import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import {
  webMCPDatabaseTracePath,
  WorldDatabaseTrace,
} from "../../src/databaseState";
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

type MembershipRole = "owner" | "editor" | "player" | "spectator";
type CurrentPlayRole = "facilitator" | "player" | "spectator";
type PlayStatus =
  "waiting-for-character" | "setup-required" | "ready" | "unavailable";

interface WorldResponse {
  id: string;
  membership_id: string;
  role: MembershipRole;
  revision: number;
  roster_revision: number;
  rules_revision: number;
  facilitator: {
    source: "human" | "terra" | "agent";
    membership_id?: string;
  };
  current_play_role: CurrentPlayRole;
  play_status: PlayStatus;
}

interface InviteResponse {
  id: string;
  role: Exclude<MembershipRole, "owner">;
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
  sheet: EntitySheetResponse;
}

interface AvailableEntitiesResponse {
  roster_revision: number;
  entities: Array<{
    id: string;
    display_name: string;
    profile_summary?: string;
  }>;
}

interface EntityClaimResponse {
  entity_id: string;
  controller_world_membership_ids: string[];
  roster_revision: number;
}

interface InteractionActionResponse {
  id: string;
  submitted_by_membership_id: string;
  acting_entity_id?: string;
  text: string;
  status: "submitted" | "withdrawn" | "selected" | "declined";
  revision: number;
}

interface EffectApplication {
  type: "set" | "adjust-number" | "apply-status" | "remove-status";
  effect_id: string;
  entity_id: string;
  mechanic_id?: string;
  status_instance_id?: string;
  status_name?: string;
  active_before?: boolean;
  active_after?: boolean;
  before?: MechanicValue;
  after?: MechanicValue;
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
  context_entity_ids: string[];
  actions: InteractionActionResponse[];
  resolution?: {
    id: string;
    facilitator_source: "human" | "terra" | "agent";
    resolved_by_membership_id?: string;
    narrative: string;
    effects: unknown[];
    applications: EffectApplication[];
    resolved_at: string;
  };
}

interface AgentResolutionResult {
  replayed?: boolean;
  interaction_id: string;
  interaction_revision: number;
  rules_revision: number;
  narrative: string;
  applications: EffectApplication[];
  entity_sheets: Record<string, EntitySheetResponse>;
}

interface EntitySheetResponse {
  entity_id: string;
  logical_state_revision: number;
  status_set_revision: number;
  rules_revision: number;
  logical_input_values: Record<string, MechanicValue>;
  effective_values: Record<string, MechanicValue>;
  evaluations: Record<string, unknown>;
  active_status_instances: Array<unknown>;
  authored_default_input_mechanic_ids: string[];
}

type MechanicValue =
  { kind: "number"; value: string } | { kind: "boolean"; value: boolean };

test("contract: Agent facilitation uses current-player authority without impersonating a membership", async ({
  request,
}, testInfo) => {
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
    facilitator: { source: "agent" },
    current_play_role: "player",
    play_status: "waiting-for-character",
    revision: world.revision + 1,
  });
  expect(agentWorld.facilitator.membership_id).toBeUndefined();

  const databaseTrace = new WorldDatabaseTrace(world.id);
  const baselineDatabaseState = await databaseTrace.capture("baseline", {
    world_id: world.id,
  });
  expect(baselineDatabaseState.changed_tables).toEqual([]);
  expect(baselineDatabaseState.state.world_membership_entity_controls).toEqual(
    [],
  );

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
        `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/sheet`,
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

    const available = await getJSON<AvailableEntitiesResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/available-entities`,
      player.id,
    );
    expect(available.roster_revision).toBe(agentWorld.roster_revision);
    expect(available.entities.map(({ id }) => id).sort()).toEqual(
      [preset.id, otherPreset.id].sort(),
    );
    for (const entity of available.entities) {
      expect(entity).not.toHaveProperty("sheet");
      expect(entity).not.toHaveProperty("controller_world_membership_ids");
    }
    await expectAPIError(
      await getAs(
        request,
        `${baseURL}/api/worlds/${world.id}/available-entities`,
        outsider.id,
      ),
      403,
      "world_forbidden",
    );
    await expectAPIError(
      await postAs(
        request,
        `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/claim`,
        { expected_roster_revision: agentWorld.roster_revision },
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
  const claim = await postJSON<EntityClaimResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/claim`,
    { expected_roster_revision: claimWorld.roster_revision },
    player.id,
  );
  expect(claim).toMatchObject({
    entity_id: preset.id,
    controller_world_membership_ids: [playerWorld.membership_id],
    roster_revision: claimWorld.roster_revision + 1,
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
    roster_revision: claim.roster_revision,
  });
  expect(
    await getJSON<EntitySheetResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/sheet`,
      player.id,
    ),
  ).toMatchObject({
    entity_id: preset.id,
    rules_revision: mechanic.revision,
    logical_input_values: {
      [mechanic.mechanic.id]: { kind: "number", value: "3" },
    },
  });
  const claimDatabaseState = await databaseTrace.capture("claim_entity", {
    entity_id: preset.id,
    membership_id: playerWorld.membership_id,
  });
  expect(claimDatabaseState.changed_tables).toEqual([
    "worlds",
    "world_membership_entity_controls",
    "world_events",
  ]);
  expect(
    claimDatabaseState.state.world_membership_entity_controls,
  ).toContainEqual(
    expect.objectContaining({
      membership_id: playerWorld.membership_id,
      entity_id: preset.id,
    }),
  );

  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${preset.id}/claim`,
      { expected_roster_revision: claimWorld.roster_revision },
      owner.id,
    ),
    409,
    "revision_conflict",
  );

  await test.step("Terra and spectators cannot pace an agent-facilitated world", async () => {
    await expectAPIError(
      await postAs(
        request,
        `${baseURL}/api/worlds/${world.id}/terra/continue`,
        undefined,
        player.id,
      ),
      403,
      "facilitator_required",
    );
    await expectAPIError(
      await postAs(
        request,
        `${baseURL}/api/worlds/${world.id}/agent/continue`,
        { prompt: `The lantern wakes beneath the lake ${unique}.` },
        spectator.id,
      ),
      403,
      "player_required",
    );
  });

  const interaction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/agent/continue`,
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
    context_entity_ids: [preset.id],
    actions: [],
  });
  expect(interaction.created_by_membership_id).toBeUndefined();
  const presentDatabaseState = await databaseTrace.capture("present_problem", {
    interaction_id: interaction.id,
  });
  expect(presentDatabaseState.changed_tables).toEqual([
    "interactions",
    "interaction_audience_members",
    "interaction_eligible_responders",
    "interaction_context_entities",
    "world_events",
  ]);
  expect(presentDatabaseState.state.interactions).toContainEqual(
    expect.objectContaining({
      id: interaction.id,
      status: "open",
      facilitator_source: "agent",
    }),
  );

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
  const actionDatabaseState = await databaseTrace.capture("submit_action", {
    interaction_id: interaction.id,
    action_id: action.id,
  });
  expect(actionDatabaseState.changed_tables).toEqual([
    "interactions",
    "interaction_actions",
    "world_events",
  ]);
  expect(actionDatabaseState.state.interaction_actions).toContainEqual(
    expect.objectContaining({
      id: action.id,
      interaction_id: interaction.id,
      status: "submitted",
    }),
  );

  const readyToResolve = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}`,
    player.id,
  );
  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/terra/decide`,
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
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/agent/resolve`,
    resolutionRequest,
    player.id,
  );
  expect(resolved).toMatchObject({
    interaction_id: interaction.id,
    rules_revision: mechanic.revision,
    narrative: resolutionRequest.narrative,
    applications: [
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
  const resolutionDatabaseState = await databaseTrace.capture(
    "resolve_problem",
    {
      interaction_id: interaction.id,
      action_id: action.id,
      effect_id: effectID,
    },
  );
  expect(resolutionDatabaseState.changed_tables).toEqual([
    "entity_logical_states",
    "entity_input_value_overrides",
    "interactions",
    "interaction_actions",
    "interaction_resolutions",
    "interaction_resolution_effects",
    "interaction_resolution_effect_targets",
    "interaction_resolution_scalar_applications",
    "interaction_resolution_effective_changes",
    "world_events",
  ]);
  expect(
    resolutionDatabaseState.state.entity_input_value_overrides,
  ).toContainEqual(
    expect.objectContaining({
      entity_id: preset.id,
      mechanic_id: mechanic.mechanic.id,
      number_value: "2",
    }),
  );
  expect(
    resolutionDatabaseState.state.interaction_resolution_scalar_applications,
  ).toContainEqual(
    expect.objectContaining({
      effect_id: effectID,
      entity_id: preset.id,
      before_number: "3",
      after_number: "2",
      changed: true,
    }),
  );
  expect(
    resolutionDatabaseState.state.world_events
      .filter((event) => event.interaction_id === interaction.id)
      .map((event) => event.event_type),
  ).toEqual([
    "interaction-created",
    "interaction-presented",
    "action-submitted",
    "interaction-adjudicating",
    "resolution-committed",
  ]);

  const replay = await postJSON<AgentResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/agent/resolve`,
    resolutionRequest,
    player.id,
  );
  expect(replay).toMatchObject({
    replayed: true,
    interaction_id: resolved.interaction_id,
    interaction_revision: resolved.interaction_revision,
    applications: resolved.applications,
  });
  const replayDatabaseState = await databaseTrace.capture(
    "resolve_problem (idempotent replay)",
    { interaction_id: interaction.id },
  );
  expect(replayDatabaseState.changed_tables).toEqual([]);
  expect(replayDatabaseState.state).toEqual(resolutionDatabaseState.state);

  await testInfo.attach("webmcp-database-trace", {
    path: webMCPDatabaseTracePath,
    contentType: "application/json",
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
      applications: [{ effect_id: effectID, changed: true }],
      resolved_at: expect.any(String),
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
