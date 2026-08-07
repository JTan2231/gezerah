import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { expireInviteForDirectContract } from "../../src/controlledTime";
import { readBaseURL } from "../../src/runtime";
import { sanitizeDiagnosticBody, sanitizeURL } from "../../src/scenario";

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  membership_id: string;
  revision: number;
  table_revision: number;
  rules_revision: number;
  role: "owner" | "editor" | "player" | "spectator";
  status: "active" | "archived";
}

interface WorldMemberResponse extends IdentifiedResource {
  user_id: string;
  role: WorldResponse["role"];
  controlled_entity_ids: string[];
}

interface InviteResponse extends IdentifiedResource {
  role: "editor" | "player" | "spectator";
  expires_at: string;
  join_path?: string;
  revoked_at?: string;
  use_count: number;
}

interface MechanicResponse extends IdentifiedResource {
  name: string;
}

interface MechanicMutationResponse {
  revision: number;
  mechanic: MechanicResponse;
}

interface MechanicCollectionResponse {
  revision: number;
  mechanics: MechanicResponse[];
}

interface ActiveStatusResponse extends IdentifiedResource {
  name: string;
}

interface StateResponse {
  revision: number;
  status_revision: number;
  values: Record<string, unknown>;
  effective_values: Record<string, unknown>;
  active_statuses: ActiveStatusResponse[];
}

interface EntityResponse extends IdentifiedResource {
  display_name: string;
  state: StateResponse;
}

interface InteractionActionResponse extends IdentifiedResource {
  revision: number;
  status: "submitted" | "withdrawn" | "selected" | "declined";
}

interface InteractionResponse extends IdentifiedResource {
  revision: number;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  actions: InteractionActionResponse[];
}

interface ResolutionResult {
  interaction_id: string;
  interaction_revision: number;
  applied_effects: Array<{
    type: string;
    entity_id: string;
    status_instance_id?: string;
  }>;
  state: { records: Record<string, StateResponse> };
}

interface APIErrorPayload {
  error: {
    code: string;
    message?: string;
    fields?: Record<string, string>;
  };
}

type InviteClosureCase = {
  scenario: "INV-V01";
  case: "invalid" | "revoked" | "expired";
  evidence: "runtime";
};

const INV_V01_CASES = [
  { scenario: "INV-V01", case: "invalid", evidence: "runtime" },
  { scenario: "INV-V01", case: "revoked", evidence: "runtime" },
  { scenario: "INV-V01", case: "expired", evidence: "runtime" },
] as const satisfies readonly InviteClosureCase[];

type RoleDenialCase = {
  scenario: "AUT-V02";
  case:
    | "player-configure"
    | "spectator-configure"
    | "player-facilitate"
    | "spectator-facilitate"
    | "spectator-respond"
    | "editor-archive";
  actor: "player" | "spectator" | "editor";
  command: "configure" | "facilitate" | "respond" | "archive";
  code:
    | "world_editor_required"
    | "facilitator_required"
    | "player_required"
    | "world_owner_required";
};

const AUT_V02_CASES = [
  {
    scenario: "AUT-V02",
    case: "player-configure",
    actor: "player",
    command: "configure",
    code: "world_editor_required",
  },
  {
    scenario: "AUT-V02",
    case: "spectator-configure",
    actor: "spectator",
    command: "configure",
    code: "world_editor_required",
  },
  {
    scenario: "AUT-V02",
    case: "player-facilitate",
    actor: "player",
    command: "facilitate",
    code: "facilitator_required",
  },
  {
    scenario: "AUT-V02",
    case: "spectator-facilitate",
    actor: "spectator",
    command: "facilitate",
    code: "facilitator_required",
  },
  {
    scenario: "AUT-V02",
    case: "spectator-respond",
    actor: "spectator",
    command: "respond",
    code: "player_required",
  },
  {
    scenario: "AUT-V02",
    case: "editor-archive",
    actor: "editor",
    command: "archive",
    code: "world_owner_required",
  },
] as const satisfies readonly RoleDenialCase[];

type CrossWorldCase = {
  scenario: "AUT-V05";
  case: "mechanic" | "entity" | "membership" | "action" | "status-instance";
};

const AUT_V05_CASES = [
  { scenario: "AUT-V05", case: "mechanic" },
  { scenario: "AUT-V05", case: "entity" },
  { scenario: "AUT-V05", case: "membership" },
  { scenario: "AUT-V05", case: "action" },
  { scenario: "AUT-V05", case: "status-instance" },
] as const satisfies readonly CrossWorldCase[];

test("contract: invitation closure and authorization matrices are atomic and private", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createUser(request, baseURL, `Matrix Owner ${unique}`);
  const editor = await createUser(request, baseURL, `Matrix Editor ${unique}`);
  const player = await createUser(request, baseURL, `Matrix Player ${unique}`);
  const spectator = await createUser(
    request,
    baseURL,
    `Matrix Spectator ${unique}`,
  );
  const inviteCandidate = await createUser(
    request,
    baseURL,
    `Matrix Invite Candidate ${unique}`,
  );

  const primaryWorld = await createWorld(
    request,
    baseURL,
    owner.id,
    `Matrix Primary ${unique}`,
  );
  const primaryEditor = await joinWorld(
    request,
    baseURL,
    primaryWorld.id,
    owner.id,
    editor.id,
    "editor",
  );
  const primaryPlayer = await joinWorld(
    request,
    baseURL,
    primaryWorld.id,
    owner.id,
    player.id,
    "player",
  );
  const primarySpectator = await joinWorld(
    request,
    baseURL,
    primaryWorld.id,
    owner.id,
    spectator.id,
    "spectator",
  );
  const primaryMechanic = await createMechanic(
    request,
    baseURL,
    primaryWorld.id,
    owner.id,
    `Primary measure ${unique}`,
    primaryWorld.rules_revision,
  );
  const primaryEntity = await createEntity(
    request,
    baseURL,
    primaryWorld.id,
    owner.id,
    `Primary subject ${unique}`,
    primaryPlayer.membership_id,
  );

  const foreignWorld = await createWorld(
    request,
    baseURL,
    owner.id,
    `Matrix Foreign ${unique}`,
  );
  const foreignPlayer = await joinWorld(
    request,
    baseURL,
    foreignWorld.id,
    owner.id,
    player.id,
    "player",
  );
  const foreignMechanic = await createMechanic(
    request,
    baseURL,
    foreignWorld.id,
    owner.id,
    `Foreign measure ${unique}`,
    foreignWorld.rules_revision,
  );
  const foreignEntity = await createEntity(
    request,
    baseURL,
    foreignWorld.id,
    owner.id,
    `Foreign subject ${unique}`,
    foreignPlayer.membership_id,
  );
  const foreignOpen = await createOpenInteraction(
    request,
    baseURL,
    foreignWorld.id,
    owner.id,
    foreignPlayer.membership_id,
    foreignEntity.id,
    `Foreign prompt ${unique}`,
  );
  const foreignAction = await postJSON<InteractionActionResponse>(
    request,
    `${baseURL}/api/worlds/${foreignWorld.id}/interactions/${foreignOpen.id}/actions`,
    {
      text: `Foreign response ${unique}`,
      acting_entity_id: foreignEntity.id,
      expected_revision: foreignOpen.revision,
    },
    player.id,
  );
  const foreignAdjudicating = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${foreignWorld.id}/interactions/${foreignOpen.id}/adjudicate`,
    { expected_revision: foreignOpen.revision + 1 },
    owner.id,
  );
  const foreignStatusName = `Foreign status ${unique}`;
  await postJSON<ResolutionResult>(
    request,
    `${baseURL}/api/worlds/${foreignWorld.id}/interactions/${foreignOpen.id}/resolve`,
    {
      expected_revision: foreignAdjudicating.revision,
      expected_rules_revision: foreignMechanic.revision,
      idempotency_key: randomUUID(),
      selected_action_id: foreignAction.id,
      narrative: `Foreign ruling ${unique}`,
      effects: [
        {
          id: randomUUID(),
          type: "apply-status",
          targets: [{ entity_id: foreignEntity.id }],
          status: {
            name: foreignStatusName,
            modifiers: [
              {
                mechanic_id: foreignMechanic.mechanic.id,
                operation: "add-number",
                value: numberValue(1),
                priority: 0,
              },
            ],
          },
        },
      ],
    },
    owner.id,
  );
  const foreignState = await getJSON<StateResponse>(
    request,
    `${baseURL}/api/worlds/${foreignWorld.id}/entities/${foreignEntity.id}/state`,
    owner.id,
  );
  const foreignStatus = required(
    foreignState.active_statuses[0],
    "foreign active status",
  );

  const primaryOpen = await createOpenInteraction(
    request,
    baseURL,
    primaryWorld.id,
    owner.id,
    primaryPlayer.membership_id,
    primaryEntity.id,
    `Primary prompt ${unique}`,
  );

  await test.step("INV-V01[invalid] closes without membership change", async () => {
    const beforeWorlds = await worldsFor(request, baseURL, inviteCandidate.id);
    const beforeMembers = await membersFor(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
    );
    const invalidToken = randomUUID().replaceAll("-", "");

    const previewError = await expectAPIError(
      await request.get(`${baseURL}/api/world-invites/${invalidToken}`),
      404,
      "invite_not_found",
    );
    const redeemError = await expectAPIError(
      await request.post(
        `${baseURL}/api/world-invites/${invalidToken}/redeem`,
        { headers: identityHeaders(inviteCandidate.id) },
      ),
      404,
      "invite_not_found",
    );
    expect(JSON.stringify([previewError, redeemError])).not.toContain(
      primaryWorld.id,
    );
    expect(await worldsFor(request, baseURL, inviteCandidate.id)).toEqual(
      beforeWorlds,
    );
    expect(
      await membersFor(request, baseURL, primaryWorld.id, owner.id),
    ).toEqual(beforeMembers);
  });

  await test.step("INV-V01[revoked] closes without membership or redemption", async () => {
    const invite = await createInvite(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
      "player",
    );
    const token = inviteToken(invite);
    await postJSON<InviteResponse>(
      request,
      `${baseURL}/api/worlds/${primaryWorld.id}/invites/${invite.id}/revoke`,
      undefined,
      owner.id,
    );
    const beforeWorlds = await worldsFor(request, baseURL, inviteCandidate.id);
    const beforeMembers = await membersFor(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
    );
    const beforeInvite = await listedInvite(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
      invite.id,
    );
    expect(beforeInvite).toMatchObject({ use_count: 0 });
    expect(beforeInvite.revoked_at).toBeTruthy();

    const previewError = await expectAPIError(
      await request.get(`${baseURL}/api/world-invites/${token}`),
      404,
      "invite_not_found",
    );
    const redeemError = await expectAPIError(
      await request.post(`${baseURL}/api/world-invites/${token}/redeem`, {
        headers: identityHeaders(inviteCandidate.id),
      }),
      404,
      "invite_not_found",
    );
    expectNoDisclosure(
      [previewError, redeemError],
      [primaryWorld.id, `Matrix Primary ${unique}`, owner.id],
    );
    expect(await worldsFor(request, baseURL, inviteCandidate.id)).toEqual(
      beforeWorlds,
    );
    expect(
      await membersFor(request, baseURL, primaryWorld.id, owner.id),
    ).toEqual(beforeMembers);
    expect(
      await listedInvite(
        request,
        baseURL,
        primaryWorld.id,
        owner.id,
        invite.id,
      ),
    ).toEqual(beforeInvite);
  });

  await test.step("INV-V01[expired] closes without membership or redemption", async () => {
    const expiredCase = required(
      INV_V01_CASES.find((item) => item.case === "expired"),
      "INV-V01 expired case manifest",
    );
    expect(expiredCase.evidence).toBe("runtime");

    const invite = await createInvite(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
      "player",
    );
    const token = inviteToken(invite);
    const beforeWorlds = await worldsFor(request, baseURL, inviteCandidate.id);
    const beforeMembers = await membersFor(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
    );

    await expireInviteForDirectContract(invite.id);
    const expiredInvite = await listedInvite(
      request,
      baseURL,
      primaryWorld.id,
      owner.id,
      invite.id,
    );
    expect(expiredInvite).toMatchObject({ use_count: 0 });
    expect(expiredInvite.revoked_at).toBeFalsy();
    expect(Date.parse(expiredInvite.expires_at)).toBeLessThan(Date.now());

    const previewError = await expectAPIError(
      await request.get(`${baseURL}/api/world-invites/${token}`),
      404,
      "invite_not_found",
    );
    const redeemError = await expectAPIError(
      await request.post(`${baseURL}/api/world-invites/${token}/redeem`, {
        headers: identityHeaders(inviteCandidate.id),
      }),
      404,
      "invite_not_found",
    );
    expectNoDisclosure(
      [previewError, redeemError],
      [primaryWorld.id, `Matrix Primary ${unique}`, owner.id],
    );
    expect(await worldsFor(request, baseURL, inviteCandidate.id)).toEqual(
      beforeWorlds,
    );
    expect(
      await membersFor(request, baseURL, primaryWorld.id, owner.id),
    ).toEqual(beforeMembers);
    expect(
      await listedInvite(
        request,
        baseURL,
        primaryWorld.id,
        owner.id,
        invite.id,
      ),
    ).toEqual(expiredInvite);
  });

  const roleActors = {
    player: player.id,
    spectator: spectator.id,
    editor: editor.id,
  } as const;
  for (const item of AUT_V02_CASES) {
    await test.step(`${item.scenario}[${item.case}] returns ${item.code} without mutation`, async () => {
      const actorID = roleActors[item.actor];
      switch (item.command) {
        case "configure": {
          const before = await mechanicsFor(
            request,
            baseURL,
            primaryWorld.id,
            owner.id,
          );
          await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/mechanics`,
              {
                headers: identityHeaders(actorID),
                data: inputMechanicRequest(
                  `Denied ${item.case} ${unique}`,
                  before.revision,
                ),
              },
            ),
            403,
            item.code,
          );
          expect(
            await mechanicsFor(request, baseURL, primaryWorld.id, owner.id),
          ).toEqual(before);
          break;
        }
        case "facilitate": {
          const before = await interactionsFor(
            request,
            baseURL,
            primaryWorld.id,
            owner.id,
          );
          await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/interactions`,
              {
                headers: identityHeaders(actorID),
                data: {
                  prompt: `Denied facilitation ${item.case} ${unique}`,
                  eligible_responder_membership_ids: [],
                  entity_ids: [],
                },
              },
            ),
            403,
            item.code,
          );
          expect(
            await interactionsFor(request, baseURL, primaryWorld.id, owner.id),
          ).toEqual(before);
          break;
        }
        case "respond": {
          const before = await interactionFor(
            request,
            baseURL,
            primaryWorld.id,
            primaryOpen.id,
            owner.id,
          );
          await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/interactions/${primaryOpen.id}/actions`,
              {
                headers: identityHeaders(actorID),
                data: {
                  text: `Denied spectator response ${unique}`,
                  expected_revision: before.revision,
                },
              },
            ),
            403,
            item.code,
          );
          expect(
            await interactionFor(
              request,
              baseURL,
              primaryWorld.id,
              primaryOpen.id,
              owner.id,
            ),
          ).toEqual(before);
          break;
        }
        case "archive": {
          const before = await worldFor(
            request,
            baseURL,
            primaryWorld.id,
            owner.id,
          );
          await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/archive`,
              {
                headers: identityHeaders(actorID),
                data: { expected_revision: before.revision },
              },
            ),
            403,
            item.code,
          );
          expect(
            await worldFor(request, baseURL, primaryWorld.id, owner.id),
          ).toEqual(before);
          break;
        }
      }
    });
  }

  const primaryAdjudicating = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${primaryWorld.id}/interactions/${primaryOpen.id}/adjudicate`,
    { expected_revision: primaryOpen.revision },
    owner.id,
  );

  for (const item of AUT_V05_CASES) {
    await test.step(`${item.scenario}[${item.case}] rejects a foreign durable ID without disclosure`, async () => {
      const primaryInteractionBefore = await interactionFor(
        request,
        baseURL,
        primaryWorld.id,
        primaryAdjudicating.id,
        owner.id,
      );
      const primaryStateBefore = await stateFor(
        request,
        baseURL,
        primaryWorld.id,
        primaryEntity.id,
        owner.id,
      );
      const foreignStateBefore = await stateFor(
        request,
        baseURL,
        foreignWorld.id,
        foreignEntity.id,
        owner.id,
      );
      let error: APIErrorPayload;
      let secrets: string[];

      switch (item.case) {
        case "mechanic":
          error = await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/interactions/${primaryAdjudicating.id}/resolve`,
              {
                headers: identityHeaders(owner.id),
                data: resolutionRequest(
                  primaryAdjudicating,
                  primaryMechanic.revision,
                  [
                    {
                      id: randomUUID(),
                      type: "set",
                      entity_ids: [primaryEntity.id],
                      mechanic_id: foreignMechanic.mechanic.id,
                      value: numberValue(4),
                    },
                  ],
                ),
              },
            ),
            422,
            "transition_failed",
          );
          secrets = [
            foreignMechanic.mechanic.id,
            foreignMechanic.mechanic.name,
          ];
          break;
        case "entity":
          error = await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/interactions/${primaryAdjudicating.id}/resolve`,
              {
                headers: identityHeaders(owner.id),
                data: resolutionRequest(
                  primaryAdjudicating,
                  primaryMechanic.revision,
                  [
                    {
                      id: randomUUID(),
                      type: "set",
                      entity_ids: [foreignEntity.id],
                      mechanic_id: primaryMechanic.mechanic.id,
                      value: numberValue(4),
                    },
                  ],
                ),
              },
            ),
            404,
            "not_found",
          );
          secrets = [foreignEntity.id, foreignEntity.display_name];
          break;
        case "membership": {
          const primaryWorldBefore = await worldFor(
            request,
            baseURL,
            primaryWorld.id,
            owner.id,
          );
          const primaryMembersBefore = await membersFor(
            request,
            baseURL,
            primaryWorld.id,
            owner.id,
          );
          error = await expectAPIError(
            await request.put(
              `${baseURL}/api/worlds/${primaryWorld.id}/entities/${primaryEntity.id}/controllers`,
              {
                headers: identityHeaders(owner.id),
                data: {
                  expected_table_revision: primaryWorldBefore.table_revision,
                  controller_world_membership_ids: [
                    foreignPlayer.membership_id,
                  ],
                },
              },
            ),
            422,
            "invalid_reference",
          );
          expect(
            await worldFor(request, baseURL, primaryWorld.id, owner.id),
          ).toEqual(primaryWorldBefore);
          expect(
            await membersFor(request, baseURL, primaryWorld.id, owner.id),
          ).toEqual(primaryMembersBefore);
          secrets = [foreignPlayer.membership_id];
          break;
        }
        case "action": {
          const foreignInteractionBefore = await interactionFor(
            request,
            baseURL,
            foreignWorld.id,
            foreignOpen.id,
            owner.id,
          );
          error = await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/interactions/${primaryAdjudicating.id}/resolve`,
              {
                headers: identityHeaders(owner.id),
                data: {
                  ...resolutionRequest(
                    primaryAdjudicating,
                    primaryMechanic.revision,
                    [],
                  ),
                  selected_action_id: foreignAction.id,
                },
              },
            ),
            422,
            "invalid_reference",
          );
          expect(
            await interactionFor(
              request,
              baseURL,
              foreignWorld.id,
              foreignOpen.id,
              owner.id,
            ),
          ).toEqual(foreignInteractionBefore);
          secrets = [foreignAction.id];
          break;
        }
        case "status-instance":
          error = await expectAPIError(
            await request.post(
              `${baseURL}/api/worlds/${primaryWorld.id}/interactions/${primaryAdjudicating.id}/resolve`,
              {
                headers: identityHeaders(owner.id),
                data: resolutionRequest(
                  primaryAdjudicating,
                  primaryMechanic.revision,
                  [
                    {
                      id: randomUUID(),
                      type: "remove-status",
                      targets: [
                        {
                          entity_id: primaryEntity.id,
                          status_instance_id: foreignStatus.id,
                        },
                      ],
                    },
                  ],
                ),
              },
            ),
            422,
            "transition_failed",
          );
          secrets = [foreignStatus.id, foreignStatusName];
          break;
      }

      await test.step("AUT-V05 GLO-003 world-isolation assertions", async () => {
        expectNoDisclosure(error, secrets);
        expect(
          await interactionFor(
            request,
            baseURL,
            primaryWorld.id,
            primaryAdjudicating.id,
            owner.id,
          ),
        ).toEqual(primaryInteractionBefore);
        expect(
          await stateFor(
            request,
            baseURL,
            primaryWorld.id,
            primaryEntity.id,
            owner.id,
          ),
        ).toEqual(primaryStateBefore);
        expect(
          await stateFor(
            request,
            baseURL,
            foreignWorld.id,
            foreignEntity.id,
            owner.id,
          ),
        ).toEqual(foreignStateBefore);
      });
    });
  }

  expect(primaryEditor.role).toBe("editor");
  expect(primarySpectator.role).toBe("spectator");
});

async function createUser(
  request: APIRequestContext,
  baseURL: string,
  displayName: string,
): Promise<IdentifiedResource> {
  return postJSON<IdentifiedResource>(request, `${baseURL}/api/users`, {
    display_name: displayName,
  });
}

async function createWorld(
  request: APIRequestContext,
  baseURL: string,
  ownerID: string,
  name: string,
): Promise<WorldResponse> {
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name },
    ownerID,
  );
}

async function joinWorld(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  userID: string,
  role: InviteResponse["role"],
): Promise<WorldResponse> {
  const invite = await createInvite(request, baseURL, worldID, ownerID, role);
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${inviteToken(invite)}/redeem`,
    undefined,
    userID,
  );
}

async function createInvite(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  role: InviteResponse["role"],
): Promise<InviteResponse> {
  return postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    { role, expires_in_days: 7 },
    ownerID,
  );
}

function inviteToken(invite: InviteResponse): string {
  return required(invite.join_path?.split("/").at(-1), "invite token");
}

async function createMechanic(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  name: string,
  expectedRulesRevision: number,
): Promise<MechanicMutationResponse> {
  return postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    inputMechanicRequest(name, expectedRulesRevision),
    ownerID,
  );
}

function inputMechanicRequest(name: string, expectedRulesRevision: number) {
  return {
    kind: "capacity",
    mode: "score",
    source_kind: "input",
    name,
    minimum: 0,
    maximum: 10,
    step: 1,
    default_number: 5,
    mutable_during_play: true,
    archived: false,
    expected_rules_revision: expectedRulesRevision,
  };
}

async function createEntity(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  displayName: string,
  controllerMembershipID: string,
): Promise<EntityResponse> {
  return postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities`,
    {
      display_name: displayName,
      controller_world_membership_ids: [controllerMembershipID],
    },
    ownerID,
  );
}

async function createOpenInteraction(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  responderMembershipID: string,
  entityID: string,
  prompt: string,
): Promise<InteractionResponse> {
  const interaction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions`,
    {
      present: true,
      prompt,
      eligible_responder_membership_ids: [responderMembershipID],
      entity_ids: [entityID],
    },
    ownerID,
  );
  expect(interaction).toMatchObject({ status: "open", revision: 1 });
  return interaction;
}

function resolutionRequest(
  interaction: InteractionResponse,
  expectedRulesRevision: number,
  effects: unknown[],
) {
  return {
    expected_revision: interaction.revision,
    expected_rules_revision: expectedRulesRevision,
    idempotency_key: randomUUID(),
    narrative: `Rejected foreign reference ${randomUUID().slice(0, 8)}`,
    effects,
  };
}

function numberValue(value: number) {
  return { kind: "number", value } as const;
}

function identityHeaders(userID: string): Record<string, string> {
  return { "X-DND-User-ID": userID };
}

async function worldFor(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
): Promise<WorldResponse> {
  return getJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}`,
    userID,
  );
}

async function worldsFor(
  request: APIRequestContext,
  baseURL: string,
  userID: string,
): Promise<WorldResponse[]> {
  return getJSON<WorldResponse[]>(request, `${baseURL}/api/worlds`, userID);
}

async function membersFor(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
): Promise<WorldMemberResponse[]> {
  return getJSON<WorldMemberResponse[]>(
    request,
    `${baseURL}/api/worlds/${worldID}/members`,
    userID,
  );
}

async function listedInvite(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
  inviteID: string,
): Promise<InviteResponse> {
  const invites = await getJSON<InviteResponse[]>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    userID,
  );
  return required(
    invites.find((invite) => invite.id === inviteID),
    "listed invite",
  );
}

async function mechanicsFor(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
): Promise<MechanicCollectionResponse> {
  return getJSON<MechanicCollectionResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    userID,
  );
}

async function interactionsFor(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
): Promise<InteractionResponse[]> {
  return getJSON<InteractionResponse[]>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions`,
    userID,
  );
}

async function interactionFor(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  interactionID: string,
  userID: string,
): Promise<InteractionResponse> {
  return getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions/${interactionID}`,
    userID,
  );
}

async function stateFor(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  userID: string,
): Promise<StateResponse> {
  return getJSON<StateResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/state`,
    userID,
  );
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  userID?: string,
): Promise<T> {
  const response = await request.get(url, {
    ...(userID === undefined ? {} : { headers: identityHeaders(userID) }),
  });
  return expectJSON<T>(response, url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await request.post(url, {
    ...(data === undefined ? {} : { data }),
    ...(userID === undefined ? {} : { headers: identityHeaders(userID) }),
  });
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
): Promise<APIErrorPayload> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as APIErrorPayload;
  expect(decoded.error.code).toBe(code);
  return decoded;
}

function expectNoDisclosure(
  error: APIErrorPayload | readonly APIErrorPayload[],
  foreignSecrets: readonly string[],
): void {
  const serialized = JSON.stringify(error);
  for (const secret of foreignSecrets) {
    expect(serialized).not.toContain(secret);
  }
}

function required<T>(value: T | undefined, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
