# System documentation

This directory is the canonical guide to Worldwright. It describes the system
implemented in this repository: a membership-scoped world library, a static
capacity/capability editor, generated entity sheets, player-controlled
characters with world-authored onboarding fields, and a multiplayer table
where facilitators create every problem ad hoc.

The application intentionally has no built-in entity classes, privileged
configured keys, seed vocabulary, or canonical JSON document model. Ruleset
authors supply the mechanical vocabulary through world configuration. The
server stores that vocabulary in relational, ruleset-scoped structures and
enforces its declared constraints. Generic configured-problem resources remain
available only as an engine compatibility surface; the product UI does not
expose them.

## Documentation map

| Document                        | Use it to understand                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md) | System boundaries, runtime topology, layers, data flow, and repository layout.                        |
| [Domain model](domain-model.md) | Worlds, mechanics, typed state, memberships, invitations, games, and interactions.                    |
| [Workflows](workflows.md)       | World creation, configuration, invitations, sheets, and the ad-hoc Play lifecycle.                    |
| [API reference](api.md)         | HTTP conventions, authentication adapter, payloads, errors, concurrency guards, SSE, and every route. |
| [Backend](backend.md)           | Go server construction, application packages, rules engine, persistence adapters, and transactions.   |
| [Frontend](frontend.md)         | React application structure, screens, state management, API integration, and styling.                 |
| [Database](database.md)         | PostgreSQL schema, migration model, table groups, constraints, receipts, and immutability.            |
| [Development](development.md)   | Prerequisites, local setup, managed services, change workflows, and troubleshooting.                  |
| [Testing](testing.md)           | Validation targets, unit/integration coverage, disposable database tests, and browser tests.          |
| [Operations](operations.md)     | Production build, configuration, deployment, health, logging, backups, and recovery.                  |
| [Security](security.md)         | Current trust boundary, authorization rules, visibility filtering, known gaps, and hardening path.    |

## System at a glance

```mermaid
flowchart LR
    Browser[React browser application]
    API[Go HTTP application]
    Rules[Pure Go rules engine]
    DB[(PostgreSQL)]
    Assets[Embedded Vite assets]

    Browser -->|JSON API and SSE| API
    API -->|validate and resolve| Rules
    API -->|pgx transactions| DB
    Assets -->|production SPA| API
```

The production artifact is one Go binary. It runs migrations, connects to
PostgreSQL, serves `/api/*`, and serves the embedded frontend for every other
route. During development, Vite serves the frontend on port `5173` and proxies
`/api` to the Go process on port `8080`.

## Primary product path and compatibility engine

The shared state-transition engine supports two paths with different product
status:

1. **Worldwright** is the primary path. A world author defines capacities and
   capabilities, generates sheets for stateful subjects, admits participants by
   invite link, and runs improvised interactions in the primary game. The state
   change and immutable resolution receipt are one transaction.
2. **Configured runtime** is a compatibility path in the API and rules engine.
   It can still resolve reusable definitions and authored outcomes, but it has
   no frontend route and new world workflows do not depend on it.

Both paths eventually create an ordered concrete transition plan and pass it
to the same pure Go transition engine. This keeps type checking, ownership,
effect ordering, default handling, and atomic failure semantics aligned.

## Core invariants

- Configuration is user-authored and scoped to exactly one ruleset.
- Durable identities are UUIDs at the HTTP and database boundaries.
- Owner schemas are capabilities/tags, not built-in classes. An entity may
  implement zero or more of them.
- A character is an ordinary game entity with one or more active player-control
  relationships, never an engine class or privileged configured key.
- Every active character field is authored by the world owner/editor and is
  required for every controlled character; there is no built-in field list.
- Character-field values are relational presentation data and are never loaded
  by the rules engine or exposed as mechanical state.
- Player admission to live play is derived from control and character-field
  completion rather than persisted as a second membership lifecycle.
- A state variable with declared owner schemas can be owned when those sets
  intersect; an empty owner-schema set is explicitly universal.
- Typed state is stored relationally; the database does not use a canonical
  JSON document as its source of truth.
- Numbers use exact PostgreSQL `numeric` and exact Go decimal arithmetic.
- Many-valued state has set semantics and rejects duplicates.
- Missing state is either logically `unknown` or materialized from an authored
  default.
- Conditions use three-valued logic: `met`, `unmet`, and `unknown`.
- Effects execute in authored order and observe earlier effects in the same
  transition.
- Failed transitions do not partially mutate state.
- State, bindings, memberships, games, interactions, and action submissions
  use revision guards where concurrent commands could overwrite one another.
- One ruleset entity can be assigned to at most one game at a time.
- A committed live resolution, its applied-effect receipt, and its game event
  are immutable audit history.

## Terminology

| Term               | Meaning                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| World              | Membership and product boundary over one backing ruleset and one primary game.                                |
| Capacity           | User-authored numeric score or pool that appears on generated sheets.                                         |
| Capability         | User-authored Boolean skill or numeric rating that appears on generated sheets.                              |
| World membership   | Link between a real user and a world with owner, editor, player, or spectator role.                           |
| Invite             | Revocable, expiring bearer link that grants a configured non-owner world role.                               |
| Ruleset            | Internal isolation boundary and container for a world's authored mechanical vocabulary.                     |
| Owner schema       | User-authored generic capability/tag retained by the underlying engine; never a built-in class.              |
| Entity             | Generic durable state owner represented to authors as a person or other world subject.                       |
| Character          | Product view of a game entity controlled by one or more active player memberships.                           |
| Character field    | Ordered, world-authored required text prompt shared by every controlled character.                           |
| Entity profile     | One entity's values for the world's active character fields, separate from typed engine state.               |
| State definition   | Normalized typed schema underlying a capacity or capability.                                                  |
| Logical state      | Stored overrides combined with authored missing/default semantics.                                            |
| Game               | Live-play boundary that maps an exclusive subset of one ruleset's entities.                                   |
| Interaction        | An ad-hoc facilitator prompt with its audience, responders, actions, ruling, and effects.                     |
| Resolution receipt | Immutable record of a committed ruling, requested effects, applied before/after values, and narrative.       |
| Configured problem | Legacy reusable engine aggregate retained for compatibility and not exposed by the Worldwright frontend.     |

## Sources of truth

The documentation explains behavior; these implementation areas are the final
authority when behavior and prose diverge:

- `internal/rules/` for domain validation and transition semantics.
- `internal/app/api_*.go` and `internal/app/handlers_*.go` for HTTP contracts,
  including character-field configuration, readiness, control, and profile
  authorization.
- `internal/migrations/*.sql` for persisted shape and database constraints.
- `web/frontend/src/api/types.ts` for the frontend's view of API payloads.
- `web/frontend/src/features/` for screen behavior.
- `ci.sh`, `run.sh`, `railway.toml`, and `railpack.json` for tooling and runtime
  operations.

When changing one of those areas, update the corresponding document in the
same change.
