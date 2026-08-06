# Worldwright

Worldwright is a collaborative world editor and live play table. Authors define
the capacities and capabilities that matter in a world, create people and other
stateful subjects from that vocabulary, and invite the table with expiring
links. During play, a facilitator presents problems in the moment, players
offer free-form actions, and the facilitator commits a Consequence with one
prose summary plus optional ordered typed effects. Problems are never required
as advance configuration.

The implementation is backed by a configurable typed state-transition engine.
World authors define writable input mechanics and derived mechanics connected
in a validated dependency graph; facilitators define persistent statuses
inside problem Consequences during play. Status modifiers are snapshotted onto
entity instances and layer over calculated state. The engine has no built-in
world ontology, entity classes, privileged configured keys, or seed vocabulary.
Real users and world memberships are separate from the fictional subjects they
control; “Dungeon Master” is a product role, not a special mechanic or
configured key.

## Documentation

The comprehensive system documentation starts at
[`docs/README.md`](docs/README.md). It covers architecture, domain semantics,
workflows, the complete HTTP API, backend and frontend internals, the database,
development, testing, operations, and security.

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

The root page asks whether to enter **Play** or **Build**. Each area then asks
for a local development profile when needed. **Build** defines input and
derived capacities/capabilities, character requirements, roster setup, people,
invitations, and world settings. **Play** is the separate live table: complete
player onboarding, present an ad-hoc problem, collect player actions, preview a
Consequence with one prose summary and ordered scalar/status effects, then
commit an immutable resolution receipt.

Useful process commands:

```sh
./run.sh status
./run.sh restart backend
./run.sh restart frontend
./run.sh logs
./run.sh tail
./run.sh stop
```

To remove all locally authored data and rebuild the current schema from its
clean migration chain, run `./reset-db.sh`. If the managed backend was running,
the script restarts it and installs the chain; otherwise, start the backend
afterward. The reset accepts the same database URL variables as the application,
refuses non-local and system databases, and requires the database name as
confirmation. Use `./reset-db.sh --yes` only when the same safety checks are
sufficient for automation.

The production-style local path builds the frontend before starting Go:

```sh
(cd web/frontend && bun install --frozen-lockfile && bun run build)
go run ./cmd/dnd
```

Migrations run automatically at startup. They use a PostgreSQL advisory lock so
concurrent starts serialize schema upgrades.

## Configuration

| Variable           | Default                                         | Purpose                                            |
| ------------------ | ----------------------------------------------- | -------------------------------------------------- |
| `DND_ADDR`         | `:8080`                                         | HTTP listen address.                               |
| `PORT`             | unset                                           | Hosting fallback when `DND_ADDR` is unset.         |
| `DND_DATABASE_URL` | `postgres://localhost:5432/dnd?sslmode=disable` | PostgreSQL connection URL.                         |
| `DATABASE_URL`     | unset                                           | Hosting fallback when `DND_DATABASE_URL` is unset. |
| `DND_LOG_LEVEL`    | `info`                                          | `debug`, `info`, `warn`, or `error`.               |

World roles, lifecycle states, visibility, and mutation permissions are
enforced by the server. Authentication is not: the current development UI
stores a selected user UUID and sends it as `X-DND-User-ID`. Any client can
forge that header. This is intentionally a trusted-development identity
adapter, so do not expose the application or its database outside a trusted
environment until it is replaced by real session or identity-provider
authentication. Command bodies do not choose their acting user or membership.

Player-safe live responses omit facilitator private notes and reject entities,
actions, or effects outside the requested world. World configuration endpoints
enforce membership and roles, but those checks remain only as strong as the
forgeable development identity header.

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
complete migration chain. End-to-end tests create their own disposable database
and exercise world privacy, invitations, authored mechanics, generated sheets,
and the multiplayer ad-hoc Play loop.

## Deployment

Railway configuration is included. Railpack installs Bun, builds the frontend,
compiles a static Go binary, starts it as `./out`, and checks `/api/health`.
Attach a Railway PostgreSQL database so `DATABASE_URL` is available.

Generated files under `web/static` are build output and are not committed.
