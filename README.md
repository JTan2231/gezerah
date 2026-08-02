# Stateful Rule Composer

This repository implements a configurable, typed state-transition system. Rule
authors define owner schemas, entities, state variables, reusable conditions,
problems, target bindings, choices, and ordered effects without a built-in
world ontology.

`DATA.md` is authoritative for domain and relational semantics. `CODE.md`
defines the application, API, frontend, transaction, and testing design.

## Stack

- Go 1.25, standard-library HTTP routing, and embedded static assets.
- PostgreSQL through `pgx/v5`, with forward-only embedded SQL migrations.
- React 19 and TypeScript, built by Vite and managed with Bun 1.1.42.
- One production Go binary serving both `/api/*` and the frontend.

## Local development

Create an empty PostgreSQL database, install frontend dependencies, and start
both development services:

```sh
createdb dnd
(cd web/frontend && bun install --frozen-lockfile)
./run.sh
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the Go server at
`http://localhost:8080`.

Useful process commands:

```sh
./run.sh status
./run.sh restart backend
./run.sh restart frontend
./run.sh logs
./run.sh tail
./run.sh stop
```

The production-style local path builds the frontend before starting Go:

```sh
(cd web/frontend && bun install --frozen-lockfile && bun run build)
go run ./cmd/dnd
```

Migrations run automatically at startup. They use a PostgreSQL advisory lock so
concurrent starts serialize schema upgrades.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DND_ADDR` | `:8080` | HTTP listen address. |
| `PORT` | unset | Hosting fallback when `DND_ADDR` is unset. |
| `DND_DATABASE_URL` | `postgres://localhost:5432/dnd?sslmode=disable` | PostgreSQL connection URL. |
| `DATABASE_URL` | unset | Hosting fallback when `DND_DATABASE_URL` is unset. |
| `DND_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

Authentication and ruleset membership are intentionally not defined yet. Do
not expose the initial application beyond a trusted environment until those
policies are implemented.

## Validation

Run the complete local validator:

```sh
./ci.sh
```

The validator snapshots the current tracked and untracked non-ignored working
tree into a disposable Git worktree, so installs and generated frontend assets
do not disturb a running checkout. Focused targets are `frontend`, `backend`,
and `e2e`.

When `DND_TEST_DATABASE_URL` is set, the backend target also starts the built
application against that explicitly disposable test database, validating the
complete migration chain. GitHub Actions supplies such a PostgreSQL database.

## Deployment

Railway configuration is included. Railpack installs Bun, builds the frontend,
compiles a static Go binary, starts it as `./out`, and checks `/api/health`.
Attach a Railway PostgreSQL database so `DATABASE_URL` is available.

Generated files under `web/static` are build output and are not committed.
