# Operations

## Production artifact

Production is one statically built Go application plus PostgreSQL. The browser
assets are compiled by Vite into `web/static` and embedded in the Go binary.
That binary:

- connects to PostgreSQL;
- applies all pending migrations before listening;
- serves API/SSE routes;
- serves the embedded SPA and assets;
- logs structured JSON to stdout;
- handles graceful termination.

The required build order is:

```sh
cd web/frontend
bun install --frozen-lockfile
bun run build
cd ../..
CGO_ENABLED=0 go build -trimpath -o out ./cmd/dnd
```

Building Go before Vite embeds only the tracked placeholder and produces a
binary whose SPA routes return 503.

## Runtime configuration

| Variable           | Default/precedence             | Operational use                             |
| ------------------ | ------------------------------ | ------------------------------------------- |
| `DND_ADDR`         | Preferred; `:8080` default     | Bind address.                               |
| `PORT`             | Fallback when `DND_ADDR` unset | Hosting-provider port.                      |
| `DND_DATABASE_URL` | Preferred                      | PostgreSQL URL.                             |
| `DATABASE_URL`     | Fallback                       | Hosting-provider database URL.              |
| `DND_LOG_LEVEL`    | `info`                         | `debug`, `info`, `warn`/`warning`, `error`. |

Treat database URLs as secrets. The application does not read secret files or
rotate credentials. Supply them through the deployment platform and restrict
who can view process configuration.

There are no environment settings for pool size, SSE interval, HTTP timeouts,
request body size, or event batch size; changing those currently requires code.

## Startup and readiness

Startup is fail-fast:

1. parse configuration;
2. create/ping database pool;
3. take migration advisory lock and apply pending migrations;
4. construct routes/static filesystem;
5. bind and log `dnd listening`.

`GET /api/health` performs a fresh database ping with a two-second deadline:

- `200` with `ok` and a timestamp when reachable;
- `503 database_unavailable` otherwise.

This is both liveness and database readiness. It does not validate every table,
frontend asset, write permission, disk capacity, or migration compatibility.

Do not send production traffic until startup migrations finish and health is
green. A long migration delays listening and may exceed platform startup
deadlines.

## Shutdown

`SIGINT` or `SIGTERM` cancels the root context and calls HTTP shutdown with a
ten-second deadline. The server stops accepting new connections and waits for
handlers. Long-lived SSE requests observe cancellation and exit.

Configure the platform termination grace period to exceed ten seconds. A forced
kill can interrupt in-flight requests, but PostgreSQL transactions roll back
when their connections close. Clients resolving live interactions should retry
the identical request with the same idempotency key after ambiguous failure.

## Logging and observability

Logs are JSON on stdout. Notable records include startup/listening, fatal stop,
request summaries, and recovered panics with stacks. Request summaries include:

- method;
- URL path (not query string);
- status;
- response bytes;
- duration.

The server does not intentionally log request/response bodies or identity
headers in its standard request log. Database/validation errors returned to
clients are often generalized, while panic stacks remain in server logs.

There is currently no:

- metrics endpoint or OpenTelemetry integration;
- request/correlation ID;
- distributed tracing;
- structured game/ruleset/user IDs on every request log;
- slow-query logger;
- alert configuration;
- application-level audit log for configuration edits.

At minimum, alert on restart loops, health failures, elevated 5xx/409 rates,
database connection saturation, database storage, and migration duration. Be
careful not to add private notes or player action text to telemetry.

## Railway deployment

The repository's only deployment definition is Railway:

- `railpack.json` selects the Go provider and Bun 1.1.42;
- `railway.toml` performs frozen frontend install/build, then a `CGO_ENABLED=0`
  trimmed Go build to `out`;
- start command is `./out`;
- health path is `/api/health` with a 30-second timeout;
- configured replica count is one.

Attach PostgreSQL so Railway supplies `DATABASE_URL`, or set
`DND_DATABASE_URL`. Do not deploy publicly in the current authentication state;
see [Security](security.md).

### Railway release checklist

1. Run the complete `./ci.sh` against the release source.
2. Review every new migration for data backfill, lock time, and forward/backward
   binary compatibility.
3. Take/verify a database backup before a risky migration.
4. Confirm Bun/Go versions and the build log shows Vite before Go.
5. Confirm database URL and log level configuration.
6. Deploy one instance and watch migration/startup logs.
7. Verify `/api/health`, an SPA route, and representative authorized API reads.
8. Verify a non-destructive SSE connection and a safe revision-guarded command.
9. Monitor errors and database health through the release window.

## Other hosting environments

A compatible platform must provide:

- a Linux/macOS-compatible Go binary environment;
- PostgreSQL with `pgcrypto` and migration privileges;
- one HTTP port from `DND_ADDR` or `PORT`;
- TLS termination/reverse proxy if exposed;
- persistent database backups;
- signal-based graceful shutdown;
- stdout log collection;
- sufficient startup time for migrations.

No writable application filesystem is required for durable state. Frontend
files are embedded. The process filesystem may be ephemeral.

There is no Dockerfile, Compose setup, Kubernetes manifest, or release image in
this repository. If adding one, retain the frontend-before-Go build order and do
not bake database credentials into an image layer.

## Scaling characteristics

The configured deployment uses one replica. Important properties for future
horizontal scaling:

- durable state, events, revisions, and idempotency are in PostgreSQL;
- migrations serialize through a database advisory lock;
- the application has no server-local session state;
- any replica can answer normal queries/commands;
- SSE handlers poll shared PostgreSQL and can reconnect to another replica;
- every connected Play client consumes one long-lived HTTP request plus regular
  database polling;
- event delivery is at-least-observed through cursor replay, but it is an
  invalidation hint rather than a broker guarantee.

Horizontal scaling should not require sticky sessions with the current model,
but it has not been load-tested. Evaluate pool sizing, SSE connection limits,
database event-query load, migration startup behavior, and reverse-proxy
buffering/timeouts before increasing replicas.

## Database changes in production

Migrations are automatic and forward-only. Deployment is therefore also the
schema-change mechanism.

For each production migration:

1. understand the source schema and existing data volume;
2. favor expand/backfill/switch/contract across releases for incompatible
   changes;
3. ensure the old binary can tolerate the expanded schema until traffic fully
   moves;
4. avoid long exclusive locks and full-table rewrites in the startup path;
5. back up and rehearse restore;
6. deploy while monitoring the migration lock and health timeout;
7. record any manual operational step outside the migration.

Editing an already-applied migration does not rerun it because
`schema_migrations` keys by filename and has no checksum. Always add a new file.

## Backup, restore, and rollback

Application state includes user-authored configuration and immutable game
history; back it up as durable business data. The repository provides no
scheduled backup or restore automation. Use managed PostgreSQL point-in-time
recovery and/or tested logical backups appropriate to the provider.

For a binary-only regression with a backwards-compatible schema, redeploy the
previous binary. For a migration/data regression, a binary rollback alone may
be unsafe because migrations do not roll back. Options are:

- deploy a new forward repair migration/application;
- restore the entire database to a verified recovery point in a new target and
  deliberately cut over;
- use a rehearsed provider-specific point-in-time recovery.

Never run ad hoc destructive SQL against the only production database. Preserve
the incident database for analysis, stop writers when consistency requires it,
and verify rulesets, logical state, receipts, revisions, and event cursors after
recovery. See [Database](database.md) for a logical backup example.

## Runbooks

### Health is 503

1. Check database provider health/network/DNS/TLS.
2. Verify the configured URL and credential validity.
3. Check pool/connection limits and active sessions.
4. Inspect application/database logs around the two-second ping.
5. Restore service before retrying write commands; clients may hold drafts.

### Application never becomes ready

1. Inspect startup logs before the listener message.
2. Distinguish connect/ping failure from migration failure.
3. Check whether another deployment holds the migration advisory lock.
4. Inspect `schema_migrations` and PostgreSQL activity/locks read-only.
5. Do not mark a failed migration applied manually. Fix forward or restore,
   depending on whether its transaction committed.

Each migration is transactional with its version insert, so an ordinary SQL
failure should leave that migration unapplied.

### SPA returns 503

The binary was compiled without `web/static/index.html`. Correct the build
pipeline, rebuild Vite, then rebuild/redeploy Go.

### SPA route works but an asset is 404

Confirm the requested hashed asset exists in the Vite build embedded in the
same binary. `/assets/*` intentionally does not fall back to `index.html`.

### Elevated revision conflicts

409 conflicts are often expected concurrency protection, not server failure.
Check for unusually aggressive polling/retry loops, stale browser tabs, or an
event-stream refresh issue. Clients should reload rather than blindly resubmit
with a replaced revision.

### Ambiguous live resolve

Retry the identical resolve body with the same game-scoped idempotency key. A
matching committed ruling returns `replayed:true`; different content must be
treated as an idempotency conflict and investigated rather than forced.

### SSE freshness issue

1. Confirm active membership and identity header.
2. Check proxy buffering and idle timeouts; the response sets no-buffer hints
   and sends keep-alives.
3. Verify cursor syntax and inspect recent `game_events`.
4. Check PostgreSQL/event query health.
5. The frontend has a three-second query fallback, so distinguish stream failure
   from general API refresh failure.

## Production-readiness gaps

- development-only forgeable identity and unauthenticated builder APIs;
- no built-in TLS/security-header/rate-limit layer;
- no backup/restore automation or release rollback tooling;
- no metrics/tracing/alerts or audit trail for configuration changes;
- no pool tuning or capacity test;
- no multi-replica/load/SSE soak test;
- no container/release pipeline beyond Railway configuration;
- no documented provider-specific incident response or disaster-recovery SLO.

The authentication gap is a release blocker for untrusted/public deployment,
not merely an observability enhancement.
