import type { ApiErrorPayload } from "./types";

let csrfToken = "";
let authenticatedUserID = "";
const authenticationRequiredListeners = new Set<() => void>();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function toErrorNotice(error: ApiError): {
  kind: "connection" | "request";
  message: string;
} {
  return {
    kind: error.code === "network_error" ? "connection" : "request",
    message: error.message,
  };
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (typeof value !== "object" || value === null || !("error" in value))
    return false;
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return requestAPI<T>(path, init, true);
}

async function requestAPI<T>(
  path: string,
  init: RequestInit,
  mayRefreshCSRF: boolean,
): Promise<T> {
  const reportAuthenticationFailure = authenticationFailureReporter();
  const requestCSRFToken = csrfToken;
  const requestUserID = authenticatedUserID;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (csrfToken !== "" && isUnsafeMethod(init.method))
    headers.set("X-SCRYER-CSRF", csrfToken);

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "The server could not be reached. Your draft is still here.",
    );
  }

  const hasBody =
    response.status !== 204 && response.headers.get("content-length") !== "0";
  let payload: unknown = null;
  if (hasBody) {
    try {
      payload = await response.json();
    } catch {
      if (response.status === 401) reportAuthenticationFailure();
      throw new ApiError(
        response.status,
        "invalid_response",
        response.ok
          ? "The server returned an unreadable response."
          : `Request failed (${response.status}).`,
      );
    }
  }
  if (!response.ok) {
    if (
      mayRefreshCSRF &&
      response.status === 403 &&
      isUnsafeMethod(init.method) &&
      isApiErrorPayload(payload) &&
      payload.error.code === "csrf_invalid" &&
      (await refreshCSRFToken(requestUserID, requestCSRFToken, init.signal))
    ) {
      return requestAPI<T>(path, init, false);
    }
    if (response.status === 401) reportAuthenticationFailure();
    if (isApiErrorPayload(payload)) {
      throw new ApiError(
        response.status,
        payload.error.code,
        payload.error.message,
        payload.error.fields ?? {},
      );
    }
    throw new ApiError(
      response.status,
      "request_failed",
      `Request failed (${response.status}).`,
    );
  }
  return payload as T;
}

async function refreshCSRFToken(
  expectedUserID: string,
  requestCSRFToken: string,
  signal: AbortSignal | null | undefined,
): Promise<boolean> {
  if (expectedUserID === "") return false;
  if (
    authenticatedUserID === expectedUserID &&
    csrfToken !== "" &&
    csrfToken !== requestCSRFToken
  ) {
    return true;
  }
  const session = await requestAPI<unknown>(
    "/api/me",
    signal === undefined ? {} : { signal },
    false,
  );
  if (!isRefreshSession(session)) {
    throw new ApiError(
      200,
      "invalid_response",
      "The server returned an unreadable authentication response.",
    );
  }
  if (session.user.id !== expectedUserID) {
    reportAuthenticationRequired();
    throw new ApiError(
      401,
      "authentication_required",
      "The signed-in account changed. Reload or sign in again to continue.",
    );
  }
  setCSRFToken(session.csrf_token, session.user.id);
  return true;
}

function isRefreshSession(
  value: unknown,
): value is { csrf_token: string; user: { id: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "csrf_token" in value &&
    typeof value.csrf_token === "string" &&
    value.csrf_token !== "" &&
    "user" in value &&
    typeof value.user === "object" &&
    value.user !== null &&
    "id" in value.user &&
    typeof value.user.id === "string" &&
    value.user.id !== ""
  );
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}

export function worldPath(worldId: string, resource = ""): string {
  const base = `/api/worlds/${encodeURIComponent(worldId)}`;
  return resource === "" ? base : `${base}/${resource}`;
}

export function worldInvitePath(token: string, resource = ""): string {
  const base = `/api/world-invites/${encodeURIComponent(token)}`;
  return resource === "" ? base : `${base}/${resource}`;
}

export function setCSRFToken(token: string, userID = ""): void {
  csrfToken = token;
  authenticatedUserID = userID;
}

export function clearAuthentication(): void {
  csrfToken = "";
  authenticatedUserID = "";
}

export function onAuthenticationRequired(listener: () => void): () => void {
  authenticationRequiredListeners.add(listener);
  return () => authenticationRequiredListeners.delete(listener);
}

// A response belongs to the authentication state that existed when its request
// started. Ignoring a late 401 after the CSRF token changes prevents an old,
// revoked session request from tearing down a newly established session.
export function authenticationFailureReporter(): () => boolean {
  const requestCSRFToken = csrfToken;
  return () => {
    if (csrfToken !== requestCSRFToken) return false;
    reportAuthenticationRequired();
    return true;
  };
}

function reportAuthenticationRequired(): void {
  clearAuthentication();
  for (const listener of authenticationRequiredListeners) listener();
}

function isUnsafeMethod(method: string | undefined): boolean {
  switch ((method ?? "GET").toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return false;
    default:
      return true;
  }
}
