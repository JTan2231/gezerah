# Backend

## Stack and process model

The backend is a Go 1.25 application with one direct runtime dependency:
`github.com/jackc/pgx/v5`. It uses the standard library HTTP server and
method-aware `http.ServeMux`, `log/slog` for structured logs, and `embed.FS` for
migrations and production frontend assets.

One process owns:

- PostgreSQL connection pooling;
- startup migrations;
- HTTP API and SSE connections;
- production SPA/static-file serving;
- signal-driven, ten-second bounded shutdown attempt.

There are no background worker processes, caches, message brokers, ORM, code
generation step, or dependency-injection framework.

## Startup and shutdown

`cmd/dnd/main.go` is deliberately thin:

1. `app.LoadConfig()` resolves environment variables.
2. A JSON `slog` handler is installed on stdout.
3. `signal.NotifyContext` watches `SIGINT` and `SIGTERM`.
4. `pgxpool.New` creates the pool and `Ping` verifies connectivity.
5. `migrations.Run` applies embedded forward-only migrations.
6. `app.NewServer` loads the embedded static filesystem and registers routes.
7. A listener is created and `http.Server.Serve` begins.
8. A signal or unexpected serve error starts HTTP shutdown with a ten-second
   deadline. Active request contexts are not rooted in the process context, so
   an open SSE handler can consume that deadline.

HTTP timeouts are:

| Timeout           | Value      |
| ----------------- | ---------- |
| Read header       | 5 seconds  |
| Read request      | 15 seconds |
| Write response    | 30 seconds |
| Idle connection   | 60 seconds |
| Graceful shutdown | 10 seconds |

SSE uses response-controller flushing, but that does not disable the configured
30-second server write deadline. An HTTP/1 stream is therefore reconnectable
rather than indefinite; the current browser hook reconnects with its cursor. If
changing global timeouts, verify event streams under the deployment's reverse
proxy.

## Package map

### `cmd/dnd`

Executable/process lifecycle only. It should not accumulate domain or route
logic.

### `internal/rules`

Pure storage-neutral mechanics:

| File             | Responsibility                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `types.go`       | Domain types and enum vocabularies.                                                       |
| `definitions.go` | Ruleset, schema, entity, and state-variable definition validation.                        |
| `values.go`      | Tagged scalar/value construction, equality, set semantics, and value validation.          |
| `state.go`       | Logical defaults/unknowns, state validation, materialization, normalization, and cloning. |
| `conditions.go`  | Condition validation, three-valued evaluation, quantifiers, and predicates.               |
| `bindings.go`    | Invocation mappings and problem target/instance binding validation.                       |
| `problems.go`    | Problem aggregate, resolution, outcome, and configured-effect validation.                 |
| `effects.go`     | Concrete transition validation and pure ordered application.                              |
| `resolution.go`  | Configured choice availability/outcome selection.                                         |
| `decimal.go`     | Exact finite base-10 parsing, canonicalization, arithmetic, and JSON text behavior.       |
| `ownership.go`   | Schema-set eligibility helpers.                                                           |
| `errors.go`      | Validation paths and domain error categories.                                             |

The package takes fully loaded maps/snapshots and returns values. It must not
query a database, read a request, log, inspect environment variables, generate
IDs, or mutate a caller-owned snapshot.

### `internal/app`

HTTP and persistence adapter. Naming follows a consistent pattern:

- `api_*.go`: request/response DTOs and tagged transport unions;
- `handlers_*.go`: routing, validation, authorization, transactions, commands,
  and response emission;
- `*_mapping.go`: transport/domain conversion and generated nested IDs;
- `*_store.go`: normalized aggregate loading and persistence;
- `domain_loaders.go`: common ruleset-domain loading through a small `queryer`
  interface implemented by both pools and transactions;
- `interaction_receipts.go`: immutable live ruling receipt persistence/loading;
- `handlers_worlds.go`, `handlers_world_mechanics.go`,
  `handlers_world_entities.go`, `handlers_world_character_fields.go`, and
  `handlers_world_entity_profiles.go`: the authorized world adapter over
  normalized ruleset, game, state-definition, entity, player-control,
  character-field, and profile-value resources;
- `character_readiness.go`: derived entity completion and world-backed player
  admission shared by world and live-game handlers;
- `server.go`, `json.go`, `config.go`: cross-cutting server infrastructure.

The files are organized by resource rather than by a generic repository
abstraction. That keeps complex aggregate-specific SQL and invariants visible.

### `internal/migrations`

Numbered SQL migrations embedded into the executable. The migration runner is
described in [Database](database.md).

### `web`

`web/static.go` embeds `web/static`. The directory contains a tracked
placeholder so a backend-only checkout can compile before the first frontend
build.

## HTTP server construction

`NewServerWithStaticFS` is the test seam. It constructs:

- a private API `ServeMux`;
- an `http.FileServer` over the provided filesystem;
- resource route registrations;
- explicit JSON not-found handlers for `/api` and `/api/`.

`Server.Routes()` creates the root handler stack:

```text
request logger
└── panic recovery
    └── API/static dispatch
        ├── /api and /api/* → API mux
        └── GET everything else → static/SPA handler
```

For API requests, `http.MaxBytesReader` caps the body at 1 MiB. Recovery logs
the panic and stack. API panics become a JSON `500 internal_error`; static-route
panics become plain text. The logger records method, path, status, bytes, and
duration for every request.

### Static/SPA behavior

For a non-API GET:

1. Normalize the path.
2. Serve an existing non-directory file directly.
3. For any `/assets/*` path, let the file server return its normal not-found
   response rather than falling back to HTML.
4. Otherwise serve `index.html`, enabling browser history routes.
5. If the embedded filesystem has no `index.html`, return
   `503 frontend has not been built`.

Because assets are embedded at Go compile time, rebuilding only Vite does not
change an already-built production binary.

## Request and response handling

### Strict JSON

`decodeJSON` uses `json.Decoder.DisallowUnknownFields`, reads exactly one JSON
value, and reports body-limit errors with the configured byte count. Tagged
unions implement custom marshal/unmarshal behavior so an operand cannot carry
fields from another kind unnoticed.

Do not replace tagged DTOs with `map[string]any`: doing so would weaken union
validation and round exact numeric input through `float64`.

### Validation layers

Handlers generally validate in this order:

1. path/query syntax and UUID shape;
2. strict body decode;
3. transport-level required fields, lengths, IDs, and key syntax;
4. DTO-to-domain conversion;
5. loading referenced ruleset resources;
6. domain aggregate validation;
7. archived/in-use/projected-dependency rules;
8. database constraints during persistence.

Transport and domain failures return path-indexed `fields` when practical.
PostgreSQL remains the final boundary for uniqueness, references, and check
constraints.

### Error mapping

`statusError` carries an intentional HTTP status/code/message/field map. The
central adapter also maps:

- `pgx.ErrNoRows` to 404 `not_found`;
- PostgreSQL `23505` to 409 `duplicate_key`;
- `23503` to 422 `invalid_reference`;
- `23514` and `22P02` to 422 `validation_failed`;
- other PostgreSQL failures to 500 `database_error`;
- other errors to 500 `internal_error`.

Rules `DomainError` values preserve their sentinel category and a list of
machine-readable validation paths. Runtime handlers translate those categories
before passing them to the common writer.

### IDs and keys

HTTP IDs use canonical UUID text. Create operations may accept a supplied ID to
support retry-safe client construction; otherwise the server generates random
version-4 UUIDs. Domain IDs remain strings so the pure package is not tied to
UUID implementation details.

Stable keys use the shared validation helper and are typically limited to 120
characters. Nested arrays use their transport order to populate explicit
database `position` columns.

## Authoring aggregate persistence

Top-level authoring resources are persisted as relational aggregates. Save
functions commonly:

1. lock or load the current root and dependency set;
2. validate the complete replacement;
3. insert/update the root row;
4. replace owned link/child rows in deterministic position order;
5. reload the domain aggregate or return the saved domain value;
6. commit before writing the response.

External references use `ON DELETE RESTRICT`; owned child rows generally use
`ON DELETE CASCADE`. Since public APIs archive rather than delete, cascades are
mainly aggregate-maintenance and ruleset-deletion safeguards, not normal user
workflows.

Semantic edits are protected when existing state, condition invocations,
problem effects, instances, or live receipts rely on the previous shape. The
application may permit label/description/presentation changes while rejecting a
kind, cardinality, option, unit, target, or ownership change that would make
stored data invalid.

## State persistence

Each entity has exactly one `state_records` root even when it has no stored
values. `state_values` holds normalized typed scalar rows.

Reading state:

1. Load the entity, definitions, state root, and stored scalar rows.
2. Reconstruct explicit domain cardinality/value unions.
3. Validate/reference-map option IDs and units.
4. Materialize applicable logical defaults and unknowns.
5. Convert durable choice/unit IDs back to option keys/unit text for HTTP.

Replacing state treats the request's `values` map as the full stored override
set. After validation and default normalization, the adapter compares storage
state. A no-op retains the revision; otherwise it rewrites scalar rows and
increments the state root.

The state revision can also advance without a scalar-row rewrite when an
entity's owner-schema memberships change. That invalidates a materialized
applicability/default/unknown view based on the prior memberships.

Resolution persistence updates only record IDs reported as changed by the pure
engine. Every changed record is rewritten and incremented inside the enclosing
resolution transaction.

Character profiles deliberately do not use state persistence. A world-level
revision guards atomic replacement of ordered field definitions, and each
entity profile has an independent revision guarding complete replacement of
its non-empty values. Definition IDs and value rows preserve provenance when a
field is reordered, renamed, or archived. Profile queries filter restricted
fields/values before serialization and never extend `rules.Entity` or state
snapshot types. Legacy free-form sections are loaded read-only.

## Rules engine execution

### Conditions

The application loads only the state records reachable through bound parameter
entities and evaluates against a consistent snapshot. The engine returns a
complete evaluation tree rather than a Boolean so callers can explain
`unknown`, `unmet`, and `met` outcomes.

### Concrete transitions

Both runtime paths converge on:

```go
rules.ApplyTransition(plan, entities, definitions, snapshot)
```

The function validates the plan and snapshot, clones the input, sorts effects
by position, applies each effect to each concrete entity in supplied order, and
returns applications plus changed record IDs. A failure returns no partially
usable working snapshot. This is in-memory atomicity; the adapter supplies
database transaction atomicity.

Configured problems first use `ResolveChoice`, which evaluates availability,
maps abstract targets, selects an outcome, and builds/applies a concrete plan.
Live adjudication maps its already-concrete effect DTOs straight to a transition
plan.

## Transaction patterns

### Consistent reads

Multiquery aggregate reads and previews often use read-only `REPEATABLE READ`.
This prevents a response from combining a root at one revision with children or
state from another.

### Optimistic commands

State, binding, game, membership, interaction, and action updates compare an
expected revision after loading/locking the current root. Conflicts return 409
instead of silently overwriting.

### Configured resolution

Preview uses read-only repeatable-read and no write locks. Resolve uses read
committed plus explicit shared/exclusive locks in stable order:

- referenced condition sets and problem configuration;
- problem instance and binding rows;
- bound entities and state roots.

After acquiring locks it reloads/rechecks dependencies and revisions. Only an
`applied` result persists; unavailable/incomplete results commit no state.

### Live resolution

Resolve locks the active game/facilitator boundary, the interaction, current
game entity mapping, definitions, entities, and state roots. It rechecks the
selected submission and idempotency key before applying mechanics. State,
receipt, application rows, action statuses, interaction status, and game event
share one transaction.

An idempotent replay loads the immutable receipt but rebuilds response state
from current state records. It is receipt-equivalent, not a byte-for-byte replay
of the original response, and still requires the actor to be an active
facilitator of an active game.

### Lock discipline

When adding a command that touches several aggregates, follow existing sorted
ID and root-first lock order. Do not introduce a new path that locks state and
then configuration if the existing path locks configuration then state; that
would create avoidable deadlocks.

## Live Play authorization and filtering

Play handlers derive a user from `X-DND-User-ID`, verify that it exists, and
then load an active game membership. For a world-backed player, game read/live
routes additionally derive play readiness from current controls and active
character-field values. Facilitator commands call a stronger helper that
verifies role and active game status while locking the game root.

World profile writes authorize either an owner/editor or the paired active
player membership named by `game_membership_entity_controls`. They lock/check
both the profile and character-field revisions, so a stale draft cannot ignore
new requirements. Controller replacement and field-set replacement remain
owner/editor-only. An optional acting entity on a player action is accepted
only when that same live control edge exists and the entity is complete; the
accepted row stores a display-name snapshot for later history.

Players remain active world members during onboarding, but world roster/state
queries narrow to their controlled entities and game/interactions/events return
`character_setup_required`. Interaction validation excludes non-ready players
from audiences/responders and rejects incomplete controlled entities as new
context or live-effect targets.

Non-facilitator interaction visibility is enforced in SQL, not merely in the
React UI. Response loading also omits private notes and facilitator-private
receipt/context fields. IDs in commands are revalidated against the requested
game so cross-game references fail closed.

The generic authoring endpoints do not apply these checks. Never route a player
feature through them. They can continue changing an archived game's underlying
ruleset entities and state, and those changes do not append `game_events`.

## SSE implementation

The event endpoint:

- authenticates and checks active membership before sending headers;
- parses `after`, falling back to `Last-Event-ID`;
- disables intermediary buffering/caching headers;
- flushes an initial retry directive;
- every 1.5 seconds, rechecks membership and queries up to 100 visible events;
- sends keep-alive comments for empty batches;
- advances the cursor only after writing an event;
- exits on request cancellation, membership revocation, query error, or flush
  error.

It intentionally sends identifiers and event types, not aggregate snapshots.
This reduces disclosure risk and makes the normal query endpoints authoritative.
For non-facilitators, event filtering uses audience membership plus whether an
interaction was ever presented; it is not the same as current interaction read
visibility. Adjudicating/cancelled lifecycle events can therefore be delivered
while the interaction query itself is hidden.

## Testing seams

- Pure mechanics are tested directly with constructed maps/snapshots.
- `NewServerWithStaticFS` permits static/API behavior tests without a Vite
  build.
- `queryer` lets loaders work with a pool or transaction.
- Mapping tests verify generated IDs, exact numbers, tagged unions, and
  archived references.
- Browser tests provide the current PostgreSQL-backed handler integration
  coverage; `internal/app` does not have a separate pgx-backed integration
  suite.

## Adding a backend capability

For a new ruleset-authored mechanic:

1. Add storage-neutral types and validation to `internal/rules`.
2. Add a forward-only migration with relational constraints.
3. Add strict DTOs and mapping; preserve exact number handling.
4. Add aggregate loader/saver functions.
5. Register method-aware routes and implement handlers.
6. Revalidate archived, cross-ruleset, in-use, revision, and lock-order cases.
7. Add rules unit tests, mapping/handler tests where possible, frontend contract
   updates, and an end-to-end path for a user-visible workflow.
8. Update this documentation and the API/domain references.

For a Play capability, additionally define membership/role/visibility rules,
game-scope every referenced entity, decide whether it needs an immutable
receipt/event, and test with separate identities. Do not rely on frontend
capability checks for authorization.
