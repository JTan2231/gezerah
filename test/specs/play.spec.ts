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

interface WorldResponse extends IdentifiedResource {
  name: string;
  role: "owner" | "editor" | "player" | "spectator";
  membership_id: string;
  table_revision: number;
  play_status:
    "waiting-for-character" | "setup-required" | "ready" | "unavailable";
}

interface InviteResponse extends IdentifiedResource {
  role: "editor" | "player" | "spectator";
  join_path?: string;
  revoked_at?: string;
  use_count: number;
}

interface MechanicResponse extends IdentifiedResource {
  name: string;
  kind: "capacity" | "capability";
}

interface EntityResponse extends IdentifiedResource {
  display_name: string;
  state: {
    revision: number;
    values: Record<string, unknown>;
  };
}

interface EntityProfileResponse {
  entity_id: string;
  revision: number;
  character_fields_revision: number;
  character_status: "not-controlled" | "setup-required" | "ready";
  required_field_count: number;
  completed_field_count: number;
  can_edit: boolean;
  fields: Array<{
    id: string;
    label: string;
    value?: string;
    visibility: "table" | "controllers-and-facilitators";
  }>;
}

interface CharacterFieldSetResponse {
  revision: number;
  fields: Array<{
    id: string;
    label: string;
    help_text?: string;
    visibility: "table" | "controllers-and-facilitators";
  }>;
}

interface InteractionResponse extends IdentifiedResource {
  revision: number;
}

test("worlds stay private until an invite link is redeemed", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const request = page.request;
  const unique = randomUUID().slice(0, 8);
  const owner = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Invite Owner ${unique}` },
  );
  const player = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Invite Player ${unique}` },
  );
  const outsider = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Invite Outsider ${unique}` },
  );
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Private World ${unique}` },
    owner.id,
  );

  expect(
    (
      await getJSON<WorldResponse[]>(request, `${baseURL}/api/worlds`, owner.id)
    ).map((item) => item.id),
  ).toEqual([world.id]);
  expect(
    await getJSON<WorldResponse[]>(
      request,
      `${baseURL}/api/worlds`,
      outsider.id,
    ),
  ).toEqual([]);

  const forbiddenWorld = await request.get(
    `${baseURL}/api/worlds/${world.id}`,
    {
      headers: identityHeaders(outsider.id),
    },
  );
  expect(forbiddenWorld.status()).toBe(403);

  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites`,
    { role: "player", expires_in_days: 7 },
    owner.id,
  );
  expect(invite.join_path).toMatch(/^\/play\/invite\//);
  const editorInvite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites`,
    { role: "editor", expires_in_days: 7 },
    owner.id,
  );
  expect(editorInvite.join_path).toMatch(/^\/build\/invite\//);
  const token = required(invite.join_path?.split("/").at(-1), "invite token");
  const preview = await getJSON<{
    world_name: string;
    role: string;
    invited_by_display_name: string;
  }>(request, `${baseURL}/api/world-invites/${token}`);
  expect(preview).toMatchObject({ world_name: world.name, role: "player" });

  const joined = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    player.id,
  );
  expect(joined).toMatchObject({
    id: world.id,
    role: "player",
    play_status: "waiting-for-character",
  });
  expect(
    (
      await getJSON<WorldResponse[]>(
        request,
        `${baseURL}/api/worlds`,
        player.id,
      )
    ).map((item) => item.id),
  ).toEqual([world.id]);

  await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    {
      display_name: `Unconfigured Character ${unique}`,
      controller_world_membership_ids: [joined.membership_id],
    },
    owner.id,
  );
  const readyWithoutFields = await getJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}`,
    player.id,
  );
  expect(readyWithoutFields.play_status).toBe("ready");

  const playerCannotInvite = await request.post(
    `${baseURL}/api/worlds/${world.id}/invites`,
    {
      data: { role: "player", expires_in_days: 7 },
      headers: identityHeaders(player.id),
    },
  );
  expect(playerCannotInvite.status()).toBe(403);

  await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites/${invite.id}/revoke`,
    undefined,
    owner.id,
  );
  const closedPreview = await request.get(
    `${baseURL}/api/world-invites/${token}`,
  );
  expect(closedPreview.status()).toBe(404);
  const closedRedemption = await request.post(
    `${baseURL}/api/world-invites/${token}/redeem`,
    { headers: identityHeaders(outsider.id) },
  );
  expect(closedRedemption.status()).toBe(404);
});

test("a problem is improvised at the table, answered, and resolved with a state receipt", async ({
  browser,
  page,
}) => {
  const baseURL = await readBaseURL();
  const request = page.request;
  const unique = randomUUID().slice(0, 8);
  const ownerName = `Table DM ${unique}`;
  const playerName = `Table Player ${unique}`;
  const owner = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: ownerName },
  );
  const player = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: playerName },
  );
  const spectator = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Table Spectator ${unique}` },
  );
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    {
      name: `The Glass March ${unique}`,
      description: "A world that discovers its trouble during play.",
    },
    owner.id,
  );
  const emptyCharacterFields = await getJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    owner.id,
  );
  const characterFields = await putJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    {
      expected_revision: emptyCharacterFields.revision,
      fields: [
        {
          label: "Backstory",
          help_text: "Where did this character come from?",
          visibility: "table",
        },
        {
          label: "Hidden oath",
          help_text: "What does this character keep from the table?",
          visibility: "controllers-and-facilitators",
        },
      ],
    },
    owner.id,
  );
  const characterFieldsWithBond = [
    ...characterFields.fields.map((field) => ({
      id: field.id,
      label: field.label,
      help_text: field.help_text,
      visibility: field.visibility,
    })),
    {
      label: "Bond",
      help_text: "Who or what keeps this character in the world?",
      visibility: "table",
    },
  ];
  const resolve = await postJSON<MechanicResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics`,
    {
      kind: "capacity",
      mode: "score",
      name: "Resolve",
      minimum: 0,
      maximum: 10,
      step: 1,
      default_number: 8,
      mutable_during_play: true,
    },
    owner.id,
  );
  const entity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: "Aria Vale" },
    owner.id,
  );
  expect(entity.state.values[resolve.id]).toEqual({ kind: "number", value: 8 });
  const uncontrolledEntity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: "The Glass Sentinel" },
    owner.id,
  );

  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites`,
    { role: "player", expires_in_days: 7 },
    owner.id,
  );
  const token = required(invite.join_path?.split("/").at(-1), "invite token");
  await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    player.id,
  );
  const spectatorInvite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites`,
    { role: "spectator", expires_in_days: 7 },
    owner.id,
  );
  const spectatorToken = required(
    spectatorInvite.join_path?.split("/").at(-1),
    "spectator invite token",
  );
  await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${spectatorToken}/redeem`,
    undefined,
    spectator.id,
  );

  const ownerContext = await worldContext(browser, owner.id);
  const playerContext = await worldContext(browser, player.id);
  try {
    const ownerPage = await ownerContext.newPage();
    const playerPage = await playerContext.newPage();
    await Promise.all([
      ownerPage.goto(`${baseURL}/play/${world.id}`),
      playerPage.goto(`${baseURL}/play/${world.id}`),
    ]);
    await expect(
      ownerPage.getByRole("heading", { name: world.name }),
    ).toBeVisible();
    await expect(
      playerPage.getByRole("heading", { name: world.name }),
    ).toBeVisible();
    await expect(
      playerPage.getByRole("button", { name: "New problem" }),
    ).toHaveCount(0);
    await expect(playerPage.getByText("Waiting for a character")).toBeVisible();
    const liveBeforeSetup = await request.get(
      `${baseURL}/api/worlds/${world.id}/interactions`,
      { headers: identityHeaders(player.id) },
    );
    expect(liveBeforeSetup.status()).toBe(403);

    await ownerPage.goto(`${baseURL}/build/${world.id}/roster`);
    await ownerPage
      .getByRole("button", { name: "Controllers", exact: true })
      .click();
    await ownerPage.getByRole("checkbox", { name: playerName }).check();
    await ownerPage
      .getByRole("dialog")
      .getByRole("button", { name: "Save controllers" })
      .click();
    await ownerPage.goto(`${baseURL}/play/${world.id}`);
    await expect(playerPage.getByText("Setup required").first()).toBeVisible();

    const publicStory = `Raised beside the glass sea ${unique}.`;
    await playerPage.getByLabel("Backstory").fill(publicStory);
    await playerPage.getByRole("button", { name: "Save character" }).click();
    await expect(playerPage.getByText("profile r1")).toBeVisible();
    await expect(playerPage.getByText("Setup required").first()).toBeVisible();
    const liveAfterPartialSetup = await request.get(
      `${baseURL}/api/worlds/${world.id}/interactions`,
      { headers: identityHeaders(player.id) },
    );
    expect(liveAfterPartialSetup.status()).toBe(403);
    const controlledStateDuringSetup = await request.get(
      `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/state`,
      { headers: identityHeaders(player.id) },
    );
    expect(controlledStateDuringSetup.status()).toBe(200);
    const otherStateDuringSetup = await request.get(
      `${baseURL}/api/worlds/${world.id}/entities/${uncontrolledEntity.id}/state`,
      { headers: identityHeaders(player.id) },
    );
    expect(otherStateDuringSetup.status()).toBe(403);

    const privateStory = `The signet was stolen ${unique}.`;
    await playerPage.getByLabel("Hidden oath").fill(privateStory);
    await playerPage.getByRole("button", { name: "Save character" }).click();
    await expect(playerPage.getByText("Your character")).toBeVisible();
    await expect(playerPage.getByText("profile r2")).toBeVisible();

    await ownerPage.getByRole("tab", { name: "Character" }).click();
    await expect(ownerPage.getByText(publicStory)).toBeVisible();
    await expect(ownerPage.getByText(privateStory)).toBeVisible();

    const spectatorProfile = await getJSON<EntityProfileResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/profile`,
      spectator.id,
    );
    expect(spectatorProfile).toMatchObject({
      entity_id: entity.id,
      revision: 2,
      character_status: "ready",
      required_field_count: 2,
      completed_field_count: 2,
      can_edit: false,
    });
    expect(spectatorProfile.fields).toHaveLength(1);
    expect(spectatorProfile.fields[0]).toMatchObject({
      label: "Backstory",
      value: publicStory,
      visibility: "table",
    });
    const spectatorWrite = await request.put(
      `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/profile`,
      {
        headers: identityHeaders(spectator.id),
        data: {
          expected_revision: 2,
          expected_character_fields_revision: characterFields.revision,
          values: [],
        },
      },
    );
    expect(spectatorWrite.status()).toBe(403);
    const staleProfileWrite = await request.put(
      `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/profile`,
      {
        headers: identityHeaders(player.id),
        data: {
          expected_revision: 0,
          expected_character_fields_revision: characterFields.revision,
          values: characterFields.fields.map((field) => ({
            field_id: field.id,
            value: field.label === "Backstory" ? publicStory : privateStory,
          })),
        },
      },
    );
    expect(staleProfileWrite.status()).toBe(409);
    const entitiesAfterProfile = await getJSON<EntityResponse[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities`,
      player.id,
    );
    expect(
      entitiesAfterProfile.find((candidate) => candidate.id === entity.id)
        ?.state.revision,
    ).toBe(0);

    const title = `The bridge gives way ${unique}`;
    const prompt = `Floodwater tears the center span loose ${unique}. What do you do?`;
    await ownerPage.getByRole("button", { name: "New problem" }).click();
    await ownerPage.getByLabel("Short title").fill(title);
    await ownerPage.getByLabel("What is happening?").fill(prompt);
    await ownerPage.getByRole("checkbox", { name: "Aria Vale" }).check();
    await expect(
      ownerPage.getByRole("checkbox", { name: playerName }),
    ).toBeChecked();
    await ownerPage
      .getByRole("dialog")
      .getByRole("button", { name: "Present to the table" })
      .click();

    await expect(playerPage.getByText(prompt)).toBeVisible();
    const openInteractions = await getJSON<InteractionResponse[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions`,
      player.id,
    );
    const openInteraction = required(
      openInteractions.find((interaction) => interaction.revision >= 0),
      "open interaction",
    );
    const schemaChangeDuringProblem = await request.put(
      `${baseURL}/api/worlds/${world.id}/character-fields`,
      {
        headers: identityHeaders(owner.id),
        data: {
          expected_revision: characterFields.revision,
          fields: characterFieldsWithBond,
        },
      },
    );
    expect(schemaChangeDuringProblem.status()).toBe(409);
    const uncontrolledAction = await request.post(
      `${baseURL}/api/worlds/${world.id}/interactions/${openInteraction.id}/actions`,
      {
        headers: identityHeaders(player.id),
        data: {
          text: "The sentinel acts for me.",
          acting_entity_id: uncontrolledEntity.id,
          expected_revision: openInteraction.revision,
        },
      },
    );
    expect(uncontrolledAction.status()).toBe(403);
    const action = `I anchor a rope and leap for the far post ${unique}.`;
    await expect(playerPage.getByLabel("Acting character")).toHaveValue(
      entity.id,
    );
    await playerPage.getByLabel("What do you do?").fill(action);
    await playerPage.getByRole("button", { name: "Offer action" }).click();
    await expect(ownerPage.getByText(action)).toBeVisible();
    await expect(
      ownerPage.locator(".action-list").getByText("Aria Vale", { exact: true }),
    ).toBeVisible();
    await expect(
      ownerPage.locator(".action-list").getByText(`played by ${playerName}`),
    ).toBeVisible();

    await ownerPage.getByRole("button", { name: "Begin ruling" }).click();
    await ownerPage.getByRole("radio", { name: new RegExp(unique) }).check();
    const outcome = `Aria catches the post, but the rope burns through her gloves ${unique}.`;
    await ownerPage.getByLabel("Public outcome").fill(outcome);
    await ownerPage.getByLabel("Effect amount").fill("-2");
    await ownerPage.getByRole("button", { name: "Add", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Preview changes" }).click();
    await expect(ownerPage.getByText("Preview is valid")).toBeVisible();
    await ownerPage.getByRole("button", { name: "Resolve problem" }).click();

    await expect(ownerPage.getByText(outcome)).toBeVisible();
    await expect(playerPage.getByText(outcome)).toBeVisible();
    await expect(playerPage.getByText("8 → 6")).toBeVisible();

    const savedEntities = await getJSON<EntityResponse[]>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities`,
      player.id,
    );
    expect(
      savedEntities.find((candidate) => candidate.id === entity.id)?.state,
    ).toMatchObject({
      revision: 1,
      values: { [resolve.id]: { kind: "number", value: 6 } },
    });

    const expandedCharacterFields = await putJSON<CharacterFieldSetResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/character-fields`,
      {
        expected_revision: characterFields.revision,
        fields: characterFieldsWithBond,
      },
      owner.id,
    );
    expect(expandedCharacterFields.revision).toBe(2);
    await expect(playerPage.getByText("Setup required").first()).toBeVisible();
    const liveAfterRequirementChange = await request.get(
      `${baseURL}/api/worlds/${world.id}/interactions`,
      { headers: identityHeaders(player.id) },
    );
    expect(liveAfterRequirementChange.status()).toBe(403);
  } finally {
    await Promise.all([ownerContext.close(), playerContext.close()]);
  }
});

async function worldContext(
  browser: Browser,
  userId: string,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript((selectedUser) => {
    localStorage.setItem("dnd.selected-user", selectedUser);
  }, userId);
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
    ...(data === undefined ? {} : { data }),
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
