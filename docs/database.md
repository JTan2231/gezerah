# Database

## Overview

PostgreSQL is authoritative. The schema persists worlds, memberships,
user-authored mechanics, entities, scalar state, character profiles,
interactions, receipts, and event cursors as normalized relations. There is no
canonical JSON aggregate column and no seeded vocabulary.

The schema uses:

- UUID primary keys generated with `pgcrypto` unless supplied by the client;
- `numeric` for exact finite decimals;
- `timestamptz` for timestamps;
- explicit `position` columns for authored order;
- composite foreign keys carrying `world_id` to enforce scope;
- checks for scalar shapes, bounds metadata, roles, statuses, and lifecycles;
- partial unique indexes for selected and idempotent records;
- triggers for `updated_at` and immutable history.

## Connection and privileges

At startup the configured role must be able to connect, create/alter schema for
unapplied migrations, create `pgcrypto` (or use an installed extension), take
advisory locks, and read/write application tables and sequences. Migration and
runtime work currently share this connection.

The E2E admin connection additionally needs permission to create/drop its
disposable database and terminate sessions connected to it.

## Migration runner and clean baseline

`internal/migrations/migrations.go` embeds every `*.sql` file. Startup:

1. acquires one pool connection;
2. takes advisory lock `3016533762926936644`;
3. sorts embedded SQL filenames lexically;
4. when the ledger is absent, verifies that `public` contains no objects except
   a preinstalled `pgcrypto`, then creates
   `schema_migrations(version, applied_at)`;
5. rejects a recorded history that is not an exact prefix of the embedded
   filenames;
6. executes each new file and version insert in one transaction with the
   migration search path fixed to `public`;
7. releases the advisory lock.

The current application has one baseline:

| Migration             | Purpose                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `001_worldwright.sql` | Complete world-native schema: users, worlds, mechanics, state, profiles, controls, live play. |

This baseline is intentionally a clean break. Databases created by the removed
schema are unsupported and must not be upgraded in place. Create a fresh empty
database and let the application install `001_worldwright.sql`.
For a local database that already has a Worldwright migration ledger,
`./reset-db.sh` safely rebuilds its `public` schema from empty on the next
backend start.
Any one-time data salvage belongs outside the runtime repository and must be
deleted after the new database is verified.

The baseline contains no alternate configuration container, secondary live
container, reusable simulation aggregate, or superseded profile storage.

## Logical schema

### Worlds, users, and membership

| Table                      | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `users`                    | Local development identities.                                              |
| `worlds`                   | Name, description, lifecycle, settings revision, and table revision.       |
| `world_memberships`        | Owner/editor/player/spectator role, status, and membership revision.       |
| `world_invites`            | Expiring/revocable role offer with SHA-256 token digest and use count.     |
| `world_invite_redemptions` | One durable redemption per invite/user linked to the resulting membership. |

`worlds.revision` guards settings and archive commands. `table_revision`
guards controller-set changes and table authority independently.

Invite rows never store raw bearer tokens. Creation returns the token once;
the table stores a lowercase 64-character SHA-256 digest. Redemption rows make
use counting idempotent per invite/user pair.

### Mechanics, entities, and state

| Table             | Purpose                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `world_mechanics` | Capacity/capability kind, mode, scalar type, default, bounds, order, lifecycle. |
| `entities`        | World-owned fictional state owners with display name and archive flag.          |
| `state_records`   | One optimistic revision/timestamp root per entity.                              |
| `state_values`    | Numeric or Boolean stored override per entity/mechanic pair.                    |

`world_mechanics` permits only:

- capacity `score`/`pool` with `value_kind=number`;
- capability `rating` with `value_kind=number`;
- capability `binary` with `value_kind=boolean`.

Numeric mechanics require an authored default and may carry minimum, maximum,
positive step, and unit. Boolean mechanics carry none of those numeric columns
and logically default to false. The composite identity
`(id, world_id, value_kind)` lets state and receipt rows prove they match their
mechanic's scalar kind.

Every entity receives one `state_records` row at creation. `state_values` holds
only overrides; absence means the mechanic's authored default. Its primary key
allows one scalar per entity/mechanic. A tagged-shape check requires exactly
one of `number_value` or `boolean_value` according to `value_kind`.

### Character fields, profiles, and control

| Table                              | Purpose                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `world_character_field_sets`       | One optimistic revision root for ordered active requirements.      |
| `world_character_fields`           | Durable label/guidance/visibility/position rows with soft archive. |
| `entity_profiles`                  | Optional independently revisioned profile root per entity.         |
| `entity_profile_field_values`      | Non-empty text value per entity/field with author provenance.      |
| `world_membership_entity_controls` | Many-to-many player-membership/entity control edge.                |

Every world has one character-field-set root. All active fields are required
for controlled entities. Field visibility is `table` or
`controllers-and-facilitators`. Profile values are relational text with
composite foreign keys proving entity, field, and profile share a world.

Control rows reference a world membership and entity through `(id, world_id)`
keys, so cross-world control is structurally impossible. The primary key allows
multiple entities per membership and multiple controllers per entity.

### Interactions and actions

| Table                             | Purpose                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `interactions`                    | Prompt/private notes/status/revision/lifecycle root.             |
| `interaction_audience_members`    | Memberships allowed to see a presented interaction.              |
| `interaction_eligible_responders` | Audience players allowed to submit.                              |
| `interaction_context_entities`    | Ordered world entity context and visibility.                     |
| `interaction_action_submissions`  | Free-form actions, acting-entity snapshot, status, and revision. |

Lifecycle checks constrain timestamp/status combinations for draft, open,
adjudicating, resolved, and cancelled interactions. A partial unique index
allows at most one selected action per interaction.

Action attribution stores a nullable `(acting_entity_id, acting_entity_name)`
pair. The entity must share the world; the display name is captured at
submission for stable history. Current control is checked by the application
rather than retained as a historical foreign key.

### Resolution receipts

| Table                                        | Purpose                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `interaction_resolutions`                    | One draft/applied ruling, narrative, actor, and idempotency key. |
| `interaction_resolution_effects`             | Ordered requested `set`/`adjust-number` operations and operands. |
| `interaction_resolution_effect_targets`      | Ordered world entity targets for each effect.                    |
| `interaction_resolution_effect_applications` | Ordered per-target changed/before/after scalar receipt.          |

Effects and applications use dedicated numeric/Boolean columns with shape
checks; there are no polymorphic scalar sets or unknown-value wrappers.
Applications require concrete before and after values because every active
mechanic has a logical default.

`interaction_resolutions` is unique per interaction. A partial unique index on
`(world_id, idempotency_key)` supports safe retry. Application rows are unique
by effect/entity, and explicit positions preserve execution order.

### Events

| Table          | Purpose                                                               |
| -------------- | --------------------------------------------------------------------- |
| `world_events` | Append-only identity cursor and related resource IDs for SSE reloads. |

Event IDs are generated `bigint` identities indexed by `(world_id, id)`. The
payload is not a state snapshot. Event types cover world/membership changes,
entity control/profile changes, character-field changes, interaction/action
lifecycle, and resolution application.

The schema checks event type and world scope of populated IDs but does not
prove every semantically required actor/resource combination. Events are an
append-only invalidation cursor, not a tamper-evident audit log.

## World scope and referential integrity

Composite foreign keys carry `world_id`, for example:

```text
(mechanic_id, world_id, value_kind)
    → world_mechanics(id, world_id, value_kind)
```

```text
(entity_id, world_id)
    → entities(id, world_id)
```

These constraints make cross-world references invalid even if application code
is bypassed. Application validation still provides clearer errors and enforces
rules that depend on current roles, readiness, or lifecycle.

## Revisions and timestamps

`set_updated_at()` updates mutable roots carrying `updated_at`. Explicit
non-negative revisions exist on worlds, world memberships, character-field
sets, entity profiles, state records, interactions, and action submissions.

Revisions advance only for meaningful mutations where implemented. A direct
SQL writer must not assume the timestamp trigger also increments a revision.
`worlds.table_revision` is separate from `worlds.revision` so controller changes
do not conflict with unrelated settings drafts.

## Immutability

The baseline adds triggers that:

- reject updates/deletes of an interaction once resolved or cancelled;
- reject updates/deletes of an applied resolution;
- reject updates/deletes of effects, targets, and applications under an applied
  resolution;
- reject updates/deletes of every `world_events` row.

Audience, responder, context, and action rows are not all protected as a
complete final audit tree. The applied receipt is the strong immutable record.
Corrections should be represented by a later domain action, not rewriting it.

These are DML protections while triggers remain installed, not tamper evidence
against a holder of the DDL-capable database credentials.

## Archive and delete behavior

Owned children generally cascade from their world or aggregate root. Historical
cross-references generally restrict deletion. Public APIs use archive/final
statuses and expose no hard-delete workflow.

Deleting a world directly would cascade authored data and can interact with
restricted history references. It is not a supported operational action.

## Adding a migration

After the baseline is released:

1. add the next zero-padded SQL file, beginning with `002_<feature>.sql`;
2. never edit a migration already recorded in a durable database;
3. keep each file valid inside one transaction;
4. preserve user-authored, world-scoped vocabulary—do not seed canonical
   mechanics, keys, entity classes, or field labels;
5. add relational constraints and `world_id`-carrying foreign keys;
6. consider existing rows, locks, and table rewrite cost;
7. run `./ci.sh backend` against an explicitly disposable database;
8. run `./ci.sh e2e` for clean-database and cross-layer behavior;
9. update this catalog and operational notes.

Migrations run before the listener starts, so long work extends deployment
health-check startup time.

## Inspection queries

List applied versions:

```sql
select version, applied_at
from schema_migrations
order by version;
```

Find state revisions in a world:

```sql
select entity.display_name, record.entity_id, record.revision, record.updated_at
from state_records record
join entities entity on entity.id = record.entity_id
where record.world_id = $1
order by lower(entity.display_name), record.entity_id;
```

Find unfinished interactions that prevent archive:

```sql
select id, title, status, revision, updated_at
from interactions
where world_id = $1
  and status in ('draft', 'open', 'adjudicating')
order by created_at, id;
```

Inspect recent event cursors:

```sql
select id, event_type, interaction_id, submission_id, resolution_id, created_at
from world_events
where world_id = $1
order by id desc
limit 100;
```

Use read-only accounts and transactions for production inspection. Do not
manually update receipt or event rows.

## Backup, restore, and cutover

The repository supplies no backup automation. Deployment owners should create
and test PostgreSQL-native backups before relying on the application for
durable history.

```sh
database_url="${DND_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$database_url" ]; then
  echo "DND_DATABASE_URL or DATABASE_URL is required" >&2
  exit 1
fi
pg_dump --format=custom --no-owner --file=dnd.dump "$database_url"
```

Restore into an empty access-controlled database using the same major
PostgreSQL toolchain, then verify migrations, `/api/health`, representative
worlds/state/receipts, revisions, and event cursors.

For the clean-break release, do not point the new binary at a non-current
database. Provision a new empty database. If old data must be preserved, export
and transform it with disposable out-of-tree tooling, verify the result, then
retire that tooling. The application intentionally contains no in-place path.

## Current operational gaps

- no automated backup, point-in-time recovery, or restore drill;
- no down migrations or application-level data repair framework;
- no separate least-privilege migration/runtime roles;
- no pool tuning through application environment variables;
- no database metrics or slow-query integration;
- no per-migration progress/duration logging;
- no cleanup tool for abandoned E2E databases after forced interruption.
