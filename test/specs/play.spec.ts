import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";

import { readBaseURL } from "../src/runtime";

interface IdentifiedResource {
  id: string;
}

interface GameResponse extends IdentifiedResource {
  status: "active" | "archived";
  revision: number;
  memberships: Array<{
    id: string;
    user_id: string;
    role: "facilitator" | "player" | "spectator";
    status: "invited" | "active" | "left";
    revision: number;
  }>;
  entity_ids: string[];
}

interface StateResponse {
  revision: number;
  values: Record<string, unknown>;
  defaulted_definition_ids: string[];
}

interface StateVariableResponse extends IdentifiedResource {
  label: string;
}

interface InteractionActionResponse extends IdentifiedResource {
  submitted_by_membership_id: string;
  text: string;
  status: "submitted" | "withdrawn" | "selected" | "declined";
  revision: number;
}

interface InteractionResponse extends IdentifiedResource {
  prompt: string;
  private_notes?: string;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  revision: number;
  audience_membership_ids: string[];
  eligible_responder_membership_ids: string[];
  entity_ids: string[];
  actions: InteractionActionResponse[];
  resolution?: {
    selected_action_id?: string;
    narrative: string;
    private_notes?: string;
    applied_effects: Array<{
      effect_id: string;
      entity_id: string;
      state_variable_id: string;
      before?: unknown;
      after?: unknown;
      changed: boolean;
    }>;
  };
}

interface InteractionResolutionResponse {
  preview?: boolean;
  replayed?: boolean;
  interaction_id: string;
  interaction_revision: number;
  narrative: string;
  applied_effects: Array<{
    effect_id: string;
    entity_id: string;
    state_variable_id: string;
    before?: unknown;
    after?: unknown;
    changed: boolean;
  }>;
  state: { records: Record<string, StateResponse> };
}

test("players propose and the Dungeon Master atomically resolves one live interaction", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID();
  const request = page.request;

  const ruleSet = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/rule-sets`,
    { key: `live-flow-${unique}`, name: "Live Flow" },
  );
  const ruleSetURL = `${baseURL}/api/rule-sets/${ruleSet.id}`;
  const schema = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/owner-schemas`,
    { key: `actor-${unique}`, label: "Actor", archived: false },
  );
  const offstageSchema = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/owner-schemas`,
    { key: `offstage-${unique}`, label: "Offstage", archived: false },
  );
  const healthDefinition = {
    key: `live-health-${unique}`,
    label: "Health",
    owner_schema_ids: [schema.id],
    cardinality: "one",
    value_schema: {
      kind: "number",
      minimum: 0,
      maximum: 20,
      step: 1,
    },
    missing_value: {
      kind: "default",
      value: { kind: "number", value: 10 },
      omit_when_stored: false,
    },
    condition_addressable: false,
    allowed_effect_operations: ["adjust-number"],
    display_order: 0,
    archived: false,
  };
  const health = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/state-variable-definitions`,
    healthDefinition,
  );
  const tags = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/state-variable-definitions`,
    {
      key: `live-tags-${unique}`,
      label: "Tags",
      owner_schema_ids: [schema.id],
      cardinality: "many",
      value_schema: { kind: "text" },
      missing_value: {
        kind: "default",
        value: [],
        omit_when_stored: true,
      },
      condition_addressable: false,
      allowed_effect_operations: ["set"],
      display_order: 1,
      archived: false,
    },
  );
  const offstageVariable = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/state-variable-definitions`,
    {
      key: `offstage-secret-${unique}`,
      label: "Offstage secret",
      owner_schema_ids: [offstageSchema.id],
      cardinality: "one",
      value_schema: { kind: "text" },
      missing_value: { kind: "unknown" },
      condition_addressable: false,
      allowed_effect_operations: ["set", "clear"],
      display_order: 2,
      archived: false,
    },
  );
  const hero = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/entities`,
    {
      key: `hero-${unique}`,
      display_name: "Live Hero",
      owner_schema_ids: [schema.id],
      archived: false,
    },
  );
  const offstageEntity = await postJSON<IdentifiedResource>(
    request,
    `${ruleSetURL}/entities`,
    {
      key: `offstage-entity-${unique}`,
      display_name: "Offstage Entity",
      owner_schema_ids: [offstageSchema.id],
      archived: false,
    },
  );
  const dm = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: "Live DM" },
  );
  const player = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: "Live Player" },
  );
  const spectator = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: "Live Spectator" },
  );

  let game = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games`,
    {
      rule_set_id: ruleSet.id,
      name: "Acceptance Table",
      entity_ids: [hero.id],
    },
    dm.id,
  );
  const dmMembership = required(
    game.memberships.find((membership) => membership.user_id === dm.id),
    "Dungeon Master membership",
  );
  expect(dmMembership.role).toBe("facilitator");
  expect(game.entity_ids).toEqual([hero.id]);

  game = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games/${game.id}/memberships`,
    { user_id: player.id, role: "player" },
    dm.id,
  );
  const playerMembership = required(
    game.memberships.find((membership) => membership.user_id === player.id),
    "player membership",
  );
  expect(playerMembership.status).toBe("active");

  game = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games/${game.id}/memberships`,
    { user_id: spectator.id, role: "spectator", status: "invited" },
    dm.id,
  );
  let spectatorMembership = required(
    game.memberships.find((membership) => membership.user_id === spectator.id),
    "spectator membership",
  );
  expect(spectatorMembership.status).toBe("invited");
  const invitedRead = await request.get(`${baseURL}/api/games/${game.id}`, {
    headers: identityHeaders(spectator.id),
  });
  expect(invitedRead.status()).toBe(403);
  game = await patchJSON<GameResponse>(
    request,
    `${baseURL}/api/games/${game.id}/memberships/${spectatorMembership.id}`,
    {
      status: "active",
      expected_revision: spectatorMembership.revision,
    },
    dm.id,
  );
  spectatorMembership = required(
    game.memberships.find((membership) => membership.user_id === spectator.id),
    "active spectator membership",
  );
  expect(spectatorMembership.status).toBe("active");

  const playerGameEntities = await getJSON<IdentifiedResource[]>(
    request,
    `${baseURL}/api/games/${game.id}/entities`,
    player.id,
  );
  expect(playerGameEntities.map((entity) => entity.id)).toEqual([hero.id]);
  expect(
    (
      await getJSON<IdentifiedResource[]>(
        request,
        `${baseURL}/api/games/${game.id}/state-variable-definitions`,
        player.id,
      )
    ).map((definition) => definition.id),
  ).toEqual(expect.arrayContaining([health.id, tags.id]));
  expect(
    (
      await getJSON<IdentifiedResource[]>(
        request,
        `${baseURL}/api/games/${game.id}/state-variable-definitions`,
        player.id,
      )
    ).map((definition) => definition.id),
  ).not.toContain(offstageVariable.id);

  const forbiddenAvailableEntities = await request.get(
    `${baseURL}/api/games/${game.id}/available-entities`,
    { headers: identityHeaders(player.id) },
  );
  expect(forbiddenAvailableEntities.status()).toBe(403);
  expect(
    (
      await getJSON<IdentifiedResource[]>(
        request,
        `${baseURL}/api/games/${game.id}/available-entities`,
        dm.id,
      )
    ).map((entity) => entity.id),
  ).toEqual(expect.arrayContaining([hero.id, offstageEntity.id]));
  expect(
    (
      await getJSON<IdentifiedResource[]>(
        request,
        `${baseURL}/api/play/rule-sets/${ruleSet.id}/available-entities`,
        dm.id,
      )
    ).map((entity) => entity.id),
  ).toContain(offstageEntity.id);

  const initialState = await getJSON<StateResponse>(
    request,
    `${ruleSetURL}/entities/${hero.id}/state`,
  );
  expect(initialState.revision).toBe(0);
  expect(initialState.values[health.id]).toEqual({
    kind: "number",
    value: 10,
  });
  expect(initialState.defaulted_definition_ids).toContain(health.id);

  let interaction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions`,
    {
      title: "The unstable bridge",
      prompt: "The bridge gives way beneath you. What do you do?",
      private_notes: "The hidden hinge was sabotaged.",
      audience_membership_ids: [playerMembership.id, spectatorMembership.id],
      eligible_responder_membership_ids: [playerMembership.id],
      entity_ids: [hero.id],
    },
    dm.id,
  );
  expect(interaction.status).toBe("draft");
  expect(interaction.revision).toBe(0);

  interaction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/present`,
    { expected_revision: interaction.revision },
    dm.id,
  );
  expect(interaction.status).toBe("open");
  expect(interaction.revision).toBe(1);

  const unfinishedArchive = await request.post(
    `${baseURL}/api/games/${game.id}/archive`,
    {
      data: { expected_revision: game.revision },
      headers: identityHeaders(dm.id),
    },
  );
  expect(unfinishedArchive.status()).toBe(409);
  await expect(unfinishedArchive.json()).resolves.toMatchObject({
    error: { code: "game_has_unfinished_interactions" },
  });

  const playerView = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    player.id,
  );
  expect(playerView.private_notes).toBeUndefined();
  expect(playerView.entity_ids).toEqual([hero.id]);

  const spectatorView = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    spectator.id,
  );
  expect(spectatorView.private_notes).toBeUndefined();
  const spectatorMutation = await request.post(
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/actions`,
    {
      data: {
        text: "I should not be allowed to act.",
        expected_revision: spectatorView.revision,
      },
      headers: identityHeaders(spectator.id),
    },
  );
  expect(spectatorMutation.status()).toBe(403);

  const action = await postJSON<InteractionActionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/actions`,
    {
      text: "I leap for the intact support beam.",
      expected_revision: playerView.revision,
    },
    player.id,
  );
  expect(action.status).toBe("submitted");
  expect(action.submitted_by_membership_id).toBe(playerMembership.id);

  interaction = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    dm.id,
  );
  expect(interaction.actions).toEqual([
    expect.objectContaining({
      id: action.id,
      text: "I leap for the intact support beam.",
      status: "submitted",
    }),
  ]);
  expect(interaction.private_notes).toBe("The hidden hinge was sabotaged.");

  const effectID = randomUUID();
  const emptySetEffectID = randomUUID();
  const idempotencyKey = randomUUID();
  const ruling = {
    expected_revision: interaction.revision,
    idempotency_key: idempotencyKey,
    selected_action_id: action.id,
    narrative: "You catch the beam, but the impact leaves you bruised.",
    private_notes: "The saboteur remains undiscovered.",
    effects: [
      {
        id: effectID,
        type: "adjust-number",
        entity_ids: [hero.id],
        state_variable_id: health.id,
        amount: -2,
      },
      {
        id: emptySetEffectID,
        type: "set",
        entity_ids: [hero.id],
        state_variable_id: tags.id,
        value: [],
      },
    ],
  };

  const forbidden = await request.post(
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/resolve`,
    { data: ruling, headers: identityHeaders(player.id) },
  );
  expect(forbidden.status()).toBe(403);
  await expect(forbidden.json()).resolves.toMatchObject({
    error: { code: "facilitator_required" },
  });
  expect(
    await getJSON<StateResponse>(
      request,
      `${ruleSetURL}/entities/${hero.id}/state`,
    ),
  ).toEqual(initialState);

  interaction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/adjudicate`,
    { expected_revision: interaction.revision },
    dm.id,
  );
  expect(interaction.status).toBe("adjudicating");
  expect(interaction.revision).toBe(3);
  const hiddenDuringAdjudication = await request.get(
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    { headers: identityHeaders(player.id) },
  );
  expect(hiddenDuringAdjudication.status()).toBe(404);
  expect(
    (
      await getJSON<InteractionResponse[]>(
        request,
        `${baseURL}/api/games/${game.id}/interactions`,
        player.id,
      )
    ).map((item) => item.id),
  ).not.toContain(interaction.id);
  const adjudication = {
    ...ruling,
    expected_revision: interaction.revision,
  };

  const preview = await postJSON<InteractionResolutionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/preview`,
    adjudication,
    dm.id,
  );
  expect(preview.preview).toBe(true);
  expect(preview.interaction_revision).toBe(interaction.revision);
  expect(preview.applied_effects).toEqual([
    {
      effect_id: effectID,
      entity_id: hero.id,
      state_variable_id: health.id,
      before: { kind: "number", value: 10 },
      after: { kind: "number", value: 8 },
      changed: true,
    },
    {
      effect_id: emptySetEffectID,
      entity_id: hero.id,
      state_variable_id: tags.id,
      before: [],
      after: [],
      changed: false,
    },
  ]);
  expect(preview.state.records[hero.id]?.revision).toBe(0);
  expect(
    await getJSON<StateResponse>(
      request,
      `${ruleSetURL}/entities/${hero.id}/state`,
    ),
  ).toEqual(initialState);

  const resolved = await postJSON<InteractionResolutionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/resolve`,
    adjudication,
    dm.id,
  );
  expect(resolved.preview).toBeUndefined();
  expect(resolved.interaction_revision).toBe(4);
  expect(resolved.state.records[hero.id]?.revision).toBe(1);
  expect(resolved.state.records[hero.id]?.values[health.id]).toEqual({
    kind: "number",
    value: 8,
  });

  const retried = await postJSON<InteractionResolutionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}/resolve`,
    adjudication,
    dm.id,
  );
  expect(retried.interaction_revision).toBe(4);
  expect(retried.replayed).toBe(true);
  expect(retried.applied_effects).toEqual(resolved.applied_effects);
  const finalState = await getJSON<StateResponse>(
    request,
    `${ruleSetURL}/entities/${hero.id}/state`,
  );
  expect(finalState.revision).toBe(1);
  expect(finalState.values[health.id]).toEqual({
    kind: "number",
    value: 8,
  });

  const resolvedPlayerView = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    player.id,
  );
  expect(resolvedPlayerView.status).toBe("resolved");
  expect(resolvedPlayerView.private_notes).toBeUndefined();
  expect(resolvedPlayerView.actions).toEqual([
    expect.objectContaining({ id: action.id, status: "selected" }),
  ]);
  expect(resolvedPlayerView.resolution).toMatchObject({
    selected_action_id: action.id,
    narrative: "You catch the beam, but the impact leaves you bruised.",
    applied_effects: resolved.applied_effects,
  });
  expect(resolvedPlayerView.resolution?.private_notes).toBeUndefined();

  const resolvedDMView = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    dm.id,
  );
  expect(resolvedDMView.resolution?.private_notes).toBe(
    "The saboteur remains undiscovered.",
  );

  const renamedHealth = await putJSON<StateVariableResponse>(
    request,
    `${ruleSetURL}/state-variable-definitions/${health.id}`,
    { ...healthDefinition, id: health.id, label: "Health after the ruling" },
  );
  expect(renamedHealth.label).toBe("Health after the ruling");
  const receiptAfterDefinitionEdit = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
    dm.id,
  );
  expect(receiptAfterDefinitionEdit.resolution?.applied_effects).toEqual(
    resolved.applied_effects,
  );

  let narrativeOnly = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions`,
    {
      present: true,
      prompt: "The storm passes while everyone catches their breath.",
      audience_membership_ids: [playerMembership.id, spectatorMembership.id],
      eligible_responder_membership_ids: [],
      entity_ids: [],
    },
    dm.id,
  );
  expect(narrativeOnly.status).toBe("open");
  expect(narrativeOnly.revision).toBe(1);
  narrativeOnly = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${narrativeOnly.id}/adjudicate`,
    { expected_revision: narrativeOnly.revision },
    dm.id,
  );
  const narrativeResult = await postJSON<InteractionResolutionResponse>(
    request,
    `${baseURL}/api/games/${game.id}/interactions/${narrativeOnly.id}/resolve`,
    {
      expected_revision: narrativeOnly.revision,
      idempotency_key: randomUUID(),
      narrative: "You recover your footing. Nothing mechanical changes.",
      effects: [],
    },
    dm.id,
  );
  expect(narrativeResult.applied_effects).toEqual([]);
  expect(narrativeResult.state.records).toEqual({});
  expect(
    await getJSON<StateResponse>(
      request,
      `${ruleSetURL}/entities/${hero.id}/state`,
    ),
  ).toEqual(finalState);

  const archived = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games/${game.id}/archive`,
    { expected_revision: game.revision },
    dm.id,
  );
  expect(archived.status).toBe("archived");
  expect(archived.revision).toBe(game.revision + 1);
  expect(
    await getJSON<InteractionResponse>(
      request,
      `${baseURL}/api/games/${game.id}/interactions/${interaction.id}`,
      player.id,
    ),
  ).toMatchObject({ id: interaction.id, status: "resolved" });

  const mutationAfterArchive = await request.post(
    `${baseURL}/api/games/${game.id}/interactions`,
    {
      data: {
        prompt: "This interaction must not be created.",
        audience_membership_ids: [playerMembership.id],
        eligible_responder_membership_ids: [playerMembership.id],
        entity_ids: [hero.id],
      },
      headers: identityHeaders(dm.id),
    },
  );
  expect(mutationAfterArchive.status()).toBe(409);
  await expect(mutationAfterArchive.json()).resolves.toMatchObject({
    error: { code: "game_archived" },
  });
});

test("separate table browsers observe live play without receiving private notes", async ({
  browser,
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID();
  const ruleSet = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/rule-sets`,
    { key: `browser-play-${unique}`, name: "Browser Play" },
  );
  const dm = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Browser DM ${unique}` },
  );
  const player = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Browser Player ${unique}` },
  );
  const spectator = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Browser Spectator ${unique}` },
  );
  let game = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games`,
    { rule_set_id: ruleSet.id, name: "Browser Table", entity_ids: [] },
    dm.id,
  );
  game = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games/${game.id}/memberships`,
    { user_id: player.id, role: "player", status: "active" },
    dm.id,
  );
  game = await postJSON<GameResponse>(
    request,
    `${baseURL}/api/games/${game.id}/memberships`,
    { user_id: spectator.id, role: "spectator", status: "active" },
    dm.id,
  );

  const dmContext = await tableContext(browser, ruleSet.id, game.id, dm.id);
  const playerContext = await tableContext(
    browser,
    ruleSet.id,
    game.id,
    player.id,
  );
  const spectatorContext = await tableContext(
    browser,
    ruleSet.id,
    game.id,
    spectator.id,
  );
  try {
    const dmPage = await dmContext.newPage();
    const playerPage = await playerContext.newPage();
    const spectatorPage = await spectatorContext.newPage();
    const playerPayloads: string[] = [];
    let playerEventStreamRequested = false;
    playerPage.on("request", (sent) => {
      if (sent.url().includes(`/api/games/${game.id}/events`))
        playerEventStreamRequested = true;
    });
    playerPage.on("response", (response) => {
      if (
        response.url().includes(`/api/games/${game.id}`) &&
        response.headers()["content-type"]?.includes("application/json")
      ) {
        void response
          .text()
          .then((body) => playerPayloads.push(body))
          .catch(() => undefined);
      }
    });

    await Promise.all([
      dmPage.goto(`${baseURL}/app/play`),
      playerPage.goto(`${baseURL}/app/play`),
      spectatorPage.goto(`${baseURL}/app/play`),
    ]);
    await expect(
      dmPage.getByRole("heading", { name: "The live table" }),
    ).toBeVisible();
    await expect(playerPage.getByText("The table is quiet")).toBeVisible();
    await expect(spectatorPage.getByText("The table is quiet")).toBeVisible();

    const publicPrompt = `A live browser prompt ${unique}`;
    const interactionSecret = `interaction-secret-${unique}`;
    const presentedEvent = playerPage.evaluate(async (gameId) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`/api/games/${gameId}/events`, {
          headers: {
            Accept: "text/event-stream",
            "X-DND-User-ID": localStorage.getItem("dnd.selected-user") ?? "",
          },
          signal: controller.signal,
        });
        if (!response.ok || response.body === null)
          throw new Error(`event stream failed (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("event stream ended");
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          const frame = frames.find((item) =>
            item.includes('"type":"interaction-presented"'),
          );
          if (frame !== undefined) {
            await reader.cancel();
            return frame;
          }
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }, game.id);
    await dmPage
      .getByLabel("What do the players encounter?")
      .fill(publicPrompt);
    await dmPage
      .getByLabel("Private Dungeon Master notes")
      .fill(interactionSecret);
    await dmPage.getByRole("button", { name: "Present now" }).click();

    await expect(playerPage.getByText(publicPrompt)).toBeVisible();
    await expect(spectatorPage.getByText(publicPrompt)).toBeVisible();
    await expect(playerPage.getByText(interactionSecret)).toHaveCount(0);
    await expect(spectatorPage.getByText(interactionSecret)).toHaveCount(0);
    expect(playerEventStreamRequested).toBe(true);
    expect(await presentedEvent).toContain("interaction-presented");

    const actionText = `I answer from another browser ${unique}`;
    await playerPage.getByLabel("What do you do?").fill(actionText);
    await playerPage.getByRole("button", { name: "Submit action" }).click();
    await expect(dmPage.getByText(actionText)).toBeVisible();
    await expect(
      spectatorPage.getByRole("button", { name: "Submit action" }),
    ).toHaveCount(0);

    await dmPage
      .getByRole("button", { name: "Close submissions and adjudicate" })
      .click();
    await expect(playerPage.getByText(publicPrompt)).toHaveCount(0);

    const publicRuling = `The table sees this ruling ${unique}`;
    const rulingSecret = `ruling-secret-${unique}`;
    await dmPage.getByLabel("What happened?").fill(publicRuling);
    await dmPage.getByLabel("Private follow-up notes").fill(rulingSecret);
    await dmPage.getByRole("button", { name: "Resolve and publish" }).click();
    await expect(playerPage.getByText(publicRuling)).toBeVisible();
    await expect(spectatorPage.getByText(publicRuling)).toBeVisible();
    await expect(playerPage.getByText(rulingSecret)).toHaveCount(0);
    await expect(spectatorPage.getByText(rulingSecret)).toHaveCount(0);
    await expect.poll(() => playerPayloads.join("\n")).toContain(publicRuling);
    expect(playerPayloads.join("\n")).not.toContain(interactionSecret);
    expect(playerPayloads.join("\n")).not.toContain(rulingSecret);
  } finally {
    await Promise.all([
      dmContext.close(),
      playerContext.close(),
      spectatorContext.close(),
    ]);
  }
});

async function tableContext(
  browser: Browser,
  ruleSetId: string,
  gameId: string,
  userId: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ selectedRuleSet, selectedGame, selectedUser }) => {
      localStorage.setItem("dnd.selected-rule-set", selectedRuleSet);
      localStorage.setItem("dnd.selected-user", selectedUser);
      localStorage.setItem(
        `dnd.selected-game.${selectedRuleSet}.${selectedUser}`,
        selectedGame,
      );
    },
    {
      selectedRuleSet: ruleSetId,
      selectedGame: gameId,
      selectedUser: userId,
    },
  );
  return context;
}

function identityHeaders(userId: string): Record<string, string> {
  return { "X-DND-User-ID": userId };
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  userId?: string,
): Promise<T> {
  const response = await request.get(url, {
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  const body = await response.text();
  expect(response.ok(), `${response.status()} ${url}: ${body}`).toBe(true);
  return JSON.parse(body) as T;
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userId?: string,
): Promise<T> {
  const response = await request.post(url, {
    data,
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  const body = await response.text();
  expect(response.ok(), `${response.status()} ${url}: ${body}`).toBe(true);
  return JSON.parse(body) as T;
}

async function patchJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userId?: string,
): Promise<T> {
  const response = await request.patch(url, {
    data,
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  const body = await response.text();
  expect(response.ok(), `${response.status()} ${url}: ${body}`).toBe(true);
  return JSON.parse(body) as T;
}

async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userId?: string,
): Promise<T> {
  const response = await request.put(url, {
    data,
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  const body = await response.text();
  expect(response.ok(), `${response.status()} ${url}: ${body}`).toBe(true);
  return JSON.parse(body) as T;
}

function required<T>(value: T | undefined, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
