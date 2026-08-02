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
  primary_game_id: string;
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
  expect(invite.join_path).toMatch(/^\/invite\//);
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
  expect(joined).toMatchObject({ id: world.id, role: "player" });
  expect(
    (
      await getJSON<WorldResponse[]>(
        request,
        `${baseURL}/api/worlds`,
        player.id,
      )
    ).map((item) => item.id),
  ).toEqual([world.id]);

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
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    {
      name: `The Glass March ${unique}`,
      description: "A world that discovers its trouble during play.",
    },
    owner.id,
  );
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

  expect(
    await getJSON<unknown[]>(
      request,
      `${baseURL}/api/rule-sets/${world.id}/problem-definitions`,
    ),
  ).toEqual([]);

  const ownerContext = await worldContext(browser, owner.id);
  const playerContext = await worldContext(browser, player.id);
  try {
    const ownerPage = await ownerContext.newPage();
    const playerPage = await playerContext.newPage();
    await Promise.all([
      ownerPage.goto(`${baseURL}/worlds/${world.id}/play`),
      playerPage.goto(`${baseURL}/worlds/${world.id}/play`),
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
    const action = `I anchor a rope and leap for the far post ${unique}.`;
    await playerPage.getByLabel("What do you do?").fill(action);
    await playerPage.getByRole("button", { name: "Offer action" }).click();
    await expect(ownerPage.getByText(action)).toBeVisible();

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
    expect(savedEntities[0]?.state).toMatchObject({
      revision: 1,
      values: { [resolve.id]: { kind: "number", value: 6 } },
    });
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

function required<T>(value: T | undefined, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
