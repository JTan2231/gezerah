# Scenario-test architecture

## Status and authority

The scenario-test system is implemented. It provides one frontend-driven
lifecycle spine, focused UI-boundary specifications, direct HTTP/PostgreSQL
contracts, lower-layer ownership, and harness-policy evidence. The executable
registry currently assigns all 141 business scenario IDs to one primary owner.

The companion documents answer different questions:

| Document                                    | Authority                   | Question                                                  |
| ------------------------------------------- | --------------------------- | --------------------------------------------------------- |
| [Business scenarios](business-scenarios.md) | Business intent             | What does a user attempt, and what outcome is correct?    |
| This document                               | Test-system structure       | How does the delivered suite execute and report evidence? |
| [Code mapping](code-mapping.md)             | Implementation traceability | Which executable region owns each scenario?               |

`test/src/scenario/catalog/scenarioTraces.ts` is the machine-checked ownership
source. Prose must not claim a coverage state that disagrees with that registry
or with generated `test/artifacts/scenario-coverage.json` evidence.

## Architectural position

A scenario ID describes business behavior, not a selector, route, SQL query, or
test title. Each ID has exactly one primary evidence tier. A broader execution
may exercise several IDs, but incidental execution is not ownership.

The suite keeps five evidence tiers:

| Tier              | Current count | Responsibility                                                                                                       |
| ----------------- | ------------: | -------------------------------------------------------------------------------------------------------------------- |
| `journey`         |            59 | Seven coherent lifecycle checkpoints and safe inline ribs performed through the rendered product.                    |
| `ui-boundary`     |            24 | Rendered flows that need focused setup, including navigation, recovery, responsive behavior, and lifecycle feedback. |
| `direct-contract` |            40 | Authorization, privacy, invalid references, races, idempotency, atomicity, and persistence facts.                    |
| `lower-layer`     |             6 | Exhaustive deterministic frontend/Go rule behavior.                                                                  |
| `harness-policy`  |            12 | Coverage ownership, isolation, redaction, diagnostic, and runtime policies.                                          |

Evidence tier is about the cheapest trustworthy proof, not the importance of a
scenario. Direct contracts and lower-layer cases are not weaker substitutes for
browser journeys when the business claim is inherently about rendered behavior.

## Current source layout

```text
test/
  src/
    scenario/
      architecture-tests/
      catalog/
        behaviorCatalog.ts
        scenarioTraces.ts
      core/
        behavior.ts
        validator.ts
      evidence/
        coverage.ts
        performance.ts
        redaction.ts
        suiteCoverage.ts
        timeline.ts
      playwright/
        scenarioReporter.ts
        scenarioTest.ts
        spineBehaviors.ts
      runtime/
        journey.ts
        mutationLedger.ts
        observationEpoch.ts
      verification.ts
      verify.ts
  specs/
    scenarios/
      lifecycle-spine.spec.ts
    ui-boundaries/
      authentication.ui.spec.ts
      authoring-control-and-live.ui.spec.ts
      entry-and-access.ui.spec.ts
      live-event-recovery.ui.spec.ts
      settings-and-mechanic-lifecycle.ui.spec.ts
    contracts/
      access-and-invites.contract.spec.ts
      authentication.contract.spec.ts
      authorization-matrices.contract.spec.ts
      concurrency-and-status-instance-matrices.contract.spec.ts
      direct-gap-closures.contract.spec.ts
      profile-and-readiness.contract.spec.ts
      resource-lifecycle.contract.spec.ts
      mechanic-graph-and-status-instances.contract.spec.ts
```

## Executable ownership

`scenarioTraces.ts` records, for every active ID:

- scenario version;
- primary evidence tier;
- execution ID, owner file, and a literal owner marker;
- optional lifecycle checkpoint;
- required named cases;
- optional changed dimension; and
- evidence availability.

`IDN-002` is retained as a retired ID and is not recycled. The verifier rejects
unknown, duplicate, missing, or multiply owned IDs, nonexistent owner files or
markers, missing required named cases, invalid checkpoint ownership, and an
unexplained `uncovered` record.

The registry deliberately does not contain documentation links, implementation
package references, review dates, blockers, or changed-path acknowledgements.
Those were features of the original target design, not the delivered schema.

## Lifecycle spine

`test/specs/scenarios/lifecycle-spine.spec.ts` is one serial, UI-authentic test
using isolated owner, editor, player, and spectator browser contexts. It reaches
seven separately reported checkpoints:

1. `JRN-001/playable-world`
2. `JRN-002/ready-player`
3. `JRN-003/improvised-round-resolved`
4. `JRN-004/status-lifecycle-preserved`
5. `JRN-005/spectator-public-play-safe`
6. `JRN-006/editor-authority-bounded`
7. `JRN-007/archived-history-readable`

The spine creates mutable prerequisites through visible product actions. Safe
negative ribs run beside the lifecycle when they preserve the current
milestone. Destructive races, broad matrices, controlled-time changes, and deep
persistence assertions remain in focused direct contracts.

The delivered spine is intentionally pragmatic: the specification contains
selectors and direct Playwright `expect` assertions, while reusable behavior
metadata and policy instrumentation live in `spineBehaviors.ts` and
`scenarioTest.ts`. It is not the selector-free journey DSL proposed in the
original design.

## Runtime components

### Behavior and journey primitives

`core/behavior.ts` defines behavior inputs, named outcomes, modules, and
implementations. `catalog/behaviorCatalog.ts` validates their composition.
`runtime/journey.ts` provides typed steps, checkpoints, output publication, and
the journey runner used by architecture tests.

Journey outputs become available only after their step succeeds. IDs are
unique, actors must be declared, and duplicate output publication is rejected.

### Observation and mutation evidence

`runtime/mutationLedger.ts` records named mutation epochs.
`runtime/observationEpoch.ts` shares observations within an epoch and rejects
stale or incorrectly scoped snapshots. Validators are registered through the
core validator model.

The current Playwright spine also uses ordinary page closures in some
validation callbacks. It does not implement branded resource-reference kinds
or a mutation-proof read-only validator capability.

### Playwright fixture and reporter

`playwright/scenarioTest.ts` extends Playwright with actor contexts, checkpoint,
behavior, and rib reporting; browser/runtime failure collection; coverage;
performance measurement; timeline evidence; and redaction. The custom reporter
writes `scenario-test-results.json`.

Screenshots are captured on failure. Trace and video are disabled in the
authoritative run and are retained only when `GEZERAH_E2E_DIAGNOSTICS=1` is set.
Default CI therefore does not promise trace or video links.

## Harness and isolation

The harness runs the production-built React assets, real Go application, and a
uniquely named disposable PostgreSQL database. Root `ci.sh e2e` builds the
frontend and binary once and passes the verified binary through
`GEZERAH_E2E_APP_BINARY`. `test/src/appServer.ts` builds only as a safe fallback for
a direct `test/` invocation.

Playwright uses one Desktop Chrome/Chromium project, two workers, zero retries,
and a 20-second per-test timeout. The lifecycle spine is serial. Other files may
overlap only when they own distinct generated aggregates; reads and assertions
remain actor-, world-, or exact-resource-scoped.

The lifecycle actors have isolated browser contexts and cookie jars. Direct
contracts use authenticated request contexts and may use narrowly scoped SQL
fixtures for facts that the product API cannot control, such as expiry or
session state. Those contracts do not claim UI-authentic setup.

## Evidence and coverage

The authoritative run can produce:

| Artifact                            | Purpose                                                  |
| ----------------------------------- | -------------------------------------------------------- |
| `app-server.log`                    | Disposable application stdout/stderr.                    |
| `playwright/`                       | Per-test results and failure screenshots.                |
| `report/`                           | Playwright HTML report.                                  |
| `scenario-test-results.json`        | Scenario-aware Playwright results.                       |
| `go-test-results.jsonl`             | Structured Go test events used by lower-layer ownership. |
| `scenario-architecture-results.xml` | Scenario architecture-test results.                      |
| `scenario-coverage.json`            | Final 141-row ownership/result inventory.                |
| `agent-facilitator-command-database-trace.json` | Safe World states at each Agent-facilitator command-contract boundary. |

`evidence/suiteCoverage.ts` combines browser, Go, and architecture-test results.
For each scenario it emits the primary tier, owner, execution/checkpoint ID,
named-case results, observed scopes, contracts/validators, mutation/snapshot
metadata when available, duration, and `passed` or `not-run`.

Root E2E sets `GEZERAH_E2E_REQUIRE_COMPLETE_COVERAGE=1`, so any required scenario
without passing evidence fails the run.

## Enforcement

`bun test src/scenario/architecture-tests` exercises catalog validity, runtime
ordering and output rules, ownership, evidence, global policies, and coverage
assembly. `bun run verify:scenarios` checks the business catalog against the
executable registry and owner markers. Both run before browser scenarios in
`./ci.sh e2e`.

The current architecture does not include a TypeScript dependency-boundary
scanner, compile-only wrong-resource fixtures, read-only HTTP/PostgreSQL adapter
fake tests, or a changed-path acknowledgement checker. Adding one of those is a
future change, not a current CI guarantee.

## Runtime budget

One successful `./ci.sh e2e` invocation must complete in less than 30 seconds on
the reference validation environment. The measurement includes detached
worktree preparation, frontend/backend validation, dependency installation,
production builds, scenario verification, database/application lifecycle,
all Playwright evidence lanes, reporting, and cleanup.

The command parallelizes independent validation and reuses production
artifacts. Increasing timeouts, adding retries, omitting registered coverage,
or reporting browser-only time does not satisfy the budget.

## Change workflow

When product behavior or coverage changes:

1. Update the business scenario without recycling stable IDs.
2. Update the primary owner and named cases in `scenarioTraces.ts`.
3. Add or change the executable evidence at the declared tier.
4. Update this architecture and the code map when structure or ownership moves.
5. Run `(cd test && bun test src/scenario/architecture-tests && bun run
verify:scenarios)` and the relevant focused target.
6. Run the authoritative repository validation before requesting review.

Examples and fixtures remain run-local and user-authored. The scenario system
must not introduce built-in entity classes, privileged configured keys,
canonical JSON aggregate storage, or seed vocabulary.
