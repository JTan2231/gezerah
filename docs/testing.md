# Testing and validation

## Validation entrypoint

Use the repository validator for code changes:

```sh
./ci.sh
```

Focused targets are:

```sh
./ci.sh frontend
./ci.sh backend
./ci.sh e2e
```

`all` is the default. The E2E target runs the complete frontend and backend
target first, then browser tests; it is not a browser-only shortcut.

GitHub Actions runs the default validator on `master` pushes and pull requests,
alongside a checksum-verified full-history Gitleaks scan. Pull requests that
change dependencies also run GitHub's dependency review, and Dependabot checks
the Go, Bun, and GitHub Actions ecosystems weekly.

## Isolated worktree behavior

On first invocation, `ci.sh`:

1. resolves current `HEAD`;
2. builds a temporary Git index from it;
3. stages all tracked and untracked non-ignored working-tree changes into that
   temporary index;
4. writes a tree and synthetic commit without modifying the real index;
5. creates a detached temporary worktree;
6. reinvokes itself there with the configured shared tool cache;
7. removes the worktree and temporary files on exit.

This design validates unsaved/untracked source changes while keeping dependency
installs and generated frontend assets out of the active checkout. Ignored
files are not copied, so tests must not depend on local `.gezerah`, `node_modules`,
`web/static` output, or test artifacts.

Bun downloads, Go build and module data, pinned tool binaries, and Node compile
caches live under the ignored `.gezerah/cache/ci` directory by default, or under
`GEZERAH_CI_CACHE_DIR` when configured. The detached worktree still owns
dependency installations, build output, analyzer result caches, and runtime
state; only path-independent caches survive between invocations. An explicit
`PLAYWRIGHT_BROWSERS_PATH` is preserved, and otherwise the normal user browser
cache is reused on macOS/Linux when one can be resolved.

The validator requires a valid Git repository with a `HEAD` commit.

## Target matrix

### Frontend

`./ci.sh frontend` performs a frozen Bun dependency install, then runs these six
checks concurrently:

- Prettier format check;
- ESLint for TypeScript/React/accessibility rules;
- Stylelint for `src/**/*.css`;
- Bun unit tests;
- Knip unused-code analysis;
- TypeScript check.

After all six pass, it runs `bunx vite build` for the production assets. The CI
build does not repeat the TypeScript check performed in the validation group.

### Backend

`./ci.sh backend` performs:

1. `gofmt` cleanliness check over Go files;
2. `go mod tidy -diff`;
3. `go vet` over application packages;
4. golangci-lint 2.12.2 with the repository's curated strict configuration;
5. `go test` over application packages;
6. govulncheck 1.6.0 over production and test reachability;
7. shell syntax checking for `ci.sh`, `deploy.sh`, `run.sh`, and `reset-db.sh`;
8. trimmed `cmd/gezerah` binary build;
9. optional application-startup/migration smoke test.

The validator downloads the official golangci-lint 2.12.2 archive into the
shared CI tool cache, verifies its published SHA-256 checksum, and invokes that
exact binary directly. The accepted macOS/Linux amd64/arm64 checksums are pinned
in `ci.sh`. Its checked-in configuration uses an explicit analyzer
allowlist, analyzes tests, enables strict ignored-error checks, and requires
every `//nolint` directive to be specific, used, and explained. The validator
passes only first-party package directories, as individually quoted arguments,
so Go source found under frontend dependencies is not analyzed and checkout
paths containing spaces remain valid.

The validator installs the pinned govulncheck command into the shared CI tool
cache without modifying `go.mod` or `go.sum`, validates its embedded module path
and version on reuse, then invokes it directly with `-test`. Reachable production
or test vulnerabilities fail the target. The tool uses the shared Go caches, but
its vulnerability database query is live and therefore requires network access.
The focused backend target runs that scan after the other backend checks. The
default and E2E targets run the same read-only scan as a separate validation
lane alongside those checks, and require both lanes to pass.

Application tests cover the five-minute session-touch boundary, immediate
continuation after a full SSE event batch, cancellation while waiting, rolling
write-deadline set/clear behavior, a real stream surviving the ordinary server
write timeout, and request-context propagation from the process root.

The smoke test runs only when `GEZERAH_TEST_DATABASE_URL` is set. It starts the
built binary against that exact database, waits for the listening log, and
stops it. The database must be explicitly disposable because startup installs
the schema.

### End to end

`./ci.sh e2e` first runs frontend validation, backend validation, and the frozen
`test/` dependency install concurrently. It then runs the production artifact
builds (Vite followed by the Go binary and optional database smoke test) in
parallel with three independent test-project checks: Prettier, TypeScript, and
the scenario-runtime architecture tests plus catalog verification. After both
groups pass, it runs the Playwright scenarios through the custom launcher.

The verified Go binary already embeds the verified frontend assets and is passed
to Playwright global setup. The successful command, including detached-worktree
preparation, every frontend/backend check, builds, browser and contract tests,
database/server lifecycle, reporting, and cleanup, has a hard wall-clock budget
of less than 60 seconds. Stage timings and the final invocation-to-cleanup time
are printed on every E2E run; exceeding the budget fails the target.

Even without the optional backend smoke variable, E2E requires a reachable
PostgreSQL admin database.

### Deployed smoke

The operator-initiated deployment path adds a narrow check of the actual hosted
system after the broader local suite:

```sh
./deploy.sh verify
```

Both successful deploy mode and verify mode require the selected Railway web and
PostgreSQL services and database volume to be healthy and the active web
manifest to use `/api/health`, one replica, and more than ten seconds of
draining. Database health includes Railway's non-migrating flag, the pinned
volume name, `READY` state, at least 5 GB, and the standard
`/var/lib/postgresql/data` mount. They refuse to attest while another web
rollout is unresolved. HTTP checks then require HTTPS with no redirects, `ok:true` health JSON, the
Gezerah app shell at `/`, the same shell at a direct SPA route, and every
same-origin JavaScript and stylesheet discovered from the returned HTML.

Unless `--no-browser` is explicit, a headless Playwright check loads the hosted
homepage, validates its title and entry heading, navigates to Play, and submits
an intentionally unknown randomized username. It requires the expected 401 and
generic credential error and fails on page exceptions, console warnings/errors,
same-origin request failures, or unexpected same-origin 4xx/5xx responses. The
probe creates no account or other durable application fixture. Chrome's generic
console noise is tolerated only when accounted for by the expected anonymous
`GET /api/me` and invalid-signin `POST /api/auth/signin` 401 responses; those UI
and response boundaries are asserted directly.

This smoke test deliberately does not replay the 141-scenario suite against the
hosted database. `./ci.sh` owns broad, deterministic product behavior against a
disposable database; deployed smoke owns the narrower Railway build, service,
public TLS/proxy, deployed-origin, asset, and database-read-path boundary.
Passing runs write an allowlisted, secret-free record with private file
permissions. Deploy mode reserves `.gezerah/deployments/<deployment-id>.json`; verify
mode writes a distinct `<deployment-id>.verify.<run-id>.json` record so it cannot
replace deploy provenance.

### ChatGPT web acceptance

Changes to the ChatGPT handoff, page-tool registration, or agent narration
should receive one human-operated acceptance loop in the signed-in ChatGPT web
app before that revision is described as manually accepted. CI, the direct
WebMCP contract, and deployed smoke do not substitute for this boundary. Manual
acceptance is not a source-publication gate and does not turn source publication
into a hosted deployment.

**Current publication candidate (2026-08-31):** its manual WebMCP acceptance
attempt was stopped before completion because this operator process needs
refactoring. The attempt supplies no passing acceptance evidence for the current
revision. Source publication may proceed without claiming that it passed this
boundary; rerun a refactored procedure before making that claim or promoting
the revision to public production.

1. Build the production frontend and Go artifact from the exact source under
   test. Create a uniquely named disposable PostgreSQL database and synthetic
   account; do not reuse development or hosted data.
2. Put an official, checksum-verified `cloudflared` binary in a unique temporary
   directory. Run
   `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080` in the
   foreground and record its random HTTPS origin. Treat that origin as public
   while the process is alive.
3. Start the standalone artifact on `127.0.0.1:8080` with the disposable
   database and `GEZERAH_PUBLIC_ORIGIN` set to that exact HTTPS origin. Do not use
   normal `./run.sh`: its Vite UI is on port 5173 and its public origin is
   loopback. Require `GET /api/health` through the public origin to return
   `ok:true`.
4. In an ordinary browser, open the public Home page and choose **Start playing
   with ChatGPT**. Continue as a person would: use the prompt in ChatGPT, answer
   its short questions, sign up, choose and copy one of the three World
   templates, and choose a Character only through visible Gezerah controls. Do
   not call APIs, edit storage, or name page tools.
5. From Play, choose **Open in ChatGPT**. If ChatGPT requires its built-in
   browser to attach the authenticated Play page, use it only for that signin
   and attachment step and keep it open. Open the same conversation at
   `chatgpt.com` and perform the actual play turn there.
6. Ask ChatGPT to begin, respond naturally to the first Problem, and continue
   until ChatGPT resolves the Action and presents the next decision. Confirm
   that its location prose includes concrete, innocuous details filtered
   through the Character without private thoughts or hidden facts, and that the
   stakes and tradeoffs are clear.
7. Reload Play and require its durable history to agree with the chat: the same
   Problem, current-player Action, committed Resolution and Effects, and next
   playable state.
8. Record the source identity, date, World and Character names, resolved
   Problem, next Problem, and whether the transcript was reviewed. Do not
   publish the transcript or record the password, session cookie, CSRF token,
   database URL, or transient tunnel URL.
9. End exposure first: stop `cloudflared`, then stop the standalone app. Confirm
   port 8080 has no listener, drop only the exact disposable database, and
   remove only the exact temporary directory. A Quick Tunnel creates no
   account-owned DNS or tunnel resource to delete.

Cloudflare Quick Tunnels do not support SSE and have no uptime guarantee. This
procedure proves a single-player ChatGPT tool loop because each page-tool
mutation reloads Play; it is not evidence for SSE delivery or multi-player
freshness.

#### Historical acceptance record — 2026-08-30

This record applies only to source artifact `63a0ec3`; it is not acceptance
evidence for later revisions or the current publication candidate.

- Source artifact: `63a0ec3`.
- Runtime: disposable standalone production artifact, synthetic
  database/account, and Cloudflare Quick Tunnel. Railway was not used as
  acceptance evidence.
- World: **The Quiet Bell**. Character: **Silas Vale**.
- Observed loop: ChatGPT presented **The Bell Without a Clapper**, resolved the
  player's natural-language Action, persisted the Resolution, and continued
  with **Three Strides to the Gallery**.
- Transcript: reviewed during acceptance; intentionally not published with the
  repository.
- Cleanup: the public tunnel and standalone app were stopped, the synthetic
  database/account was removed, and the temporary runtime directory was
  deleted.

## Test layers

### Rules engine tests

Files under `internal/rules/*_test.go` construct storage-neutral domain maps and
snapshots. Coverage includes:

- zero-valid immutable decimal canonicalization and arithmetic;
- exact decimal-string HTTP transport, canonical responses, and rejection of
  JSON number tokens for decimal fields;
- input/derived numeric/Boolean definition and value validation;
- authored-default logical input values and stored-override normalization;
- recursive expression type inference with precise field paths;
- self/multi-node cycle rejection, deterministic dependency ordering, and
  defensive runtime cycle handling;
- exact numeric, Boolean, comparison, and conditional expression evaluation;
- intrinsic/effective evaluation, dependency propagation, and deterministic
  status modifier ordering;
- ordered scalar Effects observing earlier logical-input mutations;
- atomic failure and default behavior across scalar and status-lifecycle Effect transitions;
- inline status apply, exact-instance removal, automatic application order,
  same-name coexistence, and target/world-scope validation.

These are the preferred tests for mechanical semantics because they are fast,
deterministic, and independent of SQL/HTTP.

### Application tests

Files under `internal/app/*_test.go` focus on adapter behavior without a live
PostgreSQL integration fixture. They cover:

- configuration precedence and log levels;
- strict JSON and the error envelope;
- static-file/SPA routing and panic recovery;
- API Mechanic values and exact numeric transport;
- interaction mappings and generated IDs;
- archived-mechanic and dependency guards;
- event cursor parsing and matching;
- audience-removal event projection and request/panic-log bearer redaction;
- username/password hashing and parsing, origin/cookie/session middleware, and
  live effect validation;
- world creation, invite token hashing, capacity/capability mapping,
  character-field/profile validation, and semantic no-op comparison;
- recursive expression transport/storage reconstruction, derived-source
  validation, cycle field mapping, inline status modifier normalization, exact
  remove-target validation, and active derived-dependency guards;
- unknown route families return `404 endpoint_not_found`.

Migration contract tests also require digest-only invitation storage, the
world mechanic graph/status tables, root-creation triggers, normalized storage
(no JSON/JSONB aggregate),
resolution-owned inline status modifiers, status source-provenance columns,
expanded Resolution-receipt tables, immutable Resolution-receipt triggers, constrained audience
invalidation, normalized usernames/Argon2id/session-token digests, and the
human/Terra/agent facilitator assignment and attribution shapes. They assert
that Status authoring rows are owned by the
resolution rather than world configuration. For authentication, the static
migration contract requires the password-hash/token-digest columns and shape
constraints and rejects raw-token/session-token/CSRF columns in `auth_sessions`;
it does not inspect stored runtime values. The authentication contract's
targeted SQL reads perform the value comparison for signup-created rows against
the presented password and cookie token.

The current PostgreSQL-backed HTTP integration coverage comes primarily from
Playwright rather than a dedicated Go handler/database suite.

### Frontend unit tests

Bun tests under `web/frontend/src/**/*.test.{ts,tsx}` cover pure helpers, the
API adapter, and backend-independent view rendering:

- human-readable API vocabulary and past/future relative timestamps;
- exact-decimal text validation, canonicalization, and sign handling without
  JavaScript number coercion;
- derived mechanic mode/result-kind changes, including expression preservation
  and reset behavior;
- password minimum-length behavior;
- invite/world route parsing, URL encoding, default sections, selected mechanic
  round trips and unknown-route rejection;
- same-origin cookie requests, unsafe-method CSRF injection, removal of the
  caller-supplied UUID identity header, stale-CSRF recovery, session-safe mutation replay, and
  current-versus-superseded 401 authentication teardown.

Backend-independent `*View.tsx` components also have fixture-driven rendering
tests. They use `react-dom/server`'s `renderToStaticMarkup`, which is already
available through the React runtime, so ordinary presentation tests need no DOM
emulator, browser, server process, API mock, or new test framework. Fixtures
cover materially different semantic states such as loading/empty, populated,
dirty, busy, validation failure, unavailable access, onboarding, and live
content as applicable.

View tests make focused semantic assertions against headings, status copy,
field values, disabled commands, and important accessibility attributes. They
do not use large markup snapshots. Pure mapping helpers should be tested
separately when a controller performs nontrivial DTO-to-view or
draft-to-command translation.

Static rendering intentionally does not execute effects or pointer/keyboard
events. Keep deterministic state changes in pure helpers, and use Playwright
when correctness depends on interaction, focus, routing, the API, revisions,
authorization, privacy, SSE, or multiple browser identities. The architectural
lint rule is the complementary proof that shared components, `*View.tsx`, and
`*ViewModel.{ts,tsx}` modules cannot acquire an API, route, resource-hook,
`fetch`, or event-stream dependency.

### Scenario and contract tests

`test/specs/scenarios/lifecycle-spine.spec.ts` is the one UI-authentic browser
execution. Four isolated, persistent owner/editor/player/spectator contexts
sign up through the UI and carry one user-authored world from account creation
and configuration through invites,
waiting/setup/readiness, editor authority, a shared live round, same-name Status-instance
application and exact removal, and owner-authored archive. `JRN-001` through
`JRN-007` remain separately named Playwright checkpoints inside that one test.
The spine does not use API writes, storage injection, or prepared state.

Fast PostgreSQL-backed contracts under `test/specs/contracts/` use independent
cookie jars and in-memory CSRF tokens. Ordinary product setup and commands go
through the public HTTP API. The authentication contract additionally uses test-
only direct SQL to expire or age a session, disable an account, seed the session-
cap fixture, and inspect password/session digests and timestamps. Those probes
make otherwise slow or unreachable persistence states deterministic; they are
not evidence that the same states are exposed through a product API. The
contracts retain the exact server evidence that does not need another browser
journey:

- `authentication.contract.spec.ts` covers signup/signin, cookie attributes,
  session bootstrap, anonymous forged-header denial, authenticated header
  ignoring, origin/CSRF failures, logout scopes, password replacement, and
  revoked-session behavior. Its targeted SQL reads verify that signup fixtures
  have distinct Argon2id hashes, session rows contain a digest rather than the
  cookie value, and authentication responses omit the inspected credentials. It
  also verifies that recent activity does not rewrite session timestamps,
  activity older than five minutes touches once, subsequent activity is
  coalesced, and repeated SSE reauthorization does not extend idle expiry;
- `access-and-invites.contract.spec.ts` covers world isolation, invitation-token
  secrecy, admission, membership-role/current-play-role denial, editor archive denial, and revocation;
- `profile-and-readiness.contract.spec.ts` covers play-status
  transitions, controlled-Entity authority, Entity-profile privacy projections, stale
  writes, and readiness regression after a character-field-set change;
- `mechanic-graph-and-status-instances.contract.spec.ts` covers world mechanic graph publication and atomic
  graph rejection, exact logical-input-value/effective-value results and Status-instance provenance in Resolution receipts, preview
  non-persistence, exact replay/conflicting replay, one-winner Resolution, and
  exact Status-instance removal;
- `authorization-matrices.contract.spec.ts` and
  `resource-lifecycle.contract.spec.ts` cover closed invitation states, membership-role and
  cross-world matrices, archived/incomplete resources, and atomic rejection;
- `concurrency-and-status-instance-matrices.contract.spec.ts` covers named Status-instance targets
  and Resolution race/replay matrices;
- `direct-gap-closures.contract.spec.ts` owns the remaining small authority,
  lifecycle, cancellation, projection, and no-audience contracts.

Focused browser contracts under `test/specs/ui-boundaries/` cover only behavior
whose visible UI is itself material: entry/deep-link/accessibility boundaries,
signup/signin/logout/reload, dirty-draft and stale-screen recovery,
authored-profile/control workflows, and event-stream reconnection. They use
ordinary HTTP fixture setup and do not
claim lifecycle-journey evidence.

The dependency-free runtime under `test/src/scenario/` owns the 141-ID/five-tier
registry, required named cases, behavior/outcome contracts, checkpoint and
blocked-by semantics, mutation epochs, observation reuse, redacted evidence,
and performance records. Its millisecond verification runs before Playwright.

## E2E harness lifecycle

When invoked through `./ci.sh e2e`, Playwright global setup:

1. creates `test/artifacts` and removes stale runtime metadata;
2. validates the prebuilt binary supplied by the root validator; that binary
   already embeds the production frontend from the same invocation;
3. creates a unique database named `gezerah_e2e_<timestamp>_<random>`;
4. selects a free loopback port;
5. starts the application with debug logging and the disposable URL as its
   exact public origin;
6. waits up to 10 seconds for `/api/health`;
7. writes the base URL and disposable database URL to ignored runtime metadata,
   created with mode `0600`.

A direct `(cd test && bun run e2e)` invocation has the same application boundary
but falls back to building the frontend and a temporary Go binary itself.

Teardown terminates the process group on POSIX systems or the child process on
Windows, closes the log, drops the database, removes any fallback binary
directory, and removes runtime metadata. Setup also removes stale metadata
before starting the application.

The disposable database URL is a narrowly scoped controlled-time fixture for
direct contracts. `INV-V01[expired]` signs up its account and creates its world,
membership, and
invite through public HTTP, then a test-only helper validates the invite's
canonical UUID and uses `psql` to move only that row's `expires_at` into the
past. Preview, redemption, membership, and use-count evidence still comes from
public HTTP. The helper is not a product endpoint, is not exported by the
scenario/journey runtime, and must not be used by the UI-authentic spine.

Database URL precedence is:

1. `GEZERAH_TEST_DATABASE_URL`;
2. `GEZERAH_E2E_ADMIN_DATABASE_URL`;
3. `GEZERAH_DATABASE_URL`;
4. `postgres://localhost:5432/postgres?sslmode=disable`.

The harness rewrites the selected URL's database path to `/postgres` for admin
commands, then creates its unique database with the remaining URL properties.

## Browser selection

The E2E launcher tries, in order:

1. Playwright's already-installed Chromium;
2. common system Chrome/Chromium locations for the platform;
3. `bunx playwright install chromium`.

The Playwright config reads `GEZERAH_E2E_BROWSER_EXECUTABLE`, but the custom launcher
performs the discovery sequence before starting Playwright. A discovered system
browser replaces the configured value; if no bundled or system browser exists,
the launcher installs Chromium before it can proceed. The variable is therefore
not a reliable discovery/install bypass in the current harness.

The required configuration runs one Desktop Chrome/Chromium project, two
workers, no retries, and a 20-second per-test ceiling inside the stricter
60-second whole-command budget. The lifecycle spine is still one serial test.
Only specs that own separate generated aggregates overlap; shared-database
assertions remain world- or exact-resource-scoped.

## Artifacts

On E2E runs, inspect:

| Path                                               | Content                                                         |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `test/artifacts/app-server.log`                    | Application stdout/stderr for the disposable server.            |
| `test/artifacts/go-test-results.jsonl`             | Machine-readable `go test -json` output.                        |
| `test/artifacts/scenario-architecture-results.xml` | JUnit output from scenario-runtime architecture tests.          |
| `test/artifacts/playwright/`                       | Per-test results and screenshots captured on failure.           |
| `test/artifacts/report/`                           | HTML report.                                                    |
| `test/artifacts/scenario-test-results.json`        | Exact Playwright owner results and durations.                   |
| `test/artifacts/scenario-coverage.json`            | Final 141-row scenario inventory; root E2E requires all passed. |
| `test/artifacts/webmcp-database-trace.json`        | Per-command World database states for the WebMCP contract.      |

The WebMCP database trace is a mode-`0600`, test-only JSON sidecar. It records a
baseline, the state after every mutating tool-equivalent command, the changed
tables at each boundary, and an idempotent replay. Capture uses one read-only,
repeatable-read transaction per state and an explicit World-scoped projection.
Identity/authentication rows, invitation secrets, private notes, restricted
profile prose, and idempotency keys are excluded. The trace is attached to the
Playwright result as `webmcp-database-trace` as well as written at the path
above.

Deployment verification records are separate from test artifacts. They live at
`.gezerah/deployments/`, are ignored by Git, and contain only allowlisted
project/service IDs and names, whether CI passed/was skipped/was not run,
deployment state, manifest and database-volume facts, public URL, check
measurements, and timestamps. Deploy records identify the clean commit
uploaded; verify records label `localCommit` only as local checkout context and
do not infer the hosted source identity. They never contain database URLs,
Railway variables, cookies, authorization headers, CSRF values, or response
bodies.

The active checkout usually receives no artifacts when invoked through root
`ci.sh`, because the entire run occurs in the disposable worktree that is
removed afterward. To preserve artifacts for interactive debugging, run the
test project directly in the working checkout after installing dependencies.
A direct run also rebuilds ignored production output under `web/static` in that
checkout. Run the WebMCP contract directly to preserve its database sidecar:

```sh
(cd test && bunx playwright test specs/contracts/webmcp-agent.contract.spec.ts --workers=1)
```

Passing required runs do not record trace or video. Set
`GEZERAH_E2E_DIAGNOSTICS=1` on a direct diagnostic run to retain both on failure;
the root performance-gated target deliberately keeps them off.

## Fast local iteration

The authoritative handoff check remains `./ci.sh`, but focused direct commands
can shorten a debugging loop:

```sh
go test ./internal/rules
go test ./internal/app
(cd web/frontend && bun test)
(cd web/frontend && bun run check)
(cd test && bun run verify:scenarios)
```

For browser work, the root E2E target is safest because it verifies all layers.
If running `(cd test && bun run e2e)` directly, ensure frontend/test dependencies
are installed and disposable database credentials are configured.

## Adding tests

### Mechanical rule

Add a table-driven or focused test in `internal/rules`. Assert both successful
output and validation error code/path. Include atomic input preservation when
the operation can fail after partial progress.

For graph changes, cover inferred result kind, arity, unknown/cross-world and
archived references, concrete cycle paths, deterministic topological order, and
runtime defensive failure. For Status-instance changes, cover literal kind, stable
modifier ordering, distinct instances per apply target, exact active-instance
removal, same-name coexistence, and snapshot preservation. Resolve idempotency,
rather than a name/definition lookup, must prevent duplicate lifecycle
mutations.

### Transport or persistence mapping

Test strict tagged shapes, generated/preserved IDs, exact numeric conversion,
inline apply specifications, exact remove targets, source provenance, and
round-trip response form. Add database-backed browser coverage if a
constraint/transaction is essential to correctness.

### Frontend behavior

Extract pure logic to `src/domain` and unit-test edge cases. Add Playwright when
the change involves server data, routing, keyboard workflow, revisions,
authorization, privacy, or multiple users.

### Live Play behavior

Use separate identities/contexts. Assert forbidden status codes directly, and
assert sensitive JSON properties are absent rather than merely invisible in the
DOM. Test preview non-persistence, resolve atomicity, stale revisions,
idempotency replay/conflict, event refresh, and archive/final-state rules as
applicable.

### Migration

Exercise an empty database through E2E. The migration-history test accepts only
prefixes of the full `001`–current chain, and focused SQL contracts assert the
current schema behavior. Set `GEZERAH_TEST_DATABASE_URL` only to a database that
can be destroyed or modified without consequence.

## Current gaps

- no dedicated Go PostgreSQL integration-test fixture;
- no DOM-emulated component interaction suite or automated visual-regression
  comparison beyond static view rendering and Playwright workflows;
- no source line/branch coverage threshold in the root validator;
- no accessibility audit such as axe;
- no Firefox, WebKit, mobile, or retry project;
- no load, proxy/multi-replica, long-duration SSE soak, fault-injection, or
  backup/restore tests.
