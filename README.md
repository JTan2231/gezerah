# Stateful Rule Composer and Game Player

This repository implements a configurable, typed state-transition system. Rule
authors define owner schemas, entities, state variables, reusable conditions,
problems, target bindings, choices, and ordered effects without a built-in
world ontology. The Play surface adds games with real participant memberships:
a facilitator can present an improvised interaction, players submit free-form
actions, and the facilitator commits a public narrative plus optional typed
effects. The state update and its normalized receipt are atomic.

Rulesets define the mechanical vocabulary. A game maps an exclusive subset of
one ruleset's generic entities into a live runtime world. Users and memberships
are separate from those fictional entities; “Dungeon Master” is presented as
the game-level `facilitator` role, not a privileged schema or configured key.

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

Use the Build sections to author schemas, variables, entities, conditions, and
optional configured problems. Use **Play** to select a development user, create
or select an assigned game, enroll unassigned entities, present interactions,
submit player actions, preview rulings, resolve them, and archive a completed
game while retaining its read-only history. The legacy Runtime section remains
the ruleset-scoped simulator for configured problem definitions.

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

Game roles, statuses, visibility, and mutation permissions are enforced by the
server. Authentication is not: the current development UI stores a selected
user UUID and sends it as `X-DND-User-ID`. Any client can forge that header.
This is intentionally a trusted-development identity adapter, so do not expose
the application or its database outside a trusted environment until it is
replaced by real session or identity-provider authentication. Command bodies do
not choose their acting user or membership.

Player-safe live responses omit facilitator private notes and reject entities,
references, actions, or effects outside the requested game's mapping. Generic
builder endpoints remain authoring tools for the trusted environment; they are
not a public player API.

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
and exercise both configured transitions and the multiplayer Play loop.

## Deployment

Railway configuration is included. Railpack installs Bun, builds the frontend,
compiles a static Go binary, starts it as `./out`, and checks `/api/health`.
Attach a Railway PostgreSQL database so `DATABASE_URL` is available.

Generated files under `web/static` are build output and are not committed.
