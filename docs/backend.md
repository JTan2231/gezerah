# Backend

## Stack and process model

The backend is a Go 1.25 application with two direct runtime dependencies:
`github.com/jackc/pgx/v5` and `golang.org/x/crypto` for Argon2id. It uses the standard-library HTTP server and
method-aware `http.ServeMux`, `log/slog` for structured logs, and `embed.FS` for
the PostgreSQL schema and production frontend.

One process owns connection pooling, startup migrations, JSON/SSE routes,
embedded SPA serving, and signal-driven shutdown. There is no ORM, worker,
cache, message broker, code generator, or dependency-injection framework.

## Startup and shutdown

`cmd/dnd/main.go`:

1. loads environment configuration;
2. installs a JSON `slog` handler;
3. watches `SIGINT`/`SIGTERM`;
4. opens and pings `pgxpool`;
5. applies embedded migrations;
6. constructs the API/static server;
7. listens;
8. attempts HTTP shutdown with a ten-second deadline.

| Timeout                   | Value      |
| ------------------------- | ---------- |
| Read header               | 5 seconds  |
| Read request              | 15 seconds |
| Ordinary response write   | 30 seconds |
| SSE write/flush           | 5 seconds  |
| Idle connection           | 60 seconds |
| Graceful shutdown         | 10 seconds |

Request contexts inherit the process root, so signal cancellation reaches
long-lived handlers. SSE uses response-controller flushing and replaces the
ordinary absolute response deadline with a five-second deadline around each
write/flush, clearing it while waiting. A healthy stream is long-lived; a
stalled write ends it, and clients reconnect with their last world-event cursor.

## Package map

### `cmd/dnd`

Executable and process lifecycle only.

### `internal/rules`

Pure graph evaluation and runtime transitions:

| File                     | Responsibility                                                                   |
| ------------------------ | -------------------------------------------------------------------------------- |
| `types.go`               | Mechanic graph, status, state, effect, evaluation, and receipt domain types.     |
| `definitions.go`         | Input/derived numeric/Boolean mechanic and entity validation.                    |
| `expressions.go`         | Recursive type inference, dependency extraction, cycle paths, graph compilation. |
| `evaluation.go`          | Intrinsic/effective evaluation and transparent modifier/expression traces.       |
| `statuses.go`            | Inline status specification, literal modifier, and active-instance validation.   |
| `values.go`              | Scalar construction, equality, and definition-aware validation.                  |
| `state.go`               | Input defaults, sparse overrides, materialization, normalization, cloning.       |
| `effects.go`             | Backward-compatible ordered scalar transition validation/application.            |
| `runtime_transitions.go` | Combined scalar and persistent-status lifecycle transition.                      |
| `decimal.go`             | Exact finite base-10 parsing, arithmetic, canonicalization, and JSON text.       |
| `errors.go`              | Validation paths and domain error categories.                                    |

The package takes fully loaded maps/snapshots and returns values. It must not
query PostgreSQL, inspect HTTP/environment, log, generate IDs, or mutate a
caller-owned snapshot.

### `internal/app`

HTTP and persistence adapter:

- request/response DTOs encode current world resources, recursive expression
  trees, and typed scalar unions;
- authentication helpers hash/verify passwords, issue/revoke opaque sessions,
  enforce origin/CSRF checks, and derive the actor from request context;
- authorization helpers derive one world membership from that authenticated actor;
- route handlers perform validation, visibility filtering, and transaction
  orchestration;
- SQL loaders/savers use `world_id` on every scoped aggregate;
- mechanic publication locks the world rules revision and validates the
  proposed complete graph before writing normalized rows;
- evaluated-state loaders combine sparse input, compiled expressions, and
  immutable active-status snapshots;
- receipt persistence records ordered scalar/status applications and effective
  changes;
- server/JSON/config files provide cross-cutting infrastructure.

There is one membership/role vocabulary. Owners and editors receive
facilitator authority directly; there is no parallel live membership model.

### `internal/migrations`

`001_worldwright.sql` is the clean world-native baseline;
`002_rules_graph_statuses.sql` is its supported forward upgrade for typed
derived mechanics, problem-sourced persistent statuses, and expanded receipts;
`003_interaction_audience_invalidations.sql` adds constrained audience-removal
event invalidations; and
`004_password_auth.sql` installs credentials and server sessions. See
[Database](database.md).

### `web`

`web/static.go` embeds `web/static`. A tracked placeholder lets backend-only
checkouts compile before a frontend build.

## HTTP server construction

`NewServerWithStaticFS` is the test seam. It constructs a private API mux, a
file server over the provided filesystem, current world route registrations,
and explicit JSON not-found handlers for `/api` and `/api/`.

```text
request logger
└── panic recovery
    └── browser security headers
        └── API/static dispatch
        ├── /api and /api/* → API mux
        └── GET everything else → static/SPA handler
```

API bodies are capped at 1 MiB. Recovery logs panic and stack; API panics return
the JSON `500 internal_error` envelope. Request summaries record method, path,
status, bytes, and duration.

### Static/SPA behavior

For non-API GET requests:

1. normalize the path;
2. serve an existing non-directory file;
3. let missing `/assets/*` return normal not found;
4. otherwise serve `index.html` for client routing;
5. return 503 when the embedded build has no `index.html`.

Assets are embedded at Go compile time; rebuilding Vite alone cannot change an
already-built production binary.

## Request and response handling

### Strict JSON and scalar values

`decodeJSON` rejects unknown fields, reads one JSON value, and preserves exact
numbers. The state scalar DTO accepts only:

```json
{ "kind": "number", "value": 1.25 }
{ "kind": "boolean", "value": true }
```

Custom union decoding ensures the number/Boolean shape cannot carry fields from
another variant. Do not replace it with `map[string]any`, which would weaken the
boundary and round through `float64`.

### Validation order

Handlers generally validate:

1. path/query syntax and UUID shape;
2. strict body decoding;
3. transport required fields, lengths, and enums;
4. active server session and, for unsafe methods, origin plus CSRF token;
5. active world membership and required role/readiness;
6. world ownership of every referenced resource;
7. domain mechanics/state/transition rules;
8. archive/lifecycle/revision constraints;
9. PostgreSQL constraints during persistence.

Transport/domain failures return path-indexed fields where practical.
PostgreSQL is the final uniqueness, reference, and check boundary.

### Error mapping

`statusError` carries intentional status/code/message/fields. The common mapper
also handles:

- `pgx.ErrNoRows` → 404 `not_found`;
- PostgreSQL `23505` → 409 `conflict`;
- `23503` → 422 `invalid_reference`;
- `23514`, `22P02`, `22003` → 422 `validation_failed`;
- other database failures → 500 `database_error`;
- other failures → 500 `internal_error`.

### IDs

HTTP resources use canonical UUID text. Creates may accept a supplied ID for
retry-safe construction; otherwise the server generates a random version-4
UUID. Domain IDs remain strings so `internal/rules` does not depend on UUID
implementation details.

## Persistence patterns

### World aggregates

Top-level authoring commands remain explicit and relational. A save normally:

1. authorizes and loads/locks the current world aggregate;
2. validates the complete command;
3. inserts or updates the root;
4. replaces owned ordered/link rows where appropriate;
5. increments the relevant revision only on a meaningful change;
6. reloads the authoritative response;
7. commits before writing JSON.

Owned rows commonly cascade from their root; historical references use
`ON DELETE RESTRICT`. Product APIs archive rather than hard delete.

### Base and evaluated state

Each entity has exactly one `state_records` root. `state_values` stores at most
one numeric or Boolean override per mechanic.

Reading state:

1. load the world entity, complete mechanic graph, state root, and input
   overrides;
2. load the entity status-set revision, active instances, and their immutable
   modifier snapshots;
3. materialize missing input values from mechanic defaults;
4. compile/validate the graph and recursively evaluate derived references;
5. apply status modifiers in deterministic order;
6. return input `values`, all `effective_values`, per-mechanic `evaluations`,
   active status snapshots, and state/status/rules revisions.

Replacing state treats the request map as complete logical input state and
rejects derived IDs. It locks both the mechanic rules revision and entity state
root. Values equal to defaults normalize to absent override rows.

Resolution persistence updates only entity records reported changed by the
pure transition engine. Status lifecycle changes increment the independent
entity status-set root. Both happen in the same transaction as the receipt.

### Mechanic publication

The mechanic catalog is read in `REPEATABLE READ` and returned as a
`{revision,...}` wrapper. Every publishing create/update or first archive:

1. locks `world_rule_sets` and compares `expected_rules_revision`;
2. loads all world mechanics;
3. substitutes the proposed mechanic into the in-memory graph;
4. type-checks every expression and rejects dependency cycles with
   path-indexed fields;
5. persists the normalized mechanic/expression rows;
6. increments the mechanic rules revision and appends `rules-updated`;
7. returns the new revision with the saved mechanic.

An active mechanic archive is rejected while another active derived mechanic
depends on it. Database constraints preserve tagged and world-scoped shapes,
while graph-wide type and cycle checks remain application and pure-rule
responsibilities.

### Persistent status snapshots

Statuses are authored inline in an adjudicating problem's apply effect, not in
world configuration. The effect supplies a name, optional description, ordered
literal modifiers, and ordered entity targets. Resolve inserts one durable
instance per target, snapshots the status prose and modifiers into
instance-owned rows, and records source interaction, resolution, and effect
IDs. Evaluation reads those immutable snapshots rather than a reusable catalog.

Modifier order is priority, application order, instance ID, modifier position,
then modifier ID. Same-name instances from different Consequences may coexist.
A remove effect names the exact active status instance for each entity target;
unknown, removed, cross-world, or mismatched targets fail validation. Resolve
idempotency handles equivalent retries before the transition is applied.

### Character profiles

Profiles do not use mechanical state. A world-level field-set revision guards
the ordered requirements; each entity profile has its own revision. Text rows
preserve field UUID and author provenance. Read paths filter restricted fields
and values before serialization. Profile changes never advance state revision.

### Controller sets

Controller replacement is a complete set operation over
`world_membership_entity_controls`. The command checks the world's
`table_revision`, validates every target as an active player membership in the
same world, replaces rows, increments `table_revision`, and appends an event.

## Rules execution

State reads compile definitions and evaluate one entity with:

```go
rules.EvaluateEntityState(entity, record, mechanics, statusSnapshots, activeStatuses)
```

Input intrinsic values come from stored/defaulted logical state. Derived
intrinsic values recursively consume referenced mechanics' effective values.
Each mechanic's literal status modifiers then transform intrinsic to effective.
The evaluator returns no partial result on graph, status, or arithmetic failure.

Live Consequences map concrete effect DTOs to:

```go
rules.ApplyRuntimeTransition(plan, entities, mechanics, statuses, snapshot)
```

The function validates and clones both base state and active statuses, applies
effects by position, and returns scalar applications, status applications,
changed record IDs, and the resulting runtime snapshot. The application
evaluates before and after to derive transitive effective changes. A failure
returns no partially usable snapshot. PostgreSQL supplies transactional
atomicity around the pure in-memory atomicity.

`set` and `adjust-number` retain `entity_ids` and target only mutable inputs.
`apply-status` uses ordered entity targets plus one inline status specification;
`remove-status` uses ordered entity/instance targets and no status
specification. Both status variants carry no scalar operands. Every target and
mechanic must belong to the request world. Numeric base results must satisfy
bounds/step; Boolean mechanics accept only Boolean `set`. Scalar operations
read/write logical base input and never use an active status-modified effective
value as their operand. Status layers are reapplied only when the application
evaluates the post-transition runtime snapshot.

## Transaction patterns

### Consistent reads

Multiquery resources and previews may use read-only `REPEATABLE READ` so a
response cannot combine a root at one revision with children/state from another.

### Optimistic commands

World settings, world table, mechanic rules, character-field set, profile,
state, membership, interaction, and action roots compare expected revisions
after loading/locking. Conflicts return 409 rather than overwriting newer state.

### Live resolution

Resolve locks the active world/facilitator boundary, mechanic rules revision,
interaction, referenced entities, state/status roots, and selected action in
stable order. It rechecks idempotency and revisions; evaluates before; applies
the combined transition; persists base state and status snapshots with source
provenance; evaluates after; and stores the resolution, requested effects,
inline status-effect modifiers, exact remove targets, scalar/status
applications, effective changes, action statuses, interaction status, and
world event in one transaction.

An equivalent idempotent replay loads the immutable receipt and current state,
and still checks the current authenticated actor, facilitator authority, and
active world.

### Lock discipline

Keep root-first and sorted-ID lock order. Do not add a path that locks state
before world/mechanic roots when resolution locks them in the opposite order.

## Authorization and filtering

Every product handler except health, signup, and signin requires an active
opaque-cookie session. Route registration wraps protected handlers
deny-by-default; unsafe requests additionally require an exact same-origin
`Origin` and the session-bound `X-DND-CSRF` token. The old identity header is
ignored. World handlers load an active membership for the session user.
Owner/editor helpers add configuration or facilitator authority. Players must
also have at least one complete controlled entity before live
interaction/event access.

Every authenticated request performs a read-only session/account validity
lookup. If the last activity touch is at least five minutes old, ordinary
request authentication attempts a database-guarded update of `last_seen_at` and
the sliding idle expiry; the update repeats the token, revocation, expiry, and
active-account predicates. A concurrent touch loser revalidates. The SSE
handshake follows that ordinary path, while subsequent stream reauthorization
is read-only and therefore does not keep an otherwise idle session alive.

Profile writes allow owner/editor or the entity's current active controller.
Controller and field-set replacement are owner/editor only. An acting entity on
an action must be controlled and complete. Interaction context/effect targets
must be active and eligible.

Non-facilitator interaction visibility is enforced in SQL/response loading.
Private notes and restricted profile text are omitted server-side. Every ID in
a command is revalidated against `world_id`; frontend checks are affordances,
not authorization.

## SSE implementation

The world event endpoint:

- authenticates and checks readiness before headers;
- parses `after`, falling back to `Last-Event-ID`;
- disables buffering/caching and flushes `retry: 1500`;
- rechecks the session read-only plus membership and queries up to 100 visible
  events per batch;
- immediately reauthorizes and queries again after a full 100-event batch,
  rather than sleeping with a known backlog;
- wakes every local stream immediately after a successful mutating API handler
  returns, which is after its transaction has committed;
- retains the 1.5-second database poll as a lost-wakeup and cross-replica
  fallback;
- sends keep-alive comments when empty;
- bounds each write/flush to five seconds and clears the deadline while waiting;
- advances the cursor only after successfully flushing a batch;
- exits on cancellation, revoked authority, query error, or flush failure.

Payloads contain identifiers and event types, never aggregate snapshots.
Clients treat them as reload signals.

## Testing seams

- Pure mechanics use constructed maps/snapshots.
- `NewServerWithStaticFS` tests API/static behavior without a Vite build.
- The small `queryer` interface lets helpers use pools or transactions.
- DTO tests cover strict scalar unions and exact numbers.
- Playwright supplies clean-PostgreSQL handler integration and multi-user flow.
- Route tests require removed URL families to return `404 endpoint_not_found`.

## Adding a backend capability

For a new world-authored mechanic feature:

1. extend pure scalar types/validation only when mechanical behavior changes;
2. add a world-scoped relational migration when persistence changes;
3. add strict DTOs and exact-number mapping;
4. implement explicit queries/transactions and role checks;
5. register only a world-scoped method-aware route;
6. cover archive, cross-world, revision, and lock-order cases;
7. update frontend contract, browser coverage, and canonical docs;
8. run focused CI and then full `./ci.sh`.

For live commands, also define readiness, visibility, idempotency,
receipt/event behavior, and test separate identities. Never rely on UI hiding as
authorization.
