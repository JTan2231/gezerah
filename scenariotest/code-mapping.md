# Scenario-to-code traceability plan

Status: one-shot implementation blueprint and current-code baseline. The target
suite is one UI-only lifecycle spine plus focused evidence tiers; none of the
planned scenario-runner paths described below exists yet.

This document explains how the business scenarios in
[Business scenarios](business-scenarios.md) map to the implementation that exists
today and how that mapping should remain reviewable once the runner described in
[Scenario-test architecture](architecture.md) is implemented. It complements the
canonical system documentation in [`docs/`](../docs/README.md); it does not
replace the API, domain, database, or security documentation.

## 1. Purpose and authority

The mapping has three jobs:

1. let a reader start with a scenario ID and find every region that can make the
   scenario pass or fail;
2. make missing validation visible instead of treating an untagged test as
   evidence by implication; and
3. make a product change update its scenario, behavior driver, contracts,
   implementation references, and tests as one reviewable unit.

Authority is deliberately split:

- `business-scenarios.md` owns user intent, actors, expected outcomes, and
  scenario priority;
- `architecture.md` owns the behavior catalog, journey interpreter, driver,
  observer, contract, and evidence design;
- this document owns traceability from those IDs to present code and test
  evidence;
- `docs/` remains the canonical prose description of the running system;
- `internal/rules/`, `internal/app/`, `internal/migrations/`, and
  `web/frontend/src/` remain the implementation authority when prose and code
  disagree.

A mapping is not proof. It says where a behavior is implemented and where its
evidence should be produced. Only a passing contract run supplies proof for a
particular build.

The target execution shape is deliberately singular: one Playwright test owns
one generated world and carries owner, editor, player, and spectator browser
contexts from identity creation through final archive. The seven `JRN-*` IDs
are separately reported checkpoints within that execution, not seven tests
that repeat setup and not ordered tests that share hidden residue. Focused edge
tests reuse only their own isolated fixtures and never claim lifecycle-spine
authenticity.

## 2. Traceability model

### 2.1 Stable scenario families

The scenario catalog uses these prefixes. The prefix is permanent even if a
scenario is renamed or moved within the prose document.

| Prefix | Product concern                           | Primary implementation boundary                                        |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| `IDN`  | Identity and application entry            | Development identity adapter, root choice, profile selection           |
| `WRL`  | World authoring and libraries             | World aggregate, Build/Play libraries, settings                        |
| `MEC`  | Mechanics and derived graph               | Mechanic editor, typed graph, state evaluation                         |
| `CHF`  | Character-field schema                    | Ordered field configuration and profile schema revision                |
| `RST`  | Roster, control, sheets, onboarding       | Entities, controller sets, profiles, readiness                         |
| `INV`  | Invitations, membership, roles            | Bearer invites, redemption, membership views                           |
| `PLY`  | Live problem lifecycle and multiplayer    | Interactions, actions, event invalidation                              |
| `CON`  | Consequences and state/status transitions | Preview, resolve, receipts, effective state                            |
| `AUT`  | Privacy and authorization                 | Identity, membership, role/readiness checks, filtering                 |
| `CCY`  | Concurrency, conflicts, idempotency       | Revisions, locks, replay and conflict behavior                         |
| `LFC`  | Resource lifecycle and archive behavior   | Archive, revoke, cancel, immutable final history                       |
| `NAV`  | Navigation, resilience, accessibility     | History routing, shared UI, errors, responsive behavior                |
| `JRN`  | Composite canonical journey               | Journey specification composed from exact behavior IDs                 |
| `GLO`  | Cross-cutting invariant                   | Runtime, isolation, privacy, atomicity, evidence, accessibility policy |

### 2.2 Mapping resolution

Every entry must declare one of three resolutions:

- **exact**: applies to one catalog ID such as `MEC-003`;
- **family**: applies to every scenario in a family and is written as `MEC-*`;
- **cross-cutting**: applies to an explicit set of IDs from different families.

Family mappings are an index, not a substitute for exact mappings. An exact
canonical behavior is traceable only when its user-facing driver,
expected-outcome contract, and relevant observation surfaces are named. A
variant is traceable when its declared evidence scope names either a real
frontend outcome contract or a direct HTTP/rules/application contract. Crafted
foreign IDs, malformed payload matrices, exact forbidden codes, idempotency
conflicts, and exhaustive graph/effect shapes must not be disguised as browser
journeys. Conversely, a shared authorization helper should usually have one
family or cross-cutting entry rather than being repeated as if it were unique
code.

### 2.3 Primary evidence tier and coverage state

Every exact scenario ID declares exactly one **primary evidence tier**. Other
tiers may support the same claim, but encountering an ID incidentally does not
earn coverage and one passing assertion cannot silently stand in for a named
case matrix.

| Primary tier      | Authority and permitted setup                                                                                                                                      | Planned executable home                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `journey`         | One registered action or checkpoint in the lifecycle spine. Every durable prerequisite is produced through the rendered UI; HTTP/PostgreSQL access is read-only.   | `test/specs/scenarios/lifecycle-spine.spec.ts`               |
| `ui-boundary`     | A focused rendered-route, feedback, recovery, responsive, or keyboard contract. Normal product APIs may arrange an isolated fixture, so it cannot claim a journey. | `test/specs/ui-boundaries/*.spec.ts`                         |
| `direct-contract` | A fast HTTP/application/PostgreSQL contract for exact filtering, authorization, revisions, races, idempotency, rollback, or persistence.                           | `test/specs/contracts/*.contract.spec.ts`                    |
| `lower-layer`     | A frontend unit, Go application/rules, or migration test for exhaustive pure or structural matrices.                                                               | existing `*.test.ts` and Go `*_test.go` regions              |
| `harness-policy`  | An automatic catalog, boundary, mutation-ledger, runtime-health, isolation, evidence, or performance rule applied by the harness rather than acted out by a user.  | `test/src/scenario/architecture-tests/**` and runtime policy |

Use these coverage states independently of the primary tier:

| State                     | Meaning                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `journey-covered`         | The registered spine action/checkpoint passed with UI-only mutation and all required observations.                           |
| `ui-boundary-covered`     | The focused rendered behavior passed against its isolated fixture; it is not a lifecycle-journey claim.                      |
| `direct-contract-covered` | The registered direct contract and every named case passed.                                                                  |
| `lower-layer-covered`     | The assigned frontend/Go/migration contract passed.                                                                          |
| `harness-policy-covered`  | The automatic policy ran and passed for every execution to which it applies.                                                 |
| `ui-partial`              | Existing Playwright code performs a meaningful part through the UI, but setup, checks, or another required step bypasses it. |
| `observer-covered`        | Existing read-only HTTP or persistence evidence proves a fact but not the complete assigned execution.                       |
| `uncovered`               | No current evidence directly exercises the declared outcome.                                                                 |
| `not-applicable`          | The tier cannot meaningfully validate the scenario; a reason is required.                                                    |

At the current baseline, no scenario is `journey-covered` or
`ui-boundary-covered`: there is no behavior catalog, lifecycle-spine spec, or
validation engine, and the current Playwright specifications use direct HTTP
setup or verification. Existing direct, lower-layer, observer, and partial UI
evidence remains valuable and is indexed below; it must not be promoted by
relabeling.

### 2.4 Reference grammar

Mappings should be precise without depending on line numbers:

- TypeScript/Go: `path#exported-or-stable-symbol`;
- route: `METHOD /api/... -> path#handler`;
- SQL: `migration-file#table-or-trigger-name`;
- test: `path#exact test title`;
- documentation: `path#heading`.

Use a file-only reference only when the entire file is genuinely the unit, as
with a migration or stylesheet. Line numbers are useful in a review link but
are too volatile for durable traceability metadata. Never name a path or
symbol that does not exist; proposed artifacts must be labeled `planned`.

### 2.5 Required metadata

The implemented traceability registry should contain one record per exact
scenario ID with:

```ts
interface ScenarioTrace {
  scenarioId: string;
  primaryTier:
    | "journey"
    | "ui-boundary"
    | "direct-contract"
    | "lower-layer"
    | "harness-policy";
  executionId: string;
  checkpointId?: string;
  behaviorOutcomes?: Array<{
    behaviorId: string;
    behaviorVersion: number;
    outcome: string;
    contractId: string;
  }>;
  namedCases?: string[];
  directContractIds?: string[];
  implementation: {
    frontend: CodeRef[];
    backend: CodeRef[];
    rules: CodeRef[];
    persistence: CodeRef[];
  };
  evidence: {
    journeySpecs: CodeRef[];
    directContractSpecs: CodeRef[];
    observerChecks: CodeRef[];
    lowerLayerTests: CodeRef[];
  };
  documentation: CodeRef[];
  coverage: CoverageState;
  durationMs?: number;
  blockedBy?: string;
  gaps: string[];
  reviewedOn: string;
}
```

This is a shape requirement, not a commitment to a duplicate hand-written
TypeScript database. The preferred implementation is:

- scenario metadata is declared beside the journey or behavior definition;
- behavior and contract registration supplies their IDs automatically;
- implementation and documentation references live in a small traceability
  record keyed by the scenario ID;
- a generated Markdown/JSON report joins those sources and fails on missing,
  duplicate, or unknown IDs.

The catalog in `business-scenarios.md` remains the human-readable authority.
The machine-readable ID list must be checked against it, not silently become a
second product specification.

### 2.6 Planned architecture locations

The following paths are **planned**, not present. They mirror the source layout
in `architecture.md` so traceability does not invent a second test framework.

| Planned region                                                                                       | Traceability responsibility                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `test/specs/scenarios/lifecycle-spine.spec.ts`                                                       | the one UI-only world lifecycle execution and seven separately reported `JRN-*` checkpoints |
| `test/specs/ui-boundaries/*.spec.ts`                                                                 | focused route, validation, recovery, responsive, and keyboard behavior                      |
| `test/specs/contracts/*.contract.spec.ts`                                                            | table-driven HTTP/PostgreSQL authorization, concurrency, atomicity, and lifecycle contracts |
| `test/src/scenario/core/behavior.ts`, `contract.ts`, `journey.ts`                                    | branded behavior/outcome/contract/journey IDs and scenario references                       |
| `test/src/scenario/catalog/index.ts`                                                                 | composition root; completeness, uniqueness, primary-tier, and named-case checks             |
| `test/src/scenario/journeys/lifecycleSpine.ts`                                                       | ordered spine composition; no selectors, raw assertions, or mutation shortcuts              |
| `test/src/scenario/behaviors/**/{definition,driver,contracts,validators}.ts`                         | vertical user behavior, frontend performance, outcome facts, and exact scenario IDs         |
| `test/src/scenario/fixtures/{scenarioTest,uiBoundaryTest,contractTest}.ts`                           | isolated capabilities for the three executable tiers                                        |
| `test/src/scenario/fixtures/apiFixtureFactory.ts`                                                    | normal-product-API fixture arrangement for non-journey tiers only                           |
| `test/src/scenario/runtime/{interpreter,validationEngine,spineContext,checkpoint,mutationLedger}.ts` | causal execution, named checkpoints, mutation epochs, and boundary enforcement              |
| `test/src/scenario/adapters/playwright/**`                                                           | accessible browser gestures and browser observation                                         |
| `test/src/scenario/adapters/http/readOnlyClient.ts`, `postgres/readOnlyDatabase.ts`, `logs/**`       | registered read-only journey probes; direct-contract fixtures receive separate capabilities |
| `test/src/scenario/evidence/{timeline,redaction,attachments,coverage,performance}.ts`                | evidence, per-ID result/duration, total-suite timing, and generated traceability inventory  |
| `test/src/scenario/architecture-tests/**`                                                            | catalog, dependency boundary, probe capability, mapping, and runtime-budget checks          |

Exact mapping metadata should be colocated with behavior modules when a
scenario has a frontend behavior and with the registered contract when it is a
direct-only variant. `evidence/coverage.ts` should aggregate and render it; it
should not own a separate hand-maintained copy.

The repository has no behavior catalog today, so there are no implemented
behavior IDs to map in this baseline. Names such as `world.create` in
`architecture.md` remain API-design examples until implementation registers
them. This document therefore does not invent a parallel behavior namespace.
The complete implementation must register every stable ID/version, outcome,
driver, contract, primary tier, checkpoint or executable contract, named case,
and business ID in one generated inventory; there is no partially authoritative
intermediate catalog.

## 3. Current repository landmarks

These are shared regions used across many scenario families.

| Layer                 | Current region                                                                                                                                                  | Responsibility                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Browser composition   | `web/frontend/src/App.tsx#App`                                                                                                                                  | Area selection, identity gate, invite/world/library dispatch, History API navigation        |
| Browser routing       | `web/frontend/src/worldRoutes.ts#readLocation`, `#playWorldURL`, `#buildWorldURL`, `#inviteURL`                                                                 | Recognized frontend paths and canonical URL construction                                    |
| Browser transport     | `web/frontend/src/api/client.ts#api`, `#worldPath`, `#worldInvitePath`                                                                                          | JSON calls, error mapping, development identity header                                      |
| Browser DTOs          | `web/frontend/src/api/types.ts`                                                                                                                                 | Frontend view of world, mechanic, roster, profile, interaction, receipt, and state payloads |
| Browser loading       | `web/frontend/src/hooks/useCollection.ts#useCollection`, `useResource.ts#useResource`                                                                           | Abortable collection/resource reads and reloads                                             |
| Browser drafts        | `web/frontend/src/hooks/useDraft.ts#useDraft`, `#useDirtyGuard`, `#confirmDiscardDraft`                                                                         | Local edit drafts and navigation/unload protection                                          |
| Browser events        | `web/frontend/src/hooks/useWorldEvents.ts#useWorldEvents`                                                                                                       | Authorized SSE cursor, reconnect, invalidation callbacks                                    |
| Shared UI             | `web/frontend/src/components/StudioUI.tsx`                                                                                                                      | Fields, modal, error/loading/empty states, roles, avatars                                   |
| Shared styling        | `web/frontend/src/styles/app.css`, `tokens.css`                                                                                                                 | Responsive layouts, focus/skip-link/modal/play presentation, design tokens                  |
| API registration      | `internal/app/routes.go#Server.registerResourceRoutes`                                                                                                          | Method-aware resource route catalog                                                         |
| API DTOs              | `internal/app/api.go`                                                                                                                                           | Strict requests and response shapes                                                         |
| API cross-cutting     | `internal/app/support.go#handleAppError`, `#requireKnownActor`, `#requireActiveWorldMember`, `#requireWorldEditor`, `#requireWorldOwner`, `#requireFacilitator` | Errors, development identity, membership, and role enforcement                              |
| API server            | `internal/app/server.go#NewServerWithStaticFS`, `#Server.Routes`                                                                                                | API/static dispatch, middleware, SPA fallback, health                                       |
| Pure rules            | `internal/rules/`                                                                                                                                               | Exact decimals, graph validation/evaluation, scalar/status runtime transitions              |
| Persistence           | `internal/migrations/001_worldwright.sql`, `002_rules_graph_statuses.sql`                                                                                       | Normalized world-scoped schema, constraints, revisions, immutable history                   |
| Browser harness       | `test/playwright.config.ts`, `test/src/appServer.ts#startAppServer`, `test/src/database.ts#createDisposableDatabase`, `test/src/globalSetup.ts`                 | Production frontend/binary, disposable PostgreSQL, browser lifecycle and artifacts          |
| Validation entrypoint | `ci.sh`, `test/src/e2e.ts`                                                                                                                                      | Frontend/backend/E2E gates and Chromium discovery                                           |
| Local runtime         | `run.sh`                                                                                                                                                        | Managed Go/Vite processes and logs for interactive diagnosis                                |

## 4. Family-to-code baseline

The following is a current-code inventory. `Scenario scope` uses family IDs
until the exact-scenario overlay in section 5. Test coverage descriptions refer
to tests that exist now, not to the planned authoritative journey suite.

### IDN — identity and entry

| Layer             | Current paths, symbols, or routes                                                                                                                                                                           | Scenario scope                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Frontend          | `App.tsx#App`; `features/HomeChoice.tsx#HomeChoice`; `features/IdentityGate.tsx#IdentityGate`; `api/client.ts#readSelectedUserId`, `#selectUserId`; `api/types.ts#User`                                     | `IDN-*`, with home choice also shared by `NAV-*` |
| Backend           | `GET /api/users -> users.go#Server.handleListUsers`; `POST /api/users -> users.go#Server.handleCreateUser`; `support.go#actorID`, `#requireKnownActor`                                                      | `IDN-*`, identity failures in `AUT-*`            |
| Persistence       | `001_worldwright.sql#users`; selected identity itself is browser `localStorage` key `dnd.selected-user`                                                                                                     | `IDN-*`                                          |
| Existing evidence | `test/specs/configuration.spec.ts#an author creates a world whose entity sheets stem from capacities and capabilities` creates a local profile through UI; other E2E setup commonly creates users over HTTP | `ui-partial`                                     |
| Docs              | `docs/frontend.md#Routing and identity`; `docs/api.md#Identity`; `docs/security.md#Authentication and account lifecycle`                                                                                    | `IDN-*`, `AUT-*`                                 |

Current gaps: UI selection of an existing profile, profile switching, deep-link
return after identity selection, invalid stored identity recovery, and explicit
storage isolation are not authoritative journeys. Production authentication is
out of current product scope and must not be implied by these scenarios.

### WRL — world authoring and libraries

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                         | Scenario scope                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Frontend          | `features/BuildLibrary.tsx#BuildLibrary`, `#CreateWorldModal`; `features/PlayLibrary.tsx#PlayLibrary`; `features/BuildWorkspace.tsx#BuildWorkspace`; `features/PlayWorkspace.tsx#PlayWorkspace`; `features/SettingsWorkspace.tsx#SettingsWorkspace`; `api/types.ts#World` | `WRL-*`, archive portions shared by `LFC-*`, access boundary by `AUT-*` |
| Backend           | `GET/POST /api/worlds -> worlds.go#Server.handleListWorlds`, `#Server.handleCreateWorld`; `GET/PATCH /api/worlds/{world_id} -> #Server.handleGetWorld`, `#Server.handleUpdateWorld`; `POST .../archive -> #Server.handleArchiveWorld`; `#loadWorldResponse`               | `WRL-*`, `LFC-*`                                                        |
| Persistence       | `001_worldwright.sql#worlds`, `#world_memberships`, `#world_events`; `002_rules_graph_statuses.sql#world_rule_sets` via its world-insert trigger                                                                                                                          | `WRL-*`                                                                 |
| Existing evidence | `configuration.spec.ts` creates a world through UI and checks library privacy over HTTP; `play.spec.ts#worlds stay private until an invite link is redeemed` covers world filtering over HTTP                                                                             | `ui-partial`                                                            |
| Docs              | `docs/workflows.md#Create and configure a world`; `docs/architecture.md#Creating a world`; `docs/api.md#Worlds`; `docs/database.md#Worlds, users, and membership`                                                                                                         | `WRL-*`                                                                 |

Current gaps: user-visible validation failures, settings edits, a return to each
library after changes, empty/archived library states, and persistence after a
fresh browser session do not have UI-only journeys.

### MEC — mechanics and the derived graph

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                                                                                     | Scenario scope                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Frontend          | `features/MechanicsWorkspace.tsx#MechanicsWorkspace`, `#MechanicEditor`, `#ExpressionEditor`, `#PreviewValue`; `domain/mechanics.ts#changeMechanicMode`; `features/EntityDetail.tsx#EntityDetail`, `#EntitySheet`; `api/types.ts#WorldMechanic`, `#MechanicExpression`, `#WorldMechanicCollection`, `#StateRecordResponse`                                                                            | `MEC-*`; evaluated display also supports `RST-*` and `CON-*`                              |
| Backend           | mechanic CRUD routes in `routes.go`; `mechanics.go#Server.saveWorldMechanic`, `#validateWorldMechanicRequest`, `#validateWorldRuleConfiguration`, `#hasActiveMechanicDependents`, `#advanceRulesRevision`, `#loadWorldMechanics`; `rules_revision.go`; `rules_graph_api.go`; `effective_state.go#loadEvaluatedStateResponse`                                                                          | `MEC-*`, revision failures in `CCY-*`, archive in `LFC-*`                                 |
| Rules             | `definitions.go#ValidateMechanicDefinition`; `expressions.go#InferExpressionType`, `#ValidateMechanicGraph`, `#CompileMechanicGraph`; `evaluation.go#EvaluateEntityState`, `#EvaluateEntityStateWithGraph`; `state.go#MaterializeLogicalState`, `#NormalizeStateRecord`; `decimal.go#ParseDecimal`                                                                                                    | `MEC-*`                                                                                   |
| Persistence       | `001_worldwright.sql#world_mechanics`, `#state_records`, `#state_values`; `002_rules_graph_statuses.sql#world_rule_sets`, `#world_mechanic_expression_nodes`                                                                                                                                                                                                                                          | `MEC-*`                                                                                   |
| Existing evidence | `configuration.spec.ts` authors input capacity/capability through UI; `state-graph.spec.ts#typed rules publish atomically and statuses change effective state with receipts` covers derived graph and stale/invalid publication through HTTP; frontend mechanic-domain tests and `internal/rules/expression_evaluation_test.go`, `values_state_test.go`, `mechanics_graph_test.go` cover lower layers | `ui-partial` for inputs; `observer-covered`/`lower-layer-covered` for derived/error paths |
| Docs              | `docs/domain-model.md#Capacities, capabilities, and the mechanic graph`; `docs/frontend.md#Static configuration`; `docs/backend.md#Mechanic publication`; `docs/api.md#Mechanic`; `docs/database.md#Rules, mechanics, entities, and state`                                                                                                                                                            | `MEC-*`                                                                                   |

Current gaps: no UI-only journey authors and consumes a derived expression;
cycle/type/bounds errors are not validated as user-visible field feedback; and
archive dependency ordering is not exercised through Builder.

### CHF — character-field schema

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                             | Scenario scope                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Frontend          | `features/CharacterFieldsWorkspace.tsx#CharacterFieldsWorkspace`, `#CharacterFieldsEditor`; `features/EntityProfilePanel.tsx`; `features/WorldPlay.tsx#CharacterOnboarding`; `api/types.ts#WorldCharacterFieldSet`, `#WorldCharacterField`, `#EntityProfile`  | `CHF-*`, readiness effects in `RST-*`, visibility in `AUT-*` |
| Backend           | `GET/PUT /api/worlds/{world_id}/character-fields -> handlers_world_character_fields.go#Server.handleGetWorldCharacterFields`, `#Server.handlePutWorldCharacterFields`; validators/loaders in that file; profile routes in `handlers_world_entity_profiles.go` | `CHF-*`, `CCY-*`                                             |
| Persistence       | `001_worldwright.sql#world_character_field_sets`, `#world_character_fields`, `#entity_profiles`, `#entity_profile_field_values`                                                                                                                               | `CHF-*`                                                      |
| Existing evidence | `configuration.spec.ts` publishes one field through UI; `play.spec.ts#a problem is improvised at the table, answered, and resolved with a state receipt` uses UI for partial/complete profile values but API for schema setup and conflict checks             | `ui-partial`                                                 |
| Docs              | `docs/workflows.md#Assign and author characters`; `docs/domain-model.md#Entities, character fields, and profiles`; `docs/api.md#Character fields and profiles`; `docs/frontend.md#Static configuration`                                                       | `CHF-*`                                                      |

Current gaps: reordering/removal, visibility selection, schema publication
conflict, change-during-open-problem feedback, and readiness regression after a
new field lack complete UI journeys.

### RST — roster, control, sheets, and onboarding

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                                          | Scenario scope                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Frontend          | `features/RosterWorkspace.tsx#RosterWorkspace`; `features/RosterModals.tsx#NewEntityModal`, `#ManageControllersModal`; `features/EntityDetail.tsx#EntityDetail`; `features/EntityProfilePanel.tsx#EntityProfilePanel`; `features/WorldPlay.tsx#CharacterOnboarding`; `api/types.ts#WorldEntity`, `#PlayStatus`, `#CharacterStatus`, `#StateRecordResponse` | `RST-*`, state evaluation in `MEC-*`, permissions in `AUT-*` |
| Backend           | entity, state, and controller routes in `routes.go` -> `entities.go` handlers; `handlers_world_entity_profiles.go`; `support.go#membershipPlayStatus`, `#entityCharacterStatus`; `effective_state.go`                                                                                                                                                      | `RST-*`, `CHF-*`, `CCY-*`, `AUT-*`                           |
| Persistence       | `001_worldwright.sql#entities`, `#state_records`, `#state_values`, `#world_membership_entity_controls`, `#entity_profiles`, `#entity_profile_field_values`; `002_rules_graph_statuses.sql#entity_status_sets`                                                                                                                                              | `RST-*`                                                      |
| Existing evidence | `configuration.spec.ts` creates an entity and edits its generated sheet through UI; the main `play.spec.ts` uses separate UI contexts for controller assignment and onboarding after substantial HTTP setup                                                                                                                                                | `ui-partial`                                                 |
| Docs              | `docs/workflows.md#Prepare and edit entity sheets`; `#Assign and author characters`; `docs/frontend.md#Play surface`; `docs/backend.md#Base and evaluated state`, `#Character profiles`, `#Controller sets`                                                                                                                                                | `RST-*`                                                      |

Current gaps: full UI setup from membership through ready play, zero-field
readiness as visible behavior, multi-controller behavior, controller removal,
direct-state conflicts, player read-only enforcement in the rendered sheet,
and entity archive are not authoritative journeys.

### INV — invitations, membership, and roles

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                         | Scenario scope                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Frontend          | `features/PeopleWorkspace.tsx#PeopleWorkspace`; `features/InvitePage.tsx#InvitePage`; `features/BuildLibrary.tsx#BuildLibrary`; `features/PlayLibrary.tsx#PlayLibrary`; `worldRoutes.ts#inviteURL`; `api/types.ts#WorldInvite`, `#WorldInvitePreview`, `#WorldMember`, `#WorldRole`                                                       | `INV-*`, role enforcement in `AUT-*`, revocation in `LFC-*` |
| Backend           | member/invite routes in `routes.go`; `worlds.go#Server.handleListWorldMembers`, `#Server.handleListWorldInvites`, `#Server.handleCreateWorldInvite`, `#Server.handleRevokeWorldInvite`, `#Server.handlePreviewWorldInvite`, `#Server.handleRedeemWorldInvite`, `#loadWorldInvitePreview`, `#newWorldInviteToken`, `#hashWorldInviteToken` | `INV-*`, `AUT-*`                                            |
| Persistence       | `001_worldwright.sql#world_memberships`, `#world_invites`, `#world_invite_redemptions`                                                                                                                                                                                                                                                    | `INV-*`                                                     |
| Existing evidence | `play.spec.ts#worlds stay private until an invite link is redeemed` covers filtering, invite creation/preview/redemption, role denial, and revocation through HTTP rather than UI                                                                                                                                                         | `observer-covered`                                          |
| Docs              | `docs/workflows.md#Join a world`; `docs/frontend.md#People and invite links`; `docs/api.md#Invite links`; `docs/security.md#Invite bearer scope`                                                                                                                                                                                          | `INV-*`                                                     |

Current gaps: link creation and one-time display, area-correct preview/redemption,
repeat redemption, expired links, role-preserving redemption, and post-revoke
membership continuity have no authoritative UI journeys.

### PLY — live problem lifecycle and multiplayer

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                                                                                                                                                     | Scenario scope                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Frontend          | `features/WorldPlay.tsx#WorldPlay`, `#IdleTable`, `#NewProblemModal`, `#LiveInteraction`, `#OpenProblem`; `hooks/useWorldEvents.ts#useWorldEvents`; `api/types.ts#Interaction`, `#InteractionAction`                                                                                                                                                                                                                                                                  | `PLY-*`, adjudication handoff to `CON-*`, readiness in `RST-*`, filtering in `AUT-*` |
| Backend           | interaction/action/event routes in `routes.go`; `interactions_core.go#Server.handleListInteractions`, `#Server.handleCreateInteraction`, `#Server.handlePutInteraction`, `#Server.handlePresentInteraction`, `#Server.handleBeginInteractionAdjudication`, `#Server.handleCancelInteraction`, `#Server.handleCreateInteractionAction`, `#Server.handleWithdrawInteractionAction`, `#Server.handleWorldEvents`; response/visibility/readiness helpers in the same file | `PLY-*`, `AUT-*`, `CCY-*`                                                            |
| Persistence       | `001_worldwright.sql#interactions`, `#interaction_audience_members`, `#interaction_eligible_responders`, `#interaction_context_entities`, `#interaction_action_submissions`, `#world_events`                                                                                                                                                                                                                                                                          | `PLY-*`                                                                              |
| Existing evidence | the main `play.spec.ts` uses distinct facilitator/player contexts to present, receive, answer, adjudicate, and receive resolved history live; setup is API-assisted and withdraw/cancel paths are not the central UI flow                                                                                                                                                                                                                                             | `ui-partial`                                                                         |
| Docs              | `docs/workflows.md#Run an ad-hoc problem`; `docs/domain-model.md#Interactions and actions`; `docs/frontend.md#Play surface`; `docs/backend.md#SSE implementation`; `docs/api.md#Interactions and actions`, `#World events (SSE)`                                                                                                                                                                                                                                      | `PLY-*`                                                                              |

Current gaps: fully UI-authored prerequisites, action withdrawal and
replacement, cancel, responder rejection, reconnect from cursor, and
non-facilitator adjudication visibility need explicit journeys/contracts. The
current UI composes locally and presents directly to the whole ready table
audience; persisted-draft/no-audience behavior belongs to direct contracts.

### CON — Consequences and transitions

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                                                                          | Scenario scope                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Frontend          | `features/WorldPlay.tsx#RulingEditor`, `#EffectBuilder`, `#StatusModifierEditor`, `#RulingPreview`, `#HistoryCard`; `domain/consequences.ts#effectToAPI`; `features/EntityDetail.tsx#EntitySheet`; DTOs `ConcreteEffect`, `ConcreteAppliedEffect`, `InteractionResolutionResult`, `ActiveStatus`, `EffectiveChange` in `api/types.ts`                                                      | `CON-*`, rules publication in `MEC-*`, concurrency in `CCY-*`                              |
| Backend           | preview/resolve routes in `routes.go`; `interactions_resolution.go#Server.handlePreviewInteractionResolution`, `#Server.handleResolveInteraction`, `#Server.previewInteractionResolution`, `#Server.resolveInteraction`, `#validateAdjudicationRequest`, `#loadInteractionResolutionResponse`, `#resolutionRequestMatches`; `resolution_runtime.go`; `effective_state.go#effectiveChanges` | `CON-*`, `CCY-*`, `AUT-*`                                                                  |
| Rules             | `runtime_transitions.go#ApplyRuntimeTransition`, `#ValidateRuntimeTransitionPlan`, `#ValidateRuntimeStatusSnapshot`; `statuses.go#ValidateStatusSnapshot`, `#ValidateActiveStatuses`; `evaluation.go#EvaluateEntityState`; legacy scalar path `effects.go#ApplyTransition`                                                                                                                 | `CON-*`                                                                                    |
| Persistence       | receipt tables in `001_worldwright.sql`; status/effective-change extensions in `002_rules_graph_statuses.sql#interaction_resolution_status_effect_modifiers`, `#entity_status_instances`, `#entity_status_instance_modifiers`, `#interaction_resolution_status_applications`, `#interaction_resolution_effective_changes`; receipt/status immutability triggers                            | `CON-*`, `GLO-008`                                                                         |
| Existing evidence | the main `play.spec.ts` previews/resolves one scalar effect through UI and observes live history/state; `state-graph.spec.ts` covers inline status application/removal, propagation, provenance, and receipts over HTTP; frontend consequence tests and Go rule/status tests cover mapping and semantics                                                                                   | `ui-partial` for scalar flow; `observer-covered`/`lower-layer-covered` for status variants |
| Docs              | `docs/domain-model.md#Consequences and transition semantics`, `#Resolution receipts and events`; `docs/architecture.md#Live interaction resolution`; `docs/backend.md#Rules execution`, `#Live resolution`; `docs/api.md#Action and Consequence`                                                                                                                                           | `CON-*`                                                                                    |

Current gaps: summary-only outcomes, ordered multi-effect UI execution, status
authoring/removal through the UI, preview non-persistence, late-effect rollback,
same-name instance distinction, and evidence expansion are not UI-authoritative.

### AUT — privacy and authorization

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                                                                                                     | Scenario scope                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Frontend          | `BuildWorkspace.tsx#BuildWorkspace` explicit non-editor boundary; role/readiness branches in `WorldPlay.tsx#WorldPlay`; filtered display in `EntityProfilePanel.tsx`; `api/client.ts#api` identity header                                                                                                                                                                                                             | `AUT-*`; frontend state is an affordance, never the authorization boundary |
| Backend           | `support.go` identity/member/editor/owner/facilitator helpers; `entities.go#requireEntityStateReadAccess`; `handlers_world_entity_profiles.go#loadWorldEntityProfileAccess`, `#loadEntityProfileResponse`; `interactions_core.go#requirePlayReadyWorldMember`, `#requireInteractionMemberReadiness`, `#requireInteractionVisibility`, `#loadVisibleWorldEvents`; world-scoped validation throughout resource handlers | `AUT-*`, `GLO-003`, `GLO-006`                                              |
| Persistence       | composite `world_id` foreign keys and membership/status checks throughout both migrations; audience/responder/control tables; private columns on interactions/resolutions and profile field visibility                                                                                                                                                                                                                | `AUT-*`                                                                    |
| Existing evidence | `configuration.spec.ts` checks outsider list/direct-read denial over HTTP; both `play.spec.ts` tests cover privacy/role/readiness/filtering substantially through direct requests, with some visible onboarding/adjudication checks                                                                                                                                                                                   | `observer-covered` with `ui-partial` projections                           |
| Docs              | `docs/security.md#Enforced authorization behavior`, `#Data boundaries`, `#Private data`; `docs/backend.md#Authorization and filtering`; `docs/api.md#Identity`                                                                                                                                                                                                                                                        | `AUT-*`                                                                    |

Current gaps: every role/outcome pair is not tagged to an exact scenario, event
payload filtering is not observed in a reconnecting browser journey, and the
suite lacks a systematic assertion that sensitive JSON properties are absent.
Authorization contracts should prefer direct read-only probes; UI absence
alone is insufficient.

### CCY — concurrency, conflicts, and idempotency

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                                                 | Scenario scope                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Frontend          | revision-bearing DTOs in `api/types.ts`; expected revisions sent by `SettingsWorkspace`, `MechanicsWorkspace`, `CharacterFieldsWorkspace`, `RosterModals`, `EntityProfilePanel`, `EntityDetail`, and `WorldPlay`; `api/client.ts#ApiError`; collection/resource reload hooks                                                                      | `CCY-*`, failure presentation in `NAV-*`        |
| Backend           | `support.go#revisionConflict`; `rules_revision.go#requireRulesRevision`, `#lockRulesRevision`, `#rulesRevisionConflict`; revision checks in world/entity/controller/field/profile/interaction/action handlers; `interactions_resolution.go#resolutionRequestMatches`, `#loadAppliedResolutionResult`; transaction and stable-lock code in resolve | `CCY-*`                                         |
| Rules             | transition functions return new snapshots without mutating caller-owned input; they do not own database revisions or idempotency                                                                                                                                                                                                                  | atomic portion of `CCY-*`, especially `GLO-004` |
| Persistence       | revision columns on worlds, memberships, mechanics root, fields, profiles, state/status, interactions, and actions; `interaction_resolutions_idempotency_unique`; constraints and final-history triggers                                                                                                                                          | `CCY-*`                                         |
| Existing evidence | stale graph publication in `state-graph.spec.ts`; stale profile/field/state/interaction cases and some conflict behavior in `play.spec.ts`; Go tests cover atomic in-memory failure. Existing checks are mainly direct HTTP                                                                                                                       | `observer-covered`/`lower-layer-covered`        |
| Docs              | `docs/architecture.md#Consistency and concurrency`; `docs/api.md#Optimistic concurrency`; `docs/backend.md#Transaction patterns`; `docs/database.md#Revisions and timestamps`                                                                                                                                                                     | `CCY-*`                                         |

Current gaps: visible conflict recovery in each editor, equivalent resolve
replay, mismatched idempotency reuse, and two genuinely competing browser
commands are not comprehensive. A validator must distinguish “one commit” from
two UI messages that merely look alike.

### LFC — lifecycle and archive behavior

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                    | Scenario scope                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Frontend          | archive commands in `MechanicsWorkspace.tsx` and `SettingsWorkspace.tsx`; invite revocation in `PeopleWorkspace.tsx`; problem cancellation in `WorldPlay.tsx`; `RosterWorkspace.tsx` filters archived entities but currently exposes no entity-archive command                       | `LFC-*`, invite-specific lifecycle in `INV-*`, problem cancellation in `PLY-*` |
| Backend           | archive handlers in `worlds.go`, `mechanics.go`, `entities.go`; `mechanics.go#hasActiveMechanicDependents`, `#hasActiveStatusMechanicDependency`; `worlds.go#Server.handleRevokeWorldInvite`; `interactions_core.go#Server.handleCancelInteraction`; mutation guards across handlers | `LFC-*`                                                                        |
| Persistence       | `status`/`archived`/`revoked_at`/final lifecycle columns in baseline tables; history-protecting triggers in both migrations; foreign-key restrictions retain referenced data                                                                                                         | `LFC-*`, `GLO-008`                                                             |
| Existing evidence | revocation is covered over HTTP in `play.spec.ts`; mechanic archive dependencies and final receipt immutability have lower-layer/application/migration coverage; no current browser spec owns a full archive workflow                                                                | `observer-covered`/`lower-layer-covered`                                       |
| Docs              | `docs/workflows.md#Archive resources`; `docs/database.md#Archive and delete behavior`, `#Immutability`; `docs/domain-model.md#Revisions and lifecycle rules`                                                                                                                         | `LFC-*`                                                                        |

Current gaps: all positive archive paths, dependency-safe ordering, active-status
blocking, unfinished-problem blocking, archived read-only history, and mutation
denial need end-to-end contracts.

### NAV — navigation, resilience, and accessibility

| Layer             | Current paths, symbols, or routes                                                                                                                                                                                                                                                                                               | Scenario scope                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Frontend          | `App.tsx#App`; `worldRoutes.ts`; `features/NotFoundPage.tsx#NotFoundPage`; `components/StudioUI.tsx#Modal`, `#ErrorMessage`, `#LoadingState`; `hooks/useDraft.ts`; `hooks/useCollection.ts`; `hooks/useResource.ts`; `hooks/useWorldEvents.ts`; `styles/app.css` focus, skip-link, modal, responsive and reduced-motion regions | `NAV-*`, `GLO-002`, `GLO-010`                 |
| Backend/runtime   | `server.go#Server.handleStatic`, `#Server.handleHealth`, recovery/request-log middleware; `web/static.go`; Vite proxy/build configuration; `cmd/dnd/main.go`                                                                                                                                                                    | `NAV-*`, runtime part of `GLO-002`            |
| Persistence       | none for ordinary route/accessibility behavior; `world_events` cursor supports reconnect scenarios                                                                                                                                                                                                                              | `NAV-007`, `NAV-V02` only                     |
| Existing evidence | `web/frontend/src/worldRoutes.test.ts`; `internal/app/server_test.go#TestStaticRoutesServeAssetsAndSPAFallback`; semantic locators in Playwright; current suite has only Desktop Chrome and no automated accessibility audit                                                                                                    | `lower-layer-covered` with narrow UI coverage |
| Docs              | `docs/frontend.md#Routing and identity`, `#Accessibility and responsive behavior`, `#Client state and errors`; `docs/architecture.md#Runtime topology`; `docs/testing.md#Current gaps`                                                                                                                                          | `NAV-*`                                       |

Current gaps: keyboard-complete journeys, focus restoration/trapping, narrow
viewport projects, automated accessibility checks, stale-response races,
transient command/read failures, and controlled SSE interruption/reconnect.

## 5. Exact-scenario overlay

This overlay is the initial review index for every ID in the business catalog.
“Primary anchors” intentionally names the smallest distinctive region; shared
regions from section 3 and the family tables still apply. The baseline column
does not predict the planned suite—it records evidence present in the repository
before the scenario engine is added. For readability, a basename such as
`WorldPlay#RulingEditor` in this section is shorthand for the full path already
listed in its family table; machine records must use the full reference grammar
from section 2.4.

Section 6 variants in the business plan are coverage obligations, not
automatically frontend journeys. When a user can make the attempt through a
real control, the variant should be an outcome of that frontend behavior with
read-only observers. When the obligation needs malformed transport, a crafted
cross-world identifier, an exact idempotency conflict, or an exhaustive shape
matrix, the mapped authority is a direct contract or focused lower-layer test.
Such a test may arrange and mutate its own isolated fixture, but it cannot
mutate or claim coverage as part of a canonical `JRN-*` execution.

The exact generated registry is authoritative for primary-tier ownership. The
intended family allocation below keeps browser work proportional to distinct UI
risk while retaining exact protocol and rules evidence:

| Family | Lifecycle-spine ownership                                                                      | Focused primary ownership outside the spine                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDN`  | neutral entry, identity creation/selection, and invite destination continuation                | identity/route recovery in `ui-boundary`; parsing in `lower-layer`                                                                                                    |
| `WRL`  | create, reopen, and edit the shared world                                                      | invalid form feedback in `ui-boundary`; atomicity/revision facts in `direct-contract`                                                                                 |
| `MEC`  | representative numeric, Boolean, derived, materialized, and propagated rules                   | distinct editor feedback in `ui-boundary`; type/reference/cycle/storage matrices in `direct-contract` and `lower-layer`                                               |
| `CHF`  | the mixed-visibility schema needed by the shared world                                         | zero/reorder/readiness UX in `ui-boundary`; revision/atomicity in `direct-contract`                                                                                   |
| `RST`  | create/setup, assign, partial profile, readiness, and visible authority states                 | shared/removal recovery in `ui-boundary`; forged/reference and role denials in `direct-contract`                                                                      |
| `INV`  | owner creates editor/player/spectator links and each actor redeems through the UI              | closed-link feedback in `ui-boundary`; expiry, replay, owner preservation, and token storage in `direct-contract`                                                     |
| `PLY`  | present, receive, respond, adjudicate, resolve, and converge in persistent actor contexts      | withdraw/cancel/reconnect feedback in `ui-boundary`; audience/lifecycle matrices in `direct-contract`                                                                 |
| `CON`  | preview, scalar resolution, status apply/coexist/remove, derived change, and retained evidence | invalid visible preview in `ui-boundary`; exact rollback/target/idempotency matrices in `direct-contract` and `lower-layer`                                           |
| `AUT`  | positive role projections and naturally visible denials for the four spine actors              | serialized absence, outsider, role-command, event, and cross-world matrices in `direct-contract`                                                                      |
| `CCY`  | no race is manufactured merely to lengthen the spine                                           | representative stale-screen recovery in `ui-boundary`; all revision, replay, key-conflict, and competing-write facts in `direct-contract`                             |
| `LFC`  | unfinished-work rejection, owner archive, mutation stop, and retained history                  | dependency/entity affordances in `ui-boundary` where present; archive/reference matrices in `direct-contract`                                                         |
| `NAV`  | ordinary route changes needed by the lifecycle                                                 | deep/unknown routes, drafts, obsolete responses, reconnection, failures, narrow viewport, and keyboard behavior in `ui-boundary`; pure parsing/hooks in `lower-layer` |
| `GLO`  | applied automatically at relevant actions and checkpoints                                      | all `GLO-001..012` are registered in `harness-policy`, with direct/lower observations where the policy requires them                                                  |

A scenario may receive supporting evidence from several columns. Its primary
tier remains singular, and every grouped row such as invalid/revoked/expired or
unknown/foreign/archived must expose named case keys in the coverage report.

### Identity and worlds

| IDs and intent                                                | Primary current anchors                                                                                                               | Baseline and principal gap                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `IDN-001` neutral area choice                                 | `HomeChoice#HomeChoice`; `App#App`; `worldRoutes#readLocation`                                                                        | `ui-partial`: `configuration.spec.ts` chooses Build; Play and data-free/no-request behavior are uncontracted       |
| `IDN-002` select or create local profile                      | `IdentityGate#IdentityGate`; `users.go` list/create handlers; `api/client.ts#selectUserId`                                            | `ui-partial`: UI creation exists; selecting an existing identity and switching are gaps                            |
| `IDN-003` resume a requested destination                      | `App#App`; invite/world branches in `worldRoutes#readLocation`                                                                        | `lower-layer-covered` for path parsing; no deep-link + identity UI journey                                         |
| `WRL-001` create an owned world                               | `BuildLibrary#CreateWorldModal`; `worlds.go#handleCreateWorld`; SQL `worlds`/owner membership/rule-root creation                      | `ui-partial`: creation is UI-driven in `configuration.spec.ts`, deeper checks use HTTP                             |
| `WRL-002` reopen an admitted world in the appropriate library | `BuildLibrary`; `PlayLibrary`; `worlds.go#handleListWorlds`; `test/specs/scenarios/lifecycle-spine.spec.ts#invites.create-and-redeem` | `journey-covered`: `JRN-002` admits each role and reopens the persisted world from the actor's appropriate library |
| `WRL-003` edit world details                                  | `SettingsWorkspace`; `worlds.go#handleUpdateWorld`                                                                                    | `uncovered` at browser level                                                                                       |
| `WRL-V01` reject invalid details without creation             | world creation/settings forms; `support.go#validateRequired`; world handler validation and SQL checks                                 | `uncovered` as an atomic visible outcome                                                                           |

### Mechanics and character schema

| IDs and intent                                                                 | Primary current anchors                                                                                                                                                                                   | Baseline and principal gap                                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEC-001`, `MEC-002` publish numeric/Boolean inputs                            | `MechanicsWorkspace#MechanicEditor`; `mechanics.go#saveWorldMechanic`; `rules.ValidateMechanicDefinition`                                                                                                 | `ui-partial`: numeric capacity and Boolean capability are created through UI in `configuration.spec.ts`                                                              |
| `MEC-003`, `MEC-004` publish numeric and Boolean/conditional derived mechanics | `MechanicsWorkspace#ExpressionEditor`; `rules.InferExpressionType`; `rules.ValidateMechanicGraph`                                                                                                         | `observer-covered` through numeric graph API plus lower-layer expression tests; UI authoring is a gap, especially Boolean/conditional                                |
| `MEC-005` materialize generated sheets                                         | `EntityDetail#EntitySheet`; `effective_state.go#loadEvaluatedStateResponse`; `rules.EvaluateEntityState`                                                                                                  | `ui-partial`: input sheet shown/edited in `configuration.spec.ts`; complete derived/effective display lacks a UI journey                                             |
| `MEC-006` edit and propagate a rules revision                                  | mechanic PUT route; `mechanics.go#advanceRulesRevision`; `world_events`; `useWorldEvents` rules callback                                                                                                  | `observer-covered` for API revision/evaluation; UI save and live convergence are not joined                                                                          |
| `MEC-V01` invalid bounds/step                                                  | `rules.ValidateMechanicDefinition`, `ValidateStateValue`; mechanic form field errors; `test/specs/scenarios/lifecycle-spine.spec.ts#MEC-V01/invalid-bounds`                                               | `journey-covered`: the inline spine rib shows the field error and proves the invalid mechanic was not created before correcting the same form                        |
| `MEC-V02` type/arity-invalid graph                                             | `rules.InferExpressionType`; `mechanics.go#validateWorldRuleConfiguration`                                                                                                                                | `observer-covered` in `state-graph.spec.ts` for a type error and lower-layer graph tests                                                                             |
| `MEC-V03` unknown/cross-world/archived references                              | `rules.ValidateMechanicGraph`; `mechanics.go#validateExpressionReferenceIDs`; world-scoped loaders/FKs                                                                                                    | `lower-layer-covered`; exact frontend/API variants are incomplete                                                                                                    |
| `MEC-V04` self/multi-node cycles with path                                     | `rules.ValidateMechanicGraph`; `expression_evaluation_test.go#TestMechanicGraphRejectsSelfAndMultiNodeCyclesWithPaths`; `mechanics_graph_test.go#TestValidateWorldRuleConfigurationReturnsCycleFields`    | `observer-covered` for self-cycle API plus lower-layer multi-node/path coverage; user-visible field path is a gap                                                    |
| `MEC-V05` deny derived storage/effect mutation                                 | `entities.go#handlePutWorldEntityState`; `rules.ValidateStateRecord`; `rules.ValidateRuntimeTransitionPlan`                                                                                               | `lower-layer-covered`; HTTP/UI denial matrix is incomplete                                                                                                           |
| `CHF-001` publish zero fields                                                  | `CharacterFieldsWorkspace`; character-field PUT handler; SQL field-set root                                                                                                                               | `uncovered` as a visible publish/readiness behavior                                                                                                                  |
| `CHF-002` ordered mixed-visibility fields                                      | `CharacterFieldsEditor`; field/profile DTOs and handlers                                                                                                                                                  | `ui-partial`: one field is UI-authored; mixed visibility is API-prepared in `play.spec.ts`                                                                           |
| `CHF-003` revise/reorder without value misassociation                          | durable field IDs in field/profile tables; complete-set handler comparison                                                                                                                                | `uncovered` end to end                                                                                                                                               |
| `CHF-004` add a requirement and re-evaluate readiness                          | field PUT handler; `support.go#membershipPlayStatus`; `WorldPlay#CharacterOnboarding`                                                                                                                     | `ui-partial`: API changes the schema and UI returns to setup in `play.spec.ts`                                                                                       |
| `CHF-V01` block schema change during unfinished play                           | `handlePutWorldCharacterFields`; active-interaction query/guard; `test/specs/contracts/profile-and-readiness.contract.spec.ts#contract: readiness and profile projections preserve authority and privacy` | `direct-contract-covered`: an active interaction produces `character_fields_in_use`, and the exact prior field set remains durable; this is not rendered-UI evidence |

### Roster and invitations

| IDs and intent                                                          | Primary current anchors                                                                                                                        | Baseline and principal gap                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RST-001` create entity with generated sheet                            | `RosterModals#NewEntityModal`; `entities.go#handleCreateWorldEntity`; entity/state/status-root tables                                          | `ui-partial` in `configuration.spec.ts`                                                                                                                       |
| `RST-002` save direct setup input state                                 | `EntityDetail#EntitySheet`; `entities.go#handlePutWorldEntityState`                                                                            | `ui-partial` for input values; stale/derived/read-only variants bypass UI                                                                                     |
| `RST-003` assign controllers                                            | `RosterModals#ManageControllersModal`; `entities.go#handleReplaceWorldEntityControllers`                                                       | `ui-partial` in the multi-context `play.spec.ts`                                                                                                              |
| `RST-004` save partial profile                                          | `EntityProfilePanel#EntityProfileEditor`; profile PUT handler                                                                                  | `ui-partial` in `play.spec.ts`                                                                                                                                |
| `RST-005` complete onboarding and enter live play                       | `WorldPlay#CharacterOnboarding`; `support.go#membershipPlayStatus`                                                                             | `ui-partial`: visible transition exists after API-authored prerequisites                                                                                      |
| `RST-006` shared/multiple control                                       | controller join table and complete-set handler                                                                                                 | `uncovered` in a browser journey                                                                                                                              |
| `RST-007` remove control and revoke authority                           | controller replacement; profile/action authorization helpers                                                                                   | `uncovered` end to end                                                                                                                                        |
| `RST-V01` unassigned player waits                                       | `membershipPlayStatus`; `WorldPlay` waiting branch                                                                                             | `ui-partial`: visible waiting state exists in `play.spec.ts`                                                                                                  |
| `RST-V02` incomplete controller stays out of live resources             | onboarding branch; `requirePlayReadyWorldMember`; events/interactions routes                                                                   | `ui-partial` plus direct `403` checks in `play.spec.ts`                                                                                                       |
| `RST-V03` incomplete/archived entities excluded from live references    | interaction request/presentation validation; `entityCharacterStatus`                                                                           | `uncovered` as a complete user outcome                                                                                                                        |
| `RST-V04` deny player sheet mutation                                    | `requireEntityStateReadAccess` and state PUT role check; disabled Play sheet                                                                   | `observer-covered`/visible affordance only; no joined contract                                                                                                |
| `RST-V05` revoke profile/action authority after control removal         | profile access loader; action acting-entity checks                                                                                             | `uncovered` end to end                                                                                                                                        |
| `INV-001` create role-bearing invite                                    | `PeopleWorkspace`; `worlds.go#handleCreateWorldInvite`                                                                                         | `observer-covered` over HTTP only                                                                                                                             |
| `INV-002` one-time token secrecy                                        | `PeopleWorkspace` created-invite state; `worldInviteResponse.join_path`; hashed token storage                                                  | `lower-layer-covered` by implementation shape; no UI/probe contract                                                                                           |
| `INV-003` preview/redeem into matching area                             | `InvitePage`; `worldRoutes#inviteURL`; invite preview/redeem handlers                                                                          | `observer-covered` over HTTP; area-specific UI is a gap                                                                                                       |
| `INV-004` idempotent repeat redemption                                  | `handleRedeemWorldInvite`; redemptions/membership uniqueness                                                                                   | `uncovered` at scenario level                                                                                                                                 |
| `INV-005` revoke without ejecting member                                | `PeopleWorkspace`; revoke handler; membership separate from invite; `test/specs/scenarios/lifecycle-spine.spec.ts#INV-005/revoke-spare-invite` | `journey-covered`: the inline `JRN-002` rib revokes the link through the UI, proves later use is closed, and preserves the admitted actor's usable membership |
| `INV-V01` invalid/revoked/expired link closes without membership change | invite preview/redeem handlers; token hash/expiry/revocation queries                                                                           | `observer-covered` for revoked; invalid/expired and no-change proof are gaps                                                                                  |
| `INV-V02` redemption cannot replace owner authority                     | redeem handler membership role rules; membership uniqueness                                                                                    | `uncovered` at scenario level                                                                                                                                 |

### Live play and Consequences

| IDs and intent                                                   | Primary current anchors                                                                                                                                                 | Baseline and principal gap                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLY-001` compose an ad-hoc problem locally                      | `WorldPlay#NewProblemModal`; title/prompt/context/responder form state                                                                                                  | `ui-partial` in `play.spec.ts` after API setup; the browser form does not persist a draft                                                                     |
| `PLY-002` present to the table audience and eligible responders  | `NewProblemModal#submit` with `present: true`; `handleCreateInteraction`; interaction audience/context/responder tables                                                 | `ui-partial` in `play.spec.ts` after API setup; the audience is the ready table rather than a selectable UI field                                             |
| `PLY-003` receive the open problem live                          | `useWorldEvents`; `handleWorldEvents`; `world_events`                                                                                                                   | `ui-partial`: second browser observes the prompt without an explicit reload                                                                                   |
| `PLY-004` offer attributed/unattributed action                   | `WorldPlay#OpenProblem`; `handleCreateInteractionAction`                                                                                                                | `ui-partial` for attributed action; unattributed variant is a gap                                                                                             |
| `PLY-005` withdraw and replace action                            | Open-problem action controls; `handleWithdrawInteractionAction`                                                                                                         | `uncovered`                                                                                                                                                   |
| `PLY-006` private adjudication and focal action                  | `WorldPlay#LiveInteraction`, `#RulingEditor`; adjudicate handler; selected-action persistence                                                                           | `ui-partial` for facilitator; privacy is checked separately rather than as one contract                                                                       |
| `PLY-007` cancel unfinished problem                              | WorldPlay cancellation control; `handleCancelInteraction`                                                                                                               | `uncovered`                                                                                                                                                   |
| `PLY-008` publish resolved history live                          | `WorldPlay#HistoryCard`; event reload; interaction resolution response                                                                                                  | `ui-partial` in two browser contexts                                                                                                                          |
| `PLY-V01` reject persisted-draft presentation without audience   | `validateStoredInteractionForPresentation`; presentation route                                                                                                          | `uncovered` direct-contract-only obligation; there is intentionally no matching current frontend gesture                                                      |
| `PLY-V02` exclude non-ready responders/context                   | interaction request/presentation validators; readiness helpers                                                                                                          | `uncovered` as exact scenario                                                                                                                                 |
| `PLY-V03` one current action per eligible player                 | action handler and submission uniqueness/lifecycle rules                                                                                                                | `uncovered` as exact scenario                                                                                                                                 |
| `PLY-V04` reject late submit/withdraw                            | action handlers and interaction locks/status checks; `test/specs/contracts/concurrency-and-status-matrices.contract.spec.ts#late-submit/late-withdraw`                  | `direct-contract-covered`: both late commands return lifecycle/revision conflicts and exact durable action state is unchanged; no rendered refresh is claimed |
| `PLY-V05` hide non-visible/adjudicating problems                 | `requireInteractionVisibility`; filtered list/load SQL                                                                                                                  | `ui-partial`/`observer-covered`; requires explicit non-facilitator contract                                                                                   |
| `CON-001` preview a Consequence                                  | `WorldPlay#RulingEditor`; preview handler; `test/specs/scenarios/lifecycle-spine.spec.ts#ruling.preview`                                                                | `journey-covered`: the lifecycle spine renders the preview before resolution                                                                                  |
| `CON-002` resolve summary-only                                   | resolve handler with empty effects; `test/specs/contracts/concurrency-and-status-matrices.contract.spec.ts#CCY-V09 competing resolves commit one receipt and one event` | `direct-contract-covered`: the winning empty-effect resolution commits one durable receipt/event and no state change; this is not rendered-UI evidence        |
| `CON-003` ordered scalar effects                                 | `WorldPlay#EffectBuilder`; `rules.ApplyRuntimeTransition`; scalar receipt tables                                                                                        | `ui-partial` for one effect; authored ordering and earlier-effect observation are lower-layer only                                                            |
| `CON-004` apply inline status                                    | status builder/editor; resolution runtime; status instance/snapshot tables                                                                                              | `observer-covered` over HTTP in `state-graph.spec.ts`; UI is a gap                                                                                            |
| `CON-005` propagate modifiers through derived values             | `rules.EvaluateEntityState`; `effectiveChanges`; evaluated sheet display                                                                                                | `observer-covered` plus lower-layer tests; UI explanation/live update is incomplete                                                                           |
| `CON-006` same-name instances remain distinct                    | status instance IDs/provenance; `status_effects_test.go#TestConsequenceOwnedStatusesWithSameNameRemainDistinct`                                                         | `lower-layer-covered`; browser/API integration is a gap                                                                                                       |
| `CON-007` remove one exact status                                | remove-status UI and runtime validator; instance removal receipt                                                                                                        | `observer-covered` over HTTP in `state-graph.spec.ts`; UI is a gap                                                                                            |
| `CON-008` preserve/present resolution evidence                   | `WorldPlay#HistoryCard`; response loader; receipt tables and immutability triggers                                                                                      | `ui-partial` for history plus observer/lower-layer receipt evidence                                                                                           |
| `CON-V01` invalid preview types/bounds/steps without persistence | adjudication validation; pure transition errors; preview read-only transaction                                                                                          | `lower-layer-covered`; exact non-persistence HTTP/UI proof is incomplete                                                                                      |
| `CON-V02` deny derived/immutable/archived scalar target          | runtime transition validation and loaded definition guards                                                                                                              | `lower-layer-covered`; user-visible outcome is a gap                                                                                                          |
| `CON-V03` invalid status modifiers apply nothing                 | `rules.ValidateStatusSnapshot`; runtime clone/atomicity; resolve transaction                                                                                            | `lower-layer-covered`                                                                                                                                         |
| `CON-V04` stale/removed/mismatched/foreign status target         | `rules.ValidateRuntimeTransitionPlan`; world-scoped status loaders/FKs                                                                                                  | `lower-layer-covered`; direct integration variants are incomplete                                                                                             |
| `CON-V05` later failure rolls back earlier effects               | `rules.ApplyRuntimeTransition`; resolve transaction; `runtime_transition_test.go#TestRuntimeTransitionFailureIsAtomicAcrossStatusAndScalarState`                        | `lower-layer-covered`; persistence/UI atomicity needs proof                                                                                                   |

### Authorization, concurrency, and lifecycle

| IDs and intent                                                       | Primary current anchors                                                                                                                                                                                   | Baseline and principal gap                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUT-001` admitted-world projection                                  | list-worlds membership query; Build/Play libraries                                                                                                                                                        | `observer-covered` in both configuration/play specs; UI role libraries are partial                                                                    |
| `AUT-002` Build only for owners/editors                              | `BuildWorkspace` access boundary; `requireWorldEditor`                                                                                                                                                    | `ui-partial` boundary plus direct role denials                                                                                                        |
| `AUT-003` profile visibility projection                              | `loadWorldEntityProfileAccess`, `loadEntityProfileResponse`; `EntityProfileReader`                                                                                                                        | `observer-covered` with some owner UI display                                                                                                         |
| `AUT-004` problem projection by audience/lifecycle                   | `requireInteractionVisibility`; filtered interaction loaders                                                                                                                                              | `observer-covered`/`ui-partial`, not an exact role matrix                                                                                             |
| `AUT-005` player authorship bounded by control/readiness/eligibility | profile/action handlers and readiness/control helpers                                                                                                                                                     | `observer-covered` for selected denials                                                                                                               |
| `AUT-006` spectator read-only projection                             | membership role checks; profile/interaction filtering; Play read-only UI                                                                                                                                  | `observer-covered`; no spectator browser journey                                                                                                      |
| `AUT-007` strict world boundary                                      | every scoped loader/handler; composite foreign keys                                                                                                                                                       | `observer-covered` in selected direct-read checks plus persistence structure                                                                          |
| `AUT-008` event filtering by authority/visibility                    | `handleWorldEvents`; `loadVisibleWorldEvents`                                                                                                                                                             | `uncovered` as exact multi-role stream contract                                                                                                       |
| `AUT-V01` outsider direct denial                                     | `requireActiveWorldMember`                                                                                                                                                                                | `observer-covered` by `403` assertions                                                                                                                |
| `AUT-V02` command denial by role                                     | editor/owner/facilitator helpers                                                                                                                                                                          | `observer-covered` for invite/spectator examples; full command matrix is missing                                                                      |
| `AUT-V03` omit restricted profile definitions/values                 | profile access/response loaders; `test/specs/contracts/profile-and-readiness.contract.spec.ts#contract: readiness and profile projections preserve authority and privacy`                                 | `direct-contract-covered`: the unauthorized response omits both the restricted field definition ID and its prose value; no DOM-only inference is used |
| `AUT-V04` omit facilitator-private problem/receipt data              | interaction/resolution response loaders                                                                                                                                                                   | `observer-covered` incompletely                                                                                                                       |
| `AUT-V05` deny cross-world substitution without disclosure           | handler world ownership checks; composite FKs                                                                                                                                                             | `lower-layer-covered`/selected integration only                                                                                                       |
| `AUT-V06` deny live resources during onboarding                      | `requirePlayReadyWorldMember`; WorldPlay onboarding gate                                                                                                                                                  | `ui-partial` plus direct `403` checks                                                                                                                 |
| `CCY-V01` stale world details                                        | world revision check and `SettingsWorkspace` reload/error path                                                                                                                                            | `uncovered`                                                                                                                                           |
| `CCY-V02` stale rules graph                                          | `lockRulesRevision`; mechanics editor                                                                                                                                                                     | `observer-covered` in `state-graph.spec.ts`; UI recovery is a gap                                                                                     |
| `CCY-V03` stale state/rules sheet save                               | state/rules root locks; `EntityDetail#EntitySheet`; `test/specs/contracts/rules-and-status.contract.spec.ts#contract: typed rules publish atomically and statuses change effective state with receipts`   | `direct-contract-covered`: the stale rules revision is rejected and authoritative state remains intact; no rendered reload/recovery is claimed        |
| `CCY-V04` stale controller replacement                               | table revision lock; `ManageControllersModal`                                                                                                                                                             | `uncovered`                                                                                                                                           |
| `CCY-V05` stale field/profile schemas                                | field/profile revision checks; respective editors                                                                                                                                                         | `observer-covered` for stale profile; recovery and stale field path are gaps                                                                          |
| `CCY-V06` stale interaction/action                                   | interaction/action locks and `interactionConflict`                                                                                                                                                        | `uncovered` as exact user recovery                                                                                                                    |
| `CCY-V07` equivalent resolve exactly once                            | idempotency unique index; `resolutionRequestMatches`; applied-result loader                                                                                                                               | `uncovered` by current tests                                                                                                                          |
| `CCY-V08` changed-content key reuse conflicts                        | same resolve/idempotency regions                                                                                                                                                                          | `uncovered`                                                                                                                                           |
| `CCY-V09` one competing resolve commits                              | resolve lock/transaction/final interaction trigger                                                                                                                                                        | `uncovered`                                                                                                                                           |
| `LFC-001`, `LFC-002` archive independent mechanics/dependency chains | mechanic archive UI/handler; dependency graph checks                                                                                                                                                      | `uncovered` in browser integration                                                                                                                    |
| `LFC-003` archive entity into read-only history                      | `entities.go#Server.handleArchiveWorldEntity`; historical FKs; `test/specs/contracts/resource-lifecycle.contract.spec.ts#contract: scenario matrices reject invalid and archived resource use atomically` | `direct-contract-covered`: exact archive, exclusion, and post-archive mutation/reference denials execute without claiming a rendered archive control  |
| `LFC-004` archive world after final work                             | settings UI; world archive handler                                                                                                                                                                        | `uncovered`                                                                                                                                           |
| `LFC-005` retain final interaction history                           | interaction/receipt response loaders; immutability triggers                                                                                                                                               | `lower-layer-covered`/partial history UI; post-archive read is a gap                                                                                  |
| `LFC-V01` block archive with active derived dependent                | `mechanics.go#hasActiveMechanicDependents`                                                                                                                                                                | `lower-layer-covered` by implementation validation, not an exact browser contract                                                                     |
| `LFC-V02` block archive with active status modifier                  | `mechanics.go#hasActiveStatusMechanicDependency`                                                                                                                                                          | `uncovered` integration                                                                                                                               |
| `LFC-V03` block world archive during unfinished problem              | world archive active-interaction guard                                                                                                                                                                    | `uncovered` integration                                                                                                                               |
| `LFC-V04` deny mutation/new references to archived resources         | archive/lifecycle checks throughout handlers and rules                                                                                                                                                    | `lower-layer-covered` incompletely; no scenario-wide matrix                                                                                           |

### Navigation and resilience

| IDs and intent                                         | Primary current anchors                                                                                                                | Baseline and principal gap                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NAV-001` canonical navigation/deep links              | `worldRoutes`; `App`; Build/Play workspaces                                                                                            | `lower-layer-covered` by `worldRoutes.test.ts` plus incidental UI navigation                                                          |
| `NAV-002` deliberate unknown-route recovery            | `worldRoutes#readLocation`; `NotFoundPage`                                                                                             | `lower-layer-covered`; no browser recovery journey                                                                                    |
| `NAV-003` protect dirty drafts                         | `useDraft`; editor workspace navigation                                                                                                | `uncovered` in browser automation                                                                                                     |
| `NAV-004` core narrow-viewport journeys                | responsive regions in `styles/app.css`                                                                                                 | `uncovered`; Playwright has Desktop Chrome only                                                                                       |
| `NAV-005` keyboard/semantic completion                 | semantic controls in features; `StudioUI#Modal`; focus/skip CSS                                                                        | `lower-layer-covered` by lint/semantic locators only; keyboard journey and audit are absent                                           |
| `NAV-006` ignore obsolete resource responses           | `useCollection`, `useResource` abort and same-path retention                                                                           | `uncovered` with controlled timing                                                                                                    |
| `NAV-007` reconnect from last event cursor             | `useWorldEvents`; `handleWorldEvents`; `worldEventCursor`                                                                              | `ui-partial` for ordinary live update; forced disconnect/cursor continuation is absent                                                |
| `NAV-008` recoverable failure without runtime breakage | `api#ApiError`; `ErrorMessage`; reload callbacks                                                                                       | `uncovered` under injected/transient failure                                                                                          |
| `NAV-V01` deliberate non-editor Build boundary         | `BuildWorkspace` role branch                                                                                                           | `ui-partial` indirectly; exact deep-link journey is missing                                                                           |
| `NAV-V02` event-stream interruption recovery           | event hook reconnect loop and server cursor                                                                                            | `uncovered`                                                                                                                           |
| `NAV-V03` transient resource failure recovery          | collection/resource hooks and `ErrorMessage` retry                                                                                     | `uncovered`                                                                                                                           |
| `NAV-V04` no blank/false success on command failure    | command error state in feature editors; `api#ApiError`; `test/specs/scenarios/lifecycle-spine.spec.ts#NAV-V04/archive-command-failure` | `journey-covered`: the inline spine rib keeps the authoritative world view, renders the archive rejection, and shows no false success |

## 6. Lifecycle spine and global invariants

Composite IDs do not introduce new product behaviors. All seven are checkpoint
contracts in one `test/specs/scenarios/lifecycle-spine.spec.ts` execution. That
test owns one generated world, keeps owner, editor, player, and spectator in
separate persistent browser contexts, and evolves forward from a clean database
to archive. It is never split into ordered tests or fed API/SQL-authored state.

The spine imports the composition in
`test/src/scenario/journeys/lifecycleSpine.ts`; behavior drivers retain their
own semantic controls and contracts. This preserves precise attribution
without paying for repeated browser startup, identity creation, world
configuration, invitations, or readiness.

### Separately reported spine checkpoints

| Execution order and checkpoint        | Primary journey and behavior claims                                                                                         | Current baseline and required target                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playable world                        | `JRN-001`; `IDN-001..002`, `WRL-001..002`, `MEC-001..003`, `MEC-005`, `CHF-002`, `RST-001..002`                             | `configuration.spec.ts` is UI-partial and omits UI derived authoring; the spine must create and reopen the complete playable world through the UI                                |
| Editor boundary and collaboration     | `JRN-006`; editor invite/admission, `AUT-002`, `WRL-003`, `MEC-006`, `CHF-002`, `RST-001`, `AUT-V02`                        | no current editor journey; the editor must collaborate and facilitate while the owner-only archive command remains unavailable/forbidden                                         |
| Ready player                          | `JRN-002`; player invite/admission, `IDN-003`, `INV-001..003`, `RST-003..005`, `RST-V01..002`, `AUT-003`                    | `play.spec.ts` uses API-authored prerequisites; the same spine must show waiting, setup-required, and ready states                                                               |
| Shared round and spectator projection | `JRN-003`, `JRN-005`; `PLY-001..004`, `PLY-006`, `CON-001`, `CON-003..005`, `CON-008`, `PLY-008`, `AUT-003..006`, `AUT-008` | the current multiplayer path is UI-partial and spectator checks are direct; the persistent player and spectator contexts must converge live with their distinct projections      |
| Status lifecycle                      | `JRN-004`; repeated short problem actions plus `CON-004..008` and `PLY-008`                                                 | `state-graph.spec.ts` is HTTP evidence; the spine must apply a status, create a same-name distinct instance, remove one exact instance, and retain provenance                    |
| Owner archive and retained history    | `JRN-007`; `LFC-V03`, `LFC-004..005`, `GLO-008`                                                                             | no current archive journey; the owner first observes the unfinished-work rejection, archives only after final work, and every supported actor reopens retained read-only history |

Safe, non-mutating or self-correcting negative attempts may run as named
**spine ribs** immediately before the successful action whose setup they share.
They remain registered scenario/outcome contracts in the `journey` tier, not a
sixth tier. A rib must leave the shared world at its recorded pre-attempt
mutation epoch or use a disposable sibling resource; otherwise it belongs in a
focused tier.

Each checkpoint and child outcome reports individually. A failure at
`CON-003`, for example, fails that contract, records `JRN-003` as incomplete,
and marks all causally later obligations `blocked-by CON-003`. The interpreter
stops mutating immediately while independent UI-boundary and direct-contract
executions still run.

### Global invariants

| Invariant                                  | Current implementation/evidence anchors                                                            | Planned enforcement                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GLO-001` UI-only mutation                 | Current Playwright specs contain `page.request` setup/checks and one `page.evaluate` identity read | journey imports and capabilities must make request/DB mutation unavailable; a static boundary check rejects escape hatches                          |
| `GLO-002` runtime health                   | `appServer#waitForHealth`; Go recovery middleware; Playwright failure artifacts                    | browser observer fails on uncaught page errors, unexpected console errors, failed critical resources, and unexpected `5xx` responses                |
| `GLO-003` world isolation                  | `world_id` checks/FKs; outsider tests; `docs/security.md`                                          | read-only HTTP/SQL probes assert ownership and absence/non-disclosure after relevant mutations                                                      |
| `GLO-004` atomic failure                   | pure transition clone tests; PostgreSQL resolve transaction                                        | negative contracts compare before/after observations and assert no state/status/receipt/event drift                                                 |
| `GLO-005` UI/system agreement              | some existing tests compare UI with later API state, but ad hoc                                    | every success outcome pairs user-visible evidence with declared system observers where durable state changed                                        |
| `GLO-006` sensitive-data minimization      | server-side profile/interaction filtering and selected direct JSON assertions                      | centralized absence matchers cover restricted fields, values, private notes, bearer tokens, and hidden events by actor                              |
| `GLO-007` no privileged vocabulary/classes | no built-in entity classes/seed vocabulary; migration contract rejects canonical JSON aggregation  | static/schema review plus journeys use arbitrary generated names rather than blessed fixture keys                                                   |
| `GLO-008` immutable final history          | receipt/event/final-interaction triggers and migration tests                                       | post-resolution lifecycle contracts try authorized mutation paths and re-read immutable receipts/history                                            |
| `GLO-009` eventual live convergence        | two-browser prompt/action/outcome checks; SSE cursor/reload implementation                         | a convergence validator waits on each actor's visible authoritative state and records event cursors, without reload unless the scenario requires it |
| `GLO-010` accessible interaction           | semantic JSX, accessibility ESLint rules, focus/skip/reduced-motion CSS                            | keyboard journeys plus an automated accessibility scan at named milestones; exceptions must be scoped and documented                                |
| `GLO-011` deterministic waits/isolation    | disposable database, two bounded workers, Playwright auto-waits, unique aggregate-owned data       | ban arbitrary sleeps, order dependence, shared aggregates, and table-wide assertions; actor contexts and generated data belong to one test context  |
| `GLO-012` diagnostic evidence              | traces/screenshots/video on failure; `app-server.log`                                              | evidence timeline records actor, behavior/outcome IDs, contract/probe result, URL, revisions/resource IDs, and linked Playwright artifacts          |

## 7. Existing evidence index

The required browser inventory is twelve Playwright files containing twelve
tests: one serial lifecycle spine, four focused UI-boundary tests, and seven
direct HTTP/PostgreSQL contract tests. They run in one Desktop
Chrome/Chromium project with two aggregate-isolated workers, no retries, and a
20-second per-test timeout. The measured browser invocation after this topology
change is 20.7 seconds; the authoritative acceptance result remains the full
top-level `./ci.sh e2e` wall clock, not this component timing.

`./ci.sh e2e` builds the frontend and Go binary once and passes those verified
artifacts into global setup. `test/src/appServer.ts#startAppServer` retains a
build fallback for direct `test/` invocation. Removing duplicate builds changes
harness cost, not UI-only journey authority.

### 7.1 Browser and PostgreSQL-backed specifications

| Current test region                       | Meaningful mapped IDs                                                                                   | Evidence boundary                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `test/specs/scenarios/lifecycle-spine.*`  | all `JRN-*` plus the representative successful lifecycle behaviors and safe inline ribs                 | all mutable prerequisites and journey actions originate in four isolated actor browsers                     |
| `test/specs/ui-boundaries/*.ui.spec.ts`   | visible alternate flows, draft protection, narrow/keyboard access, recovery, and lifecycle feedback     | direct setup may establish the precondition; the rendered UI performs and proves the behavior under test    |
| `test/specs/contracts/*.contract.spec.ts` | authorization, privacy, invalid references, races, idempotency, atomicity, persistence, and exact cases | normal HTTP commands plus PostgreSQL/read projections prove server-only outcomes without claiming a journey |

The removed broad configuration/play/state-graph specs are replaced by these
explicit evidence tiers. Precise protocol, privacy, transaction, and rules
coverage remains independently runnable rather than being hidden inside the UI
spine.

### 7.2 Frontend lower-layer tests

| Test region                                    | Current responsibility                                                   | Scenario families                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `web/frontend/src/worldRoutes.test.ts`         | neutral root, Play/Build/invite parsing, canonicalization, unknown paths | `IDN`, `INV`, `NAV`                                   |
| `web/frontend/src/domain/mechanics.test.ts`    | mode/source changes and derived-expression reset/preservation            | `MEC`                                                 |
| `web/frontend/src/domain/consequences.test.ts` | scalar/status draft mapping and exact remove targets                     | `CON`                                                 |
| `web/frontend/src/domain/display.test.ts`      | API vocabulary and relative dates                                        | display portions of `WRL`, `INV`, `RST`, `PLY`, `NAV` |

There are currently no React component-rendering tests, no axe-style audit, and
no controlled hook-race tests. Those omissions should remain visible in the
generated coverage report rather than being inferred from lint success.

### 7.3 Go application and rules tests

| Test region                                                       | Current responsibility                                                                                           | Scenario families/invariants              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `internal/app/json_test.go`                                       | strict JSON and stable error envelope                                                                            | `NAV`, all command variants               |
| `internal/app/server_test.go`                                     | assets, SPA fallback, API panic recovery                                                                         | `NAV`, `GLO-002`                          |
| `internal/app/mechanics_graph_test.go`                            | typed tree/exact-number DTO round trip, derived validation, cycle field paths, normalized storage reconstruction | `MEC`, `GLO-004`                          |
| `internal/app/status_effects_test.go`                             | same-name status distinction and effect-shape validation                                                         | `CON-006`, `CON-V03..004`                 |
| `internal/app/config_test.go`                                     | runtime configuration precedence                                                                                 | runtime support, not a business scenario  |
| `internal/rules/decimal_test.go`, `values_state_test.go`          | exact arithmetic, tagged values, defaults, normalized state, definition/state identity                           | `MEC`, `CON`, `GLO-004`                   |
| `internal/rules/expression_evaluation_test.go`                    | expression typing/cycles/order/evaluation, effective modifier propagation                                        | `MEC-003..006`, `MEC-V02..004`, `CON-005` |
| `internal/rules/transition_test.go`, `runtime_transition_test.go` | ordered effects, defaults, status apply/remove, target validation, atomic failure                                | `CON-003..007`, `CON-V01..005`, `GLO-004` |

### 7.4 Migration and runtime evidence

| Region                                                                           | Current responsibility                                                                                  | Scenario mapping                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `internal/migrations/migrations_test.go#TestMigrationHistoryMatches`             | applied migration prefix/history contract                                                               | operational prerequisite                                              |
| `internal/migrations/migrations_test.go#TestRulesGraphStatusesMigrationContract` | normalized graph/status storage, backfills, provenance, receipt immutability, absence of JSON aggregate | `MEC`, `CON`, `GLO-007..008`                                          |
| `test/src/appServer.ts#startAppServer`                                           | builds real production frontend and Go binary, starts disposable app, captures server log               | all `JRN-*`, `GLO-002`, `GLO-012`                                     |
| `test/src/database.ts#createDisposableDatabase`                                  | unique PostgreSQL database and teardown                                                                 | `GLO-011`                                                             |
| `test/playwright.config.ts`                                                      | one Desktop Chrome project, two aggregate-isolated workers, traces/screenshots/video on failure         | `GLO-011..012`; exposes `NAV-004..005` browser-matrix gaps            |
| `ci.sh#run_e2e`                                                                  | frontend/backend gates before browser scenarios                                                         | all scenario evidence in CI                                           |
| `run.sh`                                                                         | managed local Go/Vite runtime and logs                                                                  | manual reproduction and exploratory verification, not automated proof |

## 8. Documentation map and update plan

Scenario traceability should point to canonical prose at the level where a
reader can understand the rule independently of the test. The following map is
the required documentation review surface.

| Document                             | Scenario families to review when it changes                          | What must stay aligned                                                                    |
| ------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `scenariotest/business-scenarios.md` | all exact, variant, composite, and global IDs                        | actors, preconditions, user acts, outcomes, priorities, validation scopes                 |
| `scenariotest/architecture.md`       | all                                                                  | runner boundaries, behavior/outcome catalog, observers, evidence, no-shortcut enforcement |
| `docs/README.md`                     | all                                                                  | product invariants, terms, and implementation sources of truth                            |
| `docs/architecture.md`               | `WRL`, `MEC`, `RST`, `PLY`, `CON`, `CCY`, `NAV`                      | runtime layers, major flows, consistency, events, design constraints                      |
| `docs/domain-model.md`               | `WRL`, `MEC`, `CHF`, `RST`, `INV`, `PLY`, `CON`, `CCY`, `LFC`        | nouns, lifecycle, transition semantics, revisions                                         |
| `docs/workflows.md`                  | all canonical user workflows                                         | user-visible order and intended entry points                                              |
| `docs/api.md`                        | every family except purely visual portions of `NAV`                  | request/response, errors, authorization, revision and SSE contracts                       |
| `docs/backend.md`                    | `MEC`, `CHF`, `RST`, `INV`, `PLY`, `CON`, `AUT`, `CCY`, `LFC`        | handlers, persistence orchestration, rules boundaries, filtering, transactions            |
| `docs/frontend.md`                   | `IDN`, `WRL`, `MEC`, `CHF`, `RST`, `INV`, `PLY`, `CON`, `NAV`        | routes, screen ownership, UI states, hooks, accessibility/responsiveness                  |
| `docs/database.md`                   | `WRL`, `MEC`, `CHF`, `RST`, `INV`, `PLY`, `CON`, `AUT`, `CCY`, `LFC` | schema/constraints, revisions, archive and immutable history                              |
| `docs/security.md`                   | `IDN`, `INV`, `RST`, `PLY`, `AUT`, `GLO-003`, `GLO-006`              | trust boundary, authorization matrix, privacy, known gaps                                 |
| `docs/testing.md`                    | all                                                                  | layer definitions, harness lifecycle, evidence policy, coverage and current gaps          |
| `docs/development.md`                | test infrastructure                                                  | commands, database variables, local workflow and troubleshooting                          |
| `docs/operations.md`                 | `NAV-007`, `GLO-002`, `GLO-009`, `GLO-012`                           | production topology, health/logging, SSE and recovery runbooks                            |

Do not copy the full scenario steps into canonical system docs. The scenario
document should link to the relevant workflow/domain section, and those docs
should explain the durable product rule. This mapping document then names the
implementation/evidence. That triangular linkage avoids three competing
versions of the same scenario.

For each scenario-engine change:

1. edit the business scenario first when user intent or expected outcomes
   change;
2. update canonical `docs/` when the system contract or workflow changed;
3. update implementation and its lower-layer tests;
4. update the behavior driver and outcome contract;
5. update the traceability record and generated baseline;
6. run the scenario plus the focused CI target, then `./ci.sh` before handoff.

Documentation-only wording changes that do not alter intent may skip steps 3–4,
but the scenario ID must not be silently repurposed.

## 9. Change-impact routing

This path map should seed the planned traceability checker. It is intentionally
conservative: a touched region prompts review; it does not claim every scenario
is affected.

| Changed region                                                                                            | Families/invariants to review                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `web/frontend/src/App.tsx`, `HomeChoice.tsx`, `IdentityGate.tsx`, `worldRoutes.ts`                        | `IDN`, `INV`, `NAV`, relevant `AUT`                                                         |
| `BuildLibrary.tsx`, `PlayLibrary.tsx`, `BuildWorkspace.tsx`, `PlayWorkspace.tsx`, `SettingsWorkspace.tsx` | `WRL`, `AUT`, `LFC`, `NAV`                                                                  |
| `MechanicsWorkspace.tsx`, `domain/mechanics.ts`, mechanic API types                                       | `MEC`, `CCY`, `LFC`                                                                         |
| `CharacterFieldsWorkspace.tsx`, `EntityProfilePanel.tsx`                                                  | `CHF`, `RST`, `AUT`, `CCY`                                                                  |
| `RosterWorkspace.tsx`, `RosterModals.tsx`, `EntityDetail.tsx`                                             | `RST`, `MEC`, `CON`, `AUT`, `CCY`, `LFC`                                                    |
| `PeopleWorkspace.tsx`, `InvitePage.tsx`                                                                   | `INV`, `AUT`, `LFC`                                                                         |
| `WorldPlay.tsx`, `domain/consequences.ts`                                                                 | `RST`, `PLY`, `CON`, `AUT`, `CCY`, `LFC`, `NAV`                                             |
| `useCollection.ts`, `useResource.ts`, `useDraft.ts`, `useWorldEvents.ts`, `api/client.ts`                 | `NAV`, `CCY`, `GLO-002`, `GLO-009`, plus each consumer family                               |
| `components/StudioUI.tsx`, `styles/*.css`                                                                 | `NAV-004..005`, `NAV-008`, `GLO-010` and visually affected journeys                         |
| `internal/app/worlds.go`, `users.go`                                                                      | `IDN`, `WRL`, `INV`, `AUT`, `CCY`, `LFC`                                                    |
| `mechanics.go`, `rules_graph_api.go`, `rules_revision.go`, `effective_state.go`                           | `MEC`, `RST`, `CON`, `CCY`, `LFC`                                                           |
| `entities.go`, `handlers_world_character_fields.go`, `handlers_world_entity_profiles.go`                  | `CHF`, `RST`, `AUT`, `CCY`, `LFC`                                                           |
| `interactions_core.go`                                                                                    | `PLY`, `AUT`, `CCY`, `LFC`, `GLO-009`                                                       |
| `interactions_resolution.go`, `resolution_runtime.go`                                                     | `CON`, `AUT`, `CCY`, `LFC`, `GLO-004..005`, `GLO-008`                                       |
| `internal/app/support.go`, `api.go`, `json.go`, `routes.go`, `server.go`                                  | all relevant transport scenarios; always review `AUT`, `NAV`, and global invariants         |
| `internal/rules/**`                                                                                       | `MEC`, `CON`, `GLO-004`, `GLO-007`                                                          |
| `internal/migrations/**`                                                                                  | every family owning changed tables plus `AUT`, `CCY`, `LFC`, `GLO-003..004`, `GLO-007..008` |
| `test/src/**`, `test/playwright.config.ts`, `ci.sh`                                                       | all `JRN`, all `GLO`, `NAV-004..008`                                                        |

The checker prints this impact list in CI and fails when a changed mapped region
has no scenario acknowledgment in the change metadata. An acknowledgment may
say “reviewed, no contract change”; it must not require meaningless edits to
scenario files. The checker and complete mapping land together; there is no
advisory-only transition state.

## 10. Ownership and change workflow

The repository has no current `CODEOWNERS` assignment, so ownership here means
review responsibility, not a named person.

| Responsibility                                       | Required review role                                |
| ---------------------------------------------------- | --------------------------------------------------- |
| Scenario wording, priority, actors, expected outcome | product/domain steward                              |
| Behavior vocabulary and outcome definitions          | scenario-test maintainer plus feature implementer   |
| Playwright driver and semantic locators              | frontend/test maintainer                            |
| UI validators                                        | frontend/test maintainer                            |
| HTTP/persistence observers                           | backend/data maintainer; observers remain read-only |
| `AUT-*`, `GLO-003`, `GLO-006`                        | security/privacy reviewer                           |
| `MEC-*`, `CON-*`, `GLO-004`, `GLO-007`               | rules/domain reviewer                               |
| `CCY-*`, `LFC-*`, `GLO-008`                          | backend/data reviewer                               |
| `NAV-004..005`, `GLO-010`                            | accessibility/responsive reviewer                   |
| Harness, isolation, evidence, CI                     | test-infrastructure maintainer                      |

### Change workflow

1. **Resolve impact.** Start from scenario ID for a product change, or run the
   path-to-family resolver for an implementation-first fix.
2. **Classify the change.** Record whether it changes intent, UI performance of
   an existing behavior, an outcome contract, an observer, or implementation
   only.
3. **Update the vertical slice.** Keep the behavior definition, frontend driver,
   outcome contract, implementation, lower-layer tests, and mapping coherent.
4. **Run focused evidence.** Execute the exact scenario IDs and their global
   invariants; then run the affected frontend/backend targets.
5. **Review gaps deliberately.** A new `uncovered` state needs an owner and
   follow-up; it cannot be hidden by a family-level mapping.
6. **Regenerate traceability.** Commit the human-readable coverage report if the
   architecture chooses a checked-in report; never hand-edit generated rows.
7. **Validate.** Run `./ci.sh`, whose E2E target already builds the production
   SPA and Go binary against disposable PostgreSQL.

### Identifier lifecycle

- IDs are never reused.
- Wording-only refinements keep the ID.
- A materially different actor, action, or success criterion gets a new ID; the
  old record becomes `retired` with its replacement and reason.
- Variants retain the base family and `V` form. They are first-class contracts,
  not ad hoc negative assertions embedded in another test.
- Composite `JRN-*` IDs may change their child list without changing the child
  IDs.
- Global `GLO-*` invariants are applied by policy and should not be manually
  repeated in every journey body.

## 11. CI, runtime, coverage, and freshness checks

The non-negotiable performance gate is the complete successful
`./ci.sh e2e` wall clock: invocation through exit, including isolated-worktree
preparation, dependency checks, frontend/backend validation, production builds,
database and server startup, lifecycle spine, UI-boundary and direct-contract
execution, reporting, teardown, and cleanup. It must finish in **under 30
seconds** on the supported CI runner. A browser-only time, cached subset,
median, retry-assisted pass, or sum of selected test durations does not satisfy
the gate. Before acceptance, five consecutive retry-free runs must each remain
below 30 seconds.

The generated performance report must show at least:

- total top-level `./ci.sh e2e` wall time and exit status;
- isolated-worktree/dependency, frontend, backend, build/startup, database,
  browser, direct-contract, reporting, and cleanup durations;
- lifecycle-spine duration and each behavior/checkpoint's driver, settle,
  validation, and convergence duration;
- request/query counts, mutation epochs, observation-cache reuse, and artifact
  bytes; and
- per-spec and per-scenario marginal runtime, so a new edge cannot hide in a
  broad aggregate.

The coverage report must emit one row per exact catalog ID with:

```text
scenario_id
primary_tier
execution_id
checkpoint_id_or_contract_id
named_cases_required / named_cases_passed
required_scopes / observed_scopes
result
duration_ms
blocked_by
primary_evidence
```

One observation snapshot may satisfy multiple explicitly registered contracts,
but each row remains independently attributable. A spine failure stops further
spine mutation and marks dependent rows `blocked-by <scenario-id>`; independent
tiers continue. `passed`, `failed`, `blocked`, `uncovered`, and waived outcomes
must not be conflated.

The architecture implementation should add one traceability verification
command and call it from `./ci.sh e2e` before browsers launch. It should fail on:

- malformed, duplicate, retired-as-active, or unknown scenario IDs;
- an exact business scenario without a trace record;
- a trace record that references a missing file;
- a journey step using an unregistered behavior/outcome;
- a catalog behavior with no frontend driver or expected-outcome contract;
- a contract with no declared observation scope;
- a `journey-covered` scenario with no executable journey reference;
- a `ui-boundary-covered` scenario with no executable UI-boundary reference;
- a `direct-contract-covered` variant with no executable direct-contract
  reference;
- a `harness-policy-covered` invariant whose policy did not execute;
- a composite journey naming an unknown child;
- forbidden mutation capabilities imported into the authoritative journey
  layer;
- any grouped scenario whose required named cases are absent or only partially
  reported;
- an unexplained `not-applicable` layer or an expired temporary gap waiver.

Symbol existence checks should be best-effort for Go/SQL string references and
compile-time for TypeScript imports. The generated report must always show:

- exact scenario ID and title;
- priority, family, and primary evidence tier;
- behavior/outcome IDs;
- execution ID, journey checkpoint or focused contract, and coverage state;
- named case completion, result, duration, and causal blocker;
- UI/system/invariant validation scopes;
- mapped frontend/backend/rules/persistence/docs regions;
- open gaps or waivers;
- last reviewed change identifier; and
- the full-suite timing breakdown and under-30-second gate result.

Avoid a time-based “stale after N days” failure. Stable product regions do not
need ceremonial churn. Freshness should be driven by changed mapped paths,
missing registrations, and explicit review acknowledgments.

## 12. Per-scenario mapping template

Use this human-readable form in review descriptions or generated details. The
machine registry should carry equivalent fields.

```md
### <SCENARIO-ID> — <title>

- Catalog: `scenariotest/business-scenarios.md#<anchor>`
- Priority / actors: <priority>; <actor aliases>
- Primary tier: <journey | ui-boundary | direct-contract | lower-layer | harness-policy>
- Execution / checkpoint: <execution ID>; <checkpoint or focused contract ID>
- Behavior/outcome: <registered behavior ID> -> <expected outcome ID, or not-applicable>
- Named cases: <required case keys or not-applicable>
- Direct contract: <registered direct contract ID, or not-applicable>
- Composite journeys: <JRN IDs or none>
- Coverage: <coverage state>; <result>; <duration_ms>; <blocked_by or none>

#### User performance

- Applicability: <required for journey/UI outcome; otherwise why direct coverage is authoritative>
- Entry route: <real browser route>
- Driver: <planned/current driver path#symbol>
- Accessible controls: <roles, labels, keyboard contract>
- Bound outputs: <typed references produced for later steps>

#### Validation contract

- Experience: <visible/accessible postconditions>
- System observers: <read-only HTTP or persistence probes>
- Invariants: <GLO IDs>
- Failure evidence: <trace, screenshot, server log, revision/resource data>

#### Implementation

- Frontend: <path#symbol list>
- Backend routes/handlers: <METHOD route -> path#handler>
- Rules: <path#symbol or not-applicable with reason>
- Persistence: <migration#table/constraint/trigger or not-applicable>
- Existing tests: <path#test title>
- Canonical docs: <path#heading>

#### Gaps and review

- Missing evidence: <specific gap or none>
- Reviewed for change: <change identifier>
- Review roles: <role list>
```

Do not put raw selectors, endpoint setup calls, SQL mutations, or database IDs
in the user-performance portion. Selectors belong to the frontend driver;
endpoint/table details belong to read-only observers and implementation mapping.

## 13. One-shot implementation contract and definition of done

This design is delivered as one coherent replacement with no accepted partial
state. The implementation change must include the lifecycle spine, every
required focused contract, the five-tier registry, reporting and timing,
static/runtime boundaries, reclassified existing evidence, and CI integration together. Old
broad tests may be removed or reduced only in the same change that registers
equal or stronger replacement evidence; there is no partially authoritative
state in which a subset of `JRN-*` is treated as the new suite.

The one implementation change contains:

- `test/specs/scenarios/lifecycle-spine.spec.ts` with the seven exact checkpoint
  keys from the business catalog;
- all required `test/specs/ui-boundaries/*.spec.ts` and
  `test/specs/contracts/*.contract.spec.ts` executions;
- the core catalog, behavior/outcome contracts, actor contexts, mutation
  ledger, read-only journey observers, milestone snapshot reuse, and failure
  evidence under `test/src/scenario/`;
- registered `lower-layer` evidence and automatic `harness-policy` application
  for every exact ID;
- generated per-ID coverage and full-command performance reports, with CI
  failures for missing/duplicate ownership, incomplete named cases, forbidden
  journey mutation, or an exceeded runtime gate; and
- reuse of the production frontend assets and Go binary already verified by
  the same `./ci.sh e2e` invocation, with a build fallback for direct harness
  use.

### A scenario is mapped when

- its exact ID exists once in the business catalog and trace registry;
- its single primary tier matches the validation scopes declared in the business
  catalog;
- its execution ID, checkpoint/focused contract, behavior/outcome, and every
  required named case are registered;
- its real frontend route and frontend-only mutation driver are named when UI
  performance is required;
- every relevant implementation layer has a precise path/symbol reference or a
  justified `not-applicable` value;
- user-visible and system-observer validations are explicit and read-only;
- required global invariants are attached;
- existing lower-layer evidence and remaining gaps are honest;
- canonical documentation links are present; and
- the generated report and relevant `./ci.sh` target pass.

### The delivery is complete when

- all P0 and P1 canonical UI scenarios in `business-scenarios.md` are
  covered in their declared primary tier, with no unowned required case;
- one UI-only lifecycle-spine execution, starting from one clean isolated
  browser/database state, reports all seven `JRN-*` checkpoints without direct
  mutation shortcuts;
- the owner, editor, player, and spectator use isolated persistent browser
  contexts and the archive checkpoint is explicitly owner-authored and last;
- each security/privacy claim has a server-side absence/denial observer, not
  only a DOM assertion;
- each durable success has UI/system agreement evidence;
- failed transitions and stale/idempotent commands have before/after contracts;
- the report contains no unowned gaps;
- failures identify actor, behavior, outcome contract, observer, and artifacts
  without requiring a developer to reconstruct the timeline from a monolithic
  Playwright function; and
- five consecutive retry-free executions of the complete top-level
  `./ci.sh e2e` command each pass in under 30 seconds on the supported CI
  runner.
