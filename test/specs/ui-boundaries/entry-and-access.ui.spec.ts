import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import { sanitizeURL } from "../../src/scenario";
import { sanitizeDiagnosticBody } from "../../src/scenario/evidence/redaction";
import {
  actorMutationHeaders,
  actorRequest,
  authenticateBrowserContext,
  disposeAuthenticatedActors,
  signupActor,
} from "../support/auth";

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  name: string;
}

interface InviteResponse {
  join_path: string;
}

test.afterEach(async () => disposeAuthenticatedActors());

test("focused entry, narrow-layout, keyboard, and access boundaries stay deliberate", async ({
  page,
  request,
}) => {
  const baseURL = await readBaseURL();

  await test.step("NAV-002/unknown-route", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/this-route-does-not-exist`);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });

  await test.step("NAV-004/narrow-entry", async () => {
    const returnHome = page.getByRole("button", { name: "Return home" });
    const bounds = await returnHome.boundingBox();
    expect(bounds).not.toBeNull();
    expect((bounds?.x ?? 391) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
  });

  await test.step("NAV-005/keyboard-semantic-navigation", async () => {
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Return home" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Wrought", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("A generative narrative engine.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Play with ChatGPT" }),
    ).toBeFocused();
    await expect(
      page.getByRole("link", { name: "Play with ChatGPT" }),
    ).toHaveAttribute("href", /^https:\/\/chatgpt\.com\/\?surface=work&/);
    await expect(page.getByRole("link")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Copy starter prompt" }),
    ).toHaveCount(0);
  });

  await test.step("NAV-V01/non-editor-build-boundary", async () => {
    const unique = randomUUID().slice(0, 8);
    const owner = await signupActor(baseURL, `Boundary Owner ${unique}`);
    const playerName = `Boundary Player ${unique}`;
    const player = await signupActor(baseURL, playerName);
    const world = await postJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds`,
      { name: `Boundary World ${unique}` },
      owner.id,
    );
    const invite = await postJSON<InviteResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/invites`,
      { role: "player", expires_in_days: 1 },
      owner.id,
    );
    const token = invite.join_path.split("/").at(-1);
    expect(token).toBeTruthy();
    await postJSON(
      request,
      `${baseURL}/api/world-invites/${token}/redeem`,
      {},
      player.id,
    );

    await authenticateBrowserContext(page.context(), player);
    await page.goto(`${baseURL}/build/${world.id}/capacities`);
    await expect(page.getByRole("alert")).toContainText(
      "Build access is not available",
    );
    await page.getByRole("button", { name: "Open in Play" }).click();
    await expect(page.getByRole("heading", { name: world.name })).toBeVisible();
  });
});

async function postJSON<T>(
  _request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  if (userID === undefined) {
    throw new Error("fixture mutations require an authenticated actor");
  }
  const response = await actorRequest(userID).post(url, {
    data,
    headers: actorMutationHeaders(userID),
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
