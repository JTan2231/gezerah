# Development guide

## Prerequisites

Install the following locally:

| Tool                                   | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| Go 1.25.14                             | Pinned backend build, tests, and executable.               |
| Bun 1.1.42                             | Intended frontend and E2E package manager/runtime version. |
| PostgreSQL                             | Application data and tests.                                |
| `createdb`                             | Initial local database creation.                           |
| `psql`                                 | End-to-end disposable database management.                 |
| Git                                    | Source control and isolated `ci.sh` worktrees.             |
| `curl`                                 | Pinned CI tool downloads and `run.sh` service probes.      |
| `tar` and SHA-256 tooling              | Verification and extraction of pinned CI tools.            |
| Chrome/Chromium or Playwright Chromium | Browser acceptance tests.                                  |
| POSIX shell                            | Root scripts.                                              |

The backend validator rejects any Go toolchain other than 1.25.14. It downloads
the official golangci-lint 2.12.2 release archive into the shared CI tool cache
and verifies its checked-in published SHA-256 checksum before use. It also installs
govulncheck 1.6.0 into its disposable run directory with
`go install package@version`. Neither tool needs a separate installation. A
cold run requires network access, and every vulnerability scan queries the live
Go vulnerability database.

The application database role must be able to install/use `pgcrypto` and create
the migration schema on a new database. End-to-end admin credentials also need
database create/drop and connection-termination privileges.

There are two independent Bun projects and lockfiles:

- `web/frontend/` for the application;
- `test/` for Playwright and its harness.

Install each in its own directory. Do not run one root-level Bun install; there
is no root `package.json`.

## First-time setup

Create the default database and install frontend dependencies:

```sh
createdb gezerah
(cd web/frontend && bun install --frozen-lockfile)
```

Start both development services:

```sh
./run.sh
```

Open `http://127.0.0.1:5173`. Vite serves the React application and proxies
`/api` to `http://localhost:8080`. The Go process connects by default to:

```text
postgres://localhost:5432/gezerah?sslmode=disable
```

Migrations run automatically when the backend starts. The current chain is
`001_world_baseline.sql`, `002_mechanic_graph_status_instances.sql`,
`003_interaction_audience_invalidations.sql`, `004_password_auth.sql`,
`005_terra.sql`, `006_facilitator_assignment.sql`, and
`007_agent_facilitator.sql`. The repository has no seed step; create all
world-authored vocabulary through the application or API.

## Resetting local data

Reset the development application to an empty state with:

```sh
./reset-db.sh
```

The script uses `GEZERAH_DATABASE_URL`, then `DATABASE_URL`, then the same default
URL as the application. It refuses PostgreSQL system databases, non-loopback
servers, and databases without the Gezerah migration ledger. After
displaying the resolved database name and server, it requires that database
name to be typed exactly. `--yes` skips only this confirmation; it does not
bypass the target safety checks.

The reset drops and recreates the entire `public` schema. This removes every
object in that schema, along with dependent extension objects and the migration
record, so the next backend start installs the current migration chain. Reset and
startup serialize on the same PostgreSQL advisory lock. A managed backend is
stopped before the transaction and restarted afterward if it was running,
installing the chain immediately; otherwise the schema stays empty until the
next start. If a backend on port 8080 is reachable without managed PID state,
the script leaves it alone and refuses the reset; stop that process explicitly
first.

## Environment configuration

The Go application and root shell scripts do not source `.env` files, and the
repository has no example environment file. Export backend variables in the
shell/process manager that launches the application. Vite independently loads
`.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local` from
`web/frontend/`; only `VITE_`-prefixed values are exposed to client code.

### Runtime variables

| Variable              | Default/precedence                 | Purpose                                                                                           |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GEZERAH_ADDR`            | First; default `:8080`             | HTTP listen address.                                                                              |
| `PORT`                | Used only when `GEZERAH_ADDR` is empty | Hosting port converted to `:<port>`.                                                              |
| `GEZERAH_DATABASE_URL`    | First database URL                 | Preferred PostgreSQL connection URL.                                                              |
| `DATABASE_URL`        | Hosting fallback                   | Used when `GEZERAH_DATABASE_URL` is empty.                                                            |
| `GEZERAH_PUBLIC_ORIGIN`   | Request origin                     | Exact auth/unsafe origin; HTTP is accepted only on loopback, and all other origins require HTTPS. |
| `GEZERAH_LOG_LEVEL`       | `info`                             | `debug`, `info`, `warn`/`warning`, or `error`; other values become info.                          |
| `OPENAI_API_KEY`      | Empty                              | Enables Terra and Luna calls through the OpenAI Responses API.                                    |
| `GEZERAH_OPENAI_BASE_URL` | Official OpenAI API                | Overrides the Responses API base URL, primarily for local integration tests.                      |

When the binary is launched directly with `GEZERAH_PUBLIC_ORIGIN` unset, the server
uses the incoming request's scheme and host; plain HTTP authentication is
accepted only when both that host and the network peer are loopback. Managed
`run.sh` supplies `http://127.0.0.1:5173` unless the variable is already
exported. A proxied deployment must set the exact browser-visible HTTPS origin,
without a path, query, or fragment.

`OPENAI_API_KEY` is optional for startup but required for Terra's autonomous
Continue/Decide lifecycle and for Luna compilation of human Consequences. When it is empty, those
endpoints return `503 model_unavailable`; the key is never sent to the
frontend. Leave `GEZERAH_OPENAI_BASE_URL` empty for the official API.

### Local process variables

| Variable            | Default    | Purpose                         |
| ------------------- | ---------- | ------------------------------- |
| `GEZERAH_RUN_STATE_DIR` | `.gezerah/run` | Managed binaries and PID files. |
| `GEZERAH_RUN_LOG_DIR`   | `.gezerah/log` | Managed development logs.       |

Managed `run.sh` expects the backend at port 8080 because the Vite proxy is
fixed. It defaults to `127.0.0.1:8080`, also accepts `localhost:8080`, and
rejects wildcard or non-loopback addresses so the local HTTP session boundary
cannot become network-accessible. `PORT` is therefore useful when running the
binary directly, not when using the managed local workflow.

### Test variables

| Variable                     | Consumer              | Purpose                                                                                                                         |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GEZERAH_TEST_DATABASE_URL`      | Backend smoke and E2E | Backend smoke migrates this exact database; E2E also uses it as highest-precedence admin URL. It must be disposable.            |
| `GEZERAH_E2E_ADMIN_DATABASE_URL` | E2E                   | Admin URL used to create/drop a uniquely named database when the variable above is absent.                                      |
| `GEZERAH_E2E_BROWSER_EXECUTABLE` | E2E                   | Requested Chrome/Chromium executable; current launcher discovery can supersede it. See [Testing](testing.md#browser-selection). |
| `GEZERAH_E2E_DIAGNOSTICS`        | Direct E2E            | Set to `1` to retain trace and video on failure; the root performance-gated run keeps both disabled.                            |
| `GEZERAH_E2E_APP_BINARY`         | E2E harness           | Prebuilt embedded application passed by `ci.sh`; direct test runs normally leave it unset and use the safe build fallback.      |
| `GEZERAH_CI_CACHE_DIR`           | Root validator        | Optional persistent tool-cache directory; defaults to ignored `.gezerah/cache/ci`.                                                  |
| `PLAYWRIGHT_BROWSERS_PATH`   | Playwright/CI         | Browser cache/install location.                                                                                                 |

The E2E admin URL path is rewritten to `/postgres` for database administration.
Use credentials that can safely operate there. The backend smoke behavior is
different: it applies migrations directly to `GEZERAH_TEST_DATABASE_URL`.

## Managed local services

`run.sh` commands are:

```text
./run.sh
./run.sh start [all|backend|frontend]
./run.sh stop [all|backend|frontend]
./run.sh restart [all|backend|frontend]
./run.sh status [all|backend|frontend]
./run.sh logs [all|backend|frontend]
./run.sh tail [all|backend|frontend]
```

`logs` prints the managed log path or paths; it does not print their contents.
Use `tail` to show the last 80 lines and continue following the selected logs.

### Backend behavior

- Verifies Go and curl.
- Builds `cmd/gezerah` into `.gezerah/run/backend/gezerah`.
- Starts that binary in the background.
- Appends stdout/stderr to `.gezerah/log/backend.log`.
- Waits up to 60 seconds for `/api/health`.
- Does not watch Go files. Restart after backend edits:

  ```sh
  ./run.sh restart backend
  ```

### Frontend behavior

- Verifies Bun and curl.
- Runs a frozen install only when the local Vite executable is missing.
- Starts Vite on `127.0.0.1:5173 --strictPort`.
- Appends output to `.gezerah/log/frontend.log`.
- Waits up to 60 seconds for `/`.
- Uses Vite HMR for source changes.

### PID and unmanaged-process safety

The script removes stale managed PID files. If a service is reachable on its
expected port but has no managed PID, it reports the process as unmanaged and
leaves it alone. If a managed PID is alive but unhealthy, use the explicit
restart command.

Stop managed services after debugging:

```sh
./run.sh stop
```

Logs append across restarts and have no rotation.

## Production-style local run

Build frontend assets before compiling/running Go:

```sh
(cd web/frontend && bun install --frozen-lockfile && bun run build)
go run ./cmd/gezerah
```

For a reusable binary:

```sh
(cd web/frontend && bun run build)
CGO_ENABLED=0 go build -trimpath -o out ./cmd/gezerah
./out
```

The Vite output is embedded at Go compile time. A binary compiled before
`web/static/index.html` exists serves the API but returns 503 for SPA routes.
For public ChatGPT acceptance, do not expose the normal managed development
pair; use the isolated HTTPS [acceptance environment](testing.md#acceptance-environment)
instead.

## Normal change workflow

1. Inspect the relevant source and its tests/docs.
2. Start only the services needed, or use the existing managed pair.
3. Make the smallest coherent change without introducing built-in vocabulary or
   privileged keys.
4. Add focused tests at the pure/domain layer first, then adapter/UI/E2E coverage
   in proportion to the behavior.
5. Run a focused validator while iterating.
6. For a ChatGPT launch, delegated-start, site-tool, or ChatGPT-visible narration
   change, apply the [change-trigger matrix](testing.md#change-trigger-matrix).
7. Run the complete `./ci.sh` before requesting review.
8. Review `git status`; generated `web/static`, dependencies, `.gezerah`, test
   artifacts, and `out` should remain ignored.
9. Stop services used for debugging.

Validation details are in [Testing](testing.md).

## Change recipes

### Backend-only behavior

1. Update pure `internal/rules` logic where the behavior is mechanical.
2. Update application mapping/handler/store code where it is transport or
   persistence orchestration.
3. Add Go tests.
4. Restart the managed backend.
5. Run `./ci.sh backend`, then full CI if the contract/user workflow changed.

### Frontend-only behavior

1. Preserve the API types and server authority boundary.
2. Keep API paths, DTOs, revisions, event handling, and navigation in the
   operational feature component. `*View.tsx` and `*ViewModel.{ts,tsx}` files
   receive only semantic models and intent callbacks.
3. Put pure default/summary/draft transformation logic in `src/domain` when
   possible. Do not create a second mirror of the complete API type catalog.
4. Reuse shared UI primitives and editors. Keep CSS selectors in presentation
   files rather than operational controllers.
5. Add or update backend-free view fixtures when layout or presentation state
   changes. Use `react-dom/server` for static rendering unless interaction
   behavior specifically warrants browser coverage.
6. Add Playwright coverage when the change involves server data, routing,
   keyboard workflow, revisions, authorization, privacy, or multiple users.
7. Run `./ci.sh frontend`.

For a new feature, start with its semantic view contract. The view should be
renderable using fixture props before the controller is connected to API
resources. ESLint rejects API, route, API-backed hook, `fetch`, and event-stream
dependencies in shared components, `*View.tsx`, and `*ViewModel.{ts,tsx}`; do
not suppress that rule to save a mapping step.

### HTTP contract change

Update together:

- backend `internal/app/api.go`, relevant handler/mapping/storage files, and
  tests;
- `web/frontend/src/api/types.ts` and callers;
- Playwright fixtures/scenarios;
- [API reference](api.md) and domain/workflow docs.

### Database change

Before active users, rewrite the existing migration chain to express the one
current schema directly; do not add compatibility or cutover migrations. Update
domain, mapping, persistence, constraints, clean-database E2E coverage, and
[Database](database.md). Exercise the chain against an explicitly disposable database.

### New Play command

Define identity, active membership, membership-role/current-play-role authority, world scope, visibility, revision,
idempotency, history/event, and archive behavior before adding UI controls.
Test with separate user/browser contexts and confirm restricted Character fields are absent
from non-facilitator JSON.

## Generated and ignored files

| Path                         | Producer/content                                               |
| ---------------------------- | -------------------------------------------------------------- |
| `.gezerah/`                      | `run.sh` state, persistent CI caches, and deployment evidence. |
| `out`                        | Production/Railway-style binary.                               |
| `web/frontend/node_modules/` | Frontend install.                                              |
| `web/static/*`               | Vite production assets; placeholder is tracked.                |
| `test/node_modules/`         | E2E install.                                                   |
| `test/artifacts/`            | App log, Playwright results/report/media.                      |
| `coverage/`                  | Reserved coverage output.                                      |

Do not hand-edit generated Vite assets. Change `web/frontend/src`, rebuild, and
let the next Go compilation embed them.

## Troubleshooting

### Backend does not start

Inspect:

```sh
./run.sh status backend
./run.sh logs backend
./run.sh tail backend
```

Verify PostgreSQL is reachable, the database exists, the URL/SSL mode is
correct, and the role can create/use `pgcrypto` and apply migrations.

### Frontend shows network errors

Check the backend health at `http://127.0.0.1:8080/api/health`. The dev proxy is
fixed to `http://localhost:8080`; a direct backend on another port will not be
used by Vite without changing configuration.

### Go change is not visible

The backend is a compiled managed binary, not a file watcher. Run:

```sh
./run.sh restart backend
```

### Port is occupied

`./run.sh status` distinguishes managed from reachable unmanaged services. It
will not kill an unmanaged process. Stop that process yourself or run services
directly with coordinated alternative frontend/backend settings.

### Production route says frontend was not built

Build Vite, then rebuild the Go binary. Rebuilding only Vite cannot update files
already embedded in a binary.

### CI does not leave built assets behind

Expected: `ci.sh` snapshots the working tree into a disposable worktree and
builds there.

### E2E database setup fails

Confirm `psql` is on `PATH` and the selected admin URL can connect to
`postgres`, create/drop databases, and terminate connections. Check for an
abandoned `gezerah_e2e_*` database if a previous process was forcibly interrupted.

### E2E browser fails

Install Playwright Chromium or Chrome/Chromium in one of the launcher's common
system locations. `GEZERAH_E2E_BROWSER_EXECUTABLE` is not currently a reliable
discovery bypass: the launcher performs discovery/install first and may replace
the value with a detected system browser. Inspect `test/artifacts/` after a test
failure.

## Working constraints

- Do not add built-in entity classes.
- Do not make a configured name privileged.
- Do not introduce canonical JSON storage for authored aggregates or logical state.
- Do not give configured vocabulary built-in semantics. Bundled World-template
  terms remain optional starting content and become editable, world-scoped data
  when copied.
- Use `./ci.sh` as the final repository validator.
- Preserve unrelated work in a dirty checkout and avoid destructive source-
  control/database commands.
