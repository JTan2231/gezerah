import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import {
  extractAssetURLs,
  normalizePublicURL,
  retry,
  verifyHTTP,
  type FetchImplementation,
} from "./smoke";

describe("deployed application smoke checks", () => {
  test("normalizes only credential-free HTTPS origins", () => {
    assert.equal(
      normalizePublicURL("https://example.test/"),
      "https://example.test",
    );
    for (const value of [
      "http://example.test",
      "https://user:pass@example.test",
      "https://example.test/path",
      "https://example.test?token=secret",
    ]) {
      assert.throws(() => normalizePublicURL(value));
    }
  });

  test("extracts unique same-origin Vite scripts and stylesheets", () => {
    const html = `
      <link crossorigin href="/assets/app.css" rel="stylesheet">
      <script type="module" src='/assets/app.js'></script>
      <script src="/assets/app.js"></script>
      <link rel="preload" href="/assets/ignored.js">
      <script src="https://cdn.example/app.js"></script>
      <script>inline()</script>
    `;
    assert.deepEqual(extractAssetURLs(html, "https://example.test/"), [
      "https://example.test/assets/app.css",
      "https://example.test/assets/app.js",
    ]);
  });

  test("retries only errors selected by the caller", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "ready";
      },
      (error) => error instanceof Error && error.message === "transient",
      {
        attempts: 4,
        delaysMs: [10, 20, 30],
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    );
    assert.equal(result, "ready");
    assert.deepEqual(sleeps, [10, 20]);
  });

  test("verifies health, the app shell, a deep link, and discovered assets", async () => {
    const attempts = new Map<string, number>();
    const html = `<!doctype html><html><head><title>dnd</title>
      <script type="module" src="/assets/app.js"></script>
      <link rel="stylesheet" href="/assets/app.css">
    </head></html>`;
    const fetchImpl: FetchImplementation = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      attempts.set(url.pathname, (attempts.get(url.pathname) ?? 0) + 1);
      if (url.pathname === "/api/health") {
        if (attempts.get(url.pathname) === 1) {
          return new Response("unavailable", { status: 503 });
        }
        return response(JSON.stringify({ ok: true }), "application/json");
      }
      if (url.pathname === "/" || url.pathname === "/play/deployment-smoke") {
        return response(html, "text/html; charset=utf-8");
      }
      if (url.pathname === "/assets/app.js") {
        return response("export {};", "text/javascript");
      }
      if (url.pathname === "/assets/app.css") {
        return response("body {}", "text/css");
      }
      return new Response("missing", { status: 404 });
    };
    const checks = await verifyHTTP("https://example.test", {
      fetchImpl,
      retry: { attempts: 2, delaysMs: [0], sleep: async () => undefined },
    });
    assert.deepEqual(
      checks.map(({ name }) => name),
      [
        "health",
        "homepage",
        "SPA deep link",
        "asset /assets/app.js",
        "asset /assets/app.css",
      ],
    );
    assert.equal(attempts.get("/api/health"), 2);
    assert.equal(
      checks.every(({ status }) => status === 200),
      true,
    );
  });

  test("rejects redirects instead of mistaking another route for a deep link", async () => {
    const fetchImpl: FetchImplementation = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/api/health") {
        return response(JSON.stringify({ ok: true }), "application/json");
      }
      return new Response(null, {
        status: 302,
        headers: { Location: "https://example.test/" },
      });
    };
    await assert.rejects(
      verifyHTTP("https://example.test", {
        fetchImpl,
        retry: { attempts: 1, delaysMs: [] },
      }),
      /homepage returned HTTP 302/,
    );
  });
});

function response(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}
