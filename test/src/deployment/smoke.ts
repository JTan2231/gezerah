import { randomUUID } from "node:crypto";

import { chromium, type BrowserContext } from "@playwright/test";

export interface HTTPCheck {
  name: string;
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  durationMs: number;
}

export interface BrowserCheck {
  skipped: boolean;
  title?: string;
  finalPath?: string;
  authProbe?: boolean;
  failureCount: number;
  durationMs: number;
}

export interface BrowserFailure {
  kind: "console" | "page" | "request" | "response";
  detail: string;
}

export interface SmokeResult {
  http: readonly HTTPCheck[];
  browser: BrowserCheck;
}

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RetryOptions {
  attempts: number;
  delaysMs: readonly number[];
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

export function normalizePublicURL(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("deployment URL must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("deployment URL must use HTTPS");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("deployment URL must not contain credentials");
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      "deployment URL must identify an HTTPS origin without a path",
    );
  }
  return parsed.origin;
}

export function extractAssetURLs(
  html: string,
  pageURL: string,
): readonly string[] {
  const origin = new URL(pageURL).origin;
  const assets: string[] = [];
  const seen = new Set<string>();
  const visibleHTML = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const match of visibleHTML.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const kind = match[1]?.toLowerCase();
    if (kind === "script") {
      const source = attribute(tag, "src");
      if (source === undefined) continue;
      addAsset(source, "javascript", origin, pageURL, assets, seen);
      continue;
    }
    const relation = attribute(tag, "rel")
      ?.toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (relation?.includes("stylesheet") !== true) continue;
    const source = attribute(tag, "href");
    if (source === undefined) continue;
    addAsset(source, "stylesheet", origin, pageURL, assets, seen);
  }
  return assets;
}

export async function retry<T>(
  action: (attempt: number) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? abortableSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts || !shouldRetry(error)) throw error;
      const delay =
        options.delaysMs[Math.min(attempt - 1, options.delaysMs.length - 1)];
      await sleep(delay ?? 0, options.signal);
    }
  }
  throw lastError;
}

export async function verifyHTTP(
  baseURL: string,
  options: {
    fetchImpl?: FetchImplementation;
    retry?: Partial<RetryOptions>;
    signal?: AbortSignal;
    now?: () => number;
  } = {},
): Promise<readonly HTTPCheck[]> {
  const normalized = normalizePublicURL(baseURL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const retryOptions: RetryOptions = {
    attempts: options.retry?.attempts ?? 6,
    delaysMs: options.retry?.delaysMs ?? [500, 1_000, 2_000, 4_000, 8_000],
    ...(options.retry?.sleep === undefined
      ? {}
      : { sleep: options.retry.sleep }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const checks: HTTPCheck[] = [];

  const health = await requestText(
    "health",
    new URL(`${normalized}/api/health`),
    fetchImpl,
    retryOptions,
    now,
  );
  requireContentType(health, "application/json");
  let healthBody: unknown;
  try {
    healthBody = JSON.parse(health.body) as unknown;
  } catch {
    throw new Error("health returned malformed JSON");
  }
  if (
    typeof healthBody !== "object" ||
    healthBody === null ||
    !("ok" in healthBody) ||
    healthBody.ok !== true
  ) {
    throw new Error("health did not return ok:true");
  }
  checks.push(toCheck(health));

  const root = await requestText(
    "Wrought homepage",
    new URL(normalized),
    fetchImpl,
    retryOptions,
    now,
  );
  requireHTMLShell(root);
  checks.push(toCheck(root));

  const playDeepLink = await requestText(
    "Play SPA deep link",
    new URL(`${normalized}/play/deployment-smoke`),
    fetchImpl,
    retryOptions,
    now,
  );
  requireHTMLShell(playDeepLink);
  checks.push(toCheck(playDeepLink));

  const buildDeepLink = await requestText(
    "Build SPA deep link",
    new URL(`${normalized}/build/deployment-smoke/capacities`),
    fetchImpl,
    retryOptions,
    now,
  );
  requireHTMLShell(buildDeepLink);
  checks.push(toCheck(buildDeepLink));

  const assets = extractAssetURLs(root.body, root.finalURL);
  const javascript = assets.filter((url) => pathname(url).endsWith(".js"));
  const stylesheets = assets.filter((url) => pathname(url).endsWith(".css"));
  if (javascript.length === 0 || stylesheets.length === 0) {
    throw new Error(
      "homepage did not reference at least one same-origin JavaScript and CSS asset",
    );
  }
  for (const assetURL of assets) {
    const asset = await requestText(
      `asset ${pathname(assetURL)}`,
      new URL(assetURL),
      fetchImpl,
      retryOptions,
      now,
    );
    if (asset.body === "")
      throw new Error(`${asset.name} returned an empty body`);
    if (pathname(assetURL).endsWith(".css")) {
      requireContentType(asset, "text/css");
    } else if (!asset.contentType.toLowerCase().includes("javascript")) {
      throw new Error(
        `${asset.name} returned content type ${JSON.stringify(asset.contentType)}, expected JavaScript`,
      );
    }
    checks.push(toCheck(asset));
  }
  return checks;
}

export async function verifyBrowser(
  baseURL: string,
  options: { executablePath?: string; signal?: AbortSignal } = {},
): Promise<BrowserCheck> {
  const normalized = normalizePublicURL(baseURL);
  const publicOrigin = new URL(normalized).origin;
  const startedAt = Date.now();
  throwIfAborted(options.signal);
  const browser = await chromium.launch({
    headless: true,
    ...(options.executablePath === undefined
      ? {}
      : { executablePath: options.executablePath }),
  });
  const abortBrowser = () => void browser.close().catch(() => undefined);
  options.signal?.addEventListener("abort", abortBrowser, { once: true });
  let context: BrowserContext | undefined;
  try {
    throwIfAborted(options.signal);
    context = await browser.newContext();
    const page = await context.newPage();
    const failures: BrowserFailure[] = [];
    let expected401Responses = 0;
    let generic401ConsoleErrors = 0;
    page.on("pageerror", (error) => {
      failures.push({ kind: "page", detail: error.message });
    });
    page.on("console", (message) => {
      if (message.type() !== "error" && message.type() !== "warning") return;
      if (
        message.type() === "error" &&
        /^Failed to load resource: the server responded with a status of 401\b/.test(
          message.text(),
        )
      ) {
        generic401ConsoleErrors += 1;
        return;
      }
      failures.push({ kind: "console", detail: message.text() });
    });
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).origin !== publicOrigin) return;
      failures.push({
        kind: "request",
        detail: `${request.method()} ${safePath(request.url())}`,
      });
    });
    page.on("response", (response) => {
      if (new URL(response.url()).origin !== publicOrigin) return;
      if (response.status() < 400) return;
      const method = response.request().method();
      const path = safePath(response.url());
      if (response.status() === 401 && expectedAnonymous401(method, path)) {
        expected401Responses += 1;
        return;
      }
      failures.push({
        kind: "response",
        detail: `${response.status()} ${method} ${path}`,
      });
    });
    const response = await page.goto(normalized, {
      waitUntil: "load",
      timeout: 20_000,
    });
    if (response?.status() !== 200) {
      throw new Error(
        `browser homepage returned ${response?.status() ?? "no response"}`,
      );
    }
    const title = await page.title();
    if (title !== "Wrought") {
      throw new Error(
        `browser title was ${JSON.stringify(title)}, expected "Wrought"`,
      );
    }
    await page
      .getByRole("heading", { name: "Wrought", exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByText("A generative narrative engine.", { exact: true })
      .waitFor({ state: "visible" });
    const launchHref = await page
      .getByRole("link", { name: "Play with ChatGPT" })
      .getAttribute("href");
    if (launchHref === null) {
      throw new Error("browser homepage omitted the ChatGPT launch URL");
    }
    const launchURL = new URL(launchHref);
    const launchPrompt = launchURL.searchParams.get("prompt");
    if (
      launchURL.origin !== "https://chatgpt.com" ||
      launchURL.searchParams.get("surface") !== "work" ||
      launchURL.searchParams.get("browserUrl") !== `${normalized}/play/new` ||
      launchPrompt === null ||
      !launchPrompt.includes(`${normalized}/play/new`) ||
      !launchPrompt.includes("read and apply Wrought's Play handbook") ||
      !launchPrompt.includes("prefix every successful gameplay response") ||
      !launchPrompt.includes("State — Character") ||
      !launchPrompt.includes("Mechanics:") ||
      !launchPrompt.includes("Statuses:") ||
      !launchPrompt.includes("Changes:") ||
      !launchPrompt.includes("Label: value") ||
      !launchPrompt.includes("My play preference: surprise me.")
    ) {
      throw new Error(
        "browser homepage did not provide the expected ChatGPT web launch",
      );
    }
    await page.goto(`${normalized}/play/new`);
    await page
      .getByRole("heading", { name: "Sign in" })
      .waitFor({ state: "visible" });

    const form = page.locator("form.identity-form");
    await form
      .locator('input[name="username"]')
      .fill(`deployment-smoke-${randomUUID()}`);
    await form
      .locator('input[name="password"]')
      .fill("deployment-smoke-password");
    const [signinResponse] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === "POST" &&
          new URL(candidate.url()).pathname === "/api/auth/signin",
      ),
      form.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    if (signinResponse.status() !== 401) {
      throw new Error(
        `invalid signin returned ${signinResponse.status()}, expected 401`,
      );
    }
    await page
      .getByRole("alert")
      .getByText("username or password is incorrect", { exact: true })
      .waitFor({ state: "visible" });
    if (generic401ConsoleErrors > expected401Responses) {
      failures.push({
        kind: "console",
        detail: `${generic401ConsoleErrors - expected401Responses} unexplained 401 resource error(s)`,
      });
    }
    if (failures.length > 0) {
      const first = failures[0] as BrowserFailure;
      throw new Error(
        `browser observed ${first.kind} failure: ${first.detail}`,
      );
    }
    return {
      skipped: false,
      title,
      finalPath: new URL(page.url()).pathname,
      authProbe: true,
      failureCount: 0,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    options.signal?.removeEventListener("abort", abortBrowser);
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export function skippedBrowserCheck(): BrowserCheck {
  return { skipped: true, failureCount: 0, durationMs: 0 };
}

interface TextResponse {
  name: string;
  requestedURL: string;
  finalURL: string;
  status: number;
  contentType: string;
  body: string;
  durationMs: number;
}

class RetryableHTTPError extends Error {}

async function requestText(
  name: string,
  url: URL,
  fetchImpl: FetchImplementation,
  retryOptions: RetryOptions,
  now: () => number,
): Promise<TextResponse> {
  return requestTextWithStatus(name, url, httpOK, fetchImpl, retryOptions, now);
}

const httpOK = 200;

async function requestTextWithStatus(
  name: string,
  url: URL,
  expectedStatus: number,
  fetchImpl: FetchImplementation,
  retryOptions: RetryOptions,
  now: () => number,
): Promise<TextResponse> {
  return retry(
    async () => {
      const startedAt = now();
      let response: Response;
      try {
        response = await fetchWithTimeout(fetchImpl, url, retryOptions.signal);
      } catch (error) {
        if (retryOptions.signal?.aborted === true) throw error;
        throw new RetryableHTTPError(
          `${name} request failed: ${safeError(error)}`,
        );
      }
      if (retryableStatus(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new RetryableHTTPError(
          `${name} returned retryable HTTP ${response.status}`,
        );
      }
      if (response.status !== expectedStatus) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(
          `${name} returned HTTP ${response.status}, expected ${expectedStatus}`,
        );
      }
      const finalURL = new URL(response.url || url);
      if (finalURL.protocol !== "https:" || finalURL.origin !== url.origin) {
        throw new Error(`${name} redirected outside its original HTTPS origin`);
      }
      if (
        finalURL.pathname !== url.pathname ||
        finalURL.search !== url.search ||
        finalURL.hash !== ""
      ) {
        throw new Error(`${name} did not remain at its requested URL`);
      }
      const body = await response.text();
      return {
        name,
        requestedURL: safeURL(url),
        finalURL: safeURL(finalURL),
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body,
        durationMs: now() - startedAt,
      };
    },
    (error) => error instanceof RetryableHTTPError,
    retryOptions,
  );
}

async function fetchWithTimeout(
  fetchImpl: FetchImplementation,
  url: URL,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("request timed out after 20 seconds")),
    20_000,
  );
  const abort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetchImpl(url, {
      redirect: "manual",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function requireHTMLShell(response: TextResponse): void {
  requireContentType(response, "text/html");
  if (!/<title>Wrought<\/title>/i.test(response.body)) {
    throw new Error(`${response.name} did not return the Wrought app shell`);
  }
}

function requireContentType(response: TextResponse, expected: string): void {
  if (!response.contentType.toLowerCase().includes(expected)) {
    throw new Error(
      `${response.name} returned content type ${JSON.stringify(response.contentType)}, expected ${expected}`,
    );
  }
}

function toCheck(response: TextResponse): HTTPCheck {
  return {
    name: response.name,
    url: response.requestedURL,
    status: response.status,
    contentType: response.contentType,
    bytes: Buffer.byteLength(response.body),
    durationMs: response.durationMs,
  };
}

function attribute(tag: string, name: string): string | undefined {
  const expression = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(expression);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function addAsset(
  source: string,
  kind: "javascript" | "stylesheet",
  origin: string,
  pageURL: string,
  assets: string[],
  seen: Set<string>,
): void {
  let resolved: URL;
  try {
    resolved = new URL(source, pageURL);
  } catch {
    return;
  }
  if (resolved.origin !== origin || resolved.protocol !== "https:") return;
  const extensionMatches =
    kind === "javascript"
      ? resolved.pathname.endsWith(".js")
      : resolved.pathname.endsWith(".css");
  if (!extensionMatches || seen.has(resolved.href)) return;
  seen.add(resolved.href);
  assets.push(resolved.href);
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function pathname(value: string): string {
  return new URL(value).pathname;
}

function safeURL(value: URL): string {
  return `${value.origin}${value.pathname}`;
}

function safePath(value: string): string {
  return new URL(value).pathname;
}

function expectedAnonymous401(method: string, path: string): boolean {
  return (
    (method === "GET" && path === "/api/me") ||
    (method === "POST" && path === "/api/auth/signin")
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("deployment verification was aborted");
}

async function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("deployment verification was aborted"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
