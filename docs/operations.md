# Operations

> **Cutover state (2026-09-03):** Wrought's canonical application URL is live at
> <https://wrought.joeytan.dev>. DNS, the Railway custom domain, canonical HTTP
> routes, and the anonymous invalid-signin browser boundary are verified. The
> existing <https://joeytan.dev> site remains entirely on its unchanged GitHub
> Pages deployment. This remains an operational preview; Railway's environment
> name `production` is not a declaration of public-production readiness, and the
> separate public-release gate remains closed.

In this runbook, **deploy** means changing the active Railway preview through the
operator-initiated `deploy.sh` path. Publishing the repository's source does not
invoke that path, change the Railway release, or designate the preview as public
production.

## Deployable artifact

Wrought deploys as one statically built Go application plus PostgreSQL. The
browser assets are compiled by Vite into `web/static` and embedded in the Go
binary. That
binary:

- connects to PostgreSQL;
- applies all pending migrations before listening;
- serves Wrought API/SSE routes below `/api`;
- serves the embedded Wrought SPA from `/`, including `/play/**` and
  `/build/**` routes;
- logs structured JSON to stdout;
- attempts bounded HTTP shutdown on termination signals.

The required build order is:

```sh
cd web/frontend
bun install --frozen-lockfile
bun run build
cd ../..
CGO_ENABLED=0 go build -trimpath -o out ./cmd/wrought
```

Building Go before Vite embeds only the tracked Wrought placeholder and
produces a binary whose Wrought SPA routes return 503.

## Runtime configuration

| Variable                  | Default/precedence                 | Operational use                                                                                       |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `WROUGHT_ADDR`            | Preferred; `:8080` default         | Bind address.                                                                                         |
| `PORT`                    | Fallback when `WROUGHT_ADDR` unset | Hosting-provider port.                                                                                |
| `WROUGHT_DATABASE_URL`    | Preferred                          | PostgreSQL URL.                                                                                       |
| `DATABASE_URL`            | Fallback                           | Hosting-provider database URL.                                                                        |
| `WROUGHT_LOG_LEVEL`       | `info`                             | `debug`, `info`, `warn`/`warning`, `error`.                                                           |
| `WROUGHT_PUBLIC_ORIGIN`   | Request origin                     | Exact browser origin for unsafe/auth requests; HTTP is loopback-only and other origins require HTTPS. |
| `OPENAI_API_KEY`          | Empty                              | Enables Terra and Luna calls through the OpenAI Responses API.                                        |
| `WROUGHT_OPENAI_BASE_URL` | Official OpenAI API                | Optional Responses API base URL override.                                                             |

If neither database variable is set, the final fallback is
`postgres://localhost:5432/wrought?sslmode=disable`. This is intended for local
development; a deployed process with no database variable would try that local
address rather than fail configuration parsing. Unknown log-level values also
silently select `info`.

The binary's default bind address `:8080` listens on all interfaces, but an
unset public origin permits HTTP authentication only when both the request host
and network peer are loopback. `./run.sh` instead binds its Vite-facing backend
to `127.0.0.1:8080` and supplies
`WROUGHT_PUBLIC_ORIGIN=http://127.0.0.1:5173` unless the variable is already set.
Configuration rejects a non-loopback HTTP public origin and also rejects a
wildcard listener paired with a loopback HTTP origin. For the canonical
deployment, set `WROUGHT_PUBLIC_ORIGIN=https://wrought.joeytan.dev`. This value is the
exact external HTTPS origin—scheme and authority only, with no path, query, or
fragment. This ensures that a reverse proxy can change the request host while
the `Secure` `__Host-wrought_session` cookie is still issued for the canonical
browser origin.

Treat database URLs and `OPENAI_API_KEY` as secrets. The application does not
read secret files or rotate credentials. Supply them through the deployment
platform and restrict who can view process configuration. Omitting the OpenAI
key leaves non-model routes available, but Terra Continue/Decide and human
Luna compilation return `503 model_unavailable`.

There are no environment settings for pool size, SSE interval, HTTP timeouts,
request body size, or event batch size; changing those currently requires code.

## Startup and readiness

Startup is fail-fast:

1. parse configuration;
2. create/ping database pool;
3. take migration advisory lock and apply pending migrations;
4. construct routes/static filesystem;
5. bind and log `Wrought listening`.

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

The ordinary HTTP write timeout is 130 seconds. SSE overrides that absolute
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

## Subdomain topology and cutover

The personal site at `joeytan.dev` remains entirely on its existing GitHub
Pages deployment. Wrought uses the independent hostname
`wrought.joeytan.dev`, so the cutover does not replace or modify the apex A/AAAA
records, personal-site source, or GitHub Pages routing.

The Wrought service owns these route families on its dedicated host:

| Public path  | Content                                      |
| ------------ | -------------------------------------------- |
| `/`          | Wrought Home.                                |
| `/play/**`   | Play, onboarding, and player invite routes.  |
| `/build/**`  | Build, administration, and editor invites.   |
| `/api`, `/api/**`       | JSON API and SSE, including `/api/health`.  |
| `/assets`, `/assets/**` | Hashed Vite assets; missing files stay 404. |

As of 2026-09-03, the subdomain DNS and Railway custom domain are verified.
Railway uses `WROUGHT_DATABASE_URL` for the preserved application database
reference and does not fall back to a different generic database URL. Its
canonical origin is `WROUGHT_PUBLIC_ORIGIN=https://wrought.joeytan.dev`.

Use this order for the one-time subdomain cutover:

1. Record Railway variables, the active deployment, the database target, and
   any existing `wrought` DNS records so each can be restored exactly.
2. Reverify `WROUGHT_DATABASE_URL` and set
   `WROUGHT_PUBLIC_ORIGIN=https://wrought.joeytan.dev` before deployment.
3. Run `./deploy.sh deploy --pre-dns`. It selects Railway's generated provider
   hostname and verifies `/`, `/api/health`, a direct `/play/**` route, and
   built assets over HTTPS. It omits the browser authentication probe because
   mutations remain bound to the canonical origin.
4. Add `wrought.joeytan.dev` as the Railway web service's custom domain and add
   only the exact DNS target and ownership records Railway provides. Do not
   change the apex GitHub Pages records.
5. Wait for DNS and certificate readiness, then manually smoke `/`,
   `/api/health`, a deep Play route, and its discovered assets through
   `https://wrought.joeytan.dev`. Verify secure-cookie issuance and attributes
   separately with an explicitly managed canary account.
6. After that canonical smoke passes, remove obsolete branded variables and
   custom domains. Preserve the generated provider domain because the release
   verifier uses it for diagnostics.
7. Run `./deploy.sh verify` against the canonical URL, the now-clean domain
   allowlist, and the browser origin/login boundary. The automated invalid-signin
   smoke does not issue a session.

To roll back the subdomain cutover, restore or remove only the recorded
`wrought` DNS records and Railway custom-domain binding. The apex personal site
requires no rollback because the cutover does not change it. Redeploy the prior
Railway commit and restore its recorded variables if the Wrought service must
also be rolled back. Database migrations are forward-only, so use the database
recovery choices in [Backup, restore, and rollback](#backup-restore-and-rollback)
when schema or data changed.

## Railway deployment

The intended post-cutover Railway target uses project `Wrought`
(`0bc0c39c-c630-4898-b4af-d7f0ebe459db`) and environment `production`
(`9f15ee7b-a2b6-4fbb-b6dc-966739a8bc08`) with these resources:

- `wrought-web` (`73261ce4-d382-41a5-a7ac-64dd71c536ab`), one public web
  replica with the `wrought.joeytan.dev` custom domain and a
  provider-generated domain;
- `Postgres` (`beb083b4-4ca6-4b3d-b2df-c429e9746f44`), one managed PostgreSQL
  replica;
- `postgres-volume`, a 5 GB persistent database volume.

Railway reports domains at host granularity; the canonical Wrought URL is
`https://wrought.joeytan.dev`. Discover and verify the current generated
hostname from Railway rather than deriving it from a service display name.

The checked-in deployment definition is:

- `railpack.json` selects the Go provider and pins Bun 1.1.42 plus Node
  22.12.0;
- `railway.toml` performs a frozen frontend install/build, then a `CGO_ENABLED=0`
  trimmed Go build to `out`;
- start command is `./out`;
- health path is `/api/health` with a 30-second timeout;
- configured replica count is one;
- deployment draining is configured for 15 seconds.

### Staged release and verification

`deploy.sh` is an operator-initiated release orchestrator. It requires Bun, Git,
an authenticated Railway CLI, a checkout linked to the intended project, and
the project/environment/services/domain/variables to exist already. It does not
create or reconfigure a Railway project, service, database, volume, domain, or
variable.

Before changing DNS for the initial subdomain cutover, deploy the current
committed revision with the generated-provider, HTTP-only stage:

```sh
./deploy.sh deploy --pre-dns
```

Here “HTTP-only” means HTTPS requests without a browser run. This stage selects
the Railway domain set's one generated `*.up.railway.app` hostname and verifies
the Wrought HTTP surface there. It does not require the canonical
custom domain to be active, does not run the invalid-signin browser probe, and
records `releaseStage: "pre-dns"`. `--pre-dns` is valid only with `deploy`; it
cannot be combined with `verify`.

After DNS and the Railway certificate are ready, normal verify and deploy
commands use the post-cutover stage:

```sh
./deploy.sh deploy
./deploy.sh verify
```

They require `WROUGHT_DEPLOY_URL` to resolve exactly to
`https://wrought.joeytan.dev`, require the web service to expose only the
`wrought.joeytan.dev` custom domain plus one generated Railway provider hostname
aligned with the current service name, and reject leftover custom domains.
They run the canonical HTTP smoke and, unless `--no-browser` is explicit, the
browser origin/login-boundary probe. `--no-browser` does not relax the exact
URL or domain-allowlist gates.

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
7. chooses the generated-provider or canonical public URL from the declared
   release stage, verifies the manifest and public HTTPS responses, and runs
   the real-browser origin/login probe only for the post-cutover stage unless
   explicitly disabled, as described in [Testing](testing.md#deployed-smoke);
8. re-reads Railway service state and refuses evidence if the active deployment,
   public URL, replica health, or database-volume health changed during smoke,
   or if another rollout is unresolved;
9. writes passing, allowlisted schema-v2 evidence, including the explicit
   `releaseStage` and the manifest's required 30-second health-check timeout, to
   `.wrought/deployments/<deployment-id>.json` and prints its path.

Verify mode inspects the active release without uploading source or running CI.
It records the local checkout only as local context, not as the identity of the
already-running release. Each passing run writes a distinct
`<deployment-id>.verify.<run-id>.json` record, preserving the original deploy
record.

Every new record sets `schemaVersion: 2`. Its `releaseStage` is
`pre-dns` or `post-cutover`; the record also retains the allowlisted project,
service, deployment, URL, HTTP/browser result, and manifest facts, including
`healthcheckTimeout: 30`. A pre-DNS record has a skipped browser result. A
post-cutover browser pass proves the canonical origin and anonymous
login-boundary behavior only: the randomized invalid signin returns 401 and
does not create a session or prove secure-cookie issuance or attributes.

Post-cutover deploy and verify run the HTTP and browser checks by default.
`--pre-dns` always disables the browser check; `--no-browser` is an explicit
post-cutover escape hatch. Deploy mode alone accepts `--skip-ci`, which still
requires clean committed source but omits the normal correctness gate. Use
`./deploy.sh --help` for the accepted forms.

The default target identifies the linked Railway project, environment, web
service, and database service by the display names `Wrought`, `production`,
`wrought-web`, and `Postgres`, then carries their discovered IDs through the
release. Set `WROUGHT_DEPLOY_PROJECT`, `WROUGHT_DEPLOY_ENVIRONMENT`,
`WROUGHT_DEPLOY_WEB_SERVICE`, and `WROUGHT_DEPLOY_DATABASE_SERVICE` for an
alternate existing target. The optional matching
`WROUGHT_DEPLOY_PROJECT_ID`, `WROUGHT_DEPLOY_ENVIRONMENT_ID`,
`WROUGHT_DEPLOY_WEB_SERVICE_ID`, and
`WROUGHT_DEPLOY_DATABASE_SERVICE_ID` add immutable identity pins; they have no
checked-in target-specific defaults. `WROUGHT_DEPLOY_DATABASE_VOLUME` pins the
database service's volume name. The database check also requires no volume
migration, exactly one ready volume of at least 5 GB mounted at
`/var/lib/postgresql/data`.
`WROUGHT_DEPLOY_URL` defaults to <https://wrought.joeytan.dev>. It must be a
credential-free HTTPS URL at the root path. Post-cutover
verification additionally requires that exact canonical value; pre-DNS deploy
uses the selected service's generated provider hostname instead.
`WROUGHT_DEPLOY_TIMEOUT_SECONDS` changes the ten-minute exact-deployment polling
timeout and accepts 30 through 3600 seconds. Overrides select already-existing
resources; they do not bootstrap them.

The script never rolls back automatically. On deployment failure it exits
nonzero after printing available diagnostics. HTTP/browser failure also exits
nonzero and leaves the Railway release in place for explicit investigation or
manual rollback. Evidence is written only after all selected checks pass.

Adding a Railway PostgreSQL service does not by itself inject its variables into
the application service. Define a reference variable such as
`DATABASE_URL=${{Postgres.DATABASE_URL}}`, using the actual database service
name, or set `WROUGHT_DATABASE_URL` to an equivalent reference. Without it, the
application falls back to local PostgreSQL and startup fails.

The `wrought.joeytan.dev` custom domain must use the exact DNS target and
ownership records shown by Railway for that domain. Do not change the
`joeytan.dev` GitHub Pages records. `WROUGHT_PUBLIC_ORIGIN` must remain exactly
`https://wrought.joeytan.dev` and must not include a path.

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
3. Review every migration for data assumptions, lock time, and
   application/schema ordering.
4. Define and rehearse backup/restore and cutback when the target will hold any
   durable data; confirm Bun/Go versions and that Vite builds before Go.
5. Set the PostgreSQL reference, exact HTTPS `WROUGHT_PUBLIC_ORIGIN`, expected log
   level, TLS/proxy policy, and secret access boundaries.
6. Verify the checked-in 15-second termination/draining setting is active and
   remains greater than the ten-second application shutdown deadline, then
   deploy one instance and inspect migration, startup, request, and shutdown
   logs.
7. Beyond the script's root, health, deep-link, asset, and invalid-signin
   smoke, verify signup, successful signin, `/api/me`, logout revocation, and
   representative authorized API reads against an explicitly managed canary
   account.
8. In a real HTTPS browser, verify `__Host-wrought_session` is `Secure`, `HttpOnly`,
   `SameSite=Lax`, path `/`, and has no `Domain`; verify wrong-origin and
   missing-CSRF mutations fail.
9. Keep an SSE connection open beyond 130 seconds; verify prompt session
   revocation, cursor recovery without event loss, and one safe
   revision-guarded command.
10. If the target will advertise public delegated start, run the stable
    [ChatGPT acceptance scenario](testing.md#chatgpt-acceptance) against the
    exact deployed candidate. CI and deployed smoke do not substitute for its
    dated acceptance record.
11. Establish monitoring and a staffed release window only if the target and
    its concerned parties actually require them.

## Other hosting environments

A hosting platform must provide:

- a Linux or macOS Go binary environment;
- PostgreSQL with `pgcrypto` and migration privileges;
- one HTTP port from `WROUGHT_ADDR` or `PORT`;
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
  130-second response timeout does not routinely force reconnection;
- event delivery is at-least-observed through cursor replay, but it is an
  invalidation hint rather than a broker guarantee.

Horizontal scaling should not require sticky sessions with the current model,
but it has not been load-tested. Evaluate pool sizing, SSE connection limits,
database event-query load, migration startup behavior, and reverse-proxy
buffering/timeouts before increasing replicas.

## Database changes for a deployment

Migrations are automatic and forward-only. Deployment is therefore also the
schema-change mechanism.

The current ordered chain is `001_world_baseline.sql`,
`002_mechanic_graph_status_instances.sql`,
`003_interaction_audience_invalidations.sql`, `004_password_auth.sql`,
`005_terra.sql`, `006_facilitator_assignment.sql`, and
`007_agent_facilitator.sql`, and `008_world_prose_guide.sql`. The `008`
migration is the forward path for every preserved database already through
`007`; do not edit an applied earlier file. Do not attach a database with a different
migration history or unledgered application tables.

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
and verify Worlds, Mechanic graphs, Status instances, modifier snapshots, and their source
Interaction provenance, logical state, effective values, Resolution receipts, revisions, and World-event
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
same binary. `/assets` and `/assets/**` intentionally do not fall back to
`index.html`.

### Elevated revision conflicts

409 conflicts are often expected concurrency protection, not server failure.
Check for unusually aggressive polling/retry loops, stale browser tabs, or an
event-stream refresh issue. Clients should reload rather than blindly resubmit
with a replaced revision.

### Ambiguous live resolve

Retry the identical resolve body with the same world-scoped idempotency key. A
matching committed Resolution returns `replayed:true`; different content must
be treated as an idempotency conflict and investigated rather than forced.

### SSE freshness issue

1. Confirm the account session is active and the user still has an active,
   play-ready membership.
2. Check proxy buffering and idle timeouts; the response sets no-buffer hints
   and sends keep-alives.
3. Confirm keep-alives continue beyond 130 seconds. Each stream write has a
   five-second deadline; a stalled proxy/client still causes reconnection.
4. Verify cursor syntax and inspect recent `world_events`. Full 100-row batches
   should drain immediately rather than waiting for the next poll.
5. Check PostgreSQL/event query and read-only session-validation health.
6. A ready Play surface performs one catch-up refresh when the stream ends and
   reconnects after 1.5 seconds; it does not run a general polling fallback.
   The three-second poll is limited to player onboarding while the world is not
   play-ready, so distinguish that state from a ready Play stream failure.

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
- only an operator-initiated deployment script; no hosted deployment workflow
  or automatic rollback;
- no documented provider-specific incident response or disaster-recovery SLO.

Username/password sessions bind each request to the server-authenticated identity. If a public
launch is ever proposed, it will require deliberate TLS/proxy configuration,
backup/restore evidence, capacity/abuse testing, monitoring, and an
account-support policy for a product that intentionally collects no email and
provides no password recovery.
