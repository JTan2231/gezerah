import { afterEach, describe, expect, test } from "bun:test";

import {
  api,
  ApiError,
  authenticationFailureReporter,
  clearAuthentication,
  jsonBody,
  onAuthenticationRequired,
  setCSRFToken,
  worldInvitePath,
  worldPath,
} from "./client";

const originalFetch = globalThis.fetch;

function fetchStub(
  respond: (init: Parameters<typeof fetch>[1]) => Response,
): typeof fetch {
  return Object.assign(
    (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      Promise.resolve(respond(init)),
    { preconnect: originalFetch.preconnect },
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAuthentication();
});

describe("API authentication adapter", () => {
  test("builds API and event-stream paths at the Wrought origin", () => {
    expect(worldPath("world/1", "events")).toBe("/api/worlds/world%2F1/events");
    expect(worldInvitePath("token value", "redeem")).toBe(
      "/api/world-invites/token%20value/redeem",
    );
  });

  test("uses same-origin cookies and adds CSRF only to unsafe requests", async () => {
    const requests: Array<Parameters<typeof fetch>[1]> = [];
    globalThis.fetch = fetchStub((init) => {
      requests.push(init ?? {});
      return Response.json({ ok: true });
    });
    setCSRFToken("csrf-value");

    await api<{ ok: boolean }>("/api/example");
    await api<{ ok: boolean }>("/api/example", {
      method: "POST",
      ...jsonBody({ value: true }),
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.credentials).toBe("same-origin");
    expect(new Headers(requests[0]?.headers).has("X-WROUGHT-CSRF")).toBe(false);
    expect(requests[1]?.credentials).toBe("same-origin");
    expect(new Headers(requests[1]?.headers).get("X-WROUGHT-CSRF")).toBe(
      "csrf-value",
    );
    expect(new Headers(requests[1]?.headers).has("X-WROUGHT-User-ID")).toBe(
      false,
    );
  });

  test("reports a 401 and clears the CSRF token", async () => {
    const requests: Array<Parameters<typeof fetch>[1]> = [];
    let authenticationRequiredCount = 0;
    const unsubscribe = onAuthenticationRequired(() => {
      authenticationRequiredCount += 1;
    });
    globalThis.fetch = fetchStub((init) => {
      requests.push(init ?? {});
      if (requests.length === 1)
        return Response.json(
          {
            error: {
              code: "authentication_required",
              message: "Sign in to continue.",
            },
          },
          { status: 401 },
        );
      return Response.json({ ok: true });
    });
    setCSRFToken("expired-session-csrf");

    let error: unknown;
    try {
      await api("/api/protected", { method: "POST" });
    } catch (reason) {
      error = reason;
    }
    await api("/api/another-command", { method: "POST" });
    unsubscribe();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(authenticationRequiredCount).toBe(1);
    expect(new Headers(requests[1]?.headers).has("X-WROUGHT-CSRF")).toBe(false);
  });

  test("a late 401 from an old session cannot clear a newer session", async () => {
    let resolveStale!: (response: Response) => void;
    let authenticationRequiredCount = 0;
    const unsubscribe = onAuthenticationRequired(() => {
      authenticationRequiredCount += 1;
    });
    globalThis.fetch = Object.assign(
      () =>
        new Promise<Response>((resolve) => {
          resolveStale = resolve;
        }),
      { preconnect: originalFetch.preconnect },
    );
    setCSRFToken("old-session-csrf");
    const staleRequest = api("/api/stale", { method: "POST" }).catch(
      (reason: unknown) => reason,
    );
    await Promise.resolve();

    setCSRFToken("new-session-csrf");
    resolveStale(
      Response.json(
        {
          error: {
            code: "authentication_required",
            message: "The old session ended.",
          },
        },
        { status: 401 },
      ),
    );
    expect(await staleRequest).toBeInstanceOf(ApiError);

    let currentRequest: RequestInit | undefined;
    globalThis.fetch = fetchStub((init) => {
      currentRequest = init;
      return Response.json({ ok: true });
    });
    await api("/api/current", { method: "POST" });
    unsubscribe();

    expect(authenticationRequiredCount).toBe(0);
    expect(new Headers(currentRequest?.headers).get("X-WROUGHT-CSRF")).toBe(
      "new-session-csrf",
    );
  });

  test("refreshes a stale CSRF token after another tab rotates the same account session", async () => {
    const requests: Array<{
      input: Parameters<typeof fetch>[0];
      init: Parameters<typeof fetch>[1];
    }> = [];
    globalThis.fetch = Object.assign(
      (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        requests.push({ input, init });
        if (requests.length === 1) {
          return Promise.resolve(
            Response.json(
              {
                error: {
                  code: "csrf_invalid",
                  message: "A current CSRF token is required.",
                },
              },
              { status: 403 },
            ),
          );
        }
        if (requests.length === 2) {
          return Promise.resolve(
            Response.json({
              user: { id: "user-one" },
              csrf_token: "rotated-session-csrf",
            }),
          );
        }
        return Promise.resolve(Response.json({ ok: true }));
      },
      { preconnect: originalFetch.preconnect },
    );
    setCSRFToken("stale-session-csrf", "user-one");

    expect(
      await api<{ ok: boolean }>("/api/worlds", {
        method: "POST",
        ...jsonBody({ name: "The retried world" }),
      }),
    ).toEqual({ ok: true });

    expect(requests.map(({ input }) => input)).toEqual([
      "/api/worlds",
      "/api/me",
      "/api/worlds",
    ]);
    expect(new Headers(requests[0]?.init?.headers).get("X-WROUGHT-CSRF")).toBe(
      "stale-session-csrf",
    );
    expect(new Headers(requests[1]?.init?.headers).has("X-WROUGHT-CSRF")).toBe(
      false,
    );
    expect(new Headers(requests[2]?.init?.headers).get("X-WROUGHT-CSRF")).toBe(
      "rotated-session-csrf",
    );
  });

  test("does not replay a stale mutation under a different account", async () => {
    let requestCount = 0;
    let authenticationRequiredCount = 0;
    const unsubscribe = onAuthenticationRequired(() => {
      authenticationRequiredCount += 1;
    });
    globalThis.fetch = Object.assign(
      () => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(
            Response.json(
              {
                error: {
                  code: "csrf_invalid",
                  message: "A current CSRF token is required.",
                },
              },
              { status: 403 },
            ),
          );
        }
        return Promise.resolve(
          Response.json({
            user: { id: "user-two" },
            csrf_token: "different-account-csrf",
          }),
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    setCSRFToken("stale-session-csrf", "user-one");

    let error: unknown;
    try {
      await api("/api/worlds", {
        method: "POST",
        ...jsonBody({ name: "Must not be replayed" }),
      });
    } catch (reason) {
      error = reason;
    } finally {
      unsubscribe();
    }

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(requestCount).toBe(2);
    expect(authenticationRequiredCount).toBe(1);
  });

  test("authentication reporters identify current and stale sessions", () => {
    let authenticationRequiredCount = 0;
    const unsubscribe = onAuthenticationRequired(() => {
      authenticationRequiredCount += 1;
    });
    setCSRFToken("old-session-csrf");
    const staleReporter = authenticationFailureReporter();
    setCSRFToken("current-session-csrf");
    const currentReporter = authenticationFailureReporter();

    expect(staleReporter()).toBe(false);
    expect(currentReporter()).toBe(true);
    unsubscribe();

    expect(authenticationRequiredCount).toBe(1);
  });
});
