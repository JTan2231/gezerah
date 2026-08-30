# Scenario-to-code traceability

## Status and sources of truth

The scenario suite is implemented. All 141 active business scenario IDs have an
executable primary owner, and the current verifier reports no uncovered IDs.

Traceability has three sources with distinct authority:

1. [business-scenarios.md](business-scenarios.md) defines the scenario IDs,
   named variants, priorities, and intended outcomes.
2. `test/src/scenario/catalog/scenarioTraces.ts` assigns executable ownership.
3. Generated `test/artifacts/scenario-coverage.json` records the result of the
   latest authoritative run.

This document is a human-oriented map. When its coverage status disagrees with
the registry or generated evidence, the executable sources win and this file
must be updated.

## Ownership model

Every active scenario has exactly one primary evidence tier:

| Tier              | Scenarios | Current owner region                            |
| ----------------- | --------: | ----------------------------------------------- |
| `journey`         |        59 | `test/specs/scenarios/lifecycle-spine.spec.ts`  |
| `ui-boundary`     |        24 | `test/specs/ui-boundaries/*.ui.spec.ts`         |
| `direct-contract` |        40 | `test/specs/contracts/*.contract.spec.ts`       |
| `lower-layer`     |         6 | Frontend or Go tests named by the registry      |
| `harness-policy`  |        12 | Scenario architecture tests and policy evidence |

`scenarioTraces.ts` records the scenario version, primary tier, execution ID,
owner file, literal owner marker, evidence availability, optional checkpoint,
required named cases, and optional changed dimension. `IDN-002` is retired and
cannot be reused.

The registry intentionally does not store package/documentation references,
review dates, blockers, or change acknowledgements. There is currently no
changed-path checker; ownership is checked against the complete catalog on each
authoritative run.

## Scenario family map

| Family                            | Product implementation landmarks                                                                           | Primary executable evidence                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `IDN` identity and entry          | `internal/app/auth.go`, `internal/app/server.go`, frontend authentication and routing                      | lifecycle spine; `authentication.ui.spec.ts`; `entry-and-access.ui.spec.ts`; `authentication.contract.spec.ts` |
| `WRL` world authoring             | `internal/app/worlds.go`, world library/settings frontend features                                         | lifecycle spine; settings UI boundaries; `resource-lifecycle.contract.spec.ts`                                 |
| `MEC` mechanics and graph         | `internal/app/mechanics.go`, `internal/rules/`, `MechanicsWorkspace.tsx`, frontend mechanic domain helpers | lifecycle spine; settings/mechanic UI boundary; rules/direct-gap contracts; frontend and Go lower layers       |
| `CHF` character fields            | `internal/app/handlers_world_character_fields.go`, profile handlers, roster/profile frontend features      | lifecycle spine; authoring/control UI boundary; profile/readiness and direct-gap contracts                     |
| `RST` roster and onboarding       | `internal/app/entities.go`, profile handlers, `support.go`, `RosterWorkspace.tsx`, `WorldPlay.tsx`         | lifecycle spine; authoring/control UI boundary; profile/readiness and authorization contracts                  |
| `INV` invitations and membership roles | invite/member handlers in `internal/app/worlds.go`, `MembersWorkspace.tsx`, `InvitePage.tsx`          | lifecycle spine; entry/access UI boundary; access/invite contracts                                             |
| `PLY` live problems and actions   | `internal/app/interactions_core.go`, `WorldPlay.tsx`                                                       | lifecycle spine; authoring/live and recovery UI boundaries; concurrency/lifecycle contracts                    |
| `CON` Consequences and Status instances | `interactions_resolution.go`, `consequence_runtime.go`, `internal/rules/`, frontend Consequence helpers | lifecycle spine; concurrency-and-Status-instance, mechanic-graph-and-Status-instance, and direct-gap contracts; frontend/Go lower layers |
| `AUT` privacy and authorization   | authentication/world/profile/interaction authorization loaders and filtered DTOs                           | lifecycle spine; authorization matrices; access/invite and profile/readiness contracts                         |
| `CCY` concurrency and idempotency | revision checks, transaction locks, idempotency records, immutable Resolution receipts                     | UI stale-screen coverage; concurrency-and-Status-instance, direct-gap, and resource-lifecycle contracts        |
| `LFC` archive lifecycle           | world, mechanic, entity, interaction archive/finalization handlers and UI feedback                         | lifecycle spine; settings/mechanic UI boundary; resource-lifecycle and direct-gap contracts                    |
| `NAV` navigation and resilience   | frontend route parsing, API client, SSE hook, server SPA/static behavior                                   | all five UI-boundary files; server and frontend lower layers                                                   |
| `GLO` global invariants           | scenario runtime, reporter, coverage assembly, redaction, migrations, CI                                   | architecture tests, harness policy evidence, and relevant product contracts                                    |

Canonical product explanations live in `docs/`. This map points to executable
regions rather than maintaining fragile heading-fragment links.

## Lifecycle-spine ownership

The serial lifecycle spine owns seven checkpoints:

| Checkpoint                            | Business milestone                                                          |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `JRN-001/playable-world`              | Owner authenticates and authors a playable world.                           |
| `JRN-002/ready-player`                | Invitation, control, and onboarding reach the documented play-ready state. |
| `JRN-003/improvised-round-resolved`   | A presented Problem receives an Action and commits a Resolution.             |
| `JRN-004/status-lifecycle-preserved`  | A Status instance is applied, explained, and removed.                       |
| `JRN-005/spectator-public-play-safe` | A spectator follows the public Play projection without private data.        |
| `JRN-006/editor-authority-bounded`    | An editor facilitates without acquiring owner-only authority.               |
| `JRN-007/archived-history-readable`   | Final work is archived and retained history remains readable.               |

Safe inline ribs include `MEC-V01`, `INV-005/revoke-used-invite`, and
`NAV-V04`. Consequence preview behavior is registered as
`consequence.preview`. Exact execution markers are maintained in
`scenarioTraces.ts`; prose labels here are descriptive, not verifier inputs.

## Browser and PostgreSQL-backed evidence

The Playwright inventory is fourteen files containing fourteen tests: one
serial lifecycle spine, five UI-boundary tests, and eight direct contracts.
They run in one Desktop Chrome/Chromium project with two workers, no retries,
and a 20-second per-test timeout.

### Lifecycle

- `test/specs/scenarios/lifecycle-spine.spec.ts`

### UI boundaries

- `authentication.ui.spec.ts`
- `authoring-control-and-live.ui.spec.ts`
- `entry-and-access.ui.spec.ts`
- `live-event-recovery.ui.spec.ts`
- `settings-and-mechanic-lifecycle.ui.spec.ts`

### Direct contracts

- `access-and-invites.contract.spec.ts`
- `authentication.contract.spec.ts`
- `authorization-matrices.contract.spec.ts`
- `concurrency-and-status-instance-matrices.contract.spec.ts`
- `direct-gap-closures.contract.spec.ts`
- `profile-and-readiness.contract.spec.ts`
- `resource-lifecycle.contract.spec.ts`
- `mechanic-graph-and-status-instances.contract.spec.ts`

The lifecycle spine performs its mutable prerequisites through the rendered
frontend. UI-boundary tests may use direct setup to isolate the rendered
behavior under test. Direct contracts use normal HTTP commands plus narrowly
scoped PostgreSQL observations or controlled-time fixtures where necessary;
they do not claim frontend-authentic setup.

## Lower-layer evidence

### Frontend

| Test                                             | Responsibility                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `web/frontend/src/api/client.test.ts`            | Cookie requests, CSRF injection, authentication teardown, and session-safe replay.     |
| `web/frontend/src/worldRoutes.test.ts`           | World/invite routing, canonicalization, and unknown-route handling.                    |
| `web/frontend/src/domain/decimal.test.ts`        | Exact-decimal validation, canonicalization, bounds, and sign handling.                 |
| `web/frontend/src/domain/mechanics.test.ts`      | Mechanic mode/source changes and expression preservation/reset.                        |
| `web/frontend/src/domain/display.test.ts`        | API vocabulary and relative-time display.                                              |
| `web/frontend/src/domain/password.test.ts`       | Password minimum-length policy.                                                        |
| `web/frontend/src/features/*View.test.tsx`       | Backend-free semantic rendering fixtures for application and feature presentation.     |
| `web/frontend/src/features/EntityViews.test.tsx` | Entity detail, sheet, profile, loading/error, and controller-modal rendering fixtures. |

Static component-rendering tests are present. There is no DOM-emulated React
interaction suite or automated axe audit; Playwright owns browser interaction,
focus, routing, API, and multi-identity behavior.

### Go application and rules

Application evidence includes strict JSON/error behavior, static and SPA
serving, authentication/session policy, audience filtering and invalidation,
SSE delivery, mechanic graph mapping, Inline statuses, Status-instance Applications, and Consequence-runtime
errors. The main regions are:

- `internal/app/auth_test.go`
- `internal/app/json_test.go`
- `internal/app/server_test.go`
- `internal/app/mechanic_graph_test.go`
- `internal/app/inline_statuses_test.go`
- `internal/app/interactions_audience_test.go`
- `internal/app/interactions_events_test.go`
- `internal/app/consequence_runtime_test.go`
- `internal/rules/*_test.go`

### Migrations

The migration contract covers the complete ordered chain:

- `001_world_baseline.sql`
- `002_mechanic_graph_status_instances.sql`
- `003_interaction_audience_invalidations.sql`
- `004_password_auth.sql`
- `005_terra.sql`

Migration tests validate the prefix/history contract, normalized Mechanic-graph/Status-instance
storage, audience invalidation, password authentication schema, invite-token
digests, World facilitator-source constraints, provenance, and immutable
Resolution-receipt constraints.

## Runtime and generated evidence

Root `./ci.sh e2e` validates frontend and backend code, installs test
dependencies, builds the frontend and Go binary once, runs scenario
architecture verification, and then starts the browser suite with the verified
binary. `test/src/appServer.ts` builds only during a direct test-project run
when `DND_E2E_APP_BINARY` is absent.

Default CI captures screenshots on failure. Trace and video are disabled unless
`DND_E2E_DIAGNOSTICS=1` is explicitly enabled.

The scenario evidence set is:

| Artifact                            | Producer/consumer                                         |
| ----------------------------------- | --------------------------------------------------------- |
| `scenario-test-results.json`        | Custom Playwright scenario reporter.                      |
| `go-test-results.jsonl`             | Structured Go test run consumed by coverage assembly.     |
| `scenario-architecture-results.xml` | Architecture tests consumed by coverage assembly.         |
| `scenario-coverage.json`            | Final 141-record coverage inventory.                      |
| `app-server.log`                    | Disposable application diagnostics.                       |
| `playwright/` and `report/`         | Playwright results, failure screenshots, and HTML report. |

The generated coverage record includes owner and execution IDs, evidence tier,
named cases, checkpoint, observed surfaces, behavior/contract/validator IDs
when reported, mutation/snapshot metadata when reported, duration, and result.
It does not currently include implementation/documentation mappings, a last
reviewed change, or full-command timing.

## CI and freshness checks

`bun run verify:scenarios` checks:

- every business scenario ID is registered or explicitly retired;
- every active ID has one executable owner;
- owner files and literal markers exist;
- required named cases are present;
- tier and checkpoint assignments are valid; and
- no unexplained coverage gap remains.

Scenario architecture tests cover catalog validity, ownership, runtime rules,
evidence assembly, coverage, and global policies. Root E2E requires complete
runtime coverage and fails if any of the 141 records is not passed.

There is no time-based freshness expiry or changed-path acknowledgement gate.
Review is semantic: a product change must update the business catalog,
executable owner, and this map when responsibility moves.

## Change workflow

When behavior changes:

1. Update the business scenario or add a new stable ID.
2. Choose the cheapest trustworthy primary evidence tier.
3. Add or update the owner in `scenarioTraces.ts`, including named cases.
4. Change the executable test or lower-layer evidence.
5. Update this family map if implementation responsibility moved.
6. Run `(cd test && bun test src/scenario/architecture-tests && bun run
verify:scenarios)` during development.
7. Run the relevant focused target and the repository's authoritative
   validation before handoff.

Do not turn transport operations into business scenarios, claim incidental
execution as coverage, hide an uncovered ID, recycle a retired ID, or introduce
seed vocabulary and privileged configured keys through test fixtures.
