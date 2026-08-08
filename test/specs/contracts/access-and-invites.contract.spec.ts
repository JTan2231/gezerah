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
  actorMutationHeaders,
  actorRequest,
  disposeAuthenticatedActors,
  signupActor,
} from "../support/auth";

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  name: string;
  role: "owner" | "editor" | "player" | "spectator";
  membership_id: string;
  revision: number;
  status: "active" | "archived";
  play_status:
    "waiting-for-character" | "setup-required" | "ready" | "unavailable";
}

interface InviteResponse extends IdentifiedResource {
  role: "editor" | "player" | "spectator";
  join_path?: string;
  revoked_at?: string;
  use_count: number;
}

test.afterEach(async () => disposeAuthenticatedActors());

test("contract: invitation secrecy, admission, authorization, and revocation", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createActor(request, baseURL, `Invite Owner ${unique}`);
  const player = await createActor(request, baseURL, `Invite Player ${unique}`);
  const editor = await createActor(request, baseURL, `Invite Editor ${unique}`);
  const outsider = await createActor(
    request,
    baseURL,
    `Invite Outsider ${unique}`,
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
  await expectAPIError(
    await actorRequest(outsider.id).get(`${baseURL}/api/worlds/${world.id}`),
    403,
    "world_forbidden",
  );

  const playerInvite = await createInvite(
    request,
    baseURL,
    world.id,
    owner.id,
    "player",
  );
  const editorInvite = await createInvite(
    request,
    baseURL,
    world.id,
    owner.id,
    "editor",
  );
  expect(playerInvite.join_path).toMatch(/^\/play\/invite\//);
  expect(editorInvite.join_path).toMatch(/^\/build\/invite\//);
  const playerToken = required(
    playerInvite.join_path?.split("/").at(-1),
    "player invite token",
  );
  const editorToken = required(
    editorInvite.join_path?.split("/").at(-1),
    "editor invite token",
  );

  const listedInvites = await getJSON<InviteResponse[]>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites`,
    owner.id,
  );
  expect(listedInvites).toHaveLength(2);
  expect(listedInvites.every((invite) => invite.join_path === undefined)).toBe(
    true,
  );
  expect(JSON.stringify(listedInvites)).not.toContain(playerToken);
  expect(JSON.stringify(listedInvites)).not.toContain(editorToken);

  const preview = await getJSON<{
    world_name: string;
    role: string;
    invited_by_display_name: string;
  }>(request, `${baseURL}/api/world-invites/${playerToken}`, player.id);
  expect(preview).toMatchObject({ world_name: world.name, role: "player" });

  const joinedPlayer = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${playerToken}/redeem`,
    undefined,
    player.id,
  );
  const joinedEditor = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${editorToken}/redeem`,
    undefined,
    editor.id,
  );
  expect(joinedPlayer).toMatchObject({
    id: world.id,
    role: "player",
    play_status: "waiting-for-character",
  });
  expect(joinedEditor).toMatchObject({
    id: world.id,
    role: "editor",
    play_status: "ready",
  });

  await expectAPIError(
    await actorRequest(player.id).post(
      `${baseURL}/api/worlds/${world.id}/invites`,
      {
        data: { role: "player", expires_in_days: 7 },
        headers: actorMutationHeaders(player.id),
      },
    ),
    403,
    "world_editor_required",
  );

  const ownerBeforeDenial = await getJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}`,
    owner.id,
  );
  await expectAPIError(
    await actorRequest(editor.id).post(
      `${baseURL}/api/worlds/${world.id}/archive`,
      {
        data: { expected_revision: ownerBeforeDenial.revision },
        headers: actorMutationHeaders(editor.id),
      },
    ),
    403,
    "world_owner_required",
  );
  expect(
    await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      owner.id,
    ),
  ).toMatchObject({
    revision: ownerBeforeDenial.revision,
    status: "active",
    role: "owner",
  });

  await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/invites/${playerInvite.id}/revoke`,
    undefined,
    owner.id,
  );
  await expectAPIError(
    await actorRequest(outsider.id).get(
      `${baseURL}/api/world-invites/${playerToken}`,
    ),
    404,
    "invite_not_found",
  );
  await expectAPIError(
    await actorRequest(outsider.id).post(
      `${baseURL}/api/world-invites/${playerToken}/redeem`,
      { headers: actorMutationHeaders(outsider.id) },
    ),
    404,
    "invite_not_found",
  );
  await expectAPIError(
    await actorRequest(outsider.id).get(
      `${baseURL}/api/world-invites/not-a-real-token`,
    ),
    404,
    "invite_not_found",
  );
});

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

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  userID?: string,
): Promise<T> {
  const response = await (
    userID === undefined ? request : actorRequest(userID)
  ).get(url);
  return expectJSON<T>(response, url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  if (userID === undefined) {
    throw new Error("fixture mutations require an authenticated actor");
  }
  const response = await actorRequest(userID).post(url, {
    ...(data === undefined ? {} : { data }),
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

async function expectAPIError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as { error?: { code?: string } };
  expect(decoded.error?.code).toBe(code);
}

function required<T>(value: T | undefined, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
