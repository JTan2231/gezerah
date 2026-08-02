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

`all` is the default. `test` aliases `e2e`. The E2E target runs the complete
frontend and backend target first, then browser tests; it is not a browser-only
shortcut.

## Isolated worktree behavior

On first invocation, `ci.sh`:

1. resolves current `HEAD`;
2. builds a temporary Git index from it;
3. stages all tracked and untracked non-ignored working-tree changes into that
   temporary index;
4. writes a tree and synthetic commit without modifying the real index;
5. creates a detached temporary worktree;
6. reinvokes itself there with isolated caches;
7. removes the worktree and temporary files on exit.

This design validates unsaved/untracked source changes while keeping dependency
installs and generated frontend assets out of the active checkout. Ignored
files are not copied, so tests must not depend on local `.dnd`, `node_modules`,
`web/static` output, or test artifacts.

The validator requires a valid Git repository with a `HEAD` commit.

## Target matrix

### Frontend

`./ci.sh frontend` performs:

1. frozen Bun dependency install;
2. Prettier format check;
3. ESLint for TypeScript/React/accessibility rules;
4. Stylelint for `src/**/*.css`;
5. Bun unit tests;
6. Knip unused-code analysis;
7. TypeScript check;
8. production Vite build.

### Backend

`./ci.sh backend` performs:

1. `gofmt` cleanliness check over Go files;
2. `go mod tidy -diff`;
3. `go vet` over application packages;
4. `go test` over application packages;
5. trimmed `cmd/dnd` binary build;
6. shell syntax checking for `ci.sh` and `run.sh`;
7. optional application-startup/migration smoke test.

The smoke test runs only when `DND_TEST_DATABASE_URL` is set. It starts the
built binary against that exact database, waits for the listening log, and
stops it. The database must be explicitly disposable because the full migration
chain may alter it.

### End to end

`./ci.sh e2e` runs frontend, backend, then:

1. frozen install for `test/`;
2. Prettier check for the harness/specs;
3. TypeScript check;
4. Playwright scenarios through the custom launcher.

Even without the optional backend smoke variable, E2E requires a reachable
PostgreSQL admin database.

## Test layers

### Rules engine tests

Files under `internal/rules/*_test.go` construct storage-neutral domain maps and
snapshots. Coverage includes:

- exact decimal canonicalization, arithmetic, and JSON;
- definition/value/reference validation for every kind;
- many-value set semantics and duplicate rejection;
- default/unknown logical state and normalization;
- condition tree validation, limits, all predicates, three-valued truth tables,
  empty plural bindings, and missing-address ordering;
- target/condition invocation bindings;
- problem instance automatic binding;
- ordered effects observing earlier effects;
- atomic failure, idempotent add/remove, clear/default behavior;
- unavailable/incomplete/applied choice resolution;
- concrete live transition target/ownership validation.

These are the preferred tests for mechanical semantics because they are fast,
deterministic, and independent of SQL/HTTP.

### Application tests

Files under `internal/app/*_test.go` focus on adapter behavior without a live
PostgreSQL integration fixture. They cover:

- configuration precedence and log levels;
- strict JSON and the error envelope;
- static-file/SPA routing and panic recovery;
- API tagged values and exact numeric transport;
- condition/problem/interaction mappings and generated IDs;
- archived-reference and dependency guards;
- event cursor parsing and matching;
- development identity vocabulary and live effect validation.

The current PostgreSQL-backed HTTP integration coverage comes primarily from
Playwright rather than a dedicated Go handler/database suite.

### Frontend unit tests

Bun tests under `web/frontend/src/domain/*.test.ts` cover pure helpers:

- metadata-driven presentation/effect compatibility and defaults;
- condition summary generation;
- deep choice draft duplication and ID/key behavior;
- live concrete effect eligibility and construction.

There are no current component-rendering unit tests.

### Browser acceptance tests

`test/specs/configuration.spec.ts` exercises:

- keyboard-accessible ruleset/schema/entity/Boolean-state authoring;
- advisory configured preview versus atomic resolve;
- stale state revision conflict and default normalization;
- condition unknown/unmet/met behavior;
- authoritative conditional outcomes and rollback of invalid effects.

`test/specs/play.spec.ts` exercises:

- local users, game/membership/entity setup;
- facilitator/player/spectator permissions;
- game-safe entity/variable filtering;
- private-note omission;
- interaction presentation, action submission, adjudication, preview, resolve,
  idempotent replay, and narrative-only rulings;
- immutable/read-only history and game archive guards;
- separate browser contexts receiving live SSE refresh without private data.

## E2E harness lifecycle

Playwright global setup:

1. creates `test/artifacts` and removes stale runtime metadata;
2. builds the production frontend into `web/static` in the isolated worktree;
3. builds a temporary Go binary;
4. creates a unique database named `dnd_e2e_<timestamp>_<random>`;
5. selects a free loopback port;
6. starts the application with debug logging and the disposable URL;
7. waits up to 60 seconds for `/api/health`;
8. writes the base URL to runtime metadata for specs.

Teardown terminates the process group, closes the log, drops the database,
removes the binary directory, and removes runtime metadata.

Database URL precedence is:

1. `DND_TEST_DATABASE_URL`;
2. `DND_E2E_ADMIN_DATABASE_URL`;
3. `DND_DATABASE_URL`;
4. `postgres://localhost:5432/postgres?sslmode=disable`.

The harness rewrites the selected URL's database path to `/postgres` for admin
commands, then creates its unique database with the remaining URL properties.

## Browser selection

The E2E launcher tries, in order:

1. Playwright's already-installed Chromium;
2. common system Chrome/Chromium locations for the platform;
3. `bunx playwright install chromium`.

`DND_E2E_BROWSER_EXECUTABLE` can explicitly override the executable passed to
Playwright. The current configuration runs one Desktop Chrome/Chromium project,
one worker, no retries, and a 90-second test timeout.

## Artifacts

On E2E runs, inspect:

| Path                            | Content                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `test/artifacts/app-server.log` | Application stdout/stderr for the disposable server.                         |
| `test/artifacts/playwright/`    | Per-test results, traces, screenshots, and video retained by failure policy. |
| `test/artifacts/report/`        | HTML report.                                                                 |

The active checkout usually receives no artifacts when invoked through root
`ci.sh`, because the entire run occurs in the disposable worktree that is
removed afterward. To preserve artifacts for interactive debugging, run the
test project directly in the working checkout after installing dependencies.

## Fast local iteration

The authoritative handoff check remains `./ci.sh`, but focused direct commands
can shorten a debugging loop:

```sh
go test ./internal/rules
go test ./internal/app
(cd web/frontend && bun test)
(cd web/frontend && bun run check)
```

For browser work, the root E2E target is safest because it verifies all layers.
If running `(cd test && bun run e2e)` directly, ensure frontend/test dependencies
are installed and disposable database credentials are configured.

## Adding tests

### Mechanical rule

Add a table-driven or focused test in `internal/rules`. Assert both successful
output and validation error code/path. Include atomic input preservation when
the operation can fail after partial progress.

### Transport or persistence mapping

Test strict tagged shapes, generated/preserved IDs, exact numeric conversion,
archived references, and round-trip response form. Add database-backed browser
coverage if a constraint/transaction is essential to correctness.

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

Exercise both an empty database through E2E and, where feasible, a database at
the immediately previous schema version. Set `DND_TEST_DATABASE_URL` only to a
database that can be destroyed or modified without consequence.

## Current gaps

- no hosted CI workflow in the repository;
- no dedicated Go PostgreSQL integration-test fixture;
- no component-level React tests;
- no coverage threshold/report in the root validator;
- no accessibility audit such as axe;
- no Firefox, WebKit, mobile, or retry project;
- no migration downgrade/upgrade-from-fixture matrix;
- no load, long-duration SSE, fault-injection, or backup/restore tests.
