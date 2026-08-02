import type { ApiErrorPayload } from "./types";

const selectedUserKey = "dnd.selected-user";

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
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const selectedUserId = readSelectedUserId();
  if (selectedUserId !== "") headers.set("X-DND-User-ID", selectedUserId);

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "The server could not be reached. Your draft is still here.",
    );
  }

  const hasBody =
    response.status !== 204 && response.headers.get("content-length") !== "0";
  const payload: unknown = hasBody ? await response.json() : null;
  if (!response.ok) {
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

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}

export function ruleSetPath(ruleSetId: string, resource = ""): string {
  const base = `/api/rule-sets/${encodeURIComponent(ruleSetId)}`;
  return resource === "" ? base : `${base}/${resource}`;
}

export function gamePath(gameId: string, resource = ""): string {
  const base = `/api/games/${encodeURIComponent(gameId)}`;
  return resource === "" ? base : `${base}/${resource}`;
}

export function playRuleSetPath(ruleSetId: string, resource = ""): string {
  const base = `/api/play/rule-sets/${encodeURIComponent(ruleSetId)}`;
  return resource === "" ? base : `${base}/${resource}`;
}

export function readSelectedUserId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(selectedUserKey) ?? "";
}

export function selectUserId(userId: string): void {
  if (typeof window === "undefined") return;
  if (userId === "") window.localStorage.removeItem(selectedUserKey);
  else window.localStorage.setItem(selectedUserKey, userId);
}
