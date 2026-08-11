# dnd

dnd is a collaborative world editor and live play table. Authors define
the capacities and capabilities that matter in a world, create people and other
stateful subjects from that vocabulary, and invite the table with expiring
links. During play, exactly one designated Dungeon Master presents problems in
the moment, players offer free-form actions, and the Dungeon Master commits a
Consequence with one prose summary plus optional ordered typed effects. The DM
may be a human participant or Terra. Problems are never required as advance
configuration.

The implementation is backed by a configurable typed state-transition engine.
World authors define writable input mechanics and derived mechanics connected
in a validated dependency graph; facilitators define persistent statuses
inside problem Consequences during play. Status modifiers are snapshotted onto
entity instances and layer over calculated state. The engine has no built-in
world ontology, entity classes, privileged configured keys, or seed vocabulary.
Real users and world memberships are separate from the fictional subjects they
control. Durable owner/editor/player/spectator access and the current
facilitator/player/spectator play role are separate: handing the table to Terra
or another participant changes play responsibility without changing access.

## Documentation

The comprehensive system documentation starts at
[`docs/README.md`](docs/README.md). It covers architecture, domain semantics,
workflows, the complete HTTP API, backend and frontend internals, the database,
development, testing, operations, and security.

## Stack

- Go 1.25.12, standard-library HTTP routing, and embedded static assets.
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
the user to sign up or sign in when needed. Accounts use a username and
password; no email address is required. **Build** defines input and
derived capacities/capabilities, character requirements, roster setup, people,
invitations, and world settings. **Play** is the separate live table: complete
player onboarding, designate a human or Terra as Dungeon Master between
problems, present an ad-hoc problem, collect player actions, and commit an
immutable Consequence receipt. A human DM authors the prose and may preview
Luna-compiled effects. When Terra is DM, ready players only pace the table;
Terra creates and resolves the interaction without a human edit or approval
step.

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

| Variable            | Default                                         | Purpose                                                                         |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `DND_ADDR`          | `:8080`                                         | HTTP listen address.                                                            |
| `PORT`              | unset                                           | Hosting fallback when `DND_ADDR` is unset.                                      |
| `DND_DATABASE_URL`  | `postgres://localhost:5432/dnd?sslmode=disable` | PostgreSQL connection URL.                                                      |
| `DATABASE_URL`      | unset                                           | Hosting fallback when `DND_DATABASE_URL` is unset.                              |
| `DND_LOG_LEVEL`     | `info`                                          | `debug`, `info`, `warn`, or `error`.                                            |
| `DND_PUBLIC_ORIGIN` | request origin                                  | Exact browser origin for authenticated writes; HTTP is loopback-only.            |

World roles, lifecycle states, visibility, and mutation permissions are
enforced by the server. Username/password authentication creates an opaque,
revocable server session in an HttpOnly SameSite cookie. Passwords are stored
only as Argon2id hashes, authenticated writes require a session-bound CSRF
token and a same-origin request, and command bodies never choose their acting
user or membership. The server derives the actor from the session.

Player-safe live responses omit facilitator private notes and reject entities,
actions, or effects outside the requested world. World configuration endpoints
continue to enforce membership and roles after authentication.

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
and exercise account/session/CSRF boundaries, world privacy, invitations,
authored mechanics, generated sheets, and the multiplayer ad-hoc Play loop.

## Deployment

As of 2026-08-09, a public-addressable Railway preview is running at
<https://dnd-web-production.up.railway.app>. It is an operational
preview, not a declaration of public-production readiness.

For the existing linked Railway project, deploy a clean committed checkout with:

```sh
./deploy.sh
```

The command runs the complete `./ci.sh` validator, confirms that the checkout
remains unchanged, uploads the exact commit from a temporary detached worktree
with `railway up`, follows the exact deployment to a terminal state, verifies
the web service plus PostgreSQL replica and volume, and then checks the public
HTTPS health endpoint, app shell, SPA deep link, built assets, and a short
real-browser login-boundary journey. Passing deploy evidence is written to
ignored `.dnd/deployments/<deployment-id>.json` without credentials, cookies,
or Railway variables; later verify runs use distinct `.verify.<run-id>.json`
records and do not replace it.

Use `./deploy.sh verify` to inspect and smoke-test the currently active release
without uploading source or running CI. `--no-browser` explicitly omits the
browser check, while deploy mode alone accepts `--skip-ci`. The script expects
already-created and configured Railway infrastructure; it does not create a
project, database, volume, domain, or variables, and it does not automatically
roll back a failed release.

Railway configuration is included. Railpack installs Bun, builds the frontend,
compiles a static Go binary, starts it as `./out`, and checks `/api/health`.
When activating another target, attach PostgreSQL and define a reference
variable on the application service, such as
`DATABASE_URL=${{Postgres.DATABASE_URL}}` using the actual database service
name. Attaching the database alone does not inject its variables into the
application service.

Generated files under `web/static` are build output and are not committed.
