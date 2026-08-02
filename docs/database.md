# Database

## Overview

PostgreSQL is the authoritative store. The application persists configuration,
typed state, bindings, games, interactions, receipts, and events as normalized
relations. There is no canonical JSON aggregate column and no seeded ruleset
vocabulary.

The schema uses:

- UUID primary keys generated with `pgcrypto` unless supplied by the client;
- `numeric` for exact finite decimals;
- `timestamptz` for timestamps;
- explicit `position` columns for authored order;
- composite foreign keys carrying `rule_set_id` or `game_id` to enforce scope;
- check constraints for tagged shapes, bounds, statuses, and lifecycles;
- partial unique indexes for one/set semantics and selected/idempotent records;
- triggers for `updated_at` and selected final/append-only history rows.

## Connection and privileges

At application startup, the configured role must be able to:

- connect to the target database;
- create and alter schema objects for unapplied migrations;
- create the `pgcrypto` extension (or use one already installed by a sufficiently
  privileged administrator);
- take PostgreSQL advisory locks;
- read and write application tables/sequences.

Normal runtime and migration execution use the same configured connection. The
repository does not define separate migration/runtime roles.

The end-to-end test admin connection additionally needs permission to create
and drop databases and terminate sessions connected to its disposable test
database.

## Migration runner

`internal/migrations/migrations.go` embeds every `*.sql` in the package. On
startup it:

1. acquires a dedicated connection from the pool;
2. takes PostgreSQL advisory lock `3016533762926936644`;
3. creates `schema_migrations(version, applied_at)` if absent;
4. lists embedded SQL files and sorts names lexically;
5. skips versions already recorded by exact filename;
6. executes each new file in its own transaction;
7. inserts the filename into `schema_migrations` in that same transaction;
8. releases the advisory lock, using a five-second background timeout during
   cleanup.

This allows concurrent application starts to serialize upgrades. The HTTP
listener is not created until database ping and migrations succeed.

Migrations are forward-only. There is no down migration, schema reset, seed,
or data repair framework.

## Migration history

| Migration                     | Area                 | Main additions                                                                                                   |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `001_foundations.sql`         | Ruleset foundations  | `pgcrypto`, update trigger, rulesets, owner schemas, entities, schema membership, state roots.                   |
| `002_state_variables.sql`     | State schema         | Definition metadata, schema links, choice options, units, reference targets, allowed operations, typed defaults. |
| `003_state_values.sql`        | Stored state         | Typed scalar rows for entity overrides.                                                                          |
| `004_conditions.sql`          | Conditions           | Sets, parameters/schema requirements, recursive expressions, criteria, typed predicates.                         |
| `005_problem_definitions.sql` | Configured problems  | Targets, invocations, choices, outcomes, consequences, effects, typed operands.                                  |
| `006_problem_instances.sql`   | Configured instances | Instance/entity link, binding revision, ordered concrete target bindings.                                        |
| `007_live_play.sql`           | Multiplayer Play     | Users, games, memberships, game entity scope, interactions/actions, applied-receipt protection, event cursor.    |
| `008_world_studio.sql`        | World product model  | World/game pairing, world roles, hashed invite links/redemptions, capacity/capability classification.             |

## Logical schema

### Foundations

| Table                  | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `rule_sets`            | Top-level mechanical isolation boundary and globally unique key. |
| `state_owner_schemas`  | User-authored ownership capabilities scoped to a ruleset.        |
| `entities`             | Generic state owners with optional ruleset-unique key.           |
| `entity_owner_schemas` | Many-to-many entity capability membership.                       |
| `state_records`        | At most one revision/timestamp root per entity.                  |

`state_owner_schemas` is the persisted table name for the domain/API concept
“owner schema.”

Public creation handlers insert a `state_records` row for every entity, including
one with no scalar overrides, and loaders rely on that application invariant.
The foreign key and primary key do not require the row to exist: direct SQL can
create an entity without a state root, and inner-join loaders will omit it.

### State definitions and values

| Table                                     | Purpose                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `state_variable_definitions`              | Definition root: kind, cardinality, absence, presentation, bounds, order, archive state. |
| `state_variable_owner_schemas`            | Schemas that make an entity eligible to own the variable.                                |
| `state_variable_choice_options`           | Ordered durable choice identities, keys, and labels.                                     |
| `state_variable_measurement_units`        | Ordered durable unit identities and text.                                                |
| `state_variable_reference_target_schemas` | Optional schema restrictions for referenced entities.                                    |
| `state_variable_effect_operations`        | Per-definition effect allowlist.                                                         |
| `state_variable_default_values`           | Zero or more typed scalar rows forming the authored default.                             |
| `state_values`                            | Zero or more typed scalar rows forming one entity's stored override for a definition.    |

The definition root carries a composite typed identity
`(id, rule_set_id, value_kind, cardinality)`. Typed value rows reference that
identity, preventing a row from claiming a kind/cardinality different from its
definition.

### Conditions

| Table                                        | Purpose                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `condition_sets`                             | Reusable condition aggregate root.                                        |
| `condition_parameters`                       | Ordered singular/plural parameters.                                       |
| `condition_parameter_required_owner_schemas` | Capabilities every bound entity must implement.                           |
| `condition_expression_nodes`                 | Recursive ordered all/any/at-least/criterion tree with one root.          |
| `condition_criteria`                         | Parameter, variable, quantifier, count, and operator for criterion nodes. |
| `condition_number_predicates`                | Exact number or range operands.                                           |
| `condition_boolean_predicates`               | Boolean operand.                                                          |
| `condition_choice_operands`                  | Ordered, unique durable choice-option operands.                           |

The self-referential expression-tree foreign key is deferrable so aggregate
replacement can assemble/replace a tree inside one transaction. A partial
unique index permits at most one root candidate per condition set; domain and
save validation require a complete tree.

### Problem definitions

| Table                                       | Purpose                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `problem_definitions`                       | Problem root and optional availability invocation reference.           |
| `problem_definition_instance_owner_schemas` | Schema template copied to new instance entities.                       |
| `problem_target_definitions`                | Ordered abstract targets, bounds, cardinality, and binding source.     |
| `problem_target_required_owner_schemas`     | Capabilities target bindings must implement.                           |
| `condition_invocations`                     | Owned reference from a problem usage site to a reusable condition set. |
| `condition_invocation_arguments`            | Parameter-to-problem-target mappings.                                  |
| `problem_choices`                           | Ordered choices and optional availability invocation.                  |
| `choice_resolutions`                        | Automatic/condition resolution discriminator and invocation.           |
| `choice_outcomes`                           | Automatic, met, or unmet outcome per choice.                           |
| `consequence_sets`                          | At most one owned consequence container per outcome.                   |
| `effects`                                   | Ordered configured state operations against abstract targets.          |
| `effect_value_operands`                     | Typed set/add/remove operand scalar rows.                              |

Several problem references are deferrable because invocations, choices, and
their owning problem form a cyclic aggregate during replacement. Application
validation still performs semantic checks and requires complete resolution and
outcome structures before commit; not every exact-one relationship is enforced
from parent to child by a foreign key.

### Problem instances

| Table                              | Purpose                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `problem_instances`                | Links a problem definition to the generic entity that represents one instance; owns binding revision. |
| `problem_instance_target_bindings` | Ordered concrete entity IDs for each target.                                                          |

The instance primary key is `entity_id`, so every problem instance is
structurally also a generic entity/state owner.

### Games and membership

| Table                             | Purpose                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `users`                           | Local development identities.                                                                                     |
| `games`                           | One ruleset's live game, status, revision, and creator.                                                           |
| `game_memberships`                | User role/status/revision in a game.                                                                              |
| `game_entities`                   | Exclusive game assignment for ruleset entities.                                                                   |
| `game_membership_entity_controls` | Reserved relational mapping from membership to controlled game entity; not populated/exposed by current handlers. |

`game_entities.entity_id` is the primary key, enforcing assignment to at most
one game. Composite foreign keys prove that game and entity share a ruleset.

### World studio

| Table                       | Purpose                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `world_profiles`            | Pairs one backing ruleset with one primary game and stores world status/revision.             |
| `world_memberships`         | Owner/editor/player/spectator role and lifecycle for one user in one world.                   |
| `world_invites`             | Expiring/revocable role offer with unique SHA-256 token digest and use count.                 |
| `world_invite_redemptions`  | One durable redemption per invite/user linked to the resulting world membership.             |
| `world_mechanics`           | Capacity/capability kind, author-facing mode, and live-mutation flag for a state definition.  |

`world_profiles.primary_game_id` has a composite foreign key proving that the
game belongs to the same ruleset. World and game memberships remain separate
because their role vocabularies serve different boundaries; application
transactions create/redeem them together.

Invite rows never store raw bearer tokens. The application stores a lowercase
64-character SHA-256 hex digest and returns the raw URL-safe token only from the
create response. Redemption rows keep use counting idempotent per invite/user.

`world_mechanics.state_variable_id` is both its primary key and a composite
foreign key to a normalized definition in the same ruleset. The table does not
duplicate defaults, bounds, values, or effect operations. World mechanic
definitions intentionally have no rows in `state_variable_owner_schemas`; an
empty definition owner set is the engine's explicit universal case.

### Interactions and actions

| Table                             | Purpose                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `interactions`                    | Prompt/private notes/status/revision/lifecycle root.                                                   |
| `interaction_audience_members`    | Memberships allowed to see a presented interaction.                                                    |
| `interaction_eligible_responders` | Audience player memberships allowed to submit.                                                         |
| `interaction_context_entities`    | Ordered game entity context, with label/visibility columns reserved beyond current public-only writer. |
| `interaction_action_submissions`  | Free-form player actions, status, and revision.                                                        |

Database lifecycle checks constrain timestamp/status combinations for draft,
open, adjudicating, resolved, and cancelled interactions. A partial unique index
allows at most one selected action per interaction.

### Live resolution receipts

| Table                                           | Purpose                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `interaction_resolutions`                       | One draft/applied ruling root per interaction, narrative, notes, selected action, actor, idempotency key. |
| `interaction_resolution_effects`                | Ordered requested concrete operations.                                                                    |
| `interaction_resolution_effect_targets`         | Ordered mapped game entity targets for each effect.                                                       |
| `interaction_resolution_effect_operands`        | Typed operand scalar rows for requested effects.                                                          |
| `interaction_resolution_effect_applications`    | Ordered per-effect/per-entity application and changed flag.                                               |
| `interaction_resolution_application_value_sets` | Required `before` and `after` wrapper, preserving known/unknown and cardinality.                          |
| `interaction_resolution_application_values`     | Typed scalar rows for each known before/after value.                                                      |

The value-set wrapper is necessary because zero scalar rows can mean two
different things: a known empty many-value or an unknown logical value. It uses
`known=false, cardinality=null` for unknown and `known=true,
cardinality=many` with no children for the empty set.

`interaction_resolutions` is unique by interaction. A partial game-scoped
unique index on non-null idempotency key supports safe retry. Application rows
are unique by effect/entity, and before/after phases are exactly enumerated.

### Events

| Table         | Purpose                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `game_events` | Append-only identity cursor and normalized related resource IDs for SSE invalidation. |

Event IDs are generated `bigint` identities and indexed by `(game_id, id)`.
The payload is intentionally not a JSON state snapshot. Current event types
cover game, membership, entity assignment, interaction lifecycle, submission,
and resolution changes. `resolution-updated` is allowed by the schema but no
current handler emits it.

The schema validates the event type and game scope of any populated resource
IDs, but it does not require the actor/resource ID combination appropriate to
each type. Inserts remain allowed. `game_events` is therefore an append-only
invalidation cursor, not a tamper-evident or semantically complete audit log.

## Typed scalar storage

The schema repeats a deliberate relational tagged-union pattern for defaults,
current state, configured operands, live requested operands, and live
before/after receipt values.

Each scalar row has:

- `value_kind` and `cardinality` discriminators;
- `position`;
- nullable dedicated columns for text, number, Boolean, choice-option ID,
  measurement amount/unit ID, reference entity ID, and fallback name;
- a check constraint requiring exactly the columns appropriate to the selected
  kind;
- foreign keys for option/unit/reference identity;
- finite-number checks;
- definition identity foreign keys where applicable.

Partial unique indexes enforce set uniqueness by kind for many-valued state.
Reference set uniqueness is by referenced entity, not fallback text.
Single-valued rows must use position zero and have at most one row.

This design is verbose by intent. It lets PostgreSQL enforce the same type
boundary as the rules engine and avoids opaque JSON that can drift from
definition metadata.

## Scope and referential integrity

Where a reference must remain in one ruleset, foreign keys include
`rule_set_id`, for example:

```text
(state_variable_id, rule_set_id)
    → state_variable_definitions(id, rule_set_id)
```

Where a live reference must remain in one game, foreign keys include `game_id`,
for example:

```text
(referenced_entity_id, game_id)
    → game_entities(entity_id, game_id)
```

These constraints make those references cross-scope-invalid even if application
code is bypassed. Generic defaults and `state_values` carry only ruleset scope;
assigning an entity to a game does not require every generic reference reachable
from it to be assigned to that game. Domain validation provides better messages
and rules that cannot be expressed comfortably as static SQL constraints, such
as schema-set implications.

## Revisions and timestamps

`set_updated_at()` updates mutable roots with an `updated_at` column. Revisions
are explicit non-negative bigint counters on state records, problem instances,
games, memberships, interactions, and action submissions.

The application increments revisions only for meaningful mutations where
implemented. Direct SQL writers must not assume an `updated_at` trigger also
increments a revision; it does not.

## Immutability and receipt completeness

Migration 007 adds triggers that:

- reject updates/deletes of an `interactions` root row once it is resolved or
  cancelled;
- reject updates/deletes once a resolution is applied;
- reject inserts/updates/deletes of children owned by an applied resolution;
- prevent reparenting of receipt child rows;
- check, at transition to applied, that effects have targets, targets have
  applications, operands match operations, and every application has complete
  before/after value sets;
- reject every update/delete of `game_events`.

Audience, responder, context, and action-submission rows have no equivalent
final-interaction trigger and remain directly mutable after resolution or
cancellation. Event inserts also remain allowed. The applied receipt tree is the
strong immutable portion of the record and is deliberately hard to “fix” in
place; corrections should be represented by a new later domain action rather
than rewriting it.

These are DML protections while the triggers remain installed, not
tamper-evidence against the configured database role. Startup migrations and
normal runtime use the same DDL-capable connection, so a holder of those
credentials can alter schema protections.

## Delete and archive behavior

Owned aggregate children generally cascade from their root. Cross-aggregate
configuration and history references generally restrict deletion. The public
API does not expose hard deletion and uses archive/final statuses instead.

Deleting a ruleset directly in SQL would cascade a large amount of authored
state and may interact with restricted live/history references. It is not a
supported operational workflow.

## Adding a migration

1. Add a new zero-padded SQL filename after the current highest version, for
   example `008_feature_name.sql`.
2. Do not edit a migration that may already be recorded in any database. The
   runner keys by filename and does not checksum prior contents.
3. Make the file safe to execute inside one transaction. Avoid operations that
   PostgreSQL forbids in a transaction or split the design into an application-
   compatible forward sequence.
4. Preserve user-authored/ruleset-scoped vocabulary; do not insert canonical
   schemas, keys, entity classes, or seed rules.
5. Add relational constraints and scope-carrying foreign keys, not only handler
   validation.
6. Consider existing data explicitly: add nullable/backfilled/validated changes
   in a safe order.
7. Consider locks and table rewrite cost for production-sized data even though
   the current project has no online-migration framework.
8. Run `./ci.sh backend` with `DND_TEST_DATABASE_URL` pointing to an explicitly
   disposable database to exercise the full chain.
9. Run `./ci.sh e2e` to exercise a clean database and cross-layer behavior.
10. Update this table catalog and operational notes.

Because migrations run before the listener opens, a long migration extends
deployment health-check startup time. Railway currently allows a 30-second
health-check timeout; plan larger migrations rather than assuming that window is
adequate.

## Inspection queries

List applied versions:

```sql
select version, applied_at
from schema_migrations
order by version;
```

Find current state revisions in a ruleset:

```sql
select entity.display_name, record.owner_entity_id, record.revision,
       record.updated_at
from state_records record
join entities entity on entity.id = record.owner_entity_id
where record.rule_set_id = $1
order by lower(entity.display_name), record.owner_entity_id;
```

Find unfinished interactions that prevent archive:

```sql
select id, title, status, revision, updated_at
from interactions
where game_id = $1
  and status in ('draft', 'open', 'adjudicating')
order by created_at, id;
```

Inspect recent event cursors:

```sql
select id, event_type, interaction_id, submission_id, resolution_id, created_at
from game_events
where game_id = $1
order by id desc
limit 100;
```

Use read-only accounts and transactions for production inspection. Do not
manually update receipt or event tables.

## Backup and restore

The repository supplies no backup automation. A deployment owner should create
and test a PostgreSQL-native backup policy before relying on the application for
durable play history.

A typical logical backup is:

```sh
database_url="${DND_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$database_url" ]; then
  echo "DND_DATABASE_URL or DATABASE_URL is required" >&2
  exit 1
fi
pg_dump --format=custom --no-owner --file=dnd.dump "$database_url"
```

Restore into an empty, access-controlled database with compatible PostgreSQL
tools, then point a non-production application instance at it and verify:

1. `schema_migrations` contains the expected versions;
2. application startup runs no unexpected/destructive migration;
3. `/api/health` succeeds;
4. representative rulesets, logical state, games, and receipts load;
5. event cursors and revision guards still behave.

Do not restore over a live database. Pause writers, preserve the original
database, and rehearse the exact provider-specific recovery process. Database
restore is the current rollback mechanism for a destructive data/schema
incident; the migration runner itself cannot roll back.

## Current operational gaps

- no automated backup, point-in-time recovery, or restore drill;
- no down migrations or application-level data repair framework;
- no separate least-privilege migration/runtime roles;
- no connection-pool tuning through application environment variables;
- no database metrics or slow-query integration;
- no per-migration version, progress, or duration logging;
- no online/expand-contract migration framework;
- no cleanup tool for abandoned E2E databases after a forcibly interrupted
  run.
