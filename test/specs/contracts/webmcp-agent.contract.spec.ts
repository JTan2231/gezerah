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
  disposeAuthenticatedActors,
  getAs,
  postAs,
  putAs,
  signupActor,
} from "../support/auth";

test.afterEach(async () => disposeAuthenticatedActors());

type DurableRole = "owner" | "editor" | "player" | "spectator";
type CurrentPlayRole = "facilitator" | "player" | "spectator";
type PlayStatus =
  "waiting-for-character" | "setup-required" | "ready" | "unavailable";

interface WorldResponse {
  id: string;
  membership_id: string;
  role: DurableRole;
  revision: number;
  table_revision: number;
  rules_revision: number;
  dm_source: "human" | "terra" | "agent";
  facilitator: {
    source: "human" | "terra" | "agent";
    membership_id?: string;
  };
  current_play_role: CurrentPlayRole;
  play_status: PlayStatus;
}

interface InviteResponse {
  id: string;
  role: Exclude<DurableRole, "owner">;
  join_path?: string;
}

interface MechanicMutationResponse {
  revision: number;
  mechanic: { id: string; name: string };
}

interface EntityResponse {
  id: string;
  display_name: string;
  archived: boolean;
  character_status: "not-controlled" | "setup-required" | "ready";
  state: StateResponse;
}

interface AvailableCharactersResponse {
  table_revision: number;
  characters: Array<{
    id: string;
    display_name: string;
    profile_summary?: string;
  }>;
}

interface CharacterClaimResponse {
  entity_id: string;
  controller_world_membership_ids: string[];
  table_revision: number;
}

interface InteractionActionResponse {
  id: string;
  submitted_by_membership_id: string;
  acting_entity_id?: string;
  text: string;
  status: "submitted" | "withdrawn" | "selected" | "declined";
  revision: number;
}

interface AppliedEffect {
  type: "set" | "adjust-number" | "apply-status" | "remove-status";
  effect_id: string;
  entity_id: string;
  mechanic_id?: string;
  before?: TaggedValue;
  after?: TaggedValue;
  changed: boolean;
}

interface InteractionResponse {
  id: string;
  title?: string;
  prompt: string;
  facilitator_source: "human" | "terra" | "agent";
  created_by_membership_id?: string;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  revision: number;
  audience_membership_ids: string[];
  eligible_responder_membership_ids: string[];
  entity_ids: string[];
  actions: InteractionActionResponse[];
  resolution?: {
    id: string;
    facilitator_source: "human" | "terra" | "agent";
    resolved_by_membership_id?: string;
    narrative: string;
    effects: unknown[];
    applied_effects: AppliedEffect[];
  };
}

interface AgentResolutionResult {
  replayed?: boolean;
  interaction_id: string;
  interaction_revision: number;
  rules_revision: number;
  narrative: string;
  applied_effects: AppliedEffect[];
  state: { records: Record<string, StateResponse> };
}

interface StateResponse {
  entity_id: string;
  revision: number;
  rules_revision: number;
  values: Record<string, TaggedValue>;
  effective_values: Record<string, TaggedValue>;
}

type TaggedValue =
  { kind: "number"; value: string } | { kind: "boolean"; value: boolean };

test("contract: an agent facilitator uses player authority without impersonating a membership", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await signupActor(baseURL, `Agent Owner ${unique}`);
  const player = await signupActor(baseURL, `Agent Player ${unique}`);
  const spectator = await signupActor(baseURL, `Agent Spectator ${unique}`);
  const outsider = await signupActor(baseURL, `Agent Outsider ${unique}`);

  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Agent Contract ${unique}` },
    owner.id,
  );
  const playerWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    player.id,
    "player",
  );
  await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    spectator.id,
    "spectator",
  );

  const mechanic = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics`,
    {
      kind: "capacity",
      mode: "pool",
      source_kind: "input",
      name: `Lantern light ${unique}`,
      minimum: "0",
      maximum: "5",
      step: "1",
      default_number: "3",
      mutable_during_play: true,
      archived: false,
      expected_rules_revision: world.rules_revision,
    },
    owner.id,
  );
  const preset = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: `Mira Quill ${unique}` },
    owner.id,
  );
  const otherPreset = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: `Orin Vale ${unique}` },
    owner.id,
  );

  const agentWorld = await putJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/facilitator`,
    { source: "agent", expected_revision: world.revision },
    owner.id,
  );
  expect(agentWorld).toMatchObject({
    role: "owner",
    dm_source: "agent",
    facilitator: { source: "agent" },
    current_play_role: "player",
    play_status: "waiting-for-character",
    revision: world.revision + 1,
  });
  expect(agentWorld.facilitator.membership_id).toBeUndefined();

  await test.step("a waiting player sees only the narrow claim surface", async () => {
    expect(
      await getJSON<EntityResponse[]>(
        request,
        `${baseURL}/api/worlds/${world.id}/entities`,
        player.id,
      ),
    ).toEqual([]);
    await expectAPIError(
      await getAs(
        request,
        `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/state`,
        player.id,
      ),
      403,
      "character_setup_required",
    );
    await expectAPIError(
      await getAs(
        request,
        `${baseURL}/api/worlds/${world.id}/interactions`,
        player.id,
      ),
      403,
      "character_setup_required",
    );

    const available = await getJSON<AvailableCharactersResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/available-characters`,
      player.id,
    );
    expect(available.table_revision).toBe(agentWorld.table_revision);
    expect(available.characters.map(({ id }) => id).sort()).toEqual(
      [preset.id, otherPreset.id].sort(),
    );
    for (const character of available.characters) {
      expect(character).not.toHaveProperty("state");
      expect(character).not.toHaveProperty("controller_world_membership_ids");
    }
    await expectAPIError(
      await getAs(
        request,
        `${baseURL}/api/worlds/${world.id}/available-characters`,
        outsider.id,
      ),
      403,
      "world_forbidden",
    );
    await expectAPIError(
      await postAs(
        request,
        `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/claim`,
        { expected_table_revision: agentWorld.table_revision },
        spectator.id,
      ),
      403,
      "player_required",
    );
  });

  const claimWorld = await getJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}`,
    player.id,
  );
  const claim = await postJSON<CharacterClaimResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/claim`,
    { expected_table_revision: claimWorld.table_revision },
    player.id,
  );
  expect(claim).toMatchObject({
    entity_id: preset.id,
    controller_world_membership_ids: [playerWorld.membership_id],
    table_revision: claimWorld.table_revision + 1,
    play_status: "ready",
  });
  expect(
    await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      player.id,
    ),
  ).toMatchObject({
    current_play_role: "player",
    play_status: "ready",
    table_revision: claim.table_revision,
  });
  expect(
    await getJSON<StateResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/state`,
      player.id,
    ),
  ).toMatchObject({
    entity_id: preset.id,
    rules_revision: mechanic.revision,
    values: { [mechanic.mechanic.id]: { kind: "number", value: "3" } },
  });

  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/claim`,
      { expected_table_revision: claimWorld.table_revision },
      owner.id,
    ),
    409,
    "revision_conflict",
  );

  await test.step("Terra and spectators cannot pace an agent-facilitated world", async () => {
    await expectAPIError(
      await postAs(
        request,
        `${baseURL}/api/worlds/${world.id}/auto-dm/continue`,
        undefined,
        player.id,
      ),
      403,
      "facilitator_required",
    );
    await expectAPIError(
      await postAs(
        request,
        `${baseURL}/api/worlds/${world.id}/agent-dm/continue`,
        { prompt: `The lantern wakes beneath the lake ${unique}.` },
        spectator.id,
      ),
      403,
      "player_required",
    );
  });

  const interaction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/agent-dm/continue`,
    {
      title: `The light below ${unique}`,
      prompt: `The drowned lantern answers with a knock ${unique}. What do you do?`,
    },
    player.id,
  );
  expect(interaction).toMatchObject({
    title: `The light below ${unique}`,
    status: "open",
    revision: 1,
    facilitator_source: "agent",
    eligible_responder_membership_ids: [playerWorld.membership_id],
    entity_ids: [preset.id],
    actions: [],
  });
  expect(interaction.created_by_membership_id).toBeUndefined();

  const action = await postJSON<InteractionActionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/actions`,
    {
      text: `Mira shields the flame and answers the knock ${unique}.`,
      acting_entity_id: preset.id,
      expected_revision: interaction.revision,
    },
    player.id,
  );
  expect(action).toMatchObject({
    submitted_by_membership_id: playerWorld.membership_id,
    acting_entity_id: preset.id,
    status: "submitted",
  });

  const readyToResolve = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}`,
    player.id,
  );
  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/auto-dm/decide`,
      {
        expected_revision: readyToResolve.revision,
        expected_rules_revision: mechanic.revision,
        idempotency_key: randomUUID(),
      },
      player.id,
    ),
    403,
    "facilitator_required",
  );

  const idempotencyKey = randomUUID();
  const effectID = randomUUID();
  const resolutionRequest = {
    expected_revision: readyToResolve.revision,
    expected_rules_revision: mechanic.revision,
    idempotency_key: idempotencyKey,
    selected_action_id: action.id,
    action_summary: `Mira answers the light ${unique}.`,
    narrative: `The knock becomes a heartbeat, and the lantern burns one measure dimmer ${unique}.`,
    effects: [
      {
        id: effectID,
        type: "adjust-number",
        entity_ids: [preset.id],
        mechanic_id: mechanic.mechanic.id,
        amount: "-1",
      },
    ],
  };
  const resolved = await postJSON<AgentResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/agent-dm/resolve`,
    resolutionRequest,
    player.id,
  );
  expect(resolved).toMatchObject({
    interaction_id: interaction.id,
    rules_revision: mechanic.revision,
    narrative: resolutionRequest.narrative,
    applied_effects: [
      {
        type: "adjust-number",
        effect_id: effectID,
        entity_id: preset.id,
        mechanic_id: mechanic.mechanic.id,
        before: { kind: "number", value: "3" },
        after: { kind: "number", value: "2" },
        changed: true,
      },
    ],
  });

  const replay = await postJSON<AgentResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/agent-dm/resolve`,
    resolutionRequest,
    player.id,
  );
  expect(replay).toMatchObject({
    replayed: true,
    interaction_id: resolved.interaction_id,
    interaction_revision: resolved.interaction_revision,
    applied_effects: resolved.applied_effects,
  });

  const durable = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}`,
    player.id,
  );
  expect(durable).toMatchObject({
    status: "resolved",
    facilitator_source: "agent",
    actions: [
      {
        id: action.id,
        submitted_by_membership_id: playerWorld.membership_id,
        status: "selected",
      },
    ],
    resolution: {
      facilitator_source: "agent",
      narrative: resolutionRequest.narrative,
      applied_effects: [{ effect_id: effectID, changed: true }],
    },
  });
  expect(durable.resolution?.resolved_by_membership_id).toBeUndefined();
});

async function joinWorld(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  inviterID: string,
  joiningActorID: string,
  role: InviteResponse["role"],
): Promise<WorldResponse> {
  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    { role, expires_in_days: 7 },
    inviterID,
  );
  const token = invite.join_path?.split("/").at(-1);
  if (token === undefined || token === "") {
    throw new Error("created invitation has no bearer token");
  }
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    joiningActorID,
  );
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  actorID: string,
): Promise<T> {
  return expectJSON<T>(await getAs(request, url, actorID), url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID: string,
): Promise<T> {
  return expectJSON<T>(await postAs(request, url, data, actorID), url);
}

async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID: string,
): Promise<T> {
  return expectJSON<T>(await putAs(request, url, data, actorID), url);
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
): Promise<void> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  expect(JSON.parse(body)).toMatchObject({ error: { code } });
}
