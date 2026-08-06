import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { readBaseURL } from "../src/runtime";

interface WorldResponse {
  id: string;
  name: string;
  role: "owner" | "editor" | "player" | "spectator";
  capacity_count: number;
  capability_count: number;
  character_field_count: number;
}

interface WorldMechanicResponse {
  id: string;
  kind: "capacity" | "capability";
  mode: "score" | "pool" | "binary" | "rating";
  source_kind: "input" | "derived";
  name: string;
}

interface WorldMechanicCollectionResponse {
  revision: number;
  mechanics: WorldMechanicResponse[];
}

interface WorldEntityResponse {
  id: string;
  display_name: string;
  state: StateResponse;
}

interface StateResponse {
  revision: number;
  values: Record<string, unknown>;
  defaulted_mechanic_ids: string[];
}

test("an author creates a world whose entity sheets stem from capacities and capabilities", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const authorName = `World Author ${unique}`;
  await page.goto(baseURL);

  await expect(
    page.getByRole("heading", { name: "What are you here to do?" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Build/ }).click();

  await expect(
    page.getByRole("heading", { name: "Who is opening the book?" }),
  ).toBeVisible();
  await page.getByLabel("Your display name").fill(authorName);
  await page.getByRole("button", { name: "Create local profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Shape a world." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create world" }).click();
  await page.getByLabel("World name").fill(`Ember Coast ${unique}`);
  await page
    .getByLabel("Short description")
    .fill("A rain-soaked frontier made at the table.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create world" })
    .click();
  await expect(page.getByRole("heading", { name: "Capacities" })).toBeVisible();

  await page.getByRole("button", { name: "New capacity" }).click();
  await page.getByLabel("Name").fill("Resolve");
  await page.getByLabel("Description").fill("Composure under pressure.");
  await page.getByRole("radio", { name: /Pool/ }).check();
  await page.getByLabel("Default").fill("8");
  await page.getByLabel("Minimum").fill("0");
  await page.getByLabel("Maximum").fill("12");
  await page.getByLabel("Step").fill("1");
  await page.getByLabel("Unit").fill("grit");
  await page.getByRole("button", { name: "Create capacity" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: /Capabilities/ }).click();
  await page.getByRole("button", { name: "New capability" }).click();
  await page.getByLabel("Name").fill("Climbing");
  await page
    .getByLabel("Description")
    .fill("Moving safely across steep or unstable ground.");
  await page.getByRole("button", { name: "Create capability" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: /Character fields/ }).click();
  await expect(
    page.getByRole("heading", { name: "Character fields", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add required field" }).click();
  await page.getByLabel("Field label").fill("Backstory");
  await page.getByLabel("Guidance").fill("Where did this character come from?");
  await page.getByRole("button", { name: "Publish requirements" }).click();
  await expect(page.getByText("schema r1")).toBeVisible();

  await page.getByRole("button", { name: /Roster & sheets/ }).click();
  await expect(
    page.getByRole("heading", { name: "Roster & sheets" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create entity" }).first().click();
  await page.getByLabel("Display name").fill("Aria Vale");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create entity" })
    .click();
  await expect(page.getByRole("heading", { name: "Aria Vale" })).toBeVisible();
  await page.getByLabel("Resolve").fill("6");
  await page.getByLabel("Climbing").check();
  await page.getByRole("button", { name: "Save sheet" }).click();
  await expect(page.getByText("state r1")).toBeVisible();

  const authorID = await page.evaluate(
    () => localStorage.getItem("dnd.selected-user") ?? "",
  );
  expect(authorID).not.toBe("");
  const worlds = await getJSON<WorldResponse[]>(
    page,
    `${baseURL}/api/worlds`,
    authorID,
  );
  expect(worlds).toHaveLength(1);
  expect(worlds[0]).toMatchObject({
    role: "owner",
    capacity_count: 1,
    capability_count: 1,
    character_field_count: 1,
  });
  const world = worlds[0];
  expect(world).toBeDefined();
  const mechanicCollection = await getJSON<WorldMechanicCollectionResponse>(
    page,
    `${baseURL}/api/worlds/${world?.id}/mechanics`,
    authorID,
  );
  const mechanics = mechanicCollection.mechanics;
  expect(mechanicCollection.revision).toBe(2);
  expect(mechanics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "capacity",
        mode: "pool",
        source_kind: "input",
        name: "Resolve",
      }),
      expect.objectContaining({
        kind: "capability",
        mode: "binary",
        source_kind: "input",
        name: "Climbing",
      }),
    ]),
  );
  const entities = await getJSON<WorldEntityResponse[]>(
    page,
    `${baseURL}/api/worlds/${world?.id}/entities`,
    authorID,
  );
  const aria = entities.find((entity) => entity.display_name === "Aria Vale");
  const resolve = mechanics.find((mechanic) => mechanic.name === "Resolve");
  const climbing = mechanics.find((mechanic) => mechanic.name === "Climbing");
  expect(aria?.state.values[resolve?.id ?? ""]).toEqual({
    kind: "number",
    value: 6,
  });
  expect(aria?.state.values[climbing?.id ?? ""]).toEqual({
    kind: "boolean",
    value: true,
  });

  const outsider = await postJSON<{ id: string }>(
    page,
    `${baseURL}/api/users`,
    { display_name: `Outsider ${unique}` },
  );
  expect(
    await getJSON<WorldResponse[]>(page, `${baseURL}/api/worlds`, outsider.id),
  ).toEqual([]);
  const forbidden = await page.request.get(
    `${baseURL}/api/worlds/${world?.id}`,
    { headers: identityHeaders(outsider.id) },
  );
  expect(forbidden.status()).toBe(403);
});

async function getJSON<T>(
  page: import("@playwright/test").Page,
  url: string,
  userId?: string,
): Promise<T> {
  const response = await page.request.get(url, {
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  expect(response.ok(), `${response.status()} ${url}`).toBe(true);
  return (await response.json()) as T;
}

async function postJSON<T>(
  page: import("@playwright/test").Page,
  url: string,
  data: unknown,
  userId?: string,
): Promise<T> {
  const response = await page.request.post(url, {
    data,
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  expect(
    response.ok(),
    `${response.status()} ${url}: ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

function identityHeaders(userId: string): Record<string, string> {
  return { "X-DND-User-ID": userId };
}
