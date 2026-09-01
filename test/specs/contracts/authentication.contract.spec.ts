import { randomUUID } from "node:crypto";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import {
  ageLatestSessionActivityForDirectContract,
  disableUserForDirectContract,
  expireSessionForDirectContract,
  insertActiveSessionFixturesForDirectContract,
  readAuthPersistenceForDirectContract,
} from "../../src/authState";
import { readBaseURL } from "../../src/runtime";
import { sanitizeDiagnosticBody } from "../../src/scenario";
import {
  TEST_PASSWORD,
  actorRequest,
  actorSessionCookie,
  disposeAuthenticatedActors,
  publicMutationHeaders,
  signinActor,
  signupActor,
  testUsername,
} from "../support/auth";

const AUTH_NAMED_CASES = {
  "IDN-V01": ["invalid", "duplicate-normalized-username"],
  "IDN-V02": ["unknown-username", "wrong-password"],
  "IDN-V03": ["missing", "malformed", "expired", "revoked", "disabled"],
  "IDN-V04": ["password-hash", "session-digest", "response-redaction"],
  "IDN-V05": ["missing-token", "wrong-token", "cross-origin"],
  "AUT-V07": ["anonymous-forgery", "authenticated-override"],
} as const;

test.afterEach(async () => disposeAuthenticatedActors());

test("contract: password accounts, sessions, CSRF, and forged identity headers are enforced", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);

  await test.step("IDN-V01[invalid] signup creates neither account nor session", async () => {
    const context = await publicContext(baseURL);
    try {
      await expectAPIError(
        await context.post("/api/auth/signup", {
          data: { username: "!", display_name: "", password: "short" },
        }),
        422,
        "validation_failed",
      );
      await expectAPIError(
        await context.get("/api/me"),
        401,
        "authentication_required",
      );
    } finally {
      await context.dispose();
    }
  });

  await test.step("IDN-V01[duplicate-normalized-username] is rejected atomically", async () => {
    const username = `Case.Account-${unique}`;
    await signupActor(baseURL, `Case owner ${unique}`, { username });
    const duplicate = await publicContext(baseURL);
    try {
      await expectAPIError(
        await duplicate.post("/api/auth/signup", {
          data: {
            username: username.toLowerCase(),
            display_name: `Duplicate ${unique}`,
            password: TEST_PASSWORD,
          },
        }),
        409,
        "username_unavailable",
      );
      await expectAPIError(
        await duplicate.get("/api/me"),
        401,
        "authentication_required",
      );
    } finally {
      await duplicate.dispose();
    }
  });

  const credentialUsername = testUsername(`credentials-${unique}`);
  await signupActor(baseURL, `Credential owner ${unique}`, {
    username: credentialUsername,
  });
  const expectedInvalidCredentials = {
    status: 401,
    error: {
      code: "invalid_credentials",
      message: "username or password is incorrect",
    },
  };

  await test.step("IDN-V02[unknown-username] returns the generic credential failure", async () => {
    const unknown = await publicContext(baseURL);
    try {
      const unknownError = await readAPIError(
        await unknown.post("/api/auth/signin", {
          data: {
            username: `unknown-${unique}`,
            password: "a-wrong-password-long-enough",
          },
        }),
      );
      expect(unknownError).toEqual(expectedInvalidCredentials);
    } finally {
      await unknown.dispose();
    }
  });

  await test.step("IDN-V02[wrong-password] returns the same generic credential failure", async () => {
    const wrong = await publicContext(baseURL);
    try {
      const wrongError = await readAPIError(
        await wrong.post("/api/auth/signin", {
          data: {
            username: credentialUsername,
            password: "a-wrong-password-long-enough",
          },
        }),
      );
      expect(wrongError).toEqual(expectedInvalidCredentials);
    } finally {
      await wrong.dispose();
    }
  });

  expect(AUTH_NAMED_CASES["IDN-V03"]).toEqual([
    "missing",
    "malformed",
    "expired",
    "revoked",
    "disabled",
  ]);
  await test.step("IDN-V03[missing] session is rejected", async () => {
    await expectAPIError(
      await request.get(`${baseURL}/api/me`),
      401,
      "authentication_required",
    );
  });

  await test.step("IDN-V03[malformed] session is rejected", async () => {
    const malformed = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: "gezerah_session=not-a-valid-session" },
    });
    try {
      await expectAPIError(
        await malformed.get("/api/me"),
        401,
        "authentication_required",
      );
    } finally {
      await malformed.dispose();
    }
  });

  await test.step("IDN-V03[expired] session is rejected", async () => {
    const expired = await signupActor(baseURL, `Expired actor ${unique}`);
    await expireSessionForDirectContract(expired.id);
    await expectAPIError(
      await expired.api.get("/api/me"),
      401,
      "authentication_required",
    );
  });

  await test.step("IDN-V03[revoked] session is rejected", async () => {
    const revoked = await signupActor(baseURL, `Revoked actor ${unique}`);
    const world = await expectJSON<{ id: string }>(
      await revoked.api.post("/api/worlds", {
        data: { name: `Revoked stream ${unique}` },
      }),
    );
    const sessionCookie = await actorSessionCookie(revoked.id);
    const controller = new AbortController();
    const stream = await fetch(
      `${baseURL}/api/worlds/${world.id}/events?after=0`,
      {
        headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
        signal: controller.signal,
      },
    );
    expect(stream.status).toBe(200);
    const logout = await revoked.api.post("/api/auth/logout");
    expect(logout.status()).toBe(204);
    await expectEventStreamClosure(stream, controller);
    await expectAPIError(
      await revoked.api.get("/api/me"),
      401,
      "authentication_required",
    );
  });

  await test.step("IDN-V03[disabled] account session is rejected", async () => {
    const disabled = await signupActor(baseURL, `Disabled actor ${unique}`);
    await disableUserForDirectContract(disabled.id);
    await expectAPIError(
      await disabled.api.get("/api/me"),
      401,
      "authentication_required",
    );
  });

  const firstPersistenceActor = await signupActor(
    baseURL,
    `Persistence one ${unique}`,
  );
  const secondPersistenceActor = await signupActor(
    baseURL,
    `Persistence two ${unique}`,
  );

  await test.step("IDN-V04[password-hash] stores salted Argon2id hashes", async () => {
    const [firstRecord, secondRecord] = await Promise.all([
      readAuthPersistenceForDirectContract(firstPersistenceActor.id),
      readAuthPersistenceForDirectContract(secondPersistenceActor.id),
    ]);
    expect(firstRecord.passwordHash).toMatch(/^\$argon2id\$/);
    expect(firstRecord.passwordHash).not.toBe(TEST_PASSWORD);
    expect(secondRecord.passwordHash).not.toBe(firstRecord.passwordHash);
  });

  await test.step("IDN-V04[session-digest] stores only a token digest", async () => {
    const [firstRecord, sessionCookie] = await Promise.all([
      readAuthPersistenceForDirectContract(firstPersistenceActor.id),
      actorSessionCookie(firstPersistenceActor.id),
    ]);
    expect(firstRecord.sessionTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstRecord.sessionTokenHash).not.toBe(sessionCookie.value);
    expect(firstRecord.sessionCount).toBe(1);
    expect(sessionCookie).toMatchObject({
      name: "gezerah_session",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
  });

  await test.step("recent session activity is touched at most once per five-minute interval", async () => {
    const fresh = await readAuthPersistenceForDirectContract(
      firstPersistenceActor.id,
    );
    expect((await firstPersistenceActor.api.get("/api/me")).status()).toBe(200);
    const unchanged = await readAuthPersistenceForDirectContract(
      firstPersistenceActor.id,
    );
    expect(unchanged.lastSeenAtMicros).toBe(fresh.lastSeenAtMicros);
    expect(unchanged.idleExpiresAtMicros).toBe(fresh.idleExpiresAtMicros);

    await ageLatestSessionActivityForDirectContract(firstPersistenceActor.id);
    const aged = await readAuthPersistenceForDirectContract(
      firstPersistenceActor.id,
    );
    expect((await firstPersistenceActor.api.get("/api/me")).status()).toBe(200);
    const touched = await readAuthPersistenceForDirectContract(
      firstPersistenceActor.id,
    );
    expect(touched.lastSeenAtMicros).toBeGreaterThan(aged.lastSeenAtMicros);
    expect(touched.idleExpiresAtMicros).toBeGreaterThan(
      aged.idleExpiresAtMicros,
    );

    expect((await firstPersistenceActor.api.get("/api/me")).status()).toBe(200);
    const suppressed = await readAuthPersistenceForDirectContract(
      firstPersistenceActor.id,
    );
    expect(suppressed.lastSeenAtMicros).toBe(touched.lastSeenAtMicros);
    expect(suppressed.idleExpiresAtMicros).toBe(touched.idleExpiresAtMicros);
  });

  await test.step("SSE reauthorization is read-only and does not extend idle expiry", async () => {
    const world = await expectJSON<{ id: string }>(
      await firstPersistenceActor.api.post("/api/worlds", {
        data: { name: `Read-only session stream ${unique}` },
      }),
    );
    const [before, sessionCookie] = await Promise.all([
      readAuthPersistenceForDirectContract(firstPersistenceActor.id),
      actorSessionCookie(firstPersistenceActor.id),
    ]);
    const controller = new AbortController();
    const stream = await fetch(
      `${baseURL}/api/worlds/${world.id}/events?after=0`,
      {
        headers: { Cookie: `${sessionCookie.name}=${sessionCookie.value}` },
        signal: controller.signal,
      },
    );
    try {
      expect(stream.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 3_200));
      const after = await readAuthPersistenceForDirectContract(
        firstPersistenceActor.id,
      );
      expect(after.lastSeenAtMicros).toBe(before.lastSeenAtMicros);
      expect(after.idleExpiresAtMicros).toBe(before.idleExpiresAtMicros);
    } finally {
      controller.abort();
    }
  });

  await test.step("IDN-V04[response-redaction] never returns stored or presented secrets", async () => {
    const [firstRecord, sessionCookie, me] = await Promise.all([
      readAuthPersistenceForDirectContract(firstPersistenceActor.id),
      actorSessionCookie(firstPersistenceActor.id),
      firstPersistenceActor.api.get("/api/me"),
    ]);
    const meBody = await me.text();
    for (const secret of [
      TEST_PASSWORD,
      firstRecord.passwordHash,
      firstRecord.sessionTokenHash,
      sessionCookie.value,
    ]) {
      expect(meBody).not.toContain(secret);
    }
  });

  const csrfActor = await signupActor(baseURL, `CSRF actor ${unique}`);
  const csrfWorldsURL = `${baseURL}/api/worlds`;
  await test.step("IDN-V05[missing-token] mutation fails atomically", async () => {
    await expectAPIError(
      await csrfActor.api.post(csrfWorldsURL, {
        data: { name: `Missing CSRF ${unique}` },
        headers: { "X-GEZERAH-CSRF": "" },
      }),
      403,
      "csrf_invalid",
    );
    expect(
      await expectJSON<unknown[]>(await csrfActor.api.get(csrfWorldsURL)),
    ).toEqual([]);
  });

  await test.step("IDN-V05[wrong-token] mutation fails atomically", async () => {
    await expectAPIError(
      await csrfActor.api.post(csrfWorldsURL, {
        data: { name: `Wrong CSRF ${unique}` },
        headers: { "X-GEZERAH-CSRF": "wrong-token" },
      }),
      403,
      "csrf_invalid",
    );
    expect(
      await expectJSON<unknown[]>(await csrfActor.api.get(csrfWorldsURL)),
    ).toEqual([]);
  });

  await test.step("IDN-V05[cross-origin] mutation fails atomically", async () => {
    await expectAPIError(
      await csrfActor.api.post(csrfWorldsURL, {
        data: { name: `Cross origin ${unique}` },
        headers: { Origin: "https://attacker.invalid" },
      }),
      403,
      "origin_forbidden",
    );
    expect(
      await expectJSON<unknown[]>(await csrfActor.api.get(csrfWorldsURL)),
    ).toEqual([]);
  });

  await test.step("session creation prunes excess active sessions to the account cap", async () => {
    const actor = await signupActor(baseURL, `Session cap ${unique}`);
    await insertActiveSessionFixturesForDirectContract(actor.id, 20);
    const newest = await signinActor(baseURL, actor.username, actor.password);
    expect((await newest.api.get("/api/me")).status()).toBe(200);
    expect(
      (await readAuthPersistenceForDirectContract(actor.id)).sessionCount,
    ).toBe(20);
  });

  await test.step("IDN-007 password change rejects a wrong current password without ending the session", async () => {
    const actor = await signupActor(baseURL, `Password guard ${unique}`);
    await expectAPIError(
      await actor.api.put("/api/me/password", {
        data: {
          current_password: "not-the-current-password",
          new_password: "a-valid-new-password-that-will-not-apply",
        },
      }),
      422,
      "validation_failed",
    );
    expect((await actor.api.get("/api/me")).status()).toBe(200);
  });

  await test.step("IDN-007 password change rotates session and credentials", async () => {
    const actor = await signupActor(baseURL, `Password rotation ${unique}`);
    const oldCookie = await actorSessionCookie(actor.id);
    const newPassword = "the-new-lantern-password-is-long-enough";
    const changed = await actor.api.put("/api/me/password", {
      data: {
        current_password: actor.password,
        new_password: newPassword,
      },
    });
    expect(changed.status()).toBe(200);
    const changedBody = await expectJSON<{
      user: { id: string };
      csrf_token: string;
    }>(changed);
    expect(changedBody.user.id).toBe(actor.id);
    expect(changedBody.csrf_token).not.toBe(actor.csrfToken);
    const newCookie = await actorSessionCookie(actor.id);
    expect(newCookie.value).not.toBe(oldCookie.value);

    const oldSession = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: {
        Cookie: `${oldCookie.name}=${oldCookie.value}`,
      },
    });
    const oldPassword = await publicContext(baseURL);
    try {
      await expectAPIError(
        await oldSession.get("/api/me"),
        401,
        "authentication_required",
      );
      await expectAPIError(
        await oldPassword.post("/api/auth/signin", {
          data: { username: actor.username, password: actor.password },
        }),
        401,
        "invalid_credentials",
      );
    } finally {
      await Promise.all([oldSession.dispose(), oldPassword.dispose()]);
    }
    const replacement = await signinActor(baseURL, actor.username, newPassword);
    expect((await replacement.api.get("/api/me")).status()).toBe(200);
  });

  await test.step("IDN-007 concurrent old-password signin cannot survive password rotation", async () => {
    const actor = await signupActor(baseURL, `Password race ${unique}`);
    const oldPasswordSignin = await publicContext(baseURL);
    const newPassword = "the-raced-lantern-password-is-long-enough";
    try {
      const [changed, racedSignin] = await Promise.all([
        actor.api.put("/api/me/password", {
          data: {
            current_password: actor.password,
            new_password: newPassword,
          },
        }),
        oldPasswordSignin.post("/api/auth/signin", {
          data: { username: actor.username, password: actor.password },
        }),
      ]);
      expect(changed.status()).toBe(200);
      expect(
        (await expectJSON<{ user: { id: string } }>(changed)).user.id,
      ).toBe(actor.id);
      if (racedSignin.status() === 200) {
        expect(
          (await expectJSON<{ user: { id: string } }>(racedSignin)).user.id,
        ).toBe(actor.id);
      } else {
        await expectAPIError(racedSignin, 401, "invalid_credentials");
      }
      await expectAPIError(
        await oldPasswordSignin.get("/api/me"),
        401,
        "authentication_required",
      );
    } finally {
      await oldPasswordSignin.dispose();
    }
  });

  await test.step("IDN-008 logout-all revokes every session for the account", async () => {
    const first = await signupActor(baseURL, `All sessions ${unique}`);
    const second = await signinActor(baseURL, first.username, first.password);
    expect((await second.api.get("/api/me")).status()).toBe(200);
    const logoutAll = await first.api.post("/api/auth/logout-all");
    expect(logoutAll.status()).toBe(204);
    await Promise.all(
      [first.api, second.api].map(async (context) =>
        expectAPIError(
          await context.get("/api/me"),
          401,
          "authentication_required",
        ),
      ),
    );
  });

  await test.step("AUT-V07[anonymous-forgery] cannot authenticate", async () => {
    const victim = await signupActor(baseURL, `Forgery victim ${unique}`);
    await expectAPIError(
      await request.get(`${baseURL}/api/worlds`, {
        headers: { "X-GEZERAH-User-ID": victim.id },
      }),
      401,
      "authentication_required",
    );
  });

  await test.step("AUT-V07[authenticated-override] cannot replace the session actor", async () => {
    const victim = await signupActor(baseURL, `Override victim ${unique}`);
    const attacker = await signupActor(baseURL, `Override attacker ${unique}`);
    const victimWorld = await expectJSON<{ id: string }>(
      await actorRequest(victim.id).post("/api/worlds", {
        data: { name: `Victim world ${unique}` },
      }),
    );
    expect(
      await expectJSON<unknown[]>(
        await actorRequest(attacker.id).get("/api/worlds", {
          headers: { "X-GEZERAH-User-ID": victim.id },
        }),
      ),
    ).toEqual([]);
    await expectAPIError(
      await actorRequest(attacker.id).get(`/api/worlds/${victimWorld.id}`, {
        headers: { "X-GEZERAH-User-ID": victim.id },
      }),
      403,
      "world_forbidden",
    );
  });
});

async function publicContext(baseURL: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: publicMutationHeaders(baseURL),
  });
}

async function expectEventStreamClosure(
  response: globalThis.Response,
  controller: AbortController,
): Promise<void> {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  try {
    for (let reads = 0; reads < 8; reads += 1) {
      const result = await Promise.race([
        reader!.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("revoked event stream stayed open")),
            2_500,
          ),
        ),
      ]);
      if (result.done) return;
    }
    throw new Error("revoked event stream did not close");
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  }
}

async function expectJSON<T>(response: APIResponse): Promise<T> {
  const body = await response.text();
  expect(response.ok(), sanitizeDiagnosticBody(body)).toBe(true);
  return JSON.parse(body) as T;
}

async function expectAPIError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> {
  const error = await readAPIError(response);
  expect(error.status, sanitizeDiagnosticBody(JSON.stringify(error))).toBe(
    status,
  );
  expect(error.error.code).toBe(code);
}

async function readAPIError(response: APIResponse): Promise<{
  status: number;
  error: { code?: string; message?: string; fields?: unknown };
}> {
  const body = await response.text();
  const decoded = JSON.parse(body) as {
    error?: { code?: string; message?: string; fields?: unknown };
  };
  return {
    status: response.status(),
    error: decoded.error ?? {},
  };
}
