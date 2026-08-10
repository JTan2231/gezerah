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
  actorMutationHeaders,
  actorRequest,
  disposeAuthenticatedActors,
  getAs,
  postAs,
  putAs,
  signupActor,
} from "../support/auth";

interface IdentifiedResource {
  id: string;
}

test.afterEach(async () => disposeAuthenticatedActors());

interface WorldResponse extends IdentifiedResource {
  name: string;
  role: "owner" | "editor" | "player" | "spectator";
  membership_id: string;
  member_count: number;
  revision: number;
  table_revision: number;
  rules_revision: number;
  play_status:
    "waiting-for-character" | "setup-required" | "ready" | "unavailable";
}

interface WorldMember extends IdentifiedResource {
  user_id: string;
  role: WorldResponse["role"];
  play_status: WorldResponse["play_status"];
  controlled_entity_ids: string[];
}

interface InviteResponse extends IdentifiedResource {
  role: "editor" | "player" | "spectator";
  join_path?: string;
  use_count: number;
}

interface Mechanic extends IdentifiedResource {
  name: string;
  source_kind: "input" | "derived";
  mutable_during_play: boolean;
  archived: boolean;
}

interface MechanicMutation {
  revision: number;
  mechanic: Mechanic;
}

interface MechanicCollection {
  revision: number;
  mechanics: Mechanic[];
}

interface CharacterFieldSet {
  revision: number;
  fields: Array<{
    id: string;
    label: string;
    help_text?: string;
    visibility: "table" | "controllers-and-facilitators";
  }>;
}

interface StateResponse {
  entity_id: string;
  revision: number;
  status_revision: number;
  rules_revision: number;
  values: Record<string, TaggedValue>;
  effective_values: Record<string, TaggedValue>;
  active_statuses: Array<{
    id: string;
    source_interaction_id: string;
    source_resolution_id: string;
    source_effect_id: string;
  }>;
}

interface EntityResponse extends IdentifiedResource {
  display_name: string;
  archived: boolean;
  character_status: "not-controlled" | "setup-required" | "ready";
  state: StateResponse;
}

interface ProfileResponse {
  entity_id: string;
  revision: number;
  character_fields_revision: number;
  character_status: "not-controlled" | "setup-required" | "ready";
  required_field_count: number;
  completed_field_count: number;
  can_edit: boolean;
  missing_field_ids?: string[];
  fields: Array<{
    id: string;
    label: string;
    visibility: "table" | "controllers-and-facilitators";
    value?: string;
  }>;
}

interface InteractionAction extends IdentifiedResource {
  interaction_id: string;
  submitted_by_membership_id: string;
  acting_entity_id?: string;
  acting_entity_name?: string;
  text: string;
  status: "submitted" | "withdrawn" | "selected" | "declined";
  revision: number;
}

interface ResolutionReceipt extends IdentifiedResource {
  narrative: string;
  private_notes?: string;
  effects: unknown[];
  applied_effects: Array<{
    effect_id: string;
    entity_id: string;
    mechanic_id?: string;
    status_instance_id?: string;
  }>;
}

interface InteractionResponse extends IdentifiedResource {
  prompt: string;
  private_notes?: string;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  revision: number;
  audience_membership_ids: string[];
  eligible_responder_membership_ids: string[];
  entity_ids: string[];
  actions: InteractionAction[];
  resolution?: ResolutionReceipt;
}

interface ResolutionResult {
  interaction_id: string;
  interaction_revision: number;
  applied_effects: ResolutionReceipt["applied_effects"];
  state: { records: Record<string, StateResponse> };
}

interface ControllerResponse {
  entity_id: string;
  controller_world_membership_ids: string[];
  table_revision: number;
}

interface WorldEvent {
  id: number;
  type: string;
  interaction_id?: string;
  submission_id?: string;
  resolution_id?: string;
}

type DecimalText = string;

type TaggedValue =
  { kind: "number"; value: DecimalText } | { kind: "boolean"; value: boolean };

test("contract: direct scenario gap closures preserve state, privacy, and authority", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createActor(request, baseURL, `Gap Owner ${unique}`);
  const editor = await createActor(request, baseURL, `Gap Editor ${unique}`);
  const player = await createActor(request, baseURL, `Gap Player ${unique}`);
  const setupPlayer = await createActor(
    request,
    baseURL,
    `Gap Setup Player ${unique}`,
  );
  const waitingPlayer = await createActor(
    request,
    baseURL,
    `Gap Waiting Player ${unique}`,
  );
  const spectator = await createActor(
    request,
    baseURL,
    `Gap Spectator ${unique}`,
  );
  const outsider = await createActor(
    request,
    baseURL,
    `Gap Outsider ${unique}`,
  );
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Gap Closure World ${unique}` },
    owner.id,
  );

  let playerWorld: WorldResponse;
  await test.step("INV-004 repeat redemption reuses one membership and one use", async () => {
    const invite = await createInvite(
      request,
      baseURL,
      world.id,
      owner.id,
      "player",
    );
    const token = inviteToken(invite);
    const first = await redeemInvite(request, baseURL, token, player.id);
    const replay = await redeemInvite(request, baseURL, token, player.id);
    expect(replay).toMatchObject({
      id: world.id,
      role: "player",
      membership_id: first.membership_id,
    });
    const listed = await getJSON<InviteResponse[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/invites`,
      owner.id,
    );
    expect(requiredByID(listed, invite.id, "idempotent invite").use_count).toBe(
      1,
    );
    const memberships = await getJSON<WorldMember[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/members`,
      owner.id,
    );
    expect(
      memberships.filter((member) => member.user_id === player.id),
    ).toEqual([
      expect.objectContaining({ id: first.membership_id, role: "player" }),
    ]);
    playerWorld = first;
  });

  await test.step("INV-V02 another-role redemption preserves the sole owner membership", async () => {
    const invite = await createInvite(
      request,
      baseURL,
      world.id,
      owner.id,
      "spectator",
    );
    const token = inviteToken(invite);
    const first = await redeemInvite(request, baseURL, token, owner.id);
    const replay = await redeemInvite(request, baseURL, token, owner.id);
    expect(first).toMatchObject({
      membership_id: world.membership_id,
      role: "owner",
    });
    expect(replay).toMatchObject({
      membership_id: world.membership_id,
      role: "owner",
    });
    const listed = await getJSON<InviteResponse[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/invites`,
      owner.id,
    );
    expect(requiredByID(listed, invite.id, "owner invite").use_count).toBe(1);
    const ownerMemberships = (
      await getJSON<WorldMember[]>(
        request,
        `${baseURL}/api/worlds/${world.id}/members`,
        owner.id,
      )
    ).filter((member) => member.user_id === owner.id);
    expect(ownerMemberships).toEqual([
      expect.objectContaining({ id: world.membership_id, role: "owner" }),
    ]);
  });

  const editorWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    editor.id,
    "editor",
  );
  const setupPlayerWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    setupPlayer.id,
    "player",
  );
  const waitingPlayerWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    waitingPlayer.id,
    "player",
  );
  const spectatorWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    spectator.id,
    "spectator",
  );
  expect(editorWorld.role).toBe("editor");
  expect(waitingPlayerWorld.play_status).toBe("waiting-for-character");
  expect(spectatorWorld.role).toBe("spectator");

  const initialFields = await getJSON<CharacterFieldSet>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    owner.id,
  );
  let fields = await putJSON<CharacterFieldSet>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    {
      expected_revision: initialFields.revision,
      fields: [
        {
          label: `Public account ${unique}`,
          visibility: "table",
        },
        {
          label: `Private oath ${unique}`,
          visibility: "controllers-and-facilitators",
        },
      ],
    },
    owner.id,
  );
  const publicField = required(fields.fields[0], "public field");
  const privateField = required(fields.fields[1], "private field");

  let rulesRevision = world.rules_revision;
  const baseMechanic = await createMechanic(
    request,
    baseURL,
    world.id,
    owner.id,
    inputMechanic(`Load ${unique}`, rulesRevision, true),
  );
  rulesRevision = baseMechanic.revision;
  const statusTarget = await createMechanic(
    request,
    baseURL,
    world.id,
    owner.id,
    inputMechanic(`Poise ${unique}`, rulesRevision, true),
  );
  rulesRevision = statusTarget.revision;
  const immutableMechanic = await createMechanic(
    request,
    baseURL,
    world.id,
    owner.id,
    inputMechanic(`Fixed horizon ${unique}`, rulesRevision, false),
  );
  rulesRevision = immutableMechanic.revision;
  const derivedMechanic = await createMechanic(
    request,
    baseURL,
    world.id,
    owner.id,
    derivedMechanicRequest(
      `Calculated load ${unique}`,
      baseMechanic.mechanic.id,
      rulesRevision,
    ),
  );
  rulesRevision = derivedMechanic.revision;
  const toArchive = await createMechanic(
    request,
    baseURL,
    world.id,
    owner.id,
    inputMechanic(`Retired gauge ${unique}`, rulesRevision, true),
  );
  rulesRevision = toArchive.revision;
  const archivedMechanic = await postJSON<MechanicMutation>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics/${toArchive.mechanic.id}/archive`,
    { expected_rules_revision: rulesRevision },
    owner.id,
  );
  rulesRevision = archivedMechanic.revision;

  await test.step("LFC-V01 active derived dependents block mechanic archive atomically", async () => {
    const before = await readMechanics(request, baseURL, world.id, owner.id);
    await expectAPIError(
      await actorRequest(owner.id).post(
        `${baseURL}/api/worlds/${world.id}/mechanics/${baseMechanic.mechanic.id}/archive`,
        {
          data: { expected_rules_revision: before.revision },
        },
      ),
      409,
      "mechanic_has_dependents",
    );
    expect(await readMechanics(request, baseURL, world.id, owner.id)).toEqual(
      before,
    );
    expect(
      requiredByID(before.mechanics, baseMechanic.mechanic.id, "base").archived,
    ).toBe(false);
    expect(
      requiredByID(before.mechanics, derivedMechanic.mechanic.id, "dependent")
        .archived,
    ).toBe(false);
  });

  await test.step("CCY-V02 stale complete-graph publication preserves and reloads the winner", async () => {
    const stale = await readMechanics(request, baseURL, world.id, owner.id);
    const winner = await createMechanic(
      request,
      baseURL,
      world.id,
      owner.id,
      booleanMechanic(`Winner flag ${unique}`, stale.revision),
    );
    rulesRevision = winner.revision;
    await expectAPIError(
      await actorRequest(editor.id).post(
        `${baseURL}/api/worlds/${world.id}/mechanics`,
        {
          data: booleanMechanic(`Stale flag ${unique}`, stale.revision),
        },
      ),
      409,
      "revision_conflict",
    );
    const authoritative = await readMechanics(
      request,
      baseURL,
      world.id,
      editor.id,
    );
    expect(authoritative.revision).toBe(winner.revision);
    expect(authoritative.mechanics).toContainEqual(
      expect.objectContaining({ id: winner.mechanic.id }),
    );
    expect(
      authoritative.mechanics.map((mechanic) => mechanic.name),
    ).not.toContain(`Stale flag ${unique}`);
  });

  const primary = await createEntity(
    request,
    baseURL,
    world.id,
    owner.id,
    `Primary courier ${unique}`,
    [playerWorld!.membership_id],
  );
  const fallback = await createEntity(
    request,
    baseURL,
    world.id,
    owner.id,
    `Fallback courier ${unique}`,
    [playerWorld!.membership_id],
  );
  const incomplete = await createEntity(
    request,
    baseURL,
    world.id,
    owner.id,
    `Incomplete courier ${unique}`,
    [setupPlayerWorld.membership_id],
  );
  const raceEntity = await createEntity(
    request,
    baseURL,
    world.id,
    owner.id,
    `Race courier ${unique}`,
    [],
  );
  const archivedEntityCreated = await createEntity(
    request,
    baseURL,
    world.id,
    owner.id,
    `Archived courier ${unique}`,
    [],
  );
  const archivedEntity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${archivedEntityCreated.id}/archive`,
    undefined,
    owner.id,
  );
  expect(archivedEntity.archived).toBe(true);

  const publicStory = `Known at every quay ${unique}`;
  const privateStory = `Carries the hidden seal ${unique}`;
  let primaryProfile = await saveProfile(
    request,
    baseURL,
    world.id,
    primary.id,
    player.id,
    0,
    fields.revision,
    [
      { field_id: publicField.id, value: publicStory },
      { field_id: privateField.id, value: privateStory },
    ],
  );
  let fallbackProfile = await saveProfile(
    request,
    baseURL,
    world.id,
    fallback.id,
    player.id,
    0,
    fields.revision,
    [
      { field_id: publicField.id, value: `Fallback public ${unique}` },
      { field_id: privateField.id, value: `Fallback private ${unique}` },
    ],
  );
  const incompleteProfile = await saveProfile(
    request,
    baseURL,
    world.id,
    incomplete.id,
    setupPlayer.id,
    0,
    fields.revision,
    [{ field_id: publicField.id, value: `Partial account ${unique}` }],
  );
  expect(incompleteProfile.character_status).toBe("setup-required");

  await test.step("CCY-V05 stale profile schema cannot discard a new requirement or saved values", async () => {
    const staleProfile = primaryProfile;
    const staleFields = fields;
    fields = await putJSON<CharacterFieldSet>(
      request,
      `${baseURL}/api/worlds/${world.id}/character-fields`,
      {
        expected_revision: staleFields.revision,
        fields: [
          ...staleFields.fields.map((field) => ({
            id: field.id,
            label: field.label,
            ...(field.help_text === undefined
              ? {}
              : { help_text: field.help_text }),
            visibility: field.visibility,
          })),
          {
            label: `New required bond ${unique}`,
            visibility: "table",
          },
        ],
      },
      owner.id,
    );
    await expectAPIError(
      await actorRequest(player.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${primary.id}/profile`,
        {
          data: {
            expected_revision: staleProfile.revision,
            expected_character_fields_revision: staleFields.revision,
            values: staleProfile.fields.flatMap((field) =>
              field.value === undefined
                ? []
                : [{ field_id: field.id, value: field.value }],
            ),
          },
        },
      ),
      409,
      "revision_conflict",
    );
    const authoritative = await getProfile(
      request,
      baseURL,
      world.id,
      primary.id,
      player.id,
    );
    expect(authoritative).toMatchObject({
      revision: staleProfile.revision,
      character_fields_revision: fields.revision,
      character_status: "setup-required",
      required_field_count: 3,
      completed_field_count: 2,
    });
    expect(authoritative.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: publicField.id, value: publicStory }),
        expect.objectContaining({ id: privateField.id, value: privateStory }),
      ]),
    );
    expect(authoritative.missing_field_ids).toEqual([
      required(fields.fields[2], "new field").id,
    ]);
  });

  const newField = required(fields.fields[2], "new field");
  primaryProfile = await saveProfile(
    request,
    baseURL,
    world.id,
    primary.id,
    player.id,
    primaryProfile.revision,
    fields.revision,
    [
      { field_id: publicField.id, value: publicStory },
      { field_id: privateField.id, value: privateStory },
      { field_id: newField.id, value: `New public bond ${unique}` },
    ],
  );
  fallbackProfile = await saveProfile(
    request,
    baseURL,
    world.id,
    fallback.id,
    player.id,
    fallbackProfile.revision,
    fields.revision,
    [
      { field_id: publicField.id, value: `Fallback public ${unique}` },
      { field_id: privateField.id, value: `Fallback private ${unique}` },
      { field_id: newField.id, value: `Fallback bond ${unique}` },
    ],
  );
  expect(primaryProfile.character_status).toBe("ready");
  expect(fallbackProfile.character_status).toBe("ready");

  await test.step("CCY-V04 one stale controller replacement wins and the loser reloads it", async () => {
    const before = await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      owner.id,
    );
    const responses = await Promise.all([
      actorRequest(owner.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${raceEntity.id}/controllers`,
        {
          data: {
            expected_table_revision: before.table_revision,
            controller_world_membership_ids: [playerWorld!.membership_id],
          },
        },
      ),
      actorRequest(editor.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${raceEntity.id}/controllers`,
        {
          data: {
            expected_table_revision: before.table_revision,
            controller_world_membership_ids: [setupPlayerWorld.membership_id],
          },
        },
      ),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    const winner = await expectJSON<ControllerResponse>(
      required(
        responses.find((response) => response.status() === 200),
        "controller winner",
      ),
      "controller replacement winner",
    );
    await expectAPIError(
      required(
        responses.find((response) => response.status() === 409),
        "controller loser",
      ),
      409,
      "revision_conflict",
    );
    expect(winner.table_revision).toBe(before.table_revision + 1);
    const members = await getJSON<WorldMember[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/members`,
      editor.id,
    );
    const controllers = members
      .filter((member) => member.controlled_entity_ids.includes(raceEntity.id))
      .map((member) => member.id);
    expect(controllers).toEqual(winner.controller_world_membership_ids);

    const postRaceWorld = await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      owner.id,
    );
    await putJSON<ControllerResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${raceEntity.id}/controllers`,
      {
        expected_table_revision: postRaceWorld.table_revision,
        controller_world_membership_ids: [],
      },
      owner.id,
    );
  });

  const initialPrimaryState = await getState(
    request,
    baseURL,
    world.id,
    primary.id,
    owner.id,
  );
  let primaryState = await putJSON<StateResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${primary.id}/state`,
    {
      expected_revision: initialPrimaryState.revision,
      expected_rules_revision: rulesRevision,
      values: { [baseMechanic.mechanic.id]: numberValue("5") },
    },
    owner.id,
  );

  await test.step("MEC-V05 derived mechanics cannot acquire stored sheet state", async () => {
    const before = await getState(
      request,
      baseURL,
      world.id,
      primary.id,
      owner.id,
    );
    await expectAPIError(
      await actorRequest(owner.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${primary.id}/state`,
        {
          data: {
            expected_revision: before.revision,
            expected_rules_revision: before.rules_revision,
            values: {
              ...before.values,
              [derivedMechanic.mechanic.id]: numberValue("99"),
            },
          },
        },
      ),
      422,
      "validation_failed",
    );
    expect(
      await getState(request, baseURL, world.id, primary.id, owner.id),
    ).toEqual(before);
  });

  await test.step("RST-V04 a player reads an authorized sheet but cannot mutate it", async () => {
    const before = await getState(
      request,
      baseURL,
      world.id,
      primary.id,
      player.id,
    );
    await expectAPIError(
      await actorRequest(player.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${primary.id}/state`,
        {
          data: {
            expected_revision: before.revision,
            expected_rules_revision: before.rules_revision,
            values: {
              ...before.values,
              [baseMechanic.mechanic.id]: numberValue("7"),
            },
          },
        },
      ),
      403,
      "world_editor_required",
    );
    expect(
      await getState(request, baseURL, world.id, primary.id, player.id),
    ).toEqual(before);
  });

  await test.step("AUT-V06 setup players retain onboarding reads but not live feed or events", async () => {
    const setupWorld = await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      setupPlayer.id,
    );
    expect(setupWorld.play_status).toBe("setup-required");
    const profile = await getProfile(
      request,
      baseURL,
      world.id,
      incomplete.id,
      setupPlayer.id,
    );
    expect(profile).toMatchObject({
      can_edit: true,
      character_status: "setup-required",
    });
    expect(
      await getState(request, baseURL, world.id, incomplete.id, setupPlayer.id),
    ).toMatchObject({ entity_id: incomplete.id });
    await expectAPIError(
      await actorRequest(setupPlayer.id).get(
        `${baseURL}/api/worlds/${world.id}/interactions`,
        {},
      ),
      403,
      "character_setup_required",
    );
    const eventResponse = await fetch(
      `${baseURL}/api/worlds/${world.id}/events?after=0`,
      { headers: { Cookie: await actorCookieHeader(setupPlayer.id) } },
    );
    await expectFetchAPIError(eventResponse, 403, "character_setup_required");
  });

  await test.step("PLY-V01 an explicitly audience-free draft cannot be presented", async () => {
    const draft = await postJSON<InteractionResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions`,
      {
        prompt: `No audience draft ${unique}`,
        audience_membership_ids: [],
        eligible_responder_membership_ids: [],
        entity_ids: [],
      },
      owner.id,
    );
    expect(draft).toMatchObject({
      status: "draft",
      revision: 0,
      audience_membership_ids: [],
    });
    const cursor = await latestEventCursor(baseURL, world.id, owner.id);
    await expectAPIError(
      await actorRequest(owner.id).post(
        `${baseURL}/api/worlds/${world.id}/interactions/${draft.id}/present`,
        {
          data: { expected_revision: draft.revision },
        },
      ),
      422,
      "validation_failed",
    );
    expect(
      await getInteraction(request, baseURL, world.id, draft.id, owner.id),
    ).toEqual(draft);
    expect(
      await readAvailableEvents(baseURL, world.id, owner.id, cursor),
    ).toEqual([]);
    await postJSON<InteractionResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${draft.id}/cancel`,
      { expected_revision: draft.revision },
      owner.id,
    );
  });

  await test.step("PLY-V02 non-ready responders and incomplete or archived context are rejected atomically", async () => {
    const before = await listInteractions(request, baseURL, world.id, owner.id);
    const cursor = await latestEventCursor(baseURL, world.id, owner.id);
    const cases = [
      {
        name: "waiting responder",
        audience: [world.membership_id, waitingPlayerWorld.membership_id],
        responders: [waitingPlayerWorld.membership_id],
        entities: [primary.id],
      },
      {
        name: "setup-required responder",
        audience: [world.membership_id, setupPlayerWorld.membership_id],
        responders: [setupPlayerWorld.membership_id],
        entities: [primary.id],
      },
      {
        name: "incomplete context",
        audience: [world.membership_id, playerWorld!.membership_id],
        responders: [playerWorld!.membership_id],
        entities: [incomplete.id],
      },
      {
        name: "archived context",
        audience: [world.membership_id, playerWorld!.membership_id],
        responders: [playerWorld!.membership_id],
        entities: [archivedEntity.id],
      },
    ] as const;
    for (const scenarioCase of cases) {
      await test.step(scenarioCase.name, async () => {
        await expectAPIError(
          await actorRequest(owner.id).post(
            `${baseURL}/api/worlds/${world.id}/interactions`,
            {
              data: {
                present: true,
                prompt: `${scenarioCase.name} ${unique}`,
                audience_membership_ids: scenarioCase.audience,
                eligible_responder_membership_ids: scenarioCase.responders,
                entity_ids: scenarioCase.entities,
              },
            },
          ),
          422,
          "validation_failed",
        );
      });
    }
    expect(
      await listInteractions(request, baseURL, world.id, owner.id),
    ).toEqual(before);
    expect(
      await readAvailableEvents(baseURL, world.id, owner.id, cursor),
    ).toEqual([]);
  });

  let publicResolutionInteraction: InteractionResponse;
  await test.step("AUT-007 same-world references traverse control, profile, action, receipt, and event boundaries", async () => {
    const cursor = await latestEventCursor(baseURL, world.id, owner.id);
    const problemSecret = `Facilitator setup ${unique}`;
    const receiptSecret = `Facilitator ruling ${unique}`;
    const open = await postJSON<InteractionResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions`,
      {
        present: true,
        prompt: `Same-world chain ${unique}`,
        private_notes: problemSecret,
        audience_membership_ids: [
          world.membership_id,
          playerWorld!.membership_id,
          spectatorWorld.membership_id,
        ],
        eligible_responder_membership_ids: [playerWorld!.membership_id],
        entity_ids: [primary.id],
      },
      owner.id,
    );
    const action = await postJSON<InteractionAction>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/actions`,
      {
        text: `Act through the controlled courier ${unique}`,
        acting_entity_id: primary.id,
        expected_revision: open.revision,
      },
      player.id,
    );
    expect(action).toMatchObject({
      interaction_id: open.id,
      submitted_by_membership_id: playerWorld!.membership_id,
      acting_entity_id: primary.id,
      acting_entity_name: primary.display_name,
    });
    const withAction = await getInteraction(
      request,
      baseURL,
      world.id,
      open.id,
      owner.id,
    );
    const adjudicating = await postJSON<InteractionResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/adjudicate`,
      { expected_revision: withAction.revision },
      owner.id,
    );
    const effectID = randomUUID();
    const resolved = await postJSON<ResolutionResult>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/resolve`,
      {
        expected_revision: adjudicating.revision,
        expected_rules_revision: rulesRevision,
        idempotency_key: randomUUID(),
        selected_action_id: action.id,
        action_summary: `The courier steadies the load ${unique}.`,
        narrative: `The table sees the crossing succeed ${unique}.`,
        private_notes: receiptSecret,
        effects: [
          {
            id: effectID,
            type: "set",
            entity_ids: [primary.id],
            mechanic_id: baseMechanic.mechanic.id,
            value: numberValue("6"),
          },
        ],
      },
      owner.id,
    );
    expect(resolved).toMatchObject({
      interaction_id: open.id,
      applied_effects: [
        {
          effect_id: effectID,
          entity_id: primary.id,
          mechanic_id: baseMechanic.mechanic.id,
        },
      ],
    });
    primaryState = required(
      resolved.state.records[primary.id],
      "same-world resolved state",
    );
    const ownerHistory = await getInteraction(
      request,
      baseURL,
      world.id,
      open.id,
      owner.id,
    );
    expect(ownerHistory).toMatchObject({
      status: "resolved",
      private_notes: problemSecret,
      resolution: {
        private_notes: receiptSecret,
        applied_effects: [
          expect.objectContaining({
            effect_id: effectID,
            entity_id: primary.id,
            mechanic_id: baseMechanic.mechanic.id,
          }),
        ],
      },
    });
    const resolutionID = required(ownerHistory.resolution?.id, "resolution ID");
    const events = await readAvailableEvents(
      baseURL,
      world.id,
      owner.id,
      cursor,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "resolution-applied",
        interaction_id: open.id,
        resolution_id: resolutionID,
      }),
    );
    publicResolutionInteraction = ownerHistory;

    await test.step("AUT-V04 non-facilitator projections omit private problem and receipt prose", async () => {
      for (const actorID of [player.id, spectator.id]) {
        const projection = await getInteraction(
          request,
          baseURL,
          world.id,
          open.id,
          actorID,
        );
        expect(projection).toMatchObject({
          status: "resolved",
          prompt: open.prompt,
          resolution: {
            narrative: `The table sees the crossing succeed ${unique}.`,
          },
        });
        const serialized = JSON.stringify(projection);
        expect(serialized).not.toContain(problemSecret);
        expect(serialized).not.toContain(receiptSecret);
        expect(serialized).not.toContain("private_notes");
      }
    });
  });

  await test.step("PLY-V03 simultaneous offers yield one authoritative current action", async () => {
    const open = await createOpenInteraction(
      request,
      baseURL,
      world,
      owner.id,
      `One current offer ${unique}`,
      playerWorld!.membership_id,
      primary.id,
    );
    const responses = await Promise.all([
      actorRequest(player.id).post(
        `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/actions`,
        {
          data: {
            text: "First simultaneous offer",
            expected_revision: open.revision,
          },
        },
      ),
      actorRequest(player.id).post(
        `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/actions`,
        {
          data: {
            text: "Second simultaneous offer",
            expected_revision: open.revision,
          },
        },
      ),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([
      201, 409,
    ]);
    await expectJSON<InteractionAction>(
      required(
        responses.find((response) => response.status() === 201),
        "action winner",
      ),
      "simultaneous action winner",
    );
    await expectAPIError(
      required(
        responses.find((response) => response.status() === 409),
        "action loser",
      ),
      409,
      "revision_conflict",
    );
    const authoritative = await getInteraction(
      request,
      baseURL,
      world.id,
      open.id,
      owner.id,
    );
    expect(authoritative).toMatchObject({
      status: "open",
      revision: open.revision + 1,
    });
    expect(authoritative.actions).toHaveLength(1);
    expect(authoritative.actions[0]?.status).toBe("submitted");
  });

  await test.step("CON-V02 and MEC-V05 reject derived, immutable, and archived scalar targets", async () => {
    const cases = [
      { name: "derived", mechanicID: derivedMechanic.mechanic.id },
      { name: "immutable", mechanicID: immutableMechanic.mechanic.id },
      { name: "archived", mechanicID: archivedMechanic.mechanic.id },
    ] as const;
    for (const scenarioCase of cases) {
      await assertResolutionRejectedAtomically(
        request,
        baseURL,
        world,
        owner.id,
        primary.id,
        `CON-V02 ${scenarioCase.name}`,
        rulesRevision,
        [
          {
            type: "set",
            entity_ids: [primary.id],
            mechanic_id: scenarioCase.mechanicID,
            value: numberValue("4"),
          },
        ],
      );
    }
  });

  await test.step("CON-V03 invalid status modifiers create no status, receipt, lifecycle, or event", async () => {
    const cases = [
      {
        name: "incompatible operand",
        mechanicID: baseMechanic.mechanic.id,
        value: booleanValue(true),
      },
      {
        name: "unknown target",
        mechanicID: randomUUID(),
        value: numberValue("1"),
      },
    ] as const;
    for (const scenarioCase of cases) {
      await assertResolutionRejectedAtomically(
        request,
        baseURL,
        world,
        owner.id,
        primary.id,
        `CON-V03 ${scenarioCase.name}`,
        rulesRevision,
        [
          {
            type: "apply-status",
            targets: [{ entity_id: primary.id }],
            status: {
              name: `Invalid status ${unique}`,
              modifiers: [
                {
                  mechanic_id: scenarioCase.mechanicID,
                  operation: "add-number",
                  value: scenarioCase.value,
                  priority: 0,
                },
              ],
            },
          },
        ],
      );
    }
  });

  await test.step("CON-V05 a valid early effect rolls back when a later effect fails", async () => {
    await assertResolutionRejectedAtomically(
      request,
      baseURL,
      world,
      owner.id,
      primary.id,
      "CON-V05 ordered rollback",
      rulesRevision,
      [
        {
          type: "set",
          entity_ids: [primary.id],
          mechanic_id: baseMechanic.mechanic.id,
          value: numberValue("7"),
        },
        {
          type: "adjust-number",
          entity_ids: [primary.id],
          mechanic_id: baseMechanic.mechanic.id,
          amount: "10",
        },
      ],
    );
  });

  await test.step("LFC-V02 an active status blocks mechanic archive while history stays interpretable", async () => {
    const adjudicating = await createAdjudicatingInteraction(
      request,
      baseURL,
      world,
      owner.id,
      `Status archive blocker ${unique}`,
      primary.id,
    );
    const result = await postJSON<ResolutionResult>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${adjudicating.id}/resolve`,
      {
        expected_revision: adjudicating.revision,
        expected_rules_revision: rulesRevision,
        idempotency_key: randomUUID(),
        narrative: `Poise remains under an active status ${unique}.`,
        effects: [
          {
            type: "apply-status",
            targets: [{ entity_id: primary.id }],
            status: {
              name: `Anchored ${unique}`,
              modifiers: [
                {
                  mechanic_id: statusTarget.mechanic.id,
                  operation: "add-number",
                  value: numberValue("1"),
                  priority: 0,
                },
              ],
            },
          },
        ],
      },
      owner.id,
    );
    const statusInstanceID = required(
      result.applied_effects[0]?.status_instance_id,
      "active status instance",
    );
    const stateBefore = await getState(
      request,
      baseURL,
      world.id,
      primary.id,
      owner.id,
    );
    expect(stateBefore.active_statuses).toContainEqual(
      expect.objectContaining({ id: statusInstanceID }),
    );
    const mechanicsBefore = await readMechanics(
      request,
      baseURL,
      world.id,
      owner.id,
    );
    await expectAPIError(
      await actorRequest(owner.id).post(
        `${baseURL}/api/worlds/${world.id}/mechanics/${statusTarget.mechanic.id}/archive`,
        {
          data: { expected_rules_revision: mechanicsBefore.revision },
        },
      ),
      409,
      "mechanic_has_active_statuses",
    );
    expect(
      await getState(request, baseURL, world.id, primary.id, owner.id),
    ).toEqual(stateBefore);
    expect(await readMechanics(request, baseURL, world.id, owner.id)).toEqual(
      mechanicsBefore,
    );
    const history = await getInteraction(
      request,
      baseURL,
      world.id,
      adjudicating.id,
      owner.id,
    );
    expect(history).toMatchObject({
      status: "resolved",
      resolution: {
        narrative: `Poise remains under an active status ${unique}.`,
      },
    });
  });

  await test.step("RST-V05 removing control revokes stale profile and action authority without erasing values", async () => {
    const ownerBefore = await getProfile(
      request,
      baseURL,
      world.id,
      primary.id,
      owner.id,
    );
    const tableBefore = await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      owner.id,
    );
    await putJSON<ControllerResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${primary.id}/controllers`,
      {
        expected_table_revision: tableBefore.table_revision,
        controller_world_membership_ids: [],
      },
      owner.id,
    );
    expect(
      (
        await getJSON<WorldResponse>(
          request,
          `${baseURL}/api/worlds/${world.id}`,
          player.id,
        )
      ).play_status,
    ).toBe("ready");
    await expectAPIError(
      await actorRequest(player.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${primary.id}/profile`,
        {
          data: {
            expected_revision: ownerBefore.revision,
            expected_character_fields_revision: fields.revision,
            values: [],
          },
        },
      ),
      403,
      "entity_profile_forbidden",
    );
    const ownerAfter = await getProfile(
      request,
      baseURL,
      world.id,
      primary.id,
      owner.id,
    );
    expect(ownerAfter).toMatchObject({
      revision: ownerBefore.revision,
      character_fields_revision: ownerBefore.character_fields_revision,
      character_status: "not-controlled",
      completed_field_count: ownerBefore.completed_field_count,
      required_field_count: ownerBefore.required_field_count,
      fields: ownerBefore.fields,
    });
    const formerControllerProjection = await getProfile(
      request,
      baseURL,
      world.id,
      primary.id,
      player.id,
    );
    expect(formerControllerProjection.can_edit).toBe(false);
    expect(JSON.stringify(formerControllerProjection)).not.toContain(
      privateStory,
    );
    expect(JSON.stringify(formerControllerProjection)).not.toContain(
      privateField.id,
    );
    expect(formerControllerProjection.fields).toContainEqual(
      expect.objectContaining({ id: publicField.id, value: publicStory }),
    );

    const open = await createOpenInteraction(
      request,
      baseURL,
      world,
      owner.id,
      `Removed controller attribution ${unique}`,
      playerWorld!.membership_id,
      primary.id,
    );
    await expectAPIError(
      await actorRequest(player.id).post(
        `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/actions`,
        {
          data: {
            text: `A stale attribution ${unique}`,
            acting_entity_id: primary.id,
            expected_revision: open.revision,
          },
        },
      ),
      403,
      "entity_control_required",
    );
    expect(
      await getInteraction(request, baseURL, world.id, open.id, owner.id),
    ).toMatchObject({ revision: open.revision, actions: [] });
  });

  await test.step("AUT-V01 outsider reads and commands reveal no nested-resource distinction and mutate nothing", async () => {
    const realInteraction = publicResolutionInteraction!;
    const before = await authoritativeSnapshot(
      request,
      baseURL,
      world.id,
      primary.id,
      owner.id,
    );
    expect(
      await getJSON<WorldResponse[]>(
        request,
        `${baseURL}/api/worlds`,
        outsider.id,
      ),
    ).toEqual([]);

    const nestedPairs = [
      [
        `${baseURL}/api/worlds/${world.id}/mechanics/${baseMechanic.mechanic.id}`,
        `${baseURL}/api/worlds/${world.id}/mechanics/${randomUUID()}`,
      ],
      [
        `${baseURL}/api/worlds/${world.id}/entities/${primary.id}`,
        `${baseURL}/api/worlds/${world.id}/entities/${randomUUID()}`,
      ],
      [
        `${baseURL}/api/worlds/${world.id}/interactions/${realInteraction.id}`,
        `${baseURL}/api/worlds/${world.id}/interactions/${randomUUID()}`,
      ],
    ] as const;
    for (const [existingURL, guessedURL] of nestedPairs) {
      const existing = await readAPIError(
        await actorRequest(outsider.id).get(existingURL, {}),
        403,
        "world_forbidden",
      );
      const guessed = await readAPIError(
        await actorRequest(outsider.id).get(guessedURL, {}),
        403,
        "world_forbidden",
      );
      expect(guessed).toEqual(existing);
    }

    const attempts = [
      { method: "GET", path: `/api/worlds/${world.id}` },
      { method: "GET", path: `/api/worlds/${world.id}/mechanics` },
      { method: "GET", path: `/api/worlds/${world.id}/entities` },
      {
        method: "GET",
        path: `/api/worlds/${world.id}/entities/${primary.id}/state`,
      },
      {
        method: "GET",
        path: `/api/worlds/${world.id}/entities/${primary.id}/profile`,
      },
      { method: "GET", path: `/api/worlds/${world.id}/interactions` },
      {
        method: "PATCH",
        path: `/api/worlds/${world.id}`,
        data: {
          name: "Outsider overwrite",
          expected_revision: before.world.revision,
        },
      },
      {
        method: "POST",
        path: `/api/worlds/${world.id}/invites`,
        data: { role: "player", expires_in_days: 7 },
      },
      {
        method: "POST",
        path: `/api/worlds/${world.id}/mechanics`,
        data: booleanMechanic("Outsider mechanic", before.mechanics.revision),
      },
      {
        method: "POST",
        path: `/api/worlds/${world.id}/entities`,
        data: { display_name: "Outsider entity" },
      },
      {
        method: "PUT",
        path: `/api/worlds/${world.id}/entities/${primary.id}/state`,
        data: {
          expected_revision: before.state.revision,
          expected_rules_revision: before.state.rules_revision,
          values: before.state.values,
        },
      },
      {
        method: "PUT",
        path: `/api/worlds/${world.id}/entities/${primary.id}/profile`,
        data: {
          expected_revision: before.profile.revision,
          expected_character_fields_revision: fields.revision,
          values: [],
        },
      },
      {
        method: "POST",
        path: `/api/worlds/${world.id}/interactions`,
        data: {
          prompt: "Outsider problem",
          eligible_responder_membership_ids: [],
          entity_ids: [],
        },
      },
    ] as const;
    for (const attempt of attempts) {
      await expectAPIError(
        await actorRequest(outsider.id).fetch(`${baseURL}${attempt.path}`, {
          method: attempt.method,
          ...("data" in attempt ? { data: attempt.data } : {}),
        }),
        403,
        "world_forbidden",
      );
    }
    expect(
      await authoritativeSnapshot(
        request,
        baseURL,
        world.id,
        primary.id,
        owner.id,
      ),
    ).toEqual(before);
  });

  expect(primaryState.values[baseMechanic.mechanic.id]).toEqual(
    numberValue("6"),
  );
});

async function authoritativeSnapshot(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  ownerID: string,
) {
  const [world, mechanics, entities, state, profile, interactions, invites] =
    await Promise.all([
      getJSON<WorldResponse>(
        request,
        `${baseURL}/api/worlds/${worldID}`,
        ownerID,
      ),
      readMechanics(request, baseURL, worldID, ownerID),
      getJSON<EntityResponse[]>(
        request,
        `${baseURL}/api/worlds/${worldID}/entities`,
        ownerID,
      ),
      getState(request, baseURL, worldID, entityID, ownerID),
      getProfile(request, baseURL, worldID, entityID, ownerID),
      listInteractions(request, baseURL, worldID, ownerID),
      getJSON<InviteResponse[]>(
        request,
        `${baseURL}/api/worlds/${worldID}/invites`,
        ownerID,
      ),
    ]);
  return { world, mechanics, entities, state, profile, interactions, invites };
}

async function assertResolutionRejectedAtomically(
  request: APIRequestContext,
  baseURL: string,
  world: WorldResponse,
  ownerID: string,
  entityID: string,
  label: string,
  rulesRevision: number,
  effects: readonly unknown[],
): Promise<void> {
  await test.step(label, async () => {
    const adjudicating = await createAdjudicatingInteraction(
      request,
      baseURL,
      world,
      ownerID,
      label,
      entityID,
    );
    const stateBefore = await getState(
      request,
      baseURL,
      world.id,
      entityID,
      ownerID,
    );
    const cursor = await latestEventCursor(baseURL, world.id, ownerID);
    await expectAPIError(
      await actorRequest(ownerID).post(
        `${baseURL}/api/worlds/${world.id}/interactions/${adjudicating.id}/resolve`,
        {
          data: {
            expected_revision: adjudicating.revision,
            expected_rules_revision: rulesRevision,
            idempotency_key: randomUUID(),
            narrative: `${label} must remain atomic.`,
            effects,
          },
        },
      ),
      422,
      "transition_failed",
    );
    expect(
      await getState(request, baseURL, world.id, entityID, ownerID),
    ).toEqual(stateBefore);
    const unchangedInteraction = await getInteraction(
      request,
      baseURL,
      world.id,
      adjudicating.id,
      ownerID,
    );
    expect(unchangedInteraction).toMatchObject({
      status: "adjudicating",
      revision: adjudicating.revision,
    });
    expect(unchangedInteraction).not.toHaveProperty("resolution");
    expect(
      await readAvailableEvents(baseURL, world.id, ownerID, cursor),
    ).toEqual([]);
  });
}

async function createAdjudicatingInteraction(
  request: APIRequestContext,
  baseURL: string,
  world: WorldResponse,
  ownerID: string,
  label: string,
  entityID: string,
): Promise<InteractionResponse> {
  const open = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions`,
    {
      present: true,
      prompt: `${label} ${randomUUID().slice(0, 8)}`,
      audience_membership_ids: [world.membership_id],
      eligible_responder_membership_ids: [],
      entity_ids: [entityID],
    },
    ownerID,
  );
  const adjudicating = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/adjudicate`,
    { expected_revision: open.revision },
    ownerID,
  );
  expect(adjudicating).toMatchObject({ status: "adjudicating" });
  return adjudicating;
}

async function createOpenInteraction(
  request: APIRequestContext,
  baseURL: string,
  world: WorldResponse,
  ownerID: string,
  prompt: string,
  responderMembershipID: string,
  entityID: string,
): Promise<InteractionResponse> {
  const open = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions`,
    {
      present: true,
      prompt,
      audience_membership_ids: [world.membership_id, responderMembershipID],
      eligible_responder_membership_ids: [responderMembershipID],
      entity_ids: [entityID],
    },
    ownerID,
  );
  expect(open).toMatchObject({ status: "open", revision: 1 });
  return open;
}

async function latestEventCursor(
  baseURL: string,
  worldID: string,
  userID: string,
): Promise<number> {
  const events = await readAvailableEvents(baseURL, worldID, userID, 0);
  return events.reduce((cursor, event) => Math.max(cursor, event.id), 0);
}

async function readAvailableEvents(
  baseURL: string,
  worldID: string,
  userID: string,
  after: number,
): Promise<WorldEvent[]> {
  const controller = new AbortController();
  const response = await fetch(
    `${baseURL}/api/worlds/${worldID}/events?after=${after}`,
    {
      headers: { Cookie: await actorCookieHeader(userID) },
      signal: controller.signal,
    },
  );
  expect(response.status, "authorized event stream status").toBe(200);
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

async function createActor(
  _request: APIRequestContext,
  baseURL: string,
  displayName: string,
): Promise<IdentifiedResource> {
  return signupActor(baseURL, displayName);
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

async function redeemInvite(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  userID: string,
): Promise<WorldResponse> {
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    userID,
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
  return redeemInvite(request, baseURL, inviteToken(invite), userID);
}

function inviteToken(invite: InviteResponse): string {
  return required(
    invite.join_path?.split("/").at(-1),
    `${invite.role} invite token`,
  );
}

async function createMechanic(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  data: unknown,
): Promise<MechanicMutation> {
  return postJSON<MechanicMutation>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    data,
    ownerID,
  );
}

function inputMechanic(
  name: string,
  expectedRulesRevision: number,
  mutableDuringPlay: boolean,
) {
  return {
    kind: "capacity",
    mode: "score",
    source_kind: "input",
    name,
    minimum: "0",
    maximum: "10",
    step: "1",
    default_number: "0",
    mutable_during_play: mutableDuringPlay,
    archived: false,
    expected_rules_revision: expectedRulesRevision,
  };
}

function booleanMechanic(name: string, expectedRulesRevision: number) {
  return {
    kind: "capability",
    mode: "binary",
    source_kind: "input",
    name,
    mutable_during_play: false,
    archived: false,
    expected_rules_revision: expectedRulesRevision,
  };
}

function derivedMechanicRequest(
  name: string,
  referencedMechanicID: string,
  expectedRulesRevision: number,
) {
  return {
    kind: "capacity",
    mode: "score",
    source_kind: "derived",
    name,
    mutable_during_play: false,
    archived: false,
    expression: {
      operation: "mechanic-reference",
      mechanic_id: referencedMechanicID,
    },
    expected_rules_revision: expectedRulesRevision,
  };
}

async function readMechanics(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
): Promise<MechanicCollection> {
  return getJSON<MechanicCollection>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    userID,
  );
}

async function createEntity(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  displayName: string,
  controllers: string[],
): Promise<EntityResponse> {
  return postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities`,
    {
      display_name: displayName,
      controller_world_membership_ids: controllers,
    },
    ownerID,
  );
}

async function saveProfile(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  userID: string,
  expectedRevision: number,
  expectedFieldsRevision: number,
  values: Array<{ field_id: string; value: string }>,
): Promise<ProfileResponse> {
  return putJSON<ProfileResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/profile`,
    {
      expected_revision: expectedRevision,
      expected_character_fields_revision: expectedFieldsRevision,
      values,
    },
    userID,
  );
}

async function getProfile(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  userID: string,
): Promise<ProfileResponse> {
  return getJSON<ProfileResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/profile`,
    userID,
  );
}

async function getState(
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

async function listInteractions(
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

async function getInteraction(
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

function numberValue(value: DecimalText): TaggedValue {
  return { kind: "number", value };
}

function booleanValue(value: boolean): TaggedValue {
  return { kind: "boolean", value };
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

async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await putAs(request, url, data, userID);
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

async function readAPIError(
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

async function expectAPIError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> {
  await readAPIError(response, status, code);
}

async function expectFetchAPIError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  const body = await response.text();
  expect(response.status, sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as { error?: { code?: string } };
  expect(decoded.error?.code).toBe(code);
}

function required<T>(value: T | undefined | null, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  expect(value, `${label} is not null`).not.toBeNull();
  return value as T;
}

function requiredByID<T extends IdentifiedResource>(
  values: readonly T[],
  id: string,
  label: string,
): T {
  return required(
    values.find((value) => value.id === id),
    label,
  );
}
