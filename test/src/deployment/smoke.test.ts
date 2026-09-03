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
  test("normalizes only credential-free canonical Wrought URLs", () => {
    assert.equal(
      normalizePublicURL("https://example.test/wrought/"),
      "https://example.test/wrought",
    );
    for (const value of [
      "http://example.test/wrought",
      "https://user:pass@example.test/wrought",
      "https://example.test/",
      "https://example.test/path",
      "https://example.test/wrought?token=secret",
    ]) {
      assert.throws(() => normalizePublicURL(value));
    }
  });

  test("extracts unique same-origin Vite scripts and stylesheets", () => {
    const html = `
      <link crossorigin href="/wrought/assets/app.css" rel="stylesheet">
      <script type="module" src='/wrought/assets/app.js'></script>
      <script src="/wrought/assets/app.js"></script>
      <link rel="preload" href="/wrought/assets/ignored.js">
      <script src="https://cdn.example/app.js"></script>
      <script>inline()</script>
    `;
    assert.deepEqual(extractAssetURLs(html, "https://example.test/"), [
      "https://example.test/wrought/assets/app.css",
      "https://example.test/wrought/assets/app.js",
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
    const association = `{
  "applinks": {
    "details": [
      {
        "appIDs": ["F96ST3ZS59.com.chamber.solari"],
        "components": [
          {
            "/": "/plaid/*",
            "comment": "Matches Plaid OAuth redirect paths."
          }
        ]
      }
    ]
  }
}
`;
    const html = `<!doctype html><html><head><title>Wrought</title>
      <script type="module" src="/wrought/assets/app.js"></script>
      <link rel="stylesheet" href="/wrought/assets/app.css">
    </head></html>`;
    const siteHTML =
      "<!doctype html><title>Joey Tan - Software Engineer</title>";
    const annalsHTML =
      '<!doctype html><title>Redirecting...</title><a href="https://annals-web-production.up.railway.app">Continue</a>';
    const fetchImpl: FetchImplementation = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      attempts.set(url.pathname, (attempts.get(url.pathname) ?? 0) + 1);
      if (url.pathname === "/wrought/api/health") {
        if (attempts.get(url.pathname) === 1) {
          return new Response("unavailable", { status: 503 });
        }
        return response(JSON.stringify({ ok: true }), "application/json");
      }
      if (url.pathname === "/") {
        return response(siteHTML, "text/html; charset=utf-8");
      }
      if (url.pathname === "/index.html") {
        return response(siteHTML, "text/html; charset=utf-8");
      }
      if (url.pathname === "/annals/index.html") {
        return response(annalsHTML, "text/html; charset=utf-8");
      }
      if (url.pathname === "/plaid/oauth.html") {
        return response(
          "<!doctype html><title>Returning to Solari</title>",
          "text/html; charset=utf-8",
        );
      }
      if (url.pathname === "/llms.txt") {
        return response("# Joey Tan\n", "text/plain; charset=utf-8");
      }
      if (["/llms/", "/plaid/", "/.well-known/"].includes(url.pathname)) {
        return response("404 page not found\n", "text/plain", 404);
      }
      if (url.pathname === "/.well-known/apple-app-site-association") {
        return response(association, "application/json");
      }
      if (
        url.pathname === "/wrought" ||
        url.pathname === "/wrought/play/deployment-smoke"
      ) {
        return response(html, "text/html; charset=utf-8");
      }
      if (url.pathname === "/wrought/assets/app.js") {
        return response("export {};", "text/javascript");
      }
      if (url.pathname === "/wrought/assets/app.css") {
        return response("body {}", "text/css");
      }
      return new Response("missing", { status: 404 });
    };
    const checks = await verifyHTTP("https://example.test/wrought", {
      fetchImpl,
      retry: { attempts: 2, delaysMs: [0], sleep: async () => undefined },
    });
    assert.deepEqual(
      checks.map(({ name }) => name),
      [
        "site homepage",
        "site index",
        "annals index",
        "Plaid OAuth page",
        "LLM index",
        "directory denial /llms/",
        "directory denial /plaid/",
        "directory denial /.well-known/",
        "Apple app-site association",
        "health",
        "Wrought homepage",
        "SPA deep link",
        "asset /wrought/assets/app.js",
        "asset /wrought/assets/app.css",
      ],
    );
    assert.equal(attempts.get("/wrought/api/health"), 2);
    assert.deepEqual(
      checks.map(({ status }) => status),
      [200, 200, 200, 200, 200, 404, 404, 404, 200, 200, 200, 200, 200, 200],
    );
  });

  test("rejects redirects instead of mistaking another route for a deep link", async () => {
    const fetchImpl: FetchImplementation = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/wrought/api/health") {
        return response(JSON.stringify({ ok: true }), "application/json");
      }
      return new Response(null, {
        status: 302,
        headers: { Location: "https://example.test/" },
      });
    };
    await assert.rejects(
      verifyHTTP("https://example.test/wrought", {
        fetchImpl,
        retry: { attempts: 1, delaysMs: [] },
      }),
      /site homepage returned HTTP 302/,
    );
  });

  test("rejects a redirect from the explicit personal-site index", async () => {
    const fetchImpl: FetchImplementation = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/") {
        return response(
          "<!doctype html><title>Joey Tan - Software Engineer</title>",
          "text/html",
        );
      }
      if (url.pathname === "/index.html") {
        return new Response(null, {
          status: 301,
          headers: { Location: "https://example.test/" },
        });
      }
      return response("missing", "text/plain", 404);
    };
    await assert.rejects(
      verifyHTTP("https://example.test/wrought", {
        fetchImpl,
        retry: { attempts: 1, delaysMs: [] },
      }),
      /site index returned HTTP 301, expected 200/,
    );
  });

  test("rejects directory-listing content even with a 404 status", async () => {
    const fetchImpl: FetchImplementation = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return response(
          "<!doctype html><title>Joey Tan - Software Engineer</title>",
          "text/html",
        );
      }
      if (url.pathname === "/annals/index.html") {
        return response(
          "<!doctype html><title>Redirecting...</title>annals-web-production.up.railway.app",
          "text/html",
        );
      }
      if (url.pathname === "/plaid/oauth.html") {
        return response("<!doctype html>", "text/html");
      }
      if (url.pathname === "/llms.txt") {
        return response("# Joey Tan\n", "text/plain");
      }
      if (url.pathname === "/llms/") {
        return response(
          "<!doctype html><title>Index of /llms/</title>",
          "text/html",
          404,
        );
      }
      return response("missing", "text/plain", 404);
    };
    await assert.rejects(
      verifyHTTP("https://example.test/wrought", {
        fetchImpl,
        retry: { attempts: 1, delaysMs: [] },
      }),
      /directory denial \/llms\/ exposed a directory listing/,
    );
  });
});

function response(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}
