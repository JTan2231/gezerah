# Operations

> **Current state (2026-08-09):** dnd has a public-addressable Railway
> preview at <https://dnd-web-production.up.railway.app>, backed by a
> managed PostgreSQL service that was created fresh for this target. Railway
> names the environment `production`; that provider name is not a declaration
> of public-production readiness. This runbook governs the active preview, while
> the separate public-release gate remains closed.

## Deployable artifact

dnd deploys as one statically built Go application plus PostgreSQL. The
browser assets are compiled by Vite into `web/static` and embedded in the Go
binary. That binary:

- connects to PostgreSQL;
- applies all pending migrations before listening;
- serves API/SSE routes;
- serves the embedded SPA and assets;
- logs structured JSON to stdout;
- attempts bounded HTTP shutdown on termination signals.

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

| Variable            | Default/precedence             | Operational use                                                                               |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `DND_ADDR`          | Preferred; `:8080` default     | Bind address.                                                                                 |
| `PORT`              | Fallback when `DND_ADDR` unset | Hosting-provider port.                                                                        |
| `DND_DATABASE_URL`  | Preferred                      | PostgreSQL URL.                                                                               |
| `DATABASE_URL`      | Fallback                       | Hosting-provider database URL.                                                                |
| `DND_LOG_LEVEL`     | `info`                         | `debug`, `info`, `warn`/`warning`, `error`.                                                   |
| `DND_PUBLIC_ORIGIN` | Request origin                 | Exact browser origin for unsafe/auth requests; HTTP is loopback-only and other origins require HTTPS. |

If neither database variable is set, the final fallback is
`postgres://localhost:5432/dnd?sslmode=disable`. This is intended for local
development; a deployed process with no database variable would try that local
address rather than fail configuration parsing. Unknown log-level values also
silently select `info`.

The binary's default bind address `:8080` listens on all interfaces, but an
unset public origin permits HTTP authentication only when both the request host
and network peer are loopback. `./run.sh` instead binds its Vite-facing backend
to `127.0.0.1:8080` and supplies
`DND_PUBLIC_ORIGIN=http://127.0.0.1:5173` unless the variable is already set.
Configuration rejects a non-loopback HTTP public origin and also rejects a
wildcard listener paired with a loopback HTTP origin. For every deployment,
set `DND_PUBLIC_ORIGIN` to the exact external HTTPS origin (scheme and authority, with no
path/query/fragment); this is required when a reverse proxy changes the request
host and ensures the `Secure` `__Host-dnd_session` cookie is issued.

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
frontend asset, write permission, disk capacity, or complete schema contents.

For each new release, do not treat the revision as ready until startup
migrations finish and health is green. A long migration delays listening and
may exceed platform startup deadlines.

## Shutdown

`SIGINT` or `SIGTERM` cancels the root context and calls HTTP shutdown with a
ten-second deadline. HTTP request contexts derive from that root, so cancellation
ends open SSE loops while the server stops accepting new connections and waits
for other handlers.

The ordinary HTTP write timeout remains 30 seconds. SSE overrides that absolute
deadline: each write/flush gets a five-second deadline, which is cleared after
a successful flush. Healthy streams can therefore remain open, while a stalled
client does not block a write indefinitely. The active Railway target uses a
15-second drain, which exceeds the application deadline; retain that ordering on
other targets. A forced kill can still interrupt in-flight requests, but
PostgreSQL transactions roll back when their connections close. Clients
resolving live interactions should retry the identical request with the same
idempotency key after ambiguous failure.

## Logging and observability

Logs are JSON on stdout. Notable records include startup/listening, fatal stop,
request summaries, and recovered panics with stacks. Request summaries include:

- method;
- URL path (not query string), with invitation bearer segments replaced by
  `[REDACTED]`;
- status;
- response bytes;
- duration.

The server does not intentionally log request/response bodies, cookies,
passwords, CSRF tokens, raw invitation bearer tokens, or query strings in its
standard request or panic log. Database/validation errors returned to clients are often
generalized. Ordinary handler and database failures are not logged with their
underlying cause; only the request status remains. Panic stacks remain in
server logs.

There is currently no:

- metrics endpoint or OpenTelemetry integration;
- request/correlation ID;
- distributed tracing;
- structured world/user IDs on every request log;
- slow-query logger;
- per-migration version, progress, or duration logging;
- alert configuration;
- application-level audit log for configuration edits.

At minimum, alert on restart loops, health failures, elevated 5xx/409 rates,
database connection saturation, database storage, and migration duration. Be
careful not to add private notes or player action text to telemetry.

## Railway deployment

The active Railway project is `dnd`, with environment `production` and
these existing resources:

- `dnd-web`, one public web replica at
  <https://dnd-web-production.up.railway.app>;
- `Postgres`, one managed PostgreSQL replica;
- `postgres-volume`, a 5 GB persistent database volume.

The checked-in deployment definition is:

- `railpack.json` selects the Go provider and pins Bun 1.1.42 plus Node
  22.12.0;
- `railway.toml` performs frozen frontend install/build, then a `CGO_ENABLED=0`
  trimmed Go build to `out`;
- start command is `./out`;
- health path is `/api/health` with a 30-second timeout;
- configured replica count is one;
- deployment draining is configured for 15 seconds.

### Scripted release and verification

`deploy.sh` is an operator-initiated release orchestrator. It requires Bun, Git,
an authenticated Railway CLI, a checkout linked to the intended project, and
the project/environment/services/domain/variables to exist already. It does not
create or reconfigure a Railway project, service, database, volume, domain, or
variable.

Deploy the current committed revision with the full validation gate and hosted
checks:

```sh
./deploy.sh
```

Deploy mode:

1. resolves `HEAD` and requires a clean checkout, including no untracked files;
2. requires the expected linked project, environment, web service, and database
   service and refuses to overlap another active web deployment;
3. runs the complete `./ci.sh`, then proves that `HEAD` and the checkout stayed
   unchanged;
4. checks the verified commit out into a temporary detached Git worktree and
   uploads that immutable source with `railway up --detach --json` and a unique
   release message—the locally built CI binary is not the deployed artifact;
5. polls that exact deployment ID to `SUCCESS` rather than trusting whichever
   release happens to be latest, and prints build/runtime diagnostics on failure;
6. waits until that deployment is the healthy web release, both services have
   their configured replica running, and the PostgreSQL volume is ready;
7. verifies the deployed manifest, public HTTPS responses, and real-browser
   journey described in [Testing](testing.md#deployed-smoke);
8. re-reads Railway service state and refuses evidence if the active deployment,
   public URL, replica health, or database-volume health changed during smoke,
   or if another rollout is unresolved;
9. writes passing, allowlisted evidence to
   `.dnd/deployments/<deployment-id>.json` and prints its path.

Inspect the active release without uploading source or running CI with:

```sh
./deploy.sh verify
```

Verify records the local checkout only as local context, not as the identity of
the already-running release. Each passing run writes a distinct
`<deployment-id>.verify.<run-id>.json` record, preserving the original deploy
record.

Both modes run the HTTP and browser checks by default. `--no-browser` is an
explicit escape hatch for either mode. Deploy mode alone accepts `--skip-ci`,
which still requires clean committed source but omits the normal correctness
gate. Use `./deploy.sh --help` for the accepted forms.

The default target pins both immutable Railway IDs and display names. Alternate
existing targets must set the matching `DND_DEPLOY_PROJECT_ID`,
`DND_DEPLOY_ENVIRONMENT_ID`, `DND_DEPLOY_WEB_SERVICE_ID`, and
`DND_DEPLOY_DATABASE_SERVICE_ID` together with `DND_DEPLOY_PROJECT`,
`DND_DEPLOY_ENVIRONMENT`, `DND_DEPLOY_WEB_SERVICE`, and
`DND_DEPLOY_DATABASE_SERVICE`; `DND_DEPLOY_DATABASE_VOLUME` pins that service's
volume name. The database check also requires no volume migration, exactly one
ready volume of at least 5 GB mounted at `/var/lib/postgresql/data`.
`DND_DEPLOY_URL` can assert a credential-free exact HTTPS origin, but it must
equal the URL Railway reports for the selected web service; it cannot redirect
evidence to another host.
`DND_DEPLOY_TIMEOUT_SECONDS` changes the ten-minute exact-deployment polling
timeout and accepts 30 through 3600 seconds. Overrides select already-existing
resources; they do not bootstrap them.

The script never rolls back automatically. On deployment failure it exits
nonzero after printing available diagnostics. HTTP/browser failure also exits
nonzero and leaves the Railway release in place for explicit investigation or
manual rollback. Evidence is written only after all selected checks pass.

Adding a Railway PostgreSQL service does not by itself inject its variables into
the application service. Define a reference variable such as
`DATABASE_URL=${{Postgres.DATABASE_URL}}`, using the actual database service
name, or set `DND_DATABASE_URL` to an equivalent reference. Without it, the
application falls back to local PostgreSQL and startup fails.

The checked-in 15-second Railway drain exceeds the application's ten-second
shutdown deadline. The deployment script verifies that the active manifest
retains more than ten seconds of draining; do not reduce it to ten seconds or
less before relying on signal-based shutdown. The remaining hardening and
operational conditions in [Security](security.md) apply in proportion to the
target and its audience.

### New-target and extended release checklist

The routine script automates source validation, upload, rollout observation, and
a non-persisting smoke journey. Use the additional portions of this checklist
when activating a different target, changing its audience/data policy, or
preparing for broader public use:

1. Record the target, owner, intended audience, data sensitivity, lifetime, and
   rollback authority. For a public target, start with the release gate closed.
2. Run the complete `./ci.sh` against the exact clean committed source to be
   built; investigate any nondeterminism rather than treating a later pass as a
   substitute for a failure.
3. Review every migration for existing-data assumptions, backfill, lock time,
   and application/schema ordering. Migration `004_password_auth.sql` requires
   an empty `users` table, so use a fresh database unless a separately reviewed
   data-transition plan exists.
4. Define and rehearse backup/restore and cutback when the target will hold any
   durable data; confirm Bun/Go versions and that Vite builds before Go.
5. Set the PostgreSQL reference, exact HTTPS `DND_PUBLIC_ORIGIN`, expected log
   level, TLS/proxy policy, and secret access boundaries.
6. Verify the checked-in 15-second termination/draining setting is active and
   remains greater than the ten-second application shutdown deadline, then
   deploy one instance and inspect migration, startup, request, and shutdown
   logs.
7. Beyond the script's health/deep-link/invalid-signin smoke, verify signup,
   successful signin, `/api/me`, logout revocation, and representative
   authorized API reads against an explicitly managed canary account.
8. In a real HTTPS browser, verify `__Host-dnd_session` is `Secure`, `HttpOnly`,
   `SameSite=Lax`, path `/`, and has no `Domain`; verify wrong-origin and
   missing-CSRF mutations fail.
9. Keep an SSE connection open beyond 30 seconds; verify prompt session
   revocation, cursor recovery without event loss, and one safe
   revision-guarded command.
10. Establish monitoring and a staffed release window only if the target and
    its concerned parties actually require them.

## Other hosting environments

A hosting platform must provide:

- a Linux or macOS Go binary environment;
- PostgreSQL with `pgcrypto` and migration privileges;
- one HTTP port from `DND_ADDR` or `PORT`;
- TLS termination/reverse proxy if exposed;
- persistent database backups;
- signal delivery and a termination grace period longer than the application's
  ten-second shutdown deadline;
- stdout log collection;
- sufficient startup time for migrations.

No writable application filesystem is required for durable state. Frontend
files are embedded. The process filesystem may be ephemeral.

There is no Dockerfile, Compose setup, Kubernetes manifest, or release image in
this repository. If adding one, retain the frontend-before-Go build order and do
not bake database credentials into an image layer.

## Scaling characteristics

The checked-in Railway configuration requests one replica. Important properties
for any future horizontal scaling:

- durable state, events, revisions, and idempotency are in PostgreSQL;
- migrations serialize through a database advisory lock;
- account sessions are database-backed rather than replica-local;
- authentication throttles are replica-local and key the directly connected
  peer, so a shared proxy can aggregate unrelated users and they are not a
  complete public/multi-replica abuse boundary;
- any replica can answer normal queries/commands;
- successful commands wake SSE handlers on the same replica immediately;
- SSE handlers retain a 1.5-second shared-PostgreSQL poll, so events committed
  by another replica remain visible and clients can reconnect anywhere;
- every connected Play client holds a streaming HTTP request; SSE writes have a
  five-second deadline that is cleared after each flush, so the ordinary
  30-second response timeout does not routinely force reconnection;
- event delivery is at-least-observed through cursor replay, but it is an
  invalidation hint rather than a broker guarantee.

Horizontal scaling should not require sticky sessions with the current model,
but it has not been load-tested. Evaluate pool sizing, SSE connection limits,
database event-query load, migration startup behavior, and reverse-proxy
buffering/timeouts before increasing replicas.

## Database changes for a deployment

Migrations are automatic and forward-only. Deployment is therefore also the
schema-change mechanism.

`001_worldwright.sql` remains the clean supported baseline rather than an
upgrade from the removed schema. New databases apply `001`,
`002_rules_graph_statuses.sql`, and
`003_interaction_audience_invalidations.sql`, then the empty-user account
cutover in `004_password_auth.sql`; a database at a recorded prefix
upgrades in place, including mechanic-rules/status-set root backfills and the
audience-invalidation event flag. `004` deliberately stops if any user row
exists; this repository has no account-claim or password-invention migration.
Use a fresh deployment database for this cutover. Do not attach a database with a different
migration history or unledgered application tables. If unsupported data must
be retained, use separately reviewed one-time export/transform/import tooling
outside the running service,
verify the new database, and retire that tooling.

For each migration applied to a deployed database:

1. understand the source schema and existing data volume;
2. coordinate schema and application changes in one release and do not retain
   dual-read or dual-write paths;
3. use a separately rehearsed one-time data operation when a change cannot be
   expressed safely in startup SQL;
4. avoid long exclusive locks and full-table rewrites in the startup path;
5. back up and rehearse restore;
6. deploy while monitoring the migration lock and health timeout;
7. record any manual operational step outside the migration.

Editing an already-applied migration does not rerun it because
`schema_migrations` keys by filename and has no checksum. Always add a new file.

## Backup, restore, and rollback

Application state includes user-authored configuration and protected portions
of live world history; back it up as durable business data. The repository
provides no scheduled backup or restore automation. Use managed PostgreSQL
point-in-time recovery and/or tested logical backups appropriate to the
provider.

For a binary-only regression with an unchanged schema, redeploy the previous
binary. For a migration/data regression, a binary rollback alone may
be unsafe because migrations do not roll back. Options are:

- deploy a new forward repair migration/application;
- restore the entire database to a verified recovery point in a new target and
  deliberately cut over;
- use a rehearsed provider-specific point-in-time recovery.

Never run ad hoc destructive SQL against the only production database. Preserve
the incident database for analysis, stop writers when consistency requires it,
and verify worlds, rules graphs, status instances/snapshots and their source
problem provenance, base and effective state, receipts, revisions, and event
cursors after recovery. See
[Database](database.md) for a logical backup example.

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

Retry the identical resolve body with the same world-scoped idempotency key. A
matching committed Consequence returns `replayed:true`; different content must
be treated as an idempotency conflict and investigated rather than forced.

### SSE freshness issue

1. Confirm the account session is active and the user still has an active,
   play-ready membership.
2. Check proxy buffering and idle timeouts; the response sets no-buffer hints
   and sends keep-alives.
3. Confirm keep-alives continue beyond 30 seconds. Each stream write has a
   five-second deadline; a stalled proxy/client still causes reconnection.
4. Verify cursor syntax and inspect recent `world_events`. Full 100-row batches
   should drain immediately rather than waiting for the next poll.
5. Check PostgreSQL/event query and read-only session-validation health.
6. A ready Play surface performs one catch-up refresh when the stream ends and
   reconnects after 1.5 seconds; it does not run a general polling fallback.
   The three-second poll is limited to player onboarding while the world is not
   play-ready, so distinguish that state from a ready-table stream failure.

## Current operational gaps

These do not prevent the current disposable preview, but they constrain any
broader audience, durable real-user data, or production commitment:

- no built-in TLS termination; the reverse proxy must enforce HTTPS;
- authentication throttling is in-memory, per-process, and direct-peer based;
  there is no trusted proxy-aware/distributed abuse-control layer for public
  auth traffic, other commands, or streams;
- no backup/restore automation or release rollback tooling;
- no metrics/tracing/alerts or audit trail for configuration changes;
- no pool tuning or capacity test;
- no multi-replica/load/SSE soak test;
- only an operator-initiated deployment script; no hosted CI/CD or automatic
  rollback;
- no documented provider-specific incident response or disaster-recovery SLO.

Username/password sessions close the former impersonation gap. If a public
launch is ever proposed, it will require deliberate TLS/proxy configuration,
backup/restore evidence, capacity/abuse testing, monitoring, and an
account-support policy for a product that intentionally collects no email and
provides no password recovery.
