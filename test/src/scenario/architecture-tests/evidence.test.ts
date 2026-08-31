import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { CoverageLedger } from "../evidence/coverage";
import { PerformanceReporter } from "../evidence/performance";
import {
  REDACTED,
  redact,
  sanitizeText,
  sanitizeURL,
  secret,
} from "../evidence/redaction";
import { EvidenceTimeline } from "../evidence/timeline";

describe("scenario evidence", () => {
  test("redacts explicit secrets, sensitive keys, and invitation URLs", () => {
    const evidence = redact({
      visible: "safe",
      token: "opaque",
      password: "plain text",
      current_password: "old plain text",
      currentPassword: "old camel text",
      new_password: "new plain text",
      newPassword: "new plain text",
      password_hash: "argon2id digest",
      csrf_token: "csrf secret",
      session_token_hash: "session digest",
      headers: {
        Cookie: "scryer_session=session-secret",
        "Set-Cookie": "scryer_session=session-secret; HttpOnly",
        "X-SCRYER-CSRF": "csrf secret",
      },
      nested: {
        value: secret("private prose"),
        private_notes: "facilitator only",
        restricted_value: "controller only",
        invite_token: "bearer",
        url: "https://example.test/invites/bearer-value?token=also-secret",
      },
    });
    assert.deepEqual(evidence, {
      visible: "safe",
      token: REDACTED,
      password: REDACTED,
      current_password: REDACTED,
      currentPassword: REDACTED,
      new_password: REDACTED,
      newPassword: REDACTED,
      password_hash: REDACTED,
      csrf_token: REDACTED,
      session_token_hash: REDACTED,
      headers: {
        Cookie: REDACTED,
        "Set-Cookie": REDACTED,
        "X-SCRYER-CSRF": REDACTED,
      },
      nested: {
        value: REDACTED,
        private_notes: REDACTED,
        restricted_value: REDACTED,
        invite_token: REDACTED,
        url: `https://example.test/invites/${REDACTED}?token=${encodeURIComponent(
          REDACTED,
        )}`,
      },
    });
    assert.deepEqual(
      [
        "/play/invite/play-bearer",
        "/build/invite/build-bearer",
        "/api/world-invites/api-bearer/redeem",
      ].map(sanitizeURL),
      [
        `/play/invite/${REDACTED}`,
        `/build/invite/${REDACTED}`,
        `/api/world-invites/${REDACTED}/redeem`,
      ],
    );
    assert.equal(
      sanitizeText(
        "Cookie: scryer_session=secret\nSet-Cookie: scryer_session=secret\nX-SCRYER-CSRF: secret\npassword=secret\ncurrent_password=old-secret\nnew_password=new-secret\ncurrentPassword=old-camel-secret\nnewPassword=new-camel-secret",
      ),
      `Cookie: ${REDACTED}\nSet-Cookie: ${REDACTED}\nX-SCRYER-CSRF: ${REDACTED}\npassword=${REDACTED}\ncurrent_password=${REDACTED}\nnew_password=${REDACTED}\ncurrentPassword=${REDACTED}\nnewPassword=${REDACTED}`,
    );
  });

  test("records an ordered sanitized timeline", () => {
    let now = 100;
    const timeline = new EvidenceTimeline("journey", () => now++);
    timeline.append({
      phase: "driver",
      result: "started",
      actorId: "owner",
      details: { inviteToken: "secret" },
    });
    timeline.append({ phase: "driver", result: "passed", actorId: "owner" });
    assert.equal(timeline.entries()[0]?.sequence, 1);
    assert.deepEqual(timeline.entries()[0]?.details, {
      inviteToken: REDACTED,
    });
    assert.equal(timeline.entries()[1]?.timestampMs, 101);

    const failure = new EvidenceTimeline("failure");
    failure.append({
      phase: "harness",
      result: "failed",
      details: new Error(
        "POST /api/world-invites/error-bearer/redeem?token=query-bearer failed",
      ),
    });
    assert.deepEqual(failure.entries()[0]?.details, {
      name: "Error",
      message: `POST /api/world-invites/${REDACTED}/redeem?token=${encodeURIComponent(
        REDACTED,
      )} failed`,
    });
  });

  test("requires every named matrix case before a scenario can pass", () => {
    const coverage = new CoverageLedger();
    assert.throws(() => coverage.pass("INV-V01"), /named case invalid/);
    for (const caseId of ["invalid", "revoked", "expired"]) {
      coverage.passCase("INV-V01", caseId, {
        actors: ["visitor"],
        durationMs: 1,
        observedScopes: ["HTTP"],
      });
    }
    const result = coverage.get("INV-V01");
    assert.equal(result.result, "passed");
    assert.deepEqual(result.actors, ["visitor"]);
    assert.deepEqual(result.observedScopes, ["HTTP"]);
  });

  test("enforces a strict total budget and exposes marginal spans", async () => {
    let now = 0;
    const performance = new PerformanceReporter(30, () => now);
    await performance.measure("checkpoint", "checkpoint", async () => {
      now += 8;
    });
    performance.increment("observationLoads", 2);
    performance.increment("observationCacheHits");
    now = 29;
    const report = performance.assertUnderBudget();
    assert.equal(report.underBudget, true);
    assert.equal(report.spans[0]?.durationMs, 8);
    now = 30;
    assert.throws(() => performance.assertUnderBudget(), /strictly under/);
  });
});
