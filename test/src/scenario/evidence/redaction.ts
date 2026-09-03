const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const SECRET = Symbol("scenario-secret");

export interface SecretValue<T> {
  readonly [SECRET]: true;
  readonly value: T;
}

export function secret<T>(value: T): SecretValue<T> {
  return Object.freeze({ [SECRET]: true as const, value });
}

export interface RedactionOptions {
  readonly sensitiveKeys?: readonly string[];
}

const DEFAULT_SENSITIVE_KEYS = [
  "authorization",
  "cookie",
  "currentPassword",
  "csrfToken",
  "inviteToken",
  "inviteUrl",
  "joinPath",
  "newPassword",
  "password",
  "passwordHash",
  "privateNotes",
  "restrictedValue",
  "secret",
  "sessionToken",
  "sessionTokenHash",
  "setCookie",
  "token",
  "xWroughtCsrf",
] as const;

function normalizedKeys(options: RedactionOptions): Set<string> {
  return new Set(
    [...DEFAULT_SENSITIVE_KEYS, ...(options.sensitiveKeys ?? [])].map((key) =>
      normalizeKey(key),
    ),
  );
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSecretValue(value: unknown): value is SecretValue<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    SECRET in value &&
    (value as Partial<SecretValue<unknown>>)[SECRET] === true
  );
}

export function sanitizeURL(raw: string): string {
  try {
    const url = new URL(raw, "http://scenario.invalid");
    const parts = url.pathname.split("/");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const previous = parts[index - 1];
      const bearerSegment =
        part === "invites" ||
        part === "world-invites" ||
        (part === "invite" && (previous === "play" || previous === "build"));
      if (bearerSegment && parts[index + 1] !== undefined) {
        parts[index + 1] = REDACTED;
      }
    }
    url.pathname = parts.join("/");
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|invite|key/i.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    if (url.origin === "http://scenario.invalid") {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return raw.replace(
      /((?:token|secret|invite|key)=)[^&\s]+/gi,
      `$1${REDACTED}`,
    );
  }
}

export function sanitizeText(raw: string): string {
  return raw
    .replace(
      /\b(authorization|cookie|set-cookie|x-wrought-csrf)\s*:\s*[^\r\n]+/gi,
      `$1: ${REDACTED}`,
    )
    .replace(
      /\b((?:current_|new_)?password(?:_hash)?|(?:current|new)Password|csrf_token|session_token(?:_hash)?)\s*[=:]\s*[^\s,&;]+/gi,
      `$1=${REDACTED}`,
    )
    .replace(/(\/(?:play|build)\/invite\/)[^/?#\s"']+/g, `$1${REDACTED}`)
    .replace(/(\/(?:api\/)?(?:world-)?invites\/)[^/?#\s"']+/g, `$1${REDACTED}`)
    .replace(
      /([?&](?:token|secret|invite|key)=)[^&\s"']+/gi,
      `$1${encodeURIComponent(REDACTED)}`,
    );
}

export function sanitizeDiagnosticBody(raw: string): string {
  try {
    return JSON.stringify(redact(JSON.parse(raw) as unknown));
  } catch {
    return sanitizeText(raw);
  }
}

export function redact<T>(value: T, options: RedactionOptions = {}): unknown {
  const sensitiveKeys = normalizedKeys(options);
  const seen = new WeakSet<object>();

  function visit(current: unknown, key?: string): unknown {
    if (key !== undefined && sensitiveKeys.has(normalizeKey(key))) {
      return REDACTED;
    }
    if (isSecretValue(current)) {
      return REDACTED;
    }
    if (typeof current === "string") {
      return sanitizeText(current);
    }
    if (
      current === null ||
      current === undefined ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "bigint"
    ) {
      return typeof current === "bigint" ? current.toString() : current;
    }
    if (current instanceof Error) {
      return {
        name: current.name,
        message: sanitizeText(current.message),
      };
    }
    if (typeof current !== "object") {
      return String(current);
    }
    if (seen.has(current)) {
      return CIRCULAR;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      return current.map((item) => visit(item));
    }
    return Object.fromEntries(
      Object.entries(current).map(([entryKey, entryValue]) => [
        entryKey,
        visit(entryValue, entryKey),
      ]),
    );
  }

  return visit(value);
}

export { REDACTED };
