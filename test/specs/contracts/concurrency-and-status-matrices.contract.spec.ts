import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import { sanitizeDiagnosticBody, sanitizeURL } from "../../src/scenario";
import {
  actorCookieHeader,
  actorRequest,
  disposeAuthenticatedActors,
  getAs,
  postAs,
  signupActor,
} from "../support/auth";

const REQUIRED_NAMED_CASES = {
  "CON-V04": ["stale", "already-removed", "entity-mismatch", "cross-world"],
  "CCY-V06": ["late-submit", "late-withdraw", "stale-transition"],
} as const;

test.afterEach(async () => disposeAuthenticatedActors());

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  membership_id: string;
  rules_revision: number;
  play_status:
    "waiting-for-character" | "setup-required" | "ready" | "unavailable";
}

interface InviteResponse extends IdentifiedResource {
  join_path?: string;
}

interface ActiveStatus {
  id: string;
  name: string;
  source_interaction_id: string;
  source_resolution_id?: string;
  source_effect_id: string;
}

interface StateResponse {
  revision: number;
  status_revision: number;
  rules_revision: number;
  values: Record<string, unknown>;
  effective_values: Record<string, unknown>;
  active_statuses: ActiveStatus[];
}

interface EntityResponse extends IdentifiedResource {
  state: StateResponse;
}

interface InteractionAction extends IdentifiedResource {
  interaction_id: string;
  submitted_by_membership_id: string;
  text: string;
  status: "submitted" | "withdrawn" | "selected" | "declined";
  revision: number;
}

interface ResolutionReceipt extends IdentifiedResource {
  narrative: string;
  rules_revision: number;
  applied_effects: AppliedEffect[];
  effective_changes: unknown[];
}

interface InteractionResponse extends IdentifiedResource {
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  revision: number;
  actions: InteractionAction[];
  resolution?: ResolutionReceipt;
}

interface AppliedEffect {
  type: "set" | "adjust-number" | "apply-status" | "remove-status";
  effect_id: string;
  entity_id: string;
  status_instance_id?: string;
  status_name?: string;
  active_before?: boolean;
  active_after?: boolean;
  changed: boolean;
}

interface ResolutionResult {
  replayed?: boolean;
  interaction_id: string;
  interaction_revision: number;
  rules_revision: number;
  narrative: string;
  applied_effects: AppliedEffect[];
  effective_changes: unknown[];
  state: { records: Record<string, StateResponse> };
}

interface WorldEvent {
  id: number;
  type: string;
  interaction_id?: string;
  submission_id?: string;
  resolution_id?: string;
}

interface ContractFixture {
  baseURL: string;
  owner: IdentifiedResource;
  player: IdentifiedResource;
  world: WorldResponse;
  playerMembershipID: string;
  primaryEntity: EntityResponse;
  otherEntity: EntityResponse;
  foreignOwner: IdentifiedResource;
  foreignWorld: WorldResponse;
  foreignEntity: EntityResponse;
}

test("direct contracts: CON-V04 and CCY-V06 named matrices plus exactly-once resolution", async ({
  request,
}) => {
  expect(REQUIRED_NAMED_CASES["CON-V04"]).toHaveLength(4);
  expect(REQUIRED_NAMED_CASES["CCY-V06"]).toHaveLength(3);

  const fixture = await createFixture(request);

  await runNamedCaseMatrix("CCY-V06", REQUIRED_NAMED_CASES["CCY-V06"], [
    {
      name: "late-submit",
      expectation: "preserves the adjudication winner and creates no action",
      run: async () => {
        const interaction = await createOpenInteraction(
          request,
          fixture,
          "Late submit",
        );
        const adjudicated = await postJSON<InteractionResponse>(
          request,
          interactionURL(fixture, interaction.id, "adjudicate"),
          { expected_revision: interaction.revision },
          fixture.owner.id,
        );
        expect(adjudicated).toMatchObject({
          status: "adjudicating",
          revision: interaction.revision + 1,
          actions: [],
        });

        await expectAPIError(
          await actorRequest(fixture.player.id).post(
            interactionURL(fixture, interaction.id, "actions"),
            {
              data: {
                text: "This submission was composed against the open revision.",
                expected_revision: interaction.revision,
              },
            },
          ),
          409,
          "revision_conflict",
        );

        const durable = await readInteraction(request, fixture, interaction.id);
        await test.step("CCY-V06 PLY-V04 late-submit assertions", () => {
          expect(durable).toMatchObject({
            status: "adjudicating",
            revision: adjudicated.revision,
            actions: [],
          });
          expect(durable.resolution).toBeUndefined();
        });
      },
    },

    {
      name: "late-withdraw",
      expectation: "preserves the submitted action after adjudication",
      run: async () => {
        const interaction = await createOpenInteraction(
          request,
          fixture,
          "Late withdraw",
        );
        const action = await postJSON<InteractionAction>(
          request,
          interactionURL(fixture, interaction.id, "actions"),
          {
            text: "Hold the bridge until the signal changes.",
            expected_revision: interaction.revision,
          },
          fixture.player.id,
        );
        expect(action).toMatchObject({ status: "submitted", revision: 0 });

        const afterSubmission = await readInteraction(
          request,
          fixture,
          interaction.id,
        );
        expect(afterSubmission).toMatchObject({
          status: "open",
          revision: interaction.revision + 1,
          actions: [{ id: action.id, status: "submitted", revision: 0 }],
        });
        const adjudicated = await postJSON<InteractionResponse>(
          request,
          interactionURL(fixture, interaction.id, "adjudicate"),
          { expected_revision: afterSubmission.revision },
          fixture.owner.id,
        );

        await expectAPIError(
          await actorRequest(fixture.player.id).post(
            interactionURL(
              fixture,
              interaction.id,
              `actions/${action.id}/withdraw`,
            ),
            {
              data: { expected_revision: action.revision },
            },
          ),
          409,
          "interaction_lifecycle_conflict",
        );

        const durable = await readInteraction(request, fixture, interaction.id);
        await test.step("CCY-V06 PLY-V04 late-withdraw assertions", () => {
          expect(durable).toMatchObject({
            status: "adjudicating",
            revision: adjudicated.revision,
            actions: [{ id: action.id, status: "submitted", revision: 0 }],
          });
          expect(durable.actions).toHaveLength(1);
          expect(durable.resolution).toBeUndefined();
        });
      },
    },

    {
      name: "stale-transition",
      expectation: "permits one lifecycle winner",
      run: async () => {
        const interaction = await createOpenInteraction(
          request,
          fixture,
          "Competing lifecycle",
        );
        const responses = await Promise.all([
          actorRequest(fixture.owner.id).post(
            interactionURL(fixture, interaction.id, "adjudicate"),
            {
              data: { expected_revision: interaction.revision },
            },
          ),
          actorRequest(fixture.owner.id).post(
            interactionURL(fixture, interaction.id, "cancel"),
            {
              data: { expected_revision: interaction.revision },
            },
          ),
        ]);
        expect(responses.map((response) => response.status()).sort()).toEqual([
          200, 409,
        ]);
        const winner = required(
          responses.find((response) => response.status() === 200),
          "lifecycle winner",
        );
        const loser = required(
          responses.find((response) => response.status() === 409),
          "stale lifecycle loser",
        );
        const winningState = await expectJSON<InteractionResponse>(
          winner,
          "competing lifecycle winner",
        );
        await expectAPIError(loser, 409, "revision_conflict");

        const durable = await readInteraction(request, fixture, interaction.id);
        expect(durable).toMatchObject({
          status: winningState.status,
          revision: interaction.revision + 1,
          actions: [],
        });
        expect(["adjudicating", "cancelled"]).toContain(durable.status);
        expect(durable.resolution).toBeUndefined();
      },
    },
  ]);

  const statusSetup =
    await test.step("CCY-V07 equivalent resolve creates one durable receipt and event", async () => {
      const interaction = await createAdjudicatingInteraction(
        request,
        fixture,
        "Exactly once status application",
      );
      const firstEffectID = randomUUID();
      const secondEffectID = randomUUID();
      const idempotencyKey = randomUUID();
      const payload = {
        expected_revision: interaction.revision,
        expected_rules_revision: fixture.world.rules_revision,
        idempotency_key: idempotencyKey,
        narrative:
          "Two separately authored marks share a name but not identity.",
        effects: [
          applyStatusEffect(firstEffectID, fixture.primaryEntity.id, "Marked"),
          applyStatusEffect(secondEffectID, fixture.primaryEntity.id, "Marked"),
        ],
      };
      const cursorBeforeResolve = await latestEventCursor(
        fixture,
        fixture.world.id,
      );

      const applied = await postJSON<ResolutionResult>(
        request,
        interactionURL(fixture, interaction.id, "resolve"),
        payload,
        fixture.owner.id,
      );
      expect(applied).toMatchObject({
        interaction_id: interaction.id,
        interaction_revision: interaction.revision + 1,
        applied_effects: [
          {
            type: "apply-status",
            effect_id: firstEffectID,
            entity_id: fixture.primaryEntity.id,
            status_name: "Marked",
            active_before: false,
            active_after: true,
            changed: true,
          },
          {
            type: "apply-status",
            effect_id: secondEffectID,
            entity_id: fixture.primaryEntity.id,
            status_name: "Marked",
            active_before: false,
            active_after: true,
            changed: true,
          },
        ],
      });
      expect(applied.replayed).toBeUndefined();
      const stateAfterApply = await readState(
        request,
        fixture,
        fixture.world.id,
        fixture.primaryEntity.id,
      );
      expect(stateAfterApply.status_revision).toBe(1);
      expect(stateAfterApply.active_statuses).toHaveLength(2);
      expect(
        new Set(stateAfterApply.active_statuses.map((status) => status.id))
          .size,
      ).toBe(2);
      expect(
        stateAfterApply.active_statuses.map((status) => status.name),
      ).toEqual(["Marked", "Marked"]);

      const durableAfterApply = await readInteraction(
        request,
        fixture,
        interaction.id,
      );
      expect(durableAfterApply).toMatchObject({
        status: "resolved",
        revision: applied.interaction_revision,
        resolution: {
          narrative: payload.narrative,
          applied_effects: applied.applied_effects,
        },
      });
      const resolutionID = required(
        durableAfterApply.resolution?.id,
        "durable resolution ID",
      );
      const resolveEvents = (
        await readAvailableEvents(
          fixture,
          fixture.world.id,
          cursorBeforeResolve,
        )
      ).filter(
        (event) =>
          event.type === "resolution-applied" &&
          event.interaction_id === interaction.id,
      );
      expect(resolveEvents).toEqual([
        expect.objectContaining({ resolution_id: resolutionID }),
      ]);
      const resolveEventCursor = required(
        resolveEvents[0]?.id,
        "resolution event cursor",
      );

      const replay = await postJSON<ResolutionResult>(
        request,
        interactionURL(fixture, interaction.id, "resolve"),
        payload,
        fixture.owner.id,
      );
      expect(replay).toEqual({ ...applied, replayed: true });
      expect(
        await readState(
          request,
          fixture,
          fixture.world.id,
          fixture.primaryEntity.id,
        ),
      ).toEqual(stateAfterApply);
      expect(await readInteraction(request, fixture, interaction.id)).toEqual(
        durableAfterApply,
      );
      expect(
        (
          await readAvailableEvents(
            fixture,
            fixture.world.id,
            resolveEventCursor,
          )
        ).filter((event) => event.interaction_id === interaction.id),
      ).toEqual([]);

      return {
        interaction,
        payload,
        stateAfterApply,
        durableAfterApply,
        resolveEventCursor,
        statusIDs: stateAfterApply.active_statuses.map((status) => status.id),
      };
    });

  await test.step("CCY-V08 changed-content idempotency reuse preserves the original receipt", async () => {
    await expectAPIError(
      await actorRequest(fixture.owner.id).post(
        interactionURL(fixture, statusSetup.interaction.id, "resolve"),
        {
          data: {
            ...statusSetup.payload,
            narrative: `${statusSetup.payload.narrative} Changed after commit.`,
          },
        },
      ),
      409,
      "idempotency_conflict",
    );
    expect(
      await readState(
        request,
        fixture,
        fixture.world.id,
        fixture.primaryEntity.id,
      ),
    ).toEqual(statusSetup.stateAfterApply);
    expect(
      await readInteraction(request, fixture, statusSetup.interaction.id),
    ).toEqual(statusSetup.durableAfterApply);
    expect(
      (
        await readAvailableEvents(
          fixture,
          fixture.world.id,
          statusSetup.resolveEventCursor,
        )
      ).filter((event) => event.interaction_id === statusSetup.interaction.id),
    ).toEqual([]);
  });

  const foreignStatusID = await applyOneStatus(
    request,
    fixture,
    fixture.foreignWorld,
    fixture.foreignEntity,
    fixture.foreignOwner.id,
    "Foreign mark",
  );
  const [firstStatusID, secondStatusID] = statusSetup.statusIDs;
  expect(firstStatusID).toBeDefined();
  expect(secondStatusID).toBeDefined();
  if (firstStatusID === undefined || secondStatusID === undefined) {
    throw new Error("status setup did not create two exact instances");
  }

  await runNamedCaseMatrix("CON-V04", REQUIRED_NAMED_CASES["CON-V04"], [
    {
      name: "stale",
      expectation: "command fails after its once-valid exact target is removed",
      run: async () => {
        const staleInteraction = await createAdjudicatingInteraction(
          request,
          fixture,
          "Stale exact removal",
        );
        const stalePayload = removeStatusPayload(
          fixture,
          staleInteraction,
          fixture.primaryEntity.id,
          firstStatusID,
          "The stale removal should not select another Marked instance.",
        );
        const validPreview = await postJSON<ResolutionResult>(
          request,
          interactionURL(fixture, staleInteraction.id, "preview"),
          withoutIdempotency(stalePayload),
          fixture.owner.id,
        );
        expect(validPreview.applied_effects).toMatchObject([
          {
            type: "remove-status",
            entity_id: fixture.primaryEntity.id,
            status_instance_id: firstStatusID,
            active_before: true,
            active_after: false,
            changed: true,
          },
        ]);

        const winner = await createAdjudicatingInteraction(
          request,
          fixture,
          "Winning exact removal",
        );
        await postJSON<ResolutionResult>(
          request,
          interactionURL(fixture, winner.id, "resolve"),
          removeStatusPayload(
            fixture,
            winner,
            fixture.primaryEntity.id,
            firstStatusID,
            "A different ruling removes the exact target first.",
          ),
          fixture.owner.id,
        );
        const stateAfterWinner = await readState(
          request,
          fixture,
          fixture.world.id,
          fixture.primaryEntity.id,
        );
        expect(stateAfterWinner).toMatchObject({
          status_revision: statusSetup.stateAfterApply.status_revision + 1,
          active_statuses: [{ id: secondStatusID, name: "Marked" }],
        });

        const error = await expectAPIError(
          await actorRequest(fixture.owner.id).post(
            interactionURL(fixture, staleInteraction.id, "resolve"),
            {
              data: stalePayload,
            },
          ),
          422,
          "transition_failed",
        );
        expect(JSON.stringify(error)).toContain(
          "status instance is not active",
        );
        await expectFailedRemovalUnchanged(
          request,
          fixture,
          staleInteraction,
          stateAfterWinner,
        );
      },
    },

    {
      name: "already-removed",
      expectation: "target fails without name fallback",
      run: async () => {
        const interaction = await createAdjudicatingInteraction(
          request,
          fixture,
          "Already removed exact target",
        );
        const before = await readState(
          request,
          fixture,
          fixture.world.id,
          fixture.primaryEntity.id,
        );
        await expectAPIError(
          await actorRequest(fixture.owner.id).post(
            interactionURL(fixture, interaction.id, "resolve"),
            {
              data: removeStatusPayload(
                fixture,
                interaction,
                fixture.primaryEntity.id,
                firstStatusID,
                "A removed exact ID remains removed.",
              ),
            },
          ),
          422,
          "transition_failed",
        );
        await expectFailedRemovalUnchanged(
          request,
          fixture,
          interaction,
          before,
        );
        expect(before.active_statuses).toMatchObject([
          { id: secondStatusID, name: "Marked" },
        ]);
      },
    },

    {
      name: "entity-mismatch",
      expectation: "rejects an active instance on the wrong local entity",
      run: async () => {
        const interaction = await createAdjudicatingInteraction(
          request,
          fixture,
          "Entity-mismatched exact target",
        );
        const primaryBefore = await readState(
          request,
          fixture,
          fixture.world.id,
          fixture.primaryEntity.id,
        );
        const otherBefore = await readState(
          request,
          fixture,
          fixture.world.id,
          fixture.otherEntity.id,
        );
        await expectAPIError(
          await actorRequest(fixture.owner.id).post(
            interactionURL(fixture, interaction.id, "resolve"),
            {
              data: removeStatusPayload(
                fixture,
                interaction,
                fixture.otherEntity.id,
                secondStatusID,
                "An exact instance cannot be moved between entities.",
              ),
            },
          ),
          422,
          "transition_failed",
        );
        expect(
          await readState(
            request,
            fixture,
            fixture.world.id,
            fixture.primaryEntity.id,
          ),
        ).toEqual(primaryBefore);
        expect(
          await readState(
            request,
            fixture,
            fixture.world.id,
            fixture.otherEntity.id,
          ),
        ).toEqual(otherBefore);
        await expectInteractionStillAdjudicating(request, fixture, interaction);
      },
    },

    {
      name: "cross-world",
      expectation: "rejects a foreign status without disclosure or mutation",
      run: async () => {
        const interaction = await createAdjudicatingInteraction(
          request,
          fixture,
          "Foreign exact target",
        );
        const primaryBefore = await readState(
          request,
          fixture,
          fixture.world.id,
          fixture.primaryEntity.id,
        );
        const foreignBefore = await readState(
          request,
          fixture,
          fixture.foreignWorld.id,
          fixture.foreignEntity.id,
          fixture.foreignOwner.id,
        );
        const error = await expectAPIError(
          await actorRequest(fixture.owner.id).post(
            interactionURL(fixture, interaction.id, "resolve"),
            {
              data: removeStatusPayload(
                fixture,
                interaction,
                fixture.primaryEntity.id,
                foreignStatusID,
                "A foreign exact ID must be indistinguishable from an unavailable ID.",
              ),
            },
          ),
          422,
          "transition_failed",
        );
        const serializedError = JSON.stringify(error);
        expect(serializedError).not.toContain(fixture.foreignWorld.id);
        expect(serializedError).not.toContain(fixture.foreignEntity.id);
        expect(serializedError).not.toContain(foreignStatusID);
        expect(
          await readState(
            request,
            fixture,
            fixture.world.id,
            fixture.primaryEntity.id,
          ),
        ).toEqual(primaryBefore);
        expect(
          await readState(
            request,
            fixture,
            fixture.foreignWorld.id,
            fixture.foreignEntity.id,
            fixture.foreignOwner.id,
          ),
        ).toEqual(foreignBefore);
        await expectInteractionStillAdjudicating(request, fixture, interaction);
      },
    },
  ]);

  await test.step("CCY-V09 CON-002 competing resolves commit one receipt and one event", async () => {
    const interaction = await createAdjudicatingInteraction(
      request,
      fixture,
      "Competing first resolution",
    );
    const cursorBeforeResolve = await latestEventCursor(
      fixture,
      fixture.world.id,
    );
    const stateBeforeResolve = await readState(
      request,
      fixture,
      fixture.world.id,
      fixture.primaryEntity.id,
    );
    const narrative = "Only one of these concurrent rulings becomes history.";
    const basePayload = {
      expected_revision: interaction.revision,
      expected_rules_revision: fixture.world.rules_revision,
      narrative,
      effects: [],
    };
    const responses = await Promise.all([
      actorRequest(fixture.owner.id).post(
        interactionURL(fixture, interaction.id, "resolve"),
        {
          data: { ...basePayload, idempotency_key: randomUUID() },
        },
      ),
      actorRequest(fixture.owner.id).post(
        interactionURL(fixture, interaction.id, "resolve"),
        {
          data: { ...basePayload, idempotency_key: randomUUID() },
        },
      ),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    const winner = required(
      responses.find((response) => response.status() === 200),
      "resolution winner",
    );
    const loser = required(
      responses.find((response) => response.status() === 409),
      "resolution loser",
    );
    const winningResult = await expectJSON<ResolutionResult>(
      winner,
      "competing resolution winner",
    );
    await expectAPIError(loser, 409, "interaction_lifecycle_conflict");

    const durable = await readInteraction(request, fixture, interaction.id);
    expect(durable).toMatchObject({
      status: "resolved",
      revision: interaction.revision + 1,
      resolution: {
        narrative,
        applied_effects: [],
        effective_changes: [],
      },
    });
    expect(winningResult).toMatchObject({
      interaction_id: interaction.id,
      interaction_revision: durable.revision,
      applied_effects: [],
      effective_changes: [],
    });
    expect(
      await readState(
        request,
        fixture,
        fixture.world.id,
        fixture.primaryEntity.id,
      ),
    ).toEqual(stateBeforeResolve);
    const resolutionID = required(
      durable.resolution?.id,
      "winning resolution ID",
    );
    const resolutionEvents = (
      await readAvailableEvents(fixture, fixture.world.id, cursorBeforeResolve)
    ).filter(
      (event) =>
        event.type === "resolution-applied" &&
        event.interaction_id === interaction.id,
    );
    expect(resolutionEvents).toEqual([
      expect.objectContaining({ resolution_id: resolutionID }),
    ]);
  });
});

interface NamedContractCase<Name extends string> {
  name: Name;
  expectation: string;
  run: () => Promise<void>;
}

async function runNamedCaseMatrix<const Names extends readonly string[]>(
  scenarioID: string,
  requiredNames: Names,
  cases: ReadonlyArray<NamedContractCase<Names[number]>>,
): Promise<void> {
  expect(cases.map((scenarioCase) => scenarioCase.name)).toEqual([
    ...requiredNames,
  ]);
  for (const scenarioCase of cases) {
    await test.step(
      `${scenarioID} ${scenarioCase.name} ${scenarioCase.expectation}`,
      scenarioCase.run,
    );
  }
}

async function createFixture(
  request: APIRequestContext,
): Promise<ContractFixture> {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createActor(request, baseURL, `Matrix Owner ${unique}`);
  const player = await createActor(request, baseURL, `Matrix Player ${unique}`);
  const foreignOwner = await createActor(
    request,
    baseURL,
    `Foreign Matrix Owner ${unique}`,
  );
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Matrix World ${unique}` },
    owner.id,
  );
  const joinedPlayer = await redeemPlayer(
    request,
    baseURL,
    world.id,
    owner.id,
    player.id,
  );
  const primaryEntity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    {
      display_name: `Primary Courier ${unique}`,
      controller_world_membership_ids: [joinedPlayer.membership_id],
    },
    owner.id,
  );
  const otherEntity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: `Other Courier ${unique}` },
    owner.id,
  );
  const playerWorld = await getJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}`,
    player.id,
  );
  expect(playerWorld.play_status).toBe("ready");

  const foreignWorld = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Foreign Matrix World ${unique}` },
    foreignOwner.id,
  );
  const foreignEntity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${foreignWorld.id}/entities`,
    { display_name: `Foreign Courier ${unique}` },
    foreignOwner.id,
  );

  return {
    baseURL,
    owner,
    player,
    world,
    playerMembershipID: joinedPlayer.membership_id,
    primaryEntity,
    otherEntity,
    foreignOwner,
    foreignWorld,
    foreignEntity,
  };
}

async function createActor(
  _request: APIRequestContext,
  baseURL: string,
  displayName: string,
): Promise<IdentifiedResource> {
  return signupActor(baseURL, displayName);
}

async function redeemPlayer(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  playerID: string,
): Promise<WorldResponse> {
  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    { role: "player", expires_in_days: 7 },
    ownerID,
  );
  const token = required(
    invite.join_path?.split("/").at(-1),
    "player invite token",
  );
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    playerID,
  );
}

async function createOpenInteraction(
  request: APIRequestContext,
  fixture: ContractFixture,
  label: string,
): Promise<InteractionResponse> {
  const interaction = await postJSON<InteractionResponse>(
    request,
    `${fixture.baseURL}/api/worlds/${fixture.world.id}/interactions`,
    {
      present: true,
      prompt: `${label} ${randomUUID().slice(0, 8)}`,
      eligible_responder_membership_ids: [fixture.playerMembershipID],
      entity_ids: [fixture.primaryEntity.id],
    },
    fixture.owner.id,
  );
  expect(interaction).toMatchObject({ status: "open", revision: 1 });
  return interaction;
}

async function createAdjudicatingInteraction(
  request: APIRequestContext,
  fixture: ContractFixture,
  label: string,
): Promise<InteractionResponse> {
  const open = await createOpenInteraction(request, fixture, label);
  const adjudicating = await postJSON<InteractionResponse>(
    request,
    interactionURL(fixture, open.id, "adjudicate"),
    { expected_revision: open.revision },
    fixture.owner.id,
  );
  expect(adjudicating).toMatchObject({ status: "adjudicating", revision: 2 });
  return adjudicating;
}

async function applyOneStatus(
  request: APIRequestContext,
  fixture: ContractFixture,
  world: WorldResponse,
  entity: EntityResponse,
  actorID: string,
  label: string,
): Promise<string> {
  const open = await postJSON<InteractionResponse>(
    request,
    `${fixture.baseURL}/api/worlds/${world.id}/interactions`,
    {
      present: true,
      prompt: `${label} ${randomUUID().slice(0, 8)}`,
      eligible_responder_membership_ids: [],
      entity_ids: [entity.id],
    },
    actorID,
  );
  const interaction = await postJSON<InteractionResponse>(
    request,
    `${fixture.baseURL}/api/worlds/${world.id}/interactions/${open.id}/adjudicate`,
    { expected_revision: open.revision },
    actorID,
  );
  expect(interaction).toMatchObject({ status: "adjudicating", revision: 2 });
  const effectID = randomUUID();
  const result = await postJSON<ResolutionResult>(
    request,
    `${fixture.baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/resolve`,
    {
      expected_revision: interaction.revision,
      expected_rules_revision: world.rules_revision,
      idempotency_key: randomUUID(),
      narrative: `${label} becomes durable.`,
      effects: [applyStatusEffect(effectID, entity.id, "Foreign Marked")],
    },
    actorID,
  );
  return required(
    result.applied_effects[0]?.status_instance_id,
    `${label} status instance`,
  );
}

function applyStatusEffect(effectID: string, entityID: string, name: string) {
  return {
    id: effectID,
    type: "apply-status",
    targets: [{ entity_id: entityID }],
    status: { name, modifiers: [] },
  };
}

function removeStatusPayload(
  fixture: ContractFixture,
  interaction: InteractionResponse,
  entityID: string,
  statusInstanceID: string,
  narrative: string,
) {
  return {
    expected_revision: interaction.revision,
    expected_rules_revision: fixture.world.rules_revision,
    idempotency_key: randomUUID(),
    narrative,
    effects: [
      {
        id: randomUUID(),
        type: "remove-status",
        targets: [
          {
            entity_id: entityID,
            status_instance_id: statusInstanceID,
          },
        ],
      },
    ],
  };
}

function withoutIdempotency<T extends { idempotency_key: string }>(
  payload: T,
): Omit<T, "idempotency_key"> {
  const { idempotency_key: _idempotencyKey, ...preview } = payload;
  return preview;
}

async function expectFailedRemovalUnchanged(
  request: APIRequestContext,
  fixture: ContractFixture,
  interaction: InteractionResponse,
  stateBefore: StateResponse,
): Promise<void> {
  expect(
    await readState(
      request,
      fixture,
      fixture.world.id,
      fixture.primaryEntity.id,
    ),
  ).toEqual(stateBefore);
  await expectInteractionStillAdjudicating(request, fixture, interaction);
}

async function expectInteractionStillAdjudicating(
  request: APIRequestContext,
  fixture: ContractFixture,
  interaction: InteractionResponse,
): Promise<void> {
  const durable = await readInteraction(request, fixture, interaction.id);
  expect(durable).toMatchObject({
    status: "adjudicating",
    revision: interaction.revision,
  });
  expect(durable.resolution).toBeUndefined();
}

async function readInteraction(
  request: APIRequestContext,
  fixture: ContractFixture,
  interactionID: string,
): Promise<InteractionResponse> {
  return getJSON<InteractionResponse>(
    request,
    `${fixture.baseURL}/api/worlds/${fixture.world.id}/interactions/${interactionID}`,
    fixture.owner.id,
  );
}

async function readState(
  request: APIRequestContext,
  fixture: ContractFixture,
  worldID: string,
  entityID: string,
  userID = fixture.owner.id,
): Promise<StateResponse> {
  return getJSON<StateResponse>(
    request,
    `${fixture.baseURL}/api/worlds/${worldID}/entities/${entityID}/state`,
    userID,
  );
}

function interactionURL(
  fixture: ContractFixture,
  interactionID: string,
  suffix: string,
): string {
  return `${fixture.baseURL}/api/worlds/${fixture.world.id}/interactions/${interactionID}/${suffix}`;
}

async function latestEventCursor(
  fixture: ContractFixture,
  worldID: string,
): Promise<number> {
  const events = await readAvailableEvents(fixture, worldID, 0);
  return events.reduce((cursor, event) => Math.max(cursor, event.id), 0);
}

async function readAvailableEvents(
  fixture: ContractFixture,
  worldID: string,
  after: number,
): Promise<WorldEvent[]> {
  const controller = new AbortController();
  const response = await fetch(
    `${fixture.baseURL}/api/worlds/${worldID}/events?after=${after}`,
    {
      headers: { Cookie: await actorCookieHeader(fixture.owner.id) },
      signal: controller.signal,
    },
  );
  expect(response.status, `event stream for world ${worldID}`).toBe(200);
  const reader = required(response.body, "event stream body").getReader();
  const decoder = new TextDecoder();
  let source = "";
  try {
    for (let reads = 0; reads < 8; reads += 1) {
      const result = await Promise.race([
        reader.read().then((value) => ({ kind: "data" as const, value })),
        delay(25).then(() => ({ kind: "idle" as const })),
      ]);
      if (result.kind === "idle" || result.value.done) {
        break;
      }
      source += decoder.decode(result.value.value, { stream: true });
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return source.split("\n\n").flatMap((block): WorldEvent[] => {
    const data = block
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    return data === undefined ? [] : [JSON.parse(data) as WorldEvent];
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  userID?: string,
): Promise<T> {
  const response = await getAs(request, url, userID);
  return expectJSON<T>(response, url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await postAs(request, url, data, userID);
  return expectJSON<T>(response, url);
}

async function expectJSON<T>(response: APIResponse, url: string): Promise<T> {
  const body = await response.text();
  expect(
    response.ok(),
    `${response.status()} ${sanitizeURL(url)}: ${sanitizeDiagnosticBody(body)}`,
  ).toBe(true);
  return JSON.parse(body) as T;
}

async function expectAPIError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<unknown> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as { error?: { code?: string } };
  expect(decoded.error?.code).toBe(code);
  return decoded;
}

function required<T>(value: T | undefined | null, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
