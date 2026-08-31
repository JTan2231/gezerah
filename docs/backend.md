# Backend

## Stack and process model

The backend is a Go 1.25.14 application with two direct runtime dependencies:
`github.com/jackc/pgx/v5` and `golang.org/x/crypto` for Argon2id. It uses the standard-library HTTP server and
method-aware `http.ServeMux`, `log/slog` for structured logs, and `embed.FS` for
the PostgreSQL schema and production frontend.

One process owns connection pooling, startup migrations, JSON/SSE routes,
embedded SPA serving, and signal-driven shutdown. There is no ORM, worker,
cache, message broker, code generator, or dependency-injection framework.
Narrative generation and compilation use an optional outbound OpenAI Responses
API client; the server can start without its API key, but those calls are then
unavailable.

## Startup and shutdown

`cmd/scryer/main.go`:

1. loads environment configuration;
2. installs a JSON `slog` handler;
3. watches `SIGINT`/`SIGTERM`;
4. opens and pings `pgxpool`;
5. applies embedded migrations;
6. constructs the API/static server;
7. listens;
8. attempts HTTP shutdown with a ten-second deadline.

| Timeout                 | Value      |
| ----------------------- | ---------- |
| Read header             | 5 seconds  |
| Read request            | 15 seconds |
| Ordinary response write | 30 seconds |
| SSE write/flush         | 5 seconds  |
| Idle connection         | 60 seconds |
| Graceful shutdown       | 10 seconds |

Request contexts inherit the process root, so signal cancellation reaches
long-lived handlers. SSE uses response-controller flushing and replaces the
ordinary absolute response deadline with a five-second deadline around each
write/flush, clearing it while waiting. A healthy stream is long-lived; a
stalled write ends it, and clients reconnect with their last world-event cursor.

## Package map

### `cmd/scryer`

Executable and process lifecycle only.

### `internal/rules`

Pure graph evaluation and runtime transitions:

| File                     | Responsibility                                                                   |
| ------------------------ | -------------------------------------------------------------------------------- |
| `types.go`               | Mechanic graph, Status instance, logical-state, Effect, evaluation, and Resolution-receipt types. |
| `definitions.go`         | Input/derived numeric/Boolean mechanic and entity validation.                    |
| `expressions.go`         | Recursive type inference, dependency extraction, cycle paths, graph compilation. |
| `evaluation.go`          | Intrinsic/effective evaluation and transparent modifier/expression traces.       |
| `statuses.go`            | Inline-status, literal-modifier, and active-Status-instance validation.           |
| `values.go`              | Scalar construction, equality, and definition-aware validation.                  |
| `logical_state.go`       | Authored defaults, sparse stored overrides, materialization, normalization, cloning. |
| `effects.go`             | Ordered scalar transition validation and application.                            |
| `runtime_transitions.go` | Combined scalar and Status-instance lifecycle transition.                        |
| `decimal.go`             | Immutable exact finite base-10 parsing, arithmetic, and canonicalization.        |
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
- mechanic publication locks the rules revision and validates the
  proposed complete graph before writing normalized rows;
- Entity-sheet loaders combine sparse stored overrides, compiled expressions,
  plus active Status instances and immutable modifier snapshots;
- Resolution-receipt persistence records ordered Scalar and Status Applications and effective
  changes;
- server/JSON/config files provide cross-cutting infrastructure.

Durable membership and live responsibility are deliberately separate. The one
membership-role vocabulary remains owner/editor/player/spectator.
A world-level assignment designates either one active non-spectator membership,
Terra, or an agent as facilitator, and response mapping derives the current
facilitator/player/spectator current play role without rewriting membership.

### `internal/migrations`

`001_world_baseline.sql` is the clean World-native baseline;
`002_mechanic_graph_status_instances.sql` adds typed
derived Mechanics, problem-authored Status instances/modifier snapshots, and
expanded Resolution receipts;
`003_interaction_audience_invalidations.sql` adds constrained audience-removal
event invalidations; and
`004_password_auth.sql` installs credentials and server sessions.
`005_terra.sql` adds the world-level human/Terra facilitator source;
`006_facilitator_assignment.sql` adds the designated human membership and
human/Terra attribution on interactions, resolutions, and events; and
`007_agent_facilitator.sql` extends the non-membership attribution shape to
page agents. See
[Database](database.md).

### `internal/openai`

A narrow standard-library Responses API client provides one-shot Terra plain
text generation and Luna strict JSON Schema generation. It always sends
`reasoning.effort: "none"` and `store: false`, bounds response bodies, and
surfaces provider failures/refusals without exposing the API key.

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

When `OPENAI_API_KEY` is non-empty, production server construction installs the
Terra and Luna model provider. Without it, normal routes still start and
model-backed commands return `503 model_unavailable`.

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

`decodeJSON` rejects unknown fields and reads one JSON value. Exact decimals
cross HTTP as strings, are parsed into immutable domain values at the
application boundary, and are canonicalized in responses. The Mechanic-value DTO
accepts only:

```json
{ "kind": "number", "value": "1.25" }
{ "kind": "boolean", "value": true }
```

Custom union decoding ensures the number/Boolean shape cannot carry fields from
another variant. JSON number tokens are rejected for exact decimal fields; this
prevents generic decoders and JavaScript clients from rounding through
`float64`/`number`. Do not replace the union with `map[string]any`.

### Validation order

Route wrappers validate before a protected handler runs:

1. an active server session;
2. for unsafe methods, the exact origin and session-bound CSRF token.

Public signup and signin apply their origin check before decoding the body.
Once a handler runs, it generally validates:

1. path/query syntax and UUID shape;
2. strict body decoding;
3. transport required fields, lengths, and enums;
4. active World membership and required membership role, current play role, and play status;
5. world ownership of every referenced resource;
6. domain Mechanic/logical-state/transition rules;
7. archive/lifecycle/revision constraints;
8. PostgreSQL constraints during persistence.

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

### Logical state and Entity sheets

Each Entity has exactly one `entity_logical_states` root.
`entity_input_value_overrides` stores at most one numeric or Boolean override
per input Mechanic.

Reading an Entity sheet:

1. load the World Entity, complete world mechanic graph, logical-state root,
   and stored overrides;
2. load the entity status-set revision, active instances, and their immutable
   modifier snapshots;
3. materialize missing logical input values from Mechanic authored defaults;
4. compile/validate the graph and recursively evaluate derived references;
5. apply status modifiers in deterministic order;
6. return `logical_input_values`, all `effective_values`, per-Mechanic
   `evaluations`, active Status instances, and logical-state/status-set/rules
   revisions.

Replacing logical state treats the request map as complete and rejects derived
IDs. It locks both the rules revision and Entity logical-state
root. Values equal to authored defaults normalize to absent override rows.

Resolution persistence updates only Entities reported changed by the
pure transition engine. Status-instance lifecycle changes increment the independent
Entity status-set root. Both happen in the same transaction as the Resolution receipt.

### Mechanic publication

The world mechanic graph is read in `REPEATABLE READ` and returned as a
`{revision,...}` wrapper. Every publishing create/update or first archive:

1. locks `world_mechanic_graphs` and compares `expected_rules_revision`;
2. loads all world mechanics;
3. substitutes the proposed mechanic into the in-memory graph;
4. type-checks every expression and rejects dependency cycles with
   path-indexed fields;
5. persists the normalized mechanic/expression rows;
6. increments the rules revision and appends `rules-updated`;
7. returns the new revision with the saved mechanic.

An active Mechanic archive is rejected while another active derived Mechanic
depends on it (`mechanic_has_dependents`) or any modifier from an active Status instance
references it (`mechanic_has_active_status_instances`). The latter Status instances
must be removed before archive. Archived mechanics remain readable but cannot
be changed or restored through the product API. Database constraints preserve
tagged and world-scoped shapes, while graph-wide type and cycle checks remain
application and pure-rule responsibilities.

### Persistent Status instances

Inline statuses are authored in an adjudicating Problem's apply-status Effect, not in
World configuration. The Effect supplies a name, optional description, ordered
literal modifiers, and ordered entity targets. Resolve inserts one durable
instance per target, snapshots the Inline-status prose and modifiers into
instance-owned rows, and records source interaction, resolution, and effect
IDs. Evaluation reads those immutable snapshots rather than a reusable catalog.

Modifier order is priority, application order, instance ID, modifier position,
then modifier ID. Same-name instances from different Consequences may coexist.
A remove-status Effect names the exact active Status instance for each Entity target;
unknown, removed, cross-world, or mismatched targets fail validation. Resolve
idempotency handles equivalent retries before the transition is applied.

### Entity profiles

Profiles do not use mechanical state. A World-level character-field-set revision guards
the ordered character fields; each Entity profile has its own revision. Text rows
preserve field UUID and author provenance. Read paths filter restricted fields
and values before serialization. Profile changes never advance the logical-state revision.

### Controller sets

Controller replacement is a complete set operation over
`world_membership_entity_controls`. The command checks the world's
`roster_revision`, validates every target as an active non-spectator membership in the
same world, replaces rows, increments `roster_revision`, and appends an event.

## Rules execution

Entity-sheet reads compile definitions and evaluate one Entity with:

```go
rules.EvaluateEntity(entity, inputOverrides, mechanics, inlineStatuses, statusInstances)
```

Input intrinsic values come from stored overrides or authored defaults. Derived
intrinsic values recursively consume referenced mechanics' effective values.
Each Mechanic's literal Status modifiers then transform intrinsic to effective.
The evaluator returns no partial result on graph, Inline-status/Status-instance, or arithmetic failure.

Live Consequences map concrete effect DTOs to:

```go
rules.ApplyRuntimeTransition(plan, entities, mechanics, inlineStatuses, snapshot)
```

The function validates and clones both stored overrides and active Status
instances, applies Effects by position, and returns Applications, changed
Entity IDs, and the resulting runtime snapshot. The application
evaluates before and after to derive transitive effective changes. A failure
returns no partially usable snapshot. PostgreSQL supplies transactional
atomicity around the pure in-memory atomicity.

`set` and `adjust-number` retain `entity_ids` and target only mutable inputs.
`apply-status` uses ordered Entity targets plus one Inline status;
`remove-status` uses ordered Entity/Status-instance targets and no Inline
status. Both Status-lifecycle Effect variants carry no scalar operands. Every target and
mechanic must belong to the request World. Numeric logical-input results must satisfy
bounds/step; Boolean mechanics accept only Boolean `set`. Scalar operations
read/write logical input values and never use a Status-modified effective
value as their operand. Status modifiers are reapplied only when the application
evaluates the post-transition runtime snapshot.

## Model generation and Terra orchestration

The application builds Terra and Luna context in one read-only `REPEATABLE READ`
transaction. It includes the World description as world brief, all active
Mechanic definitions, and every non-archived Entity with its facilitator-visible
profile values and their authored character-field guidance plus generated sheet data (exact logical input values,
intrinsic/effective values, and active Status instances), plus
the latest three resolved Problem/Consequence pairs. Consequence calls add
the adjudicating Problem and all submitted Actions. UUIDs are replaced with
short request-local references before the snapshot leaves the process.

Terra's Problem and Consequence instructions ask for a small amount of concrete
sensory and environmental texture, including otherwise innocuous details whose
emphasis follows relevant profile prose and guidance, effective Mechanics,
active Statuses, contextual equipment, and demonstrated temperament. That is a
narration rule, not a privileged Perception/Temperament field or an invented
check. Private profile context may preserve consistency but cannot be exposed,
and one Character never learns another's unexpressed thoughts from it. Problem
prose keeps pressure, stakes, and meaningful tradeoffs clear without making
suggested Actions exhaustive; Consequence prose carries those choices into
observable costs and changed pressure.

For a human facilitator, consequence compilation remains advisory: GPT-5.6
Luna interprets the human's immutable prose, the application maps request-local
references back to world-owned UUIDs, validates and previews the concrete
effects, and returns them to the human. Only a later human resolve command
writes.

Terra uses two orchestration handlers instead. `terra/continue` first checks
that the caller is a ready current player, Terra is assigned, and no
interaction is unfinished. After GPT-5.6 Terra generates the prompt, a write
transaction locks the world and repeats those checks. It derives the audience
from all ready active memberships, responders from all ready non-spectators,
and context from ready controlled entities, then inserts and presents an open
interaction with `facilitator_source='terra'` and no human creator. Its two
lifecycle events likewise use `actor_source='terra'` and no human actor.

The existing interaction cancellation path also admits a ready current player
when Terra is still assigned and the target is a Terra-authored open or
adjudicating interaction. The transaction locks and rechecks the assignment,
source, lifecycle, and expected revision, then makes the interaction
`cancelled` without a Consequence. Its event is attributed to the human player;
the interaction source and world assignment remain Terra. Cancellation does
not call the provider or generate a replacement.

`terra/decide` requires a ready current player, fresh Interaction and rules
revisions, a non-empty idempotency key, and one submitted action for every
eligible responder. It locks the interaction, changes `open` to
`adjudicating`, and appends a Terra-attributed event before the provider calls.
Terra writes the narrative; Luna produces optional selected-Action metadata
and the four existing effect types. The application maps and validates every
reference, runs the ordinary preview internally, and immediately calls the
ordinary resolution transaction as facilitator source `terra`. The committed
Resolution receipt and World event have no human resolver/actor. A pacing current player's session
authorizes and times the request but is never substituted as the model's
author.

No prose or effects cross back to the browser for editing or approval before a
Terra resolution commits. A failed provider/validation call can leave the
interaction adjudicating; the client reloads its revision and retries with the
same idempotency key. A committed replay returns the immutable result, while a
different use of that key conflicts. Provider output still passes the normal
world scope, lifecycle, revision, type, bounds, transition, lock, and Resolution-receipt
boundaries.

Agent facilitation uses `agent/continue` and `agent/resolve` without a
server-side model call. The handlers accept page-agent Problem and Consequence
content from an authenticated ready current player, derive audience,
responders, and context server-side, and invoke the same deterministic preview,
transition, Resolution-receipt, and World-event paths with `agent` attribution.

## Transaction patterns

### Consistent reads

Multiquery resources and previews may use read-only `REPEATABLE READ` so a
response cannot combine roots and child rows from different revisions.

### Optimistic commands

World settings, World roster, world mechanic graph, character-field set,
profile, logical state, Interaction, and Action roots compare expected revisions after
loading/locking. Membership rows carry revisions, but no membership mutation
currently accepts an expected membership revision. Conflicts return 409 rather
than overwriting newer state.

### Live resolution

Resolve checks the active world and applicable assignment/source boundary with
ordinary transaction reads, then checks for an idempotent replay. The public
resolve route requires the designated human facilitator—including an owner who
has taken over a Terra-authored interaction. Terra's decision path invokes the
same implementation with Terra assignment plus ready-current-player pacing checks.
A new Resolution locks the world mechanic graph root, Interaction, and sorted target
Entity logical-state/status-set roots. Selected
Action existence is validated by an ordinary read rather than a row lock. The
transaction checks lifecycle and revisions; evaluates before; applies the
combined transition; persists logical state plus Status instances and modifier snapshots with source
provenance; evaluates after; and stores the Resolution, requested Effects,
Status modifiers authored within Inline statuses, exact remove targets, scalar and Status
Applications, effective changes, Action statuses, Interaction status, and
world event atomically.

An equivalent idempotent replay loads the immutable Resolution receipt and current Entity sheets,
and still checks the current session, active world, Resolution-receipt facilitator source,
current assignment, and the applicable human-facilitator or Terra-pacing
authority.

### Lock discipline

Keep root-first and sorted-ID lock order. Do not add a path that locks target
Entity logical-state/status-set roots before the mechanic-graph and Interaction roots used
by resolution.

## Authorization and filtering

Every product handler except health, signup, and signin requires an active
opaque-cookie session. Route registration wraps protected handlers
deny-by-default; unsafe requests additionally require an exact same-origin
`Origin` and the session-bound `X-SCRYER-CSRF` token. Caller-supplied identity
headers are ignored. World handlers load an active membership for the session user.
Owner/editor helpers grant durable configuration authority. A separate helper
checks whether that exact membership is the currently designated human
facilitator for live facilitator commands; Terra assignment is checked without
manufacturing a membership. Current players—including owners/editors when they
are not the facilitator—must satisfy controlled-character readiness before live
interaction/event access and before skipping a Terra-authored open or
adjudicating Interaction. `play_status` is still derived for a designated
human facilitator so a later handoff knows the seat they return to, but the
facilitator bypasses that readiness gate while assigned. Spectators report
ready and remain audience-only.

Every authenticated request performs a read-only session/account validity
lookup. If the last activity touch is at least five minutes old, ordinary
request authentication attempts a database-guarded update of `last_seen_at` and
the sliding idle expiry; the update repeats the token, revocation, expiry, and
active-account predicates. A concurrent touch loser revalidates. The SSE
handshake follows that ordinary path, while subsequent stream reauthorization
is read-only and therefore does not keep an otherwise idle session alive.

Profile writes allow owner/editor or the entity's current active
non-spectator Controller. Controller and field-set replacement are
owner/editor only. An acting Entity on an Action must be controlled and
complete. Interaction context/Effect targets must be active and eligible.
Restricted profile reads additionally admit the currently designated human
facilitator even when that membership is neither an editor nor controller.

Facilitator assignment accepts an active non-spectator target and is available
to owner/editor memberships or the current human facilitator. It locks the
world revision and normally rejects a meaningful handoff while any interaction
is unfinished. One transactional exception lets the owner assign themself from
Terra while the sole unfinished interaction is Terra-authored and open or
adjudicating. It locks that interaction, withdraws the owner's submitted action
if present, advances the interaction revision for the withdrawal, and preserves
the interaction's Terra source. The owner closes/adjudicates an open problem as
needed; the later human Resolution receipt records the owner.

Action creation instead rejects spectators and the designated
human facilitator; the interaction's eligible-responder snapshot supplies the
remaining authority.

Non-facilitator interaction visibility is enforced in SQL/response loading.
Adjudication of a human-authored interaction is private; a Terra-authored
interaction remains visible to its audience for progress/retry, including
after an owner takeover. Presented cancelled interactions remain audience
history, while cancelled drafts remain facilitator-only. Private notes and
restricted profile text are omitted server-side. Every ID in a command is
revalidated against `world_id`; frontend checks are affordances, not
authorization.

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

Ordinary human adjudication and cancellation events may be marked as audience
projection invalidations. A non-facilitator audience member receives a marked
cursor as `interaction-feed-invalidated`, with Interaction, Action,
Resolution, and human actor IDs cleared. The projection preserves cursor/time
metadata so the client can reload authoritative visibility without an
identifier leak.
Autonomous Terra adjudication explicitly appends an unmarked, unredacted
Terra-attributed event and remains visible while pending.

The response always includes `actor_source`. Human events pair it with the
authenticated membership; Terra events require a null human actor. Continue
and Decide use Terra attribution, while a ready current player's Skip uses human
attribution without changing the interaction's Terra source.

## Testing seams

- Pure mechanics use constructed maps/snapshots.
- `NewServerWithStaticFS` tests API/static behavior without a Vite build.
- The small `queryer` interface lets helpers use pools or transactions.
- DTO tests cover strict scalar unions and exact numbers.
- Playwright supplies clean-PostgreSQL handler integration and multi-user flow.
- Route tests require unknown API URLs to return `404 endpoint_not_found`.

## Adding a backend capability

For a new world-authored mechanic feature:

1. extend pure scalar types/validation only when mechanical behavior changes;
2. add a world-scoped relational migration when persistence changes;
3. add strict DTOs and exact-number mapping;
4. implement explicit queries/transactions and membership-role/current-play-role checks;
5. register only a world-scoped method-aware route;
6. cover archive, cross-world, revision, and lock-order cases;
7. update frontend contract, browser coverage, and canonical docs;
8. run focused CI and then full `./ci.sh`.

For live commands, also define readiness, visibility, idempotency,
Resolution-receipt/World-event behavior, and test separate identities. Never rely on UI hiding as
authorization.
