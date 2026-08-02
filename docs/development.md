# Development guide

## Prerequisites

Install the following locally:

| Tool                                   | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| Go 1.25                                | Backend build, tests, and executable.                      |
| Bun 1.1.42                             | Intended frontend and E2E package manager/runtime version. |
| PostgreSQL                             | Application data and tests.                                |
| `createdb`                             | Initial local database creation.                           |
| `psql`                                 | End-to-end disposable database management.                 |
| Git                                    | Source control and isolated `ci.sh` worktrees.             |
| `curl`                                 | `run.sh` service probes.                                   |
| Chrome/Chromium or Playwright Chromium | Browser acceptance tests.                                  |
| POSIX shell                            | Root scripts.                                              |

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
createdb dnd
(cd web/frontend && bun install --frozen-lockfile)
```

Start both development services:

```sh
./run.sh
```

Open `http://127.0.0.1:5173`. Vite serves the React application and proxies
`/api` to `http://localhost:8080`. The Go process connects by default to:

```text
postgres://localhost:5432/dnd?sslmode=disable
```

Migrations run automatically when the backend starts. The repository has no
seed step; create all ruleset vocabulary through the application/API.

## Environment configuration

The application does not load `.env` files and the repository has no example
environment file. Export variables in the shell/process manager that launches
the application.

### Runtime variables

| Variable           | Default/precedence                 | Purpose                                                                  |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| `DND_ADDR`         | First; default `:8080`             | HTTP listen address.                                                     |
| `PORT`             | Used only when `DND_ADDR` is empty | Hosting port converted to `:<port>`.                                     |
| `DND_DATABASE_URL` | First database URL                 | Preferred PostgreSQL connection URL.                                     |
| `DATABASE_URL`     | Hosting fallback                   | Used when `DND_DATABASE_URL` is empty.                                   |
| `DND_LOG_LEVEL`    | `info`                             | `debug`, `info`, `warn`/`warning`, or `error`; other values become info. |

### Local process variables

| Variable            | Default    | Purpose                         |
| ------------------- | ---------- | ------------------------------- |
| `DND_RUN_STATE_DIR` | `.dnd/run` | Managed binaries and PID files. |
| `DND_RUN_LOG_DIR`   | `.dnd/log` | Managed development logs.       |

Managed `run.sh` expects the backend at port 8080 because the Vite proxy is
fixed. It accepts `DND_ADDR=:8080`, `localhost:8080`, or `127.0.0.1:8080` and
rejects other addresses. `PORT` is therefore useful when running the binary
directly, not when using the managed local workflow.

### Test variables

| Variable                     | Consumer              | Purpose                                                                                                              |
| ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DND_TEST_DATABASE_URL`      | Backend smoke and E2E | Backend smoke migrates this exact database; E2E also uses it as highest-precedence admin URL. It must be disposable. |
| `DND_E2E_ADMIN_DATABASE_URL` | E2E                   | Admin URL used to create/drop a uniquely named database when the variable above is absent.                           |
| `DND_E2E_BROWSER_EXECUTABLE` | E2E                   | Explicit Chrome/Chromium executable.                                                                                 |
| `PLAYWRIGHT_BROWSERS_PATH`   | Playwright/CI         | Browser cache/install location.                                                                                      |

The E2E admin URL path is rewritten to `/postgres` for database administration.
Use credentials that can safely operate there. The backend smoke behavior is
different: it applies migrations directly to `DND_TEST_DATABASE_URL`.

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

Aliases include `up`, `down`, `ps`, `log`, `follow`, and service aliases such as
`back`/`api` and `front`/`web`/`vite`.

### Backend behavior

- Verifies Go and curl.
- Builds `cmd/dnd` into `.dnd/run/backend/dnd`.
- Starts that binary in the background.
- Appends stdout/stderr to `.dnd/log/backend.log`.
- Waits up to 60 seconds for `/api/health`.
- Does not watch Go files. Restart after backend edits:

  ```sh
  ./run.sh restart backend
  ```

### Frontend behavior

- Verifies Bun and curl.
- Runs a frozen install only when the local Vite executable is missing.
- Starts Vite on `127.0.0.1:5173 --strictPort`.
- Appends output to `.dnd/log/frontend.log`.
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
go run ./cmd/dnd
```

For a reusable binary:

```sh
(cd web/frontend && bun run build)
CGO_ENABLED=0 go build -trimpath -o out ./cmd/dnd
./out
```

The Vite output is embedded at Go compile time. A binary compiled before
`web/static/index.html` exists serves the API but returns 503 for SPA routes.

## Normal change workflow

1. Inspect the relevant source and its tests/docs.
2. Start only the services needed, or use the existing managed pair.
3. Make the smallest coherent change without introducing built-in vocabulary or
   privileged keys.
4. Add focused tests at the pure/domain layer first, then adapter/UI/E2E coverage
   in proportion to the behavior.
5. Run a focused validator while iterating.
6. Run the complete `./ci.sh` before handing off a cross-layer change.
7. Review `git status`; generated `web/static`, dependencies, `.dnd`, test
   artifacts, and `out` should remain ignored.
8. Stop services used for debugging.

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
2. Put pure compatibility/default/summary logic in `src/domain` when possible.
3. Reuse shared editors/workspaces.
4. Add Bun tests and browser coverage for a workflow change.
5. Run `./ci.sh frontend`.

### HTTP contract change

Update together:

- backend `api_*.go`, mapping, handler, and tests;
- `web/frontend/src/api/types.ts` and callers;
- Playwright fixtures/scenarios;
- [API reference](api.md) and domain/workflow docs.

### Database change

Add a new forward migration; do not rewrite applied migrations. Update domain,
mapping, persistence, constraints, clean-database E2E coverage, and
[Database](database.md). Exercise the chain against an explicitly disposable
database.

### New Play command

Define identity, active-membership, role, game scope, visibility, revision,
idempotency, history/event, and archive behavior before adding UI controls.
Test with separate user/browser contexts and confirm private fields are absent
from non-facilitator JSON.

## Generated and ignored files

| Path                         | Producer/content                                |
| ---------------------------- | ----------------------------------------------- |
| `.dnd/`                      | `run.sh` binaries, PIDs, and logs.              |
| `out`                        | Production/Railway-style binary.                |
| `web/frontend/node_modules/` | Frontend install.                               |
| `web/static/*`               | Vite production assets; placeholder is tracked. |
| `test/node_modules/`         | E2E install.                                    |
| `test/artifacts/`            | App log, Playwright results/report/media.       |
| `coverage/`                  | Reserved coverage output.                       |

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
abandoned `dnd_e2e_*` database if a previous process was forcibly interrupted.

### E2E browser fails

Install Chrome/Chromium, provide `DND_E2E_BROWSER_EXECUTABLE`, or allow the
harness to install Playwright Chromium. Inspect `test/artifacts/` after a test
failure.

## Working constraints

- Do not add built-in entity classes.
- Do not make a configured key privileged.
- Do not introduce canonical JSON storage for authored aggregates/state.
- Do not seed vocabulary; configuration remains user-authored and ruleset-
  scoped.
- Use `./ci.sh` as the handoff validator.
- Preserve unrelated work in a dirty checkout and avoid destructive source-
  control/database commands.
