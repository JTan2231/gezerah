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

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  name: string;
}

interface InviteResponse {
  join_path: string;
}

test("focused entry, narrow-layout, keyboard, and access boundaries stay deliberate", async ({
  page,
  request,
}) => {
  const baseURL = await readBaseURL();

  await test.step("NAV-002/unknown-route", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/this-route-does-not-exist`);
    await expect(
      page.getByRole("heading", { name: "That page is not in this world" }),
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
      page.getByRole("heading", { name: "What are you here to do?" }),
    ).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /Play/ })).toBeFocused();
  });

  await test.step("NAV-V01/non-editor-build-boundary", async () => {
    const unique = randomUUID().slice(0, 8);
    const owner = await postJSON<IdentifiedResource>(
      request,
      `${baseURL}/api/users`,
      { display_name: `Boundary Owner ${unique}` },
    );
    const playerName = `Boundary Player ${unique}`;
    const player = await postJSON<IdentifiedResource>(
      request,
      `${baseURL}/api/users`,
      { display_name: playerName },
    );
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

    await page.goto(`${baseURL}/build/${world.id}/capacities`);
    await page.getByRole("button", { name: new RegExp(playerName) }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Builder access is not available",
    );
    await page.getByRole("button", { name: "Open in Play" }).click();
    await expect(page.getByRole("heading", { name: world.name })).toBeVisible();
  });
});

function identityHeaders(userID: string): Record<string, string> {
  return { "X-DND-User-ID": userID };
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await request.post(url, {
    data,
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
