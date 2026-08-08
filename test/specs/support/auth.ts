import { randomUUID } from "node:crypto";

import {
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";

import { sanitizeDiagnosticBody } from "../../src/scenario/evidence/redaction";

export const TEST_PASSWORD = "correct-horse-battery-staple-42";

export interface AuthenticatedUser {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly created_at?: string;
  readonly updated_at?: string;
}

export interface AuthenticatedActor extends AuthenticatedUser {
  readonly api: APIRequestContext;
  readonly csrfToken: string;
  readonly password: string;
}

interface AuthResponse {
  readonly user: AuthenticatedUser;
  readonly csrf_token: string;
}

const actorsByID = new Map<string, AuthenticatedActor>();
const ownedContexts = new Set<APIRequestContext>();

export async function signupActor(
  baseURL: string,
  displayName: string,
  options: Readonly<{ username?: string; password?: string }> = {},
): Promise<AuthenticatedActor> {
  const username = options.username ?? testUsername(displayName);
  const password = options.password ?? TEST_PASSWORD;
  const bootstrap = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: originOf(baseURL) },
  });
  try {
    const response = await bootstrap.post("/api/auth/signup", {
      data: { username, display_name: displayName, password },
    });
    const auth = await expectAuthResponse(response, "signup");
    const state = await bootstrap.storageState();
    await bootstrap.dispose();
    const api = await authenticatedContext(baseURL, state, auth.csrf_token);
    ownedContexts.add(api);
    return registerActor({
      ...auth.user,
      api,
      csrfToken: auth.csrf_token,
      password,
    });
  } catch (error: unknown) {
    await bootstrap.dispose().catch(() => undefined);
    throw error;
  }
}

export async function signinActor(
  baseURL: string,
  username: string,
  password = TEST_PASSWORD,
): Promise<AuthenticatedActor> {
  const bootstrap = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: originOf(baseURL) },
  });
  try {
    const response = await bootstrap.post("/api/auth/signin", {
      data: { username, password },
    });
    const auth = await expectAuthResponse(response, "signin");
    const state = await bootstrap.storageState();
    await bootstrap.dispose();
    const api = await authenticatedContext(baseURL, state, auth.csrf_token);
    ownedContexts.add(api);
    return registerActor({
      ...auth.user,
      api,
      csrfToken: auth.csrf_token,
      password,
    });
  } catch (error: unknown) {
    await bootstrap.dispose().catch(() => undefined);
    throw error;
  }
}

export function actorRequest(actorID: string): APIRequestContext {
  return actorByID(actorID).api;
}

export function actorMutationHeaders(actorID: string): Record<string, string> {
  return { "X-DND-CSRF": actorByID(actorID).csrfToken };
}

export async function actorCookieHeader(actorID: string): Promise<string> {
  const state = await actorByID(actorID).api.storageState();
  return state.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export async function actorSessionCookie(actorID: string): Promise<
  Readonly<{
    name: string;
    value: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>
> {
  const state = await actorByID(actorID).api.storageState();
  const cookie = state.cookies.find(({ name }) =>
    ["dnd_session", "__Host-dnd_session"].includes(name),
  );
  if (cookie === undefined) {
    throw new Error(`authenticated actor ${actorID} has no session cookie`);
  }
  return cookie;
}

export async function authenticateBrowserContext(
  context: BrowserContext,
  actor: AuthenticatedActor,
): Promise<void> {
  const state = await actor.api.storageState();
  await context.addCookies(state.cookies);
}

export async function disposeAuthenticatedActors(): Promise<void> {
  const contexts = [...ownedContexts];
  ownedContexts.clear();
  actorsByID.clear();
  await Promise.all(contexts.map(async (context) => context.dispose()));
}

export function publicMutationHeaders(baseURL: string): Record<string, string> {
  return { Origin: originOf(baseURL) };
}

export async function getAs(
  fallback: APIRequestContext,
  url: string,
  actorID?: string,
): Promise<APIResponse> {
  return (actorID === undefined ? fallback : actorRequest(actorID)).get(url);
}

export async function postAs(
  fallback: APIRequestContext,
  url: string,
  data: unknown,
  actorID?: string,
): Promise<APIResponse> {
  return (actorID === undefined ? fallback : actorRequest(actorID)).post(url, {
    ...(data === undefined ? {} : { data }),
    headers:
      actorID === undefined
        ? publicMutationHeaders(url)
        : actorMutationHeaders(actorID),
  });
}

export async function putAs(
  fallback: APIRequestContext,
  url: string,
  data: unknown,
  actorID?: string,
): Promise<APIResponse> {
  return (actorID === undefined ? fallback : actorRequest(actorID)).put(url, {
    data,
    headers:
      actorID === undefined
        ? publicMutationHeaders(url)
        : actorMutationHeaders(actorID),
  });
}

export async function patchAs(
  fallback: APIRequestContext,
  url: string,
  data: unknown,
  actorID?: string,
): Promise<APIResponse> {
  return (actorID === undefined ? fallback : actorRequest(actorID)).patch(url, {
    data,
    headers:
      actorID === undefined
        ? publicMutationHeaders(url)
        : actorMutationHeaders(actorID),
  });
}

export function testUsername(seed: string): string {
  const stem = seed
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${stem || "actor"}-${randomUUID().slice(0, 8)}`;
}

function registerActor(actor: AuthenticatedActor): AuthenticatedActor {
  actorsByID.set(actor.id, actor);
  return Object.freeze(actor);
}

function actorByID(actorID: string): AuthenticatedActor {
  const actor = actorsByID.get(actorID);
  if (actor === undefined) {
    throw new Error(`no authenticated actor context for ${actorID}`);
  }
  return actor;
}

function originOf(baseURL: string): string {
  return new URL(baseURL).origin;
}

async function authenticatedContext(
  baseURL: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  csrfToken: string,
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    storageState,
    extraHTTPHeaders: {
      Origin: originOf(baseURL),
      "X-DND-CSRF": csrfToken,
    },
  });
}

async function expectAuthResponse(
  response: APIResponse,
  operation: string,
): Promise<AuthResponse> {
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${response.status()} ${operation}: ${sanitizeDiagnosticBody(body)}`,
    );
  }
  const parsed = JSON.parse(body) as Partial<AuthResponse>;
  if (
    parsed.user === undefined ||
    typeof parsed.user.id !== "string" ||
    typeof parsed.user.username !== "string" ||
    typeof parsed.user.display_name !== "string" ||
    typeof parsed.csrf_token !== "string" ||
    parsed.csrf_token.length === 0
  ) {
    throw new Error(`${operation} returned an invalid authentication response`);
  }
  return parsed as AuthResponse;
}
