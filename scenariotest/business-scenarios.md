# Business scenario plan

This document defines the business behavior that the scenario-test system must
exercise. It is the authority for **what a user attempts and what outcome makes
that attempt correct**. It deliberately does not define selectors, request
paths, SQL, or the code that performs an action.

The companion [architecture plan](architecture.md) defines how journeys,
behavior drivers, outcome contracts, and validators execute. The
[code-mapping plan](code-mapping.md) maps every scenario family and scenario ID
below to the product code and existing tests that implement or protect it.

This plan follows the current Worldwright workflows and domain model. All
world, mechanic, field, entity, problem, and status names used by a test are
run-local, user-authored examples. They are never built-in vocabulary, entity
classes, privileged keys, or seeded definitions.

The product baseline for this catalog is the current
[workflow guide](../docs/workflows.md), [domain model](../docs/domain-model.md),
[frontend guide](../docs/frontend.md), [security boundary](../docs/security.md),
and [testing guide](../docs/testing.md). If implemented behavior and this plan
diverge, reconcile the product decision and update this catalog before silently
teaching a driver the divergence.

## 1. Authority and boundaries

A scenario begins with a user's intent, not a transport operation. For example,
“the author publishes a calculated capacity” is a behavior; clicking a
particular element, sending a particular JSON shape, and inserting expression
rows are implementation details observed at different layers.

The authority is divided as follows:

- A **canonical journey** tells a coherent story across several behaviors.
- A **behavior scenario** states one semantic user action and its successful
  product outcome.
- An **outcome variant** states a rejected, conflicting, private, stale, or
  otherwise non-happy result of that action.
- A **milestone** is a named business state reached between steps, such as
  “player is ready for live play.”
- A **global invariant** must hold across all relevant behaviors regardless of
  the particular expected outcome.
- A **validation scope** says where evidence is observed. It does not grant that
  validator permission to mutate setup or repair a failed journey.

Canonical journeys mutate the application only through the rendered frontend.
Read-only validators may inspect other product surfaces to distinguish “the UI
looked right” from “the system committed the right facts.” A validator must
never seed, modify, retry with altered data, or repair journey state through a
back channel.

Worldwright currently uses a forgeable local-development identity selector.
These scenarios validate identity selection and the authorization behavior
that follows it; they must not describe that selector as production
authentication.

## 2. Scenario vocabulary

### 2.1 Actors

| Actor       | Business meaning                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor     | A browser context with no selected local development profile.                                                                                               |
| Owner       | The creator of a world and its owner membership. The owner also has facilitator authority during Play.                                                      |
| Editor      | An admitted editor. Editors can configure the world and facilitate, but cannot perform owner-only lifecycle actions.                                        |
| Player      | An admitted player. Its milestone state is qualified as waiting, setup-required, or ready.                                                                  |
| Controller  | A player whose active world membership controls the entity in question. This is authority derived from a relationship, not a separate role or entity class. |
| Spectator   | An admitted read-only table participant.                                                                                                                    |
| Facilitator | An owner or editor acting with live-problem authority. This is a capability of those roles, not another membership type.                                    |
| Outsider    | A known local profile with no active membership in the world.                                                                                               |

Each independently acting participant receives an isolated browser context.
An actor never borrows another actor's local storage, cookies, open page, or
in-memory application state.

### 2.2 Stable identifiers

Behavior scenarios use `<FAMILY>-<three digits>`. Negative and exceptional
outcomes use `<FAMILY>-V<two digits>`. Composite journeys use `JRN-<three
digits>`, and cross-cutting invariants use `GLO-<three digits>`. IDs remain
stable when titles or implementation details change. An ID is retired rather
than reused for different business meaning.

| Prefix | Scenario family                                                                  |
| ------ | -------------------------------------------------------------------------------- |
| `IDN`  | Identity selection and product entry                                             |
| `WRL`  | World creation, discovery, and details                                           |
| `MEC`  | Capacities, capabilities, and the typed derived graph                            |
| `CHF`  | Character-field configuration                                                    |
| `RST`  | Roster, entity sheets, control, profiles, and onboarding                         |
| `INV`  | Invitations, membership admission, and roles                                     |
| `PLY`  | Ad-hoc problem lifecycle, actions, multiplayer updates, and SSE-visible behavior |
| `CON`  | Consequence preview/resolve, scalar effects, statuses, and receipts              |
| `AUT`  | Privacy, authorization, readiness, and world-scope projections                   |
| `CCY`  | Concurrency, revisions, idempotency, and atomicity                               |
| `LFC`  | Resource lifecycle, archive behavior, and retained history                       |
| `NAV`  | Navigation, accessibility, responsive behavior, and resilience                   |
| `JRN`  | A composite canonical journey; not a new product behavior family                 |
| `GLO`  | A cross-cutting product or execution invariant                                   |

### 2.3 Priorities

| Priority | Meaning                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P0`     | Release-blocking path or protection: losing it prevents the core author-to-table loop, exposes private data, or risks corrupt/duplicate live state. |
| `P1`     | High-value supported behavior with meaningful role, lifecycle, or recovery risk.                                                                    |
| `P2`     | Important breadth, edge-case, responsive, or resilience coverage after the core suite is trusted.                                                   |
| `P3`     | Extended matrix, long-duration, or expensive fault coverage suitable for scheduled runs.                                                            |

Priority describes business risk, not implementation order alone. A narrow P0
contract may be implemented before a broad P1 journey that contains it.

### 2.4 Validation scopes

Every scenario and variant declares its intended evidence scopes.

| Scope     | Evidence collected                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `UI`      | Visible text, values, state, navigation, enabled actions, and feedback in the acting browser.                                             |
| `MULTI`   | Eventual observations in one or more independent participant browsers without a manual refresh unless refresh is the behavior under test. |
| `HTTP`    | Read-only resource projections, response filtering, revisions, and error classification.                                                  |
| `DB`      | Read-only relational facts, absence of partial writes, transaction boundaries, and retained history.                                      |
| `AUDIT`   | Resolution receipt, event, provenance, ordering, and immutability evidence through UI and/or read-only observers.                         |
| `A11Y`    | Keyboard operation, focus, semantic names/roles, reduced-motion behavior, and usable responsive reflow.                                   |
| `RUNTIME` | Page exceptions, browser console errors, failed assets, unexpected server errors, and diagnostic artifacts.                               |

`HTTP`, `DB`, and `AUDIT` are observation scopes only. Their presence never
allows the journey to create prerequisites outside the frontend.

### 2.5 Tags

Tags support selection and coverage reporting; they do not replace scenario
IDs. Use lower-case kebab-case. The initial controlled set is:

- outcome: `happy`, `negative`, `conflict`, `privacy`, `archive`, `recovery`;
- actor: `owner`, `editor`, `player`, `spectator`, `outsider`, `multi-actor`;
- subsystem: `identity`, `rules`, `profile`, `control`, `invite`, `sse`,
  `consequence`, `status`, `history`;
- quality: `atomic`, `idempotent`, `responsive`, `keyboard`, `runtime-health`.

New tags should describe a reusable selection dimension. They must not encode a
selector, file name, test worker, or transient implementation detail.

### 2.6 Required scenario record

An executable scenario definition must preserve this business record even if
the TypeScript representation differs:

```text
id, title, priority, tags
actors
given: business preconditions and consumed references
when: one semantic action or a short indivisible user task
expect: named outcome and actor-visible result
milestones: business states established or preserved
produces: typed references available to later steps
validation_scopes
primary_evidence_tier
```

Outcome variants inherit the base scenario's vocabulary when applicable, but
state their changed precondition, attempted action, expected rejection or
projection, and non-mutation guarantee explicitly. A variant that represents a
matrix also declares `base_behavior`, `changed_dimension`, and stable
`named_cases`; one representative case may not claim the whole matrix.

### 2.7 Distinguishing scenarios from cases and evidence

Two records deserve different scenario IDs only when they protect a materially
different business contract. At least one of these dimensions must change:

- actor or authority;
- user intent;
- starting business or lifecycle state;
- visible or durable outcome;
- non-mutation guarantee; or
- recovery, concurrency, or idempotency model.

A different example value, endpoint, table, validation scope, browser, or
evidence source is not a different business scenario. Those differences are
named cases or validators beneath the same scenario ID. Conversely, sharing a
frontend gesture does not merge distinct outcomes: preview and resolve, an
owner archive and an editor denial, and exact replay versus conflicting reuse
remain separately reported contracts.

Broad records use stable case keys so coverage cannot be inferred from a
single convenient representative. The initial required matrices are:

| Scenario  | `base_behavior`                   | `changed_dimension`              | Required `named_cases`                                                                                                                           |
| --------- | --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INV-V01` | preview/redeem invitation         | closure reason                   | `invalid`, `revoked`, `expired`                                                                                                                  |
| `MEC-V03` | publish referenced graph          | reference eligibility            | `unknown`, `cross-world`, `archived`                                                                                                             |
| `RST-V03` | select entity for live use        | readiness/lifecycle and use site | `incomplete-context`, `archived-context`, `incomplete-attribution`, `archived-attribution`, `incomplete-effect-target`, `archived-effect-target` |
| `CON-V04` | remove exact status               | target invalidity                | `stale`, `already-removed`, `entity-mismatch`, `cross-world`                                                                                     |
| `AUT-V02` | issue role-gated command          | actor and command family         | `player-configure`, `spectator-configure`, `player-facilitate`, `spectator-facilitate`, `spectator-respond`, `editor-archive`                    |
| `AUT-V05` | substitute foreign reference      | resource kind                    | `mechanic`, `entity`, `membership`, `action`, `status-instance`                                                                                  |
| `CCY-V06` | issue lifecycle-sensitive command | stale command kind               | `late-submit`, `late-withdraw`, `stale-transition`                                                                                               |
| `LFC-V04` | use archived resource             | resource and use kind            | `world-mutation`, `entity-mutation`, `mechanic-mutation`, `archived-new-reference`                                                               |

These case keys may be table-driven at a cheap evidence tier. They do not
create more browser journeys, but every required case must appear separately in
the coverage report.

## 3. Composition rules

### 3.1 References and run-local examples

Scenarios exchange typed references such as `WorldRef`, `MembershipRef`,
`MechanicRef`, `EntityRef`, `InviteRef`, `ProblemRef`, `ActionRef`, and
`StatusInstanceRef`. Journey prose refers to aliases such as “the authored
world” or “the courier,” never copied durable IDs.

A fixture vocabulary factory creates unique user-authored examples per run. A
journey may, for example, author a world named _Lantern Estuary_, an entity
named _Glasswing Courier_, a numeric capacity named _Bearing_, a Boolean
capability named _Carries the seal_, a character field named _Public sign_, and
a status named _Off balance_. Those labels make evidence readable; none has
meaning outside that journey.

### 3.2 Preconditions

The canonical lifecycle spine builds all mutable preconditions by composing
earlier frontend behaviors. It does not depend on another test's database
residue or execution order. A journey checkpoint starts from a named milestone
produced earlier in that same isolated spine run, for example:

```text
authored-world
  -> admitted-player
  -> controlled-character
  -> ready-player
  -> open-problem
  -> adjudicating-problem
  -> resolved-problem
```

Read-only inspection, clock control for expiry variants, and browser/network
fault injection are allowed when they cannot create or mutate product state.
A repeated command used to verify idempotency must be an exact replay of the
browser-issued command, not a separately crafted API setup call.

### 3.3 Sequencing and concurrency

- `sequence` requires one step's outcome contract to pass before the next step
  consumes its references.
- `parallel` expresses genuinely simultaneous actor attempts, such as two
  facilitators resolving the same problem. It is not a speed optimization.
- `eventually` applies only to asynchronous observation, such as another
  browser converging after an event. It must have a diagnostic deadline and a
  named expected state, never a fixed sleep.
- A refresh is an explicit semantic action only when persistence or recovery is
  being tested. It must not conceal a broken live-update expectation.

### 3.4 Checkpoints and evidence

The runner validates four checkpoint types:

1. **Outcome checkpoint:** immediately after a semantic action, validate its
   declared result.
2. **Milestone checkpoint:** validate a state that spans several behaviors,
   such as readiness after control and profile completion.
3. **Convergence checkpoint:** wait for an authorized second browser to display
   the authoritative new state.
4. **Journey checkpoint:** validate persistence, history, privacy, and global
   invariants at the end of the story.

Every failed checkpoint reports the actor, scenario ID, expected outcome,
current visible state, browser trace, relevant response metadata, and server
log window. Sensitive prose and invite tokens must be redacted from durable
diagnostics.

## 4. Canonical user journeys

The seven journey IDs are distinct business stories and separately reported
contracts, but they are not seven independent browser tests. One executable
`lifecycle-spine.spec.ts` test carries one run-local world from first identity
selection through final archive. It retains isolated owner, editor, player,
and spectator browser contexts and performs every spine mutation through the
rendered frontend. A shared gesture may advance more than one story, but each
journey checkpoint must independently name and validate its outcome.

The spine deliberately reuses expensive setup and live transitions:

| Spine order | Shared operation                                                                                                                                                                                                                                                     | Separately reported checkpoint                                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1           | The owner authors the world, rules, profile schema, entity, and persistent generated sheet.                                                                                                                                                                          | `JRN-001/playable-world`                                                                                                        |
| 2           | The owner creates editor, player, and spectator invitations; the three isolated contexts redeem them and remain open.                                                                                                                                                | prerequisites for `JRN-002`, `JRN-005`, and `JRN-006`                                                                           |
| 3           | The editor makes one configuration change, has no archive affordance, and later facilitates the shared live round.                                                                                                                                                   | `JRN-006/editor-authority-bounded`                                                                                              |
| 4           | The player moves through waiting, setup-required, a partial profile, and readiness.                                                                                                                                                                                  | `JRN-002/ready-player`                                                                                                          |
| 5           | The editor presents one problem; the player responds; the spectator follows only its public projection; preview remains advisory; the owner verifies archive is blocked while work is unfinished; resolve combines scalar effects with the first status application. | `JRN-003/improvised-round-resolved` and `JRN-005/spectator-public-table-safe`; establishes the first `JRN-004` status milestone |
| 6           | Two concise follow-up problems apply an independent same-name status and remove one exact instance.                                                                                                                                                                  | `JRN-004/status-lifecycle-preserved`                                                                                            |
| 7           | After all work is final, the owner archives and the actors reopen retained read-only history.                                                                                                                                                                        | `JRN-007/archived-history-readable`                                                                                             |

If an earlier checkpoint fails, later spine checkpoints are reported as
`blocked-by` that scenario rather than falsely passing. Independent UI-boundary,
direct-contract, lower-layer, and harness-policy coverage continues. The
`Composition` line for each journey lists its primary business coverage;
prerequisite behaviors retain their own IDs without duplicating browser setup.

### JRN-001 — Author creates a playable world

- **Priority:** P0
- **Actors:** visitor becoming owner
- **Tags:** `happy`, `owner`, `identity`, `rules`, `profile`
- **Scopes:** `UI`, `HTTP`, `DB`, `A11Y`, `RUNTIME`
- **Precondition:** a clean run and a browser with no selected local profile
- **Composition:** `IDN-001`, `IDN-002`, `WRL-001`, `MEC-001`, `MEC-002`,
  `MEC-003`, `MEC-005`, `CHF-002`, `RST-001`, `RST-002`
- **Spine checkpoint:** `JRN-001/playable-world`

Semantic flow:

1. Choose the authoring area and create or select a local profile.
2. Create a named world with optional authored description.
3. Publish numeric and Boolean inputs, then publish a calculated numeric value
   that references the authored input.
4. Publish an ordered public field and a controller/facilitator-only field.
5. Create an ordinary entity and observe a generated sheet containing defaults
   and the calculated value.
6. Change an allowed setup input, save, navigate away, and return.

Milestones and expected outcome:

- `owned-world`: the creator sees the world in Build and Play with owner
  authority.
- `valid-rules-graph`: the published graph has advanced its revision and every
  active mechanic appears on the sheet.
- `configured-character-schema`: authored labels, order, guidance, and
  visibility survive a reload.
- `persisted-entity-state`: only input state is editable/stored; the calculated
  value is recomputed and displayed as calculated.

### JRN-002 — Invited player becomes ready

- **Priority:** P0
- **Actors:** owner and a visitor becoming player
- **Tags:** `happy`, `owner`, `player`, `multi-actor`, `invite`, `control`,
  `profile`
- **Scopes:** `UI`, `MULTI`, `HTTP`, `DB`, `A11Y`, `RUNTIME`
- **Precondition:** a world with at least one authored character field and one
  active entity
- **Composition:** `INV-001`, `INV-002`, `IDN-003`, `INV-003`, `RST-003`,
  `RST-004`, `RST-005`, `AUT-003`
- **Spine checkpoint:** `JRN-002/ready-player`

Semantic flow:

1. The owner creates a player invitation and passes the displayed link to a
   separate visitor browser.
2. The visitor opens the link, selects or creates a profile without losing the
   destination, reviews the offer, and redeems it.
3. The admitted player first sees the waiting state.
4. The owner assigns the player's active membership to an entity.
5. The player saves a partial profile and remains in setup.
6. The player completes every active field and enters the live table.

Milestones and expected outcome:

- `admitted-player`: the world appears in Play with the offered role and does
  not appear as editable in Build.
- `waiting-player`: no controlled entity means no live problem/event access.
- `setup-required-player`: a controlled but incomplete character exposes only
  authorized onboarding fields.
- `ready-player`: at least one controlled character is complete, and live play
  becomes available without mechanical sheet-write authority.

### JRN-003 — Group completes an improvised round

- **Priority:** P0
- **Actors:** facilitator and ready player in separate browsers
- **Tags:** `happy`, `multi-actor`, `player`, `owner`, `sse`, `consequence`,
  `history`
- **Scopes:** `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`, `RUNTIME`
- **Precondition:** one valid rules graph, one ready player, and an eligible
  active entity
- **Composition:** `PLY-001`, `PLY-002`, `PLY-003`, `PLY-004`, `PLY-006`,
  `CON-001`, `CON-003`, `CON-008`, `PLY-008`
- **Spine checkpoint:** `JRN-003/improvised-round-resolved`

Semantic flow:

1. The facilitator authors a new problem at the table, selects an eligible
   responder and optional context entity, then presents it to the table
   audience.
2. The player's already-open browser receives the problem without refreshing.
3. The player offers one free-form action and attributes it to a ready
   controlled entity.
4. The facilitator receives the action live, closes submissions, and selects
   the focal action during private adjudication.
5. The facilitator writes a public summary and previews it without effects,
   confirming that preview does not persist.
6. The facilitator adds ordered scalar effects, previews the proposed value
   changes, and resolves.
7. Both browsers converge on resolved history and the entity's updated
   generated sheet.

Milestones and expected outcome:

- `open-problem`: only the intended audience can see it, and only the eligible
  ready player can respond.
- `adjudicating-problem`: submissions are closed and the problem is hidden from
  non-facilitators.
- `previewed-consequence`: exact proposed before/after values are visible, but
  live state and history remain unchanged.
- `resolved-problem`: state, selected action, lifecycle, receipt, history, and
  event converge as one committed outcome.

### JRN-004 — Status is applied, explained, and later removed

- **Priority:** P0
- **Actors:** facilitator and ready player
- **Tags:** `happy`, `multi-actor`, `status`, `rules`, `consequence`, `history`
- **Scopes:** `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`, `RUNTIME`
- **Precondition:** a ready character with an input and a derived mechanic that
  consumes that input
- **Composition:** repeated `PLY-001`, `PLY-002`, `PLY-003`, and `PLY-006`
  problem flows, plus `CON-004`, `CON-005`, `CON-006`, `CON-007`, `CON-008`,
  and `PLY-008`
- **Spine checkpoint:** `JRN-004/status-lifecycle-preserved`

Semantic flow:

1. Resolve a problem with an inline-authored status whose literal modifier
   changes an input's effective value.
2. Observe its chip, description, source problem, modifier trail, and the
   transitive change in the derived value.
3. Resolve another problem that applies an independently authored status with
   the same display name.
4. Resolve a third problem that removes exactly one selected active instance.

Milestones and expected outcome:

- `status-active`: intrinsic base state remains distinct from effective state,
  and the modifier is not baked into the stored input.
- `same-name-statuses-active`: both instances coexist with distinct provenance
  and identities.
- `one-status-removed`: only the chosen instance becomes inactive; the other
  still affects evaluation.
- `status-history-preserved`: apply and remove receipts continue to identify
  their exact instances and sources.

### JRN-005 — Spectator follows the public table safely

- **Priority:** P1
- **Actors:** facilitator, ready player, and spectator
- **Tags:** `happy`, `privacy`, `spectator`, `multi-actor`, `sse`
- **Scopes:** `UI`, `MULTI`, `HTTP`, `AUDIT`, `RUNTIME`
- **Precondition:** a world with public and restricted character fields, a ready
  player, and an admitted spectator
- **Composition:** `INV-001`, `INV-003`, `AUT-003`, `AUT-004`, `AUT-006`,
  `AUT-008`, `PLY-002`, `PLY-003`, `PLY-006`, `PLY-008`
- **Spine checkpoint:** `JRN-005/spectator-public-table-safe`

Semantic flow:

1. Admit a spectator through the visible invitation journey.
2. Present a problem to the table, where the player and spectator are in its
   audience but only the player is an eligible responder.
3. Observe public character prose and the open problem in the spectator
   browser, but no response or configuration authority.
4. Begin adjudication and observe that the problem becomes unavailable to the
   spectator.
5. Resolve and observe that public history returns through the live update.

Expected outcome: the spectator follows the shared story, receives no
restricted profile values or facilitator-private data, cannot act, and never
receives an event that reveals a hidden interaction.

### JRN-006 — Editor collaborates without owner authority

- **Priority:** P1
- **Actors:** owner and editor
- **Tags:** `happy`, `editor`, `owner`, `multi-actor`, `rules`
- **Scopes:** `UI`, `MULTI`, `HTTP`, `DB`, `RUNTIME`
- **Precondition:** an owned active world
- **Composition:** `INV-001`, `INV-003`, `AUT-002`, `WRL-003`, `MEC-006`,
  `CHF-002`, `RST-001`; companion direct-contract case
  `AUT-V02[editor-archive]`
- **Spine checkpoint:** `JRN-006/editor-authority-bounded`

Semantic flow:

1. The owner admits an editor through an editor invitation.
2. The editor opens Build, edits world details and user-authored configuration,
   and creates or updates roster setup.
3. The editor enters Play and exercises facilitator authority.
4. The editor observes that the owner-only world archive affordance is absent;
   the editor is not invited to perform an action the UI does not support.

Expected outcome: editor collaboration works across authoring and facilitation,
while ownership remains a meaningful lifecycle boundary. The separately
reported direct-contract case `AUT-V02[editor-archive]` issues the owner-only
command as the editor and proves a forbidden result with no lifecycle change.
That crafted denial is not a spine mutation and is not represented as a
visible editor gesture.

### JRN-007 — Owner closes and archives a world

- **Priority:** P1
- **Actors:** owner, optionally editor/player/spectator observers
- **Tags:** `happy`, `owner`, `archive`, `history`
- **Scopes:** `UI`, `HTTP`, `DB`, `AUDIT`, `RUNTIME`
- **Precondition:** an active world with resolved and/or cancelled problems and
  no unfinished problem
- **Composition:** `PLY-007` and/or a resolved problem, `LFC-004`, `LFC-005`
- **Spine checkpoint:** `JRN-007/archived-history-readable`

Semantic flow:

1. Finish every active problem by resolving or cancelling it.
2. Review retained final history, then archive the world as owner.
3. Reopen retained material through every supported read-only path.

Expected outcome: no destructive delete occurs; new configuration and play
mutations stop, while archived resources and final receipts remain
interpretable.

## 5. Successful behavior catalog

The scenarios below are reusable semantic building blocks. “Success” includes
a deliberate read-only projection, such as a spectator seeing only public
material. Rejections and conflict outcomes are catalogued separately in
Section 6.

### 5.1 Identity and entry

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                   | Priority | Scopes and tags                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| `IDN-001` | **Neutral area choice.** A visitor at the product entry chooses Play or Build and reaches that area's identity boundary without the neutral choice itself loading user/world data.                                                             | P1       | `UI`, `HTTP`, `RUNTIME`; `happy`, `identity`           |
| `IDN-002` | **Select or create a local profile.** A visitor chooses an existing development profile or authors a display name for a new one, then continues as that identity. The UI labels this as local development identity rather than secure sign-in. | P0       | `UI`, `HTTP`, `DB`; `happy`, `identity`                |
| `IDN-003` | **Resume requested destination after identity selection.** A visitor opens an area, world, or invitation destination first, chooses a profile, and returns to the same semantic destination with the bearer invitation intact.                 | P0       | `UI`, `HTTP`, `RUNTIME`; `happy`, `identity`, `invite` |

### 5.2 World authoring

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                         | Priority | Scopes and tags                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| `WRL-001` | **Create an owned world.** A known profile authors a name and optional description. One active world, owner membership, empty rules root, empty character-field root, and world-created history are established together; the creator can enter both Build and Play. | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `owner`, `atomic` |
| `WRL-002` | **Reopen an admitted world in its appropriate library.** An admitted actor leaves and returns. The world remains discoverable in Play, and appears in Build only when the role has authoring authority, with current role/readiness/activity summary.                | P1       | `UI`, `HTTP`; `happy`, `owner`, `player`                |
| `WRL-003` | **Edit world details.** An active owner/editor replaces the authored name or description against the current settings revision and sees the updated identity consistently on subsequent authoritative loads in libraries, Build, and Play.                           | P1       | `UI`, `HTTP`, `DB`; `happy`, `owner`, `editor`          |

### 5.3 Mechanics and the derived graph

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                        | Priority | Scopes and tags                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------- |
| `MEC-001` | **Publish a numeric input mechanic.** An author chooses capacity score/pool or capability rating, authors its name, default and optional bounds/step/unit, and decides whether live scalar effects may target it. Publication advances the complete graph revision. | P0       | `UI`, `HTTP`, `DB`; `happy`, `rules`, `owner`, `editor` |
| `MEC-002` | **Publish a Boolean input mechanic.** An author publishes a binary capability with an authored name and Boolean default. It appears on every active entity sheet as input state.                                                                                    | P1       | `UI`, `HTTP`, `DB`; `happy`, `rules`                    |
| `MEC-003` | **Publish a numeric derived mechanic.** An author constructs a typed expression from literals and stable references using supported numeric operations. It has no stored default or direct mutability and evaluates on every sheet.                                 | P0       | `UI`, `HTTP`, `DB`; `happy`, `rules`                    |
| `MEC-004` | **Publish a Boolean/conditional derived mechanic.** An author combines Boolean logic, equality/comparison, and a typed conditional whose result matches the declared mechanic scalar kind.                                                                          | P1       | `UI`, `HTTP`, `DB`; `happy`, `rules`                    |
| `MEC-005` | **Materialize generated sheets from the active graph.** After a valid publication, every active entity shows every active mechanic; missing inputs use authored defaults and derived values are calculated from dependency effective values.                        | P0       | `UI`, `HTTP`, `DB`; `happy`, `rules`                    |
| `MEC-006` | **Edit a mechanic and propagate the new rules revision.** An author changes a valid definition/expression, and open authorized Play clients reload the catalog and evaluated sheets before allowing a Consequence against the new graph.                            | P1       | `UI`, `MULTI`, `HTTP`, `AUDIT`; `happy`, `rules`, `sse` |

The implementation should parameterize mode/scalar coverage across numeric
score, pool, and rating plus Boolean binary definitions. Scenario examples
must not turn those product shapes into named built-in mechanics.

### 5.4 Character fields

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                       | Priority | Scopes and tags                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `CHF-001` | **Publish a zero-field schema.** An author leaves the active field set empty. A controlled entity is immediately complete because no active requirement is missing.                                                                                | P1       | `UI`, `HTTP`, `DB`; `happy`, `profile`                           |
| `CHF-002` | **Publish ordered fields with mixed visibility.** An author publishes user-written labels, optional guidance, order, and table or controllers/facilitators visibility. Every active field is required; no per-field required switch is introduced. | P0       | `UI`, `HTTP`, `DB`; `happy`, `profile`, `privacy`                |
| `CHF-003` | **Revise/reorder fields without mis-associating values.** An author edits labels/guidance/order while preserving durable field identity; existing values remain attached to the intended authored field rather than a list position.               | P1       | `UI`, `HTTP`, `DB`; `happy`, `profile`                           |
| `CHF-004` | **Add a requirement and re-evaluate readiness.** With no unfinished problem, an author adds an active field. Previously complete controlled characters lacking it return to setup until controllers provide a value.                               | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `profile`, `player`, `sse` |

### 5.5 Roster, control, and onboarding

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                         | Priority | Scopes and tags                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `RST-001` | **Create an entity with a generated sheet.** An owner/editor authors an ordinary entity display name. Empty state/status roots exist, authored defaults materialize immediately, and no entity class or applicability vocabulary is requested.                       | P0       | `UI`, `HTTP`, `DB`; `happy`, `owner`, `editor`, `rules`              |
| `RST-002` | **Save direct setup input state.** An owner/editor changes the complete logical input map in Builder using current state/rules revisions. Inputs display new intrinsic/effective values; calculated mechanics remain read-only and no live receipt is fabricated.    | P0       | `UI`, `HTTP`, `DB`; `happy`, `rules`, `atomic`                       |
| `RST-003` | **Assign one or more player controllers.** An owner/editor replaces an entity's controller set with active same-world player memberships. All browsers converge on character/control/readiness presentation.                                                         | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `control`, `multi-actor`       |
| `RST-004` | **Save a partial character profile.** A controller or facilitator enters any subset of authorized active fields and saves a draft. Values persist, completion count advances, and the controlled entity remains setup-required.                                      | P0       | `UI`, `HTTP`, `DB`; `happy`, `profile`, `player`                     |
| `RST-005` | **Complete onboarding and enter live play.** A controller supplies non-empty values for every active field on at least one controlled entity. The entity and player derive ready status and the player enters the table.                                             | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `profile`, `player`, `control` |
| `RST-006` | **Support shared and multiple control.** Multiple active players may control one entity and one player may control multiple entities. Each authorized controller can edit profiles, and one ready controlled entity is sufficient for that player's live admission.  | P1       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `control`, `multi-actor`       |
| `RST-007` | **Remove control and revoke character authority.** An owner/editor removes a controller relationship. Existing profile values remain, but that player loses profile edit and acting-entity attribution authority; readiness is recalculated from remaining controls. | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `control`, `privacy`           |

### 5.6 Invitations, memberships, and roles

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                                            | Priority | Scopes and tags                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `INV-001` | **Create a role-bearing invite.** An owner/editor chooses editor, player, or spectator and an allowed lifetime. A new bearer link is visibly offered for intentional sharing.                                                                                                           | P0       | `UI`, `HTTP`, `DB`; `happy`, `invite`, `owner`, `editor`               |
| `INV-002` | **Preserve one-time token secrecy.** Immediately after creation the author can copy the raw link and is warned it will not be listed again. Later invite lists show role, creator, use/expiry/revocation metadata but cannot recover the token; persistence contains only its digest.   | P0       | `UI`, `HTTP`, `DB`; `happy`, `invite`, `privacy`                       |
| `INV-003` | **Preview and redeem into the matching area.** A visitor with the bearer link reviews world, inviter, role, and expiry, selects an identity if needed, then accepts. Exactly one active membership is established and the world appears in Play or Build according to the offered role. | P0       | `UI`, `HTTP`, `DB`; `happy`, `invite`, `player`, `spectator`, `editor` |
| `INV-004` | **Repeat redemption idempotently.** The same user returns to the same valid link. The existing active membership is reused/reactivated as specified, and invite use accounting does not create a duplicate redemption for that invite/user pair.                                        | P1       | `UI`, `HTTP`, `DB`; `happy`, `invite`, `idempotent`                    |
| `INV-005` | **Revoke an invite without ejecting admitted members.** An owner/editor revokes an open link. Future redemption closes, while existing memberships created through it remain active and usable.                                                                                         | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `invite`, `privacy`              |

### 5.7 Live problem lifecycle and multiplayer

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                                    | Priority | Scopes and tags                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `PLY-001` | **Compose an ad-hoc problem.** A facilitator authors a required prompt, optional short title, eligible ready responders, and optional ready context entities in the live-table form. The composition is local until presentation and no reusable problem definition is created. | P0       | `UI`, `HTTP`; `happy`, `owner`, `editor`                             |
| `PLY-002` | **Present to the table audience and eligible responders.** The facilitator presents the valid composition. It becomes an open problem for its table audience and accepts one action from each selected eligible ready player.                                                   | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `multi-actor`, `player`        |
| `PLY-003` | **Receive an open problem live in another browser.** An authorized audience member already at the table sees the newly open problem through live invalidation and authoritative reload, without manual refresh.                                                                 | P0       | `UI`, `MULTI`, `HTTP`, `RUNTIME`; `happy`, `sse`, `multi-actor`      |
| `PLY-004` | **Offer an attributed or unattributed action.** An eligible ready player authors one free-form response and may select a ready controlled entity. Accepted attribution snapshots the entity's display name for stable history.                                                  | P0       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `happy`, `player`, `control`   |
| `PLY-005` | **Withdraw and replace an action.** While the problem is open, the submitting player withdraws their current action and may offer a replacement. Other players' actions are untouched.                                                                                          | P1       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `player`                       |
| `PLY-006` | **Begin private adjudication and select the focal action.** A facilitator closes submissions. Non-facilitators lose visibility until final resolution, while the facilitator may select one submitted action or explicitly select none.                                         | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `happy`, `privacy`, `multi-actor`       |
| `PLY-007` | **Cancel an unfinished problem.** A facilitator cancels an open or adjudicating problem from the table. It becomes final without a Consequence and no longer blocks world archive; direct contract coverage also protects persisted draft cancellation.                         | P1       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `happy`, `history`             |
| `PLY-008` | **Publish resolved history live to participants.** After resolve, authorized participants receive invalidation, reload authoritative data, and see the public summary and applicable receipt changes without reconstructing state from an event payload.                        | P0       | `UI`, `MULTI`, `HTTP`, `AUDIT`, `RUNTIME`; `happy`, `sse`, `history` |

### 5.8 Consequences, scalar effects, and statuses

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                                                 | Priority | Scopes and tags                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `CON-001` | **Preview a summary-only Consequence without persistence.** During adjudication, the facilitator authors public prose with no effects and previews. The proposal validates and remains advisory: no lifecycle, state, status, receipt, or event is written.                                  | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `consequence`, `atomic`                   |
| `CON-002` | **Resolve a summary-only Consequence.** A facilitator commits public prose with zero effects. Final lifecycle/history and one receipt commit without an artificial state change.                                                                                                             | P1       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `happy`, `consequence`, `history`         |
| `CON-003` | **Apply ordered scalar effects.** A facilitator authors ordered set and/or numeric-adjust effects against active mutable inputs and eligible entities. Each later scalar effect observes earlier logical base changes; final values obey exact type, bounds, and step constraints.           | P0       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `happy`, `consequence`, `rules`, `atomic` |
| `CON-004` | **Apply a problem-authored status.** An apply-status effect authors a name, optional description, and ordered literal modifiers inline, then creates one distinct snapshotted instance for each target entity with source provenance. An empty modifier list is a valid fictional condition. | P0       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `happy`, `status`, `consequence`          |
| `CON-005` | **Propagate status modifiers through derived values.** The sheet distinguishes base/intrinsic/effective values. Deterministically ordered active modifiers affect their targets, and derived references consume dependency effective values so transitive changes are explained.             | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `status`, `rules`                         |
| `CON-006` | **Keep same-name status instances distinct.** Two independently authored effects use the same display name. Both instances coexist, retain separate IDs/sources/modifier snapshots, and are never merged by name.                                                                            | P1       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `status`, `history`                       |
| `CON-007` | **Remove one exact status instance.** A later Consequence selects an exact active instance on its entity. Only that instance is deactivated; the removed instance and its original apply history remain readable.                                                                            | P0       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `happy`, `status`, `consequence`          |
| `CON-008` | **Preserve and present resolution evidence.** Final history records the public summary, selected action, requested-effect order, concrete targets, scalar/status applications, changed effective values including transitive changes, rules revision, actor, and source provenance.          | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `history`, `consequence`                  |

### 5.9 Privacy and authorization projections

These successful projection scenarios describe what an authorized actor may
receive. Denials and sensitive-field absence are explicit variants in Section
6 so a hidden control is never mistaken for access control.

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                    | Priority | Scopes and tags                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| `AUT-001` | **Show each member only admitted worlds.** Each known profile's libraries and direct world projection contain active memberships for that actor and no unrelated world summaries.                                                               | P0       | `UI`, `HTTP`; `happy`, `privacy`, `multi-actor`                |
| `AUT-002` | **Expose Build authority only to owners/editors.** Owners/editors can enter authoring and use its commands. Players/spectators remain in Play and receive an explicit area boundary rather than a partially functional Builder.                 | P0       | `UI`, `HTTP`; `happy`, `privacy`, `owner`, `editor`            |
| `AUT-003` | **Project profile fields by visibility.** Facilitators/controllers can read authorized active values; ordinary admitted members receive only completed table-visible prose. Restricted definitions and values are filtered before presentation. | P0       | `UI`, `MULTI`, `HTTP`; `happy`, `privacy`, `profile`           |
| `AUT-004` | **Project problem data by audience and lifecycle.** A non-facilitator reads only open/resolved problems in their audience and never facilitator-private notes or private receipt fields.                                                        | P0       | `UI`, `MULTI`, `HTTP`, `AUDIT`; `happy`, `privacy`             |
| `AUT-005` | **Bound player authorship to control/readiness/eligibility.** A ready eligible player can edit controlled profiles and submit/attribute only their own current action within the open lifecycle.                                                | P0       | `UI`, `HTTP`, `DB`; `happy`, `player`, `control`, `privacy`    |
| `AUT-006` | **Give spectators a read-only table projection.** An admitted spectator can read authorized public table/history content but has no configuration, profile edit, response, or Consequence authority.                                            | P0       | `UI`, `MULTI`, `HTTP`; `happy`, `spectator`, `privacy`         |
| `AUT-007` | **Keep every resource inside its world boundary.** Valid same-world references work across mechanics, controls, profiles, problems, effects, receipts, and events. No user-authored name conveys authority or scope.                            | P0       | `HTTP`, `DB`, `AUDIT`; `happy`, `privacy`, `atomic`            |
| `AUT-008` | **Filter live events by membership/readiness/visibility.** An authorized ready client receives only invalidations it may follow with authoritative reads; event data itself carries no sensitive prose.                                         | P0       | `MULTI`, `HTTP`, `AUDIT`, `RUNTIME`; `happy`, `privacy`, `sse` |

### 5.10 Resource lifecycle and archive

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                             | Priority | Scopes and tags                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| `LFC-001` | **Archive an independent mechanic while retaining history.** An author archives an active mechanic with no active dependency/status blocker. It leaves current sheets and new-effect choices, while retained stored values and historical receipts remain interpretable. | P1       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `archive`, `rules`   |
| `LFC-002` | **Archive dependency chains in safe order.** An author first archives every active derived dependent, then archives the dependency. The UI explains and respects that order rather than destructively cascading.                                                         | P1       | `UI`, `HTTP`, `DB`; `happy`, `archive`, `rules`            |
| `LFC-003` | **Archive an entity into read-only history.** An author archives an entity. It is excluded from new setup/live references and rejects mutation, while existing profiles, statuses, actions, and receipts retain their historical subject.                                | P1       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `archive`, `history` |
| `LFC-004` | **Archive a world after work is final.** The owner archives a world only after every problem is resolved/cancelled. Further configuration and play mutation stop.                                                                                                        | P1       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `archive`, `owner`   |
| `LFC-005` | **Keep final interaction history readable.** Resolved/cancelled problems and applied receipts remain stable through resource archives, navigation, and reload.                                                                                                           | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `happy`, `archive`, `history` |

`LFC-003` is supported by the current application contract but has no current
frontend archive command. It remains in the catalog as an explicit product
affordance gap and must not be implemented by quietly archiving an entity over
HTTP inside a journey. Until the UI exposes the action, its backend semantics
remain direct-contract coverage and `JRN-007` does not compose it.

### 5.11 Navigation, accessibility, and resilience

| ID        | Behavior, precondition, and expected outcome                                                                                                                                                                                                                  | Priority | Scopes and tags                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| `NAV-001` | **Follow canonical Play/Build navigation and deep links.** Users move deliberately between the neutral choice, libraries, world sections, table, and area-scoped invitation destinations; a bare authoring-world destination resolves to its default section. | P1       | `UI`, `A11Y`, `RUNTIME`; `happy`, `identity`                 |
| `NAV-002` | **Recover deliberately from an unknown route.** An unsupported destination renders a not-found state with a comprehensible route back instead of silently opening unrelated content.                                                                          | P2       | `UI`, `A11Y`, `RUNTIME`; `recovery`                          |
| `NAV-003` | **Protect dirty author drafts during navigation.** An unsaved mechanic/configuration draft warns before in-app or browser departure; save/discard choices have unambiguous outcomes and a saved draft can be reopened.                                        | P1       | `UI`, `A11Y`, `RUNTIME`; `recovery`, `keyboard`              |
| `NAV-004` | **Complete core journeys at narrow viewport.** Identity/invite, configuration, onboarding, and live-table tasks reflow to a usable single-column presentation without horizontal-page dependence or lost controls.                                            | P1       | `UI`, `A11Y`, `RUNTIME`; `responsive`                        |
| `NAV-005` | **Complete core journeys by keyboard/semantic controls.** A user can reach actions through the skip link and logical focus order, use labeled controls/fieldsets, operate dialogs including Escape-close, and perceive status/alert feedback.                 | P1       | `UI`, `A11Y`, `RUNTIME`; `keyboard`                          |
| `NAV-006` | **Ignore obsolete resource responses.** When navigation or selection changes while an earlier load is pending, the visible screen retains or adopts only the current destination's authoritative resource.                                                    | P2       | `UI`, `HTTP`, `RUNTIME`; `recovery`                          |
| `NAV-007` | **Reconnect live events from the last cursor.** After a stream ends, the browser reconnects from its last observed cursor, reloads authoritative resources, and converges without duplicate user-visible history.                                             | P1       | `UI`, `MULTI`, `HTTP`, `AUDIT`, `RUNTIME`; `recovery`, `sse` |
| `NAV-008` | **Present recoverable failures without runtime breakage.** Expected command/load failures render actionable feedback, preserve safe drafts where appropriate, and allow a supported retry/reload without blanking the application or claiming success.        | P1       | `UI`, `A11Y`, `RUNTIME`; `recovery`, `runtime-health`        |

## 6. Negative and exceptional outcome variants

Variants are not erased inside happy journeys. Each receives its own ID,
expected business outcome, priority, validation scopes, and coverage result. A
safe, non-mutating UI variant may run as a separately reported **spine rib**
immediately before the successful operation it reuses. It is eligible only when
the rejection leaves the spine at the same authoritative milestone or affects
a disposable sibling resource.

Where the UI cannot express malformed input or a forged reference, the variant
remains a business coverage obligation but is implemented by the direct
contract suite identified in the code map. It is not represented as a frontend
journey and does not get to mutate the lifecycle spine. Where a real frontend
action exists, the variant is a registered outcome of that action and its
attached HTTP/DB validators remain read-only. Fault variants may interrupt or
replay an exact browser-issued command, but may not manufacture a different
journey command. Exhaustive payload combinations continue to belong in focused
rules/application tests rather than being multiplied through the browser.

### 6.1 Authoring, configuration, and onboarding variants

| ID        | Changed precondition or attempted action; expected outcome                                                                                                                                                                       | Priority | Scopes and tags                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `WRL-V01` | **Reject invalid world details without creation.** The author submits missing/invalid visible details. Field feedback is attached to the authored input and no world, membership, roots, or event is created.                    | P1       | `UI`, `HTTP`, `DB`; `negative`, `atomic`                                  |
| `MEC-V01` | **Reject invalid numeric bounds or step atomically.** An authored default/bounds/step combination is invalid. Publication reports the relevant field and does not advance rules revision or partially change the graph.          | P0       | `UI`, `HTTP`, `DB`; `negative`, `rules`, `atomic`                         |
| `MEC-V02` | **Reject a type/arity-invalid expression graph.** A derived expression combines incompatible scalar kinds or invalid operands. The author gets a useful expression path and the prior graph remains active.                      | P0       | `UI`, `HTTP`, `DB`; `negative`, `rules`, `atomic`                         |
| `MEC-V03` | **Reject unknown, cross-world, or archived references.** A proposed active expression cannot consume a reference outside its valid active world graph. No information about a foreign resource and no graph mutation leaks.      | P0       | `UI`, `HTTP`, `DB`; `negative`, `rules`, `privacy`, `atomic`              |
| `MEC-V04` | **Reject self and multi-node cycles with a useful path.** Publication detects a concrete dependency cycle, reports its path, retains the previous definitions, and does not advance rules revision.                              | P0       | `UI`, `HTTP`, `DB`; `negative`, `rules`, `atomic`                         |
| `MEC-V05` | **Reject direct storage/effect mutability for derived mechanics.** A calculated mechanic cannot acquire input storage, be edited on a sheet, or become a scalar-effect target.                                                   | P0       | `UI`, `HTTP`, `DB`; `negative`, `rules`                                   |
| `CHF-V01` | **Block active requirement-set changes during unfinished play.** Adding/removing active field IDs while a problem is draft/open/adjudicating is rejected; field revision, readiness, and the in-flight problem remain unchanged. | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `negative`, `profile`, `atomic`              |
| `RST-V01` | **Keep an unassigned player waiting.** An admitted player with no controlled entity sees the waiting experience and cannot enter live problems/events.                                                                           | P0       | `UI`, `HTTP`; `negative`, `player`, `control`                             |
| `RST-V02` | **Keep an incomplete controller in setup and out of live resources.** A player whose controlled entities all miss active fields can save drafts but cannot enter live play until one becomes ready.                              | P0       | `UI`, `HTTP`; `negative`, `player`, `profile`, `privacy`                  |
| `RST-V03` | **Exclude incomplete/archived entities from new live references.** They cannot become context, acting-entity attribution, or effect targets, while retained historical references remain readable.                               | P0       | `UI`, `HTTP`, `DB`; `negative`, `control`, `archive`                      |
| `RST-V04` | **Deny player sheet-state mutation.** A player can read an authorized generated sheet but cannot directly alter mechanical inputs; state and revisions remain unchanged.                                                         | P0       | `UI`, `HTTP`, `DB`; `negative`, `player`, `privacy`                       |
| `RST-V05` | **Revoke profile/action authority when control is removed.** A stale controller screen cannot save a profile or attribute a new action after control removal. Existing values remain intact and filtered appropriately.          | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `negative`, `control`, `privacy`, `conflict` |

### 6.2 Invitation and live-play variants

| ID        | Changed precondition or attempted action; expected outcome                                                                                                                                                                                                                               | Priority | Scopes and tags                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `INV-V01` | **Close invalid, revoked, or expired invitations without membership change.** Preview/redeem explains that the link is unavailable without identifying more than appropriate; no membership or redemption is created. Expiry coverage may use controlled time.                           | P0       | `UI`, `HTTP`, `DB`; `negative`, `invite`, `privacy`, `atomic`           |
| `INV-V02` | **Preserve owner authority when another-role link is redeemed.** An existing owner using a player/editor/spectator link is not downgraded and no duplicate membership appears.                                                                                                           | P1       | `UI`, `HTTP`, `DB`; `negative`, `invite`, `privacy`, `idempotent`       |
| `PLY-V01` | **Reject presentation without an audience.** A persisted draft with no audience cannot open; the prompt remains unchanged and no open-problem event is emitted. The current frontend always supplies the table audience, so this is direct contract coverage rather than a journey step. | P0       | `HTTP`, `DB`, `AUDIT`; `negative`, `atomic`                             |
| `PLY-V02` | **Exclude non-ready responders and context.** Waiting/setup-required players and incomplete/archived entities are not eligible for new open-problem selections; crafted stale selection cannot bypass the rule.                                                                          | P0       | `UI`, `HTTP`, `DB`; `negative`, `player`, `privacy`                     |
| `PLY-V03` | **Enforce one current action per eligible player.** A second simultaneous offer cannot create two submitted actions. The visible current action and revision remain authoritative.                                                                                                       | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `negative`, `player`, `conflict`, `atomic` |
| `PLY-V04` | **Reject late submit/withdraw after submissions close.** A player acting from a stale open screen after adjudication begins gets a lifecycle conflict, no action changes, and an authoritative refresh.                                                                                  | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `negative`, `player`, `conflict`, `sse`    |
| `PLY-V05` | **Hide non-visible/adjudicating problems from non-facilitators.** A non-audience member never sees an open problem; all non-facilitators lose it during adjudication without receiving revealing event payload.                                                                          | P0       | `UI`, `MULTI`, `HTTP`, `AUDIT`; `negative`, `privacy`, `sse`            |

### 6.3 Consequence variants

| ID        | Changed precondition or attempted action; expected outcome                                                                                                                                                                                                      | Priority | Scopes and tags                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| `CON-V01` | **Reject invalid preview types/bounds/steps without persistence.** A scalar proposal has the wrong kind or an exact result outside authored constraints. Preview identifies the affected path/target and writes no state, status, receipt, lifecycle, or event. | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `consequence`, `rules`, `atomic` |
| `CON-V02` | **Reject scalar targeting of derived, immutable, or archived mechanics.** Such mechanics are absent from valid choices; a stale selection is still rejected by the system without mutation.                                                                     | P0       | `UI`, `HTTP`, `DB`; `negative`, `consequence`, `rules`, `archive`         |
| `CON-V03` | **Reject invalid status modifiers without partial application.** A modifier uses an incompatible operation/operand or invalid target. No status instance/snapshot, status revision, receipt, or event is created.                                               | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `status`, `rules`, `atomic`      |
| `CON-V04` | **Reject stale, removed, mismatched, or foreign exact-status targets.** Removal never falls back to a display-name lookup and never affects a different same-name instance.                                                                                     | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `status`, `privacy`, `atomic`    |
| `CON-V05` | **Roll back every earlier effect when a later effect fails.** An ordered plan has a valid early effect and invalid later effect. Neither base nor status snapshots change, the problem remains adjudicating, and no final receipt/event exists.                 | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `consequence`, `atomic`          |

### 6.4 Authorization and privacy variants

| ID        | Changed precondition or attempted action; expected outcome                                                                                                                                                                                                         | Priority | Scopes and tags                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------- |
| `AUT-V01` | **Deny outsider direct reads and commands.** A known identity without active membership cannot list/read the world or operate any world resource. No distinction leaks whether a guessed nested resource exists.                                                   | P0       | `UI`, `HTTP`; `negative`, `outsider`, `privacy`                 |
| `AUT-V02` | **Deny commands outside the actor's role.** The UI omits unsupported controls. Table-driven direct commands prove player/spectator configuration and facilitation denial, spectator response denial, and editor owner-only lifecycle denial, all without mutation. | P0       | `UI`, `HTTP`, `DB`; `negative`, `privacy`, `atomic`             |
| `AUT-V03` | **Omit restricted profile definitions and values from unauthorized responses.** The assertion inspects the response projection, not only the DOM, and confirms neither labels nor prose values are serialized.                                                     | P0       | `UI`, `HTTP`; `negative`, `privacy`, `profile`                  |
| `AUT-V04` | **Omit facilitator-private problem/receipt data.** Authorized non-facilitators receive the allowed public projection with private notes and facilitator-only receipt fields absent.                                                                                | P0       | `UI`, `HTTP`, `AUDIT`; `negative`, `privacy`, `history`         |
| `AUT-V05` | **Deny cross-world substitutions without disclosure.** Substituting a mechanic, entity, membership, action, status instance, or other durable ID from a second world fails and creates no cross-world relationship.                                                | P0       | `HTTP`, `DB`, `AUDIT`; `negative`, `privacy`, `atomic`          |
| `AUT-V06` | **Deny live interactions/events to onboarding players.** An active but not-ready player can access authorized onboarding resources and cannot read the live interaction collection or event stream.                                                                | P0       | `UI`, `HTTP`, `RUNTIME`; `negative`, `player`, `privacy`, `sse` |

### 6.5 Concurrency, conflict, idempotency, and atomicity variants

| ID        | Changed precondition or attempted action; expected outcome                                                                                                                                                                                       | Priority | Scopes and tags                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------- |
| `CCY-V01` | **Reject and recover a stale world-details command.** Two authors edit the same revision; the later stale save does not overwrite the winner and reloads/presents current details before an intentional retry.                                   | P1       | `UI`, `MULTI`, `HTTP`, `DB`; `conflict`, `recovery`, `atomic`                 |
| `CCY-V02` | **Reject and recover a stale rules-graph command.** Concurrent mechanic publication invalidates an older draft's expected graph revision. The stale draft cannot silently replace the complete graph.                                            | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `conflict`, `rules`, `atomic`                    |
| `CCY-V03` | **Reject and recover stale state/rules sheet save.** A direct setup save built from old entity state or graph revision preserves the winner and reloads both authoritative state and calculated values.                                          | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `conflict`, `rules`, `atomic`                    |
| `CCY-V04` | **Reject and recover a stale controller replacement.** Two facilitators replace the complete controller set from one table revision. Exactly one wins; the loser sees the authoritative set before deciding to retry.                            | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `conflict`, `control`, `atomic`                  |
| `CCY-V05` | **Reject and recover stale field/profile schemas.** A controller's profile draft built against an older field set cannot claim completion or discard newly required fields; prior saved values remain.                                           | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `conflict`, `profile`, `atomic`                  |
| `CCY-V06` | **Reject and recover stale interaction/action commands.** A participant acts from an old lifecycle/action revision. The winning command remains authoritative and the stale screen converges without a duplicate action or lifecycle transition. | P0       | `UI`, `MULTI`, `HTTP`, `DB`; `conflict`, `player`, `sse`, `atomic`            |
| `CCY-V07` | **Replay an equivalent resolve exactly once.** After a simulated lost response, the exact browser-issued resolve command with the same key/content returns the existing result. No effect, status, receipt, or event is duplicated.              | P0       | `UI`, `HTTP`, `DB`, `AUDIT`, `RUNTIME`; `idempotent`, `consequence`, `atomic` |
| `CCY-V08` | **Conflict on idempotency-key reuse with different content.** Reusing a captured key with a semantically different resolve payload does not reinterpret or replace the committed receipt.                                                        | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `conflict`, `idempotent`, `atomic`               |
| `CCY-V09` | **Let only one competing resolve commit.** Two facilitator contexts attempt first resolution of the same adjudicating problem. One immutable resolution wins; the other observes final state/conflict, with one transition and event.            | P0       | `UI`, `MULTI`, `HTTP`, `DB`, `AUDIT`; `conflict`, `multi-actor`, `atomic`     |

### 6.6 Archive, navigation, and resilience variants

| ID        | Changed precondition or attempted action; expected outcome                                                                                                                                                                   | Priority | Scopes and tags                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `LFC-V01` | **Block mechanic archive while active derived dependents remain.** The author receives the dependency explanation and both mechanics remain active until dependents are handled first.                                       | P0       | `UI`, `HTTP`, `DB`; `negative`, `archive`, `rules`, `atomic`            |
| `LFC-V02` | **Block mechanic archive while active statuses modify it.** The active status and mechanic remain interpretable; the author must remove the status through live Consequence history before archive.                          | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `archive`, `status`            |
| `LFC-V03` | **Block world archive while a problem is unfinished.** Draft/open/adjudicating work remains intact, world lifecycle is unchanged, and the UI directs the owner to finish or cancel it.                                       | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `archive`, `atomic`            |
| `LFC-V04` | **Reject mutation/new references to archived resources.** Archived worlds/entities/mechanics reject new writes or live selections while historical reads continue.                                                           | P0       | `UI`, `HTTP`, `DB`, `AUDIT`; `negative`, `archive`, `history`           |
| `NAV-V01` | **Show a deliberate access boundary for a non-editor Build deep link.** A player/spectator cannot render a misleading Builder; the UI explains the boundary and offers a deliberate route to their Play surface.             | P1       | `UI`, `HTTP`, `A11Y`; `negative`, `privacy`, `recovery`                 |
| `NAV-V02` | **Recover after an event-stream interruption.** Interrupt the transport without changing product state, commit a visible event while disconnected, then confirm cursor-based reconnection and authoritative convergence.     | P1       | `UI`, `MULTI`, `HTTP`, `AUDIT`, `RUNTIME`; `recovery`, `sse`            |
| `NAV-V03` | **Recover visibly from a transient resource failure.** A load fails once, presents an actionable state, and succeeds through the supported reload path without stale cross-resource content.                                 | P2       | `UI`, `HTTP`, `A11Y`, `RUNTIME`; `recovery`                             |
| `NAV-V04` | **Avoid blank/false-success state on command failure.** An expected command rejection keeps the last authoritative view or safe local draft, announces failure, and never shows a success notice or fabricated new resource. | P0       | `UI`, `HTTP`, `A11Y`, `RUNTIME`; `negative`, `runtime-health`, `atomic` |

## 7. Global invariants

Global invariants run at the relevant checkpoint even when a scenario expects a
business rejection. They are distinct from scenario-specific assertions.

| ID        | Invariant                                                                                                                                                                                                                                                      | Priority | Scopes                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| `GLO-001` | **UI-only mutation.** Every product mutation and mutable precondition in a canonical journey originates from rendered user behavior. Validators and probes are read-only; idempotency replay may repeat only the exact browser-issued command.                 | P0       | `UI`, `HTTP`, `DB`, `RUNTIME`             |
| `GLO-002` | **Runtime health.** No unexpected page exception, console error, failed application asset, uncaught promise, or unexpected server error occurs. Expected negative responses are allow-listed by scenario ID and outcome.                                       | P0       | `RUNTIME`                                 |
| `GLO-003` | **World isolation.** Every resource, reference, authorization decision, receipt, and event remains in exactly one world. User-authored display names never establish identity or authority.                                                                    | P0       | `HTTP`, `DB`, `AUDIT`                     |
| `GLO-004` | **Atomic failure.** A rejected publication, save, transition, or lifecycle command leaves every affected revision, root, child row, history item, and event unchanged.                                                                                         | P0       | `HTTP`, `DB`, `AUDIT`                     |
| `GLO-005` | **UI/system agreement.** Visible success is backed by authoritative state, and committed authoritative success becomes visible to the authorized actor. A UI-only optimistic illusion is a failure.                                                            | P0       | `UI`, `HTTP`, `DB`                        |
| `GLO-006` | **Sensitive-data minimization.** Unauthorized HTTP and event projections omit restricted profile prose, facilitator-private content, bearer tokens, and hidden interaction data; hiding DOM elements is insufficient.                                          | P0       | `UI`, `HTTP`, `AUDIT`, `RUNTIME`          |
| `GLO-007` | **No privileged vocabulary or classes.** All example mechanic, field, status, and entity names are authored during the run. The journey engine, product, database, and assertions attach no behavior to those names and create no built-in entity taxonomy.    | P0       | `UI`, `HTTP`, `DB`                        |
| `GLO-008` | **Immutable final history.** Final interaction roots, applied receipts, status modifier snapshots, and committed events remain stable through retries, later configuration, status removal, and archive.                                                       | P0       | `DB`, `AUDIT`                             |
| `GLO-009` | **Eventual live convergence.** Every authorized open browser reaches the same authoritative visible state after a committed event; unauthorized or not-ready browsers do not gain visibility.                                                                  | P0       | `UI`, `MULTI`, `HTTP`, `AUDIT`, `RUNTIME` |
| `GLO-010` | **Accessible interaction.** Core commands have semantic names/labels, visible focus, keyboard operation, understandable status/error announcement, and usable responsive presentation.                                                                         | P1       | `UI`, `A11Y`                              |
| `GLO-011` | **Deterministic isolation and waits.** The spine has only its declared milestone dependencies; every independent test is order-independent. All use unique authored data, isolated actor contexts, and observable business state rather than arbitrary sleeps. | P0       | `UI`, `MULTI`, `RUNTIME`                  |
| `GLO-012` | **Diagnostic evidence without secret leakage.** A failure preserves a useful timeline, trace, screenshot/video as configured, response/error metadata, and server log window while redacting raw invite tokens and sensitive prose.                            | P1       | `RUNTIME`, `AUDIT`                        |

## 8. Coverage and risk plan

### 8.1 Risk dimensions

Prioritization considers the highest applicable dimension:

| Risk                            | Highest-risk examples                                                                        | Required evidence                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Core reachability               | Create world, join, become ready, present/respond/resolve                                    | At least `UI` plus authoritative `HTTP`/`DB`; `MULTI` for live paths       |
| Privacy/authority               | Restricted profiles, private adjudication, outsider/cross-world access, spectator projection | Unauthorized status **and** sensitive-field absence at `HTTP`/event scope  |
| Irreversible or durable history | Resolve, status apply/remove, archive                                                        | `DB` and `AUDIT` evidence, replay/immutability checks                      |
| Atomicity                       | Graph publication, controller/schema replacement, multi-effect resolve                       | Before/after read-only snapshots and absence of partial rows/events        |
| Concurrency                     | Complete replacements, lifecycle transition, live resolve                                    | Independent actor contexts, one winner, visible loser recovery             |
| Freshness                       | SSE invalidation, rule changes, readiness regression                                         | `MULTI` convergence without an unplanned refresh, then authoritative reads |
| UX/accessibility                | Identity/invite continuity, onboarding, dialogs, narrow table                                | `UI` and `A11Y` at desktop and one narrow viewport                         |
| Operational diagnostics         | Event reconnect, transient failure, runtime exception                                        | `RUNTIME` artifacts and no false success                                   |

### 8.2 Canonical-journey coverage matrix

`●` is primary coverage; `○` is incidental supporting coverage.

| Family | JRN-001 | JRN-002 | JRN-003 | JRN-004 | JRN-005 | JRN-006 | JRN-007 |
| ------ | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| IDN    | ●       | ●       |         |         | ○       | ○       |         |
| WRL    | ●       | ○       |         |         |         | ●       | ○       |
| MEC    | ●       |         | ○       | ●       |         | ●       | ○       |
| CHF    | ●       | ●       |         |         | ○       | ●       |         |
| RST    | ●       | ●       | ○       | ○       | ○       | ●       | ●       |
| INV    |         | ●       |         |         | ●       | ●       |         |
| PLY    |         |         | ●       | ●       | ●       | ○       | ○       |
| CON    |         |         | ●       | ●       | ○       |         | ○       |
| AUT    | ○       | ●       | ●       | ○       | ●       | ●       | ○       |
| CCY    |         |         | ○       | ○       |         | ○       |         |
| LFC    |         |         |         | ○       |         |         | ●       |
| NAV    | ○       | ○       | ○       | ○       | ○       | ○       | ○       |

The matrix is not sufficient by itself. A coverage report must also show every
behavior ID's registered frontend driver, every declared outcome contract,
every variant execution, and every required validation scope. Incidental
coverage does not satisfy a scenario's dedicated negative contract.

### 8.3 Depth versus exhaustive matrices

The browser suite proves representative cross-layer behavior. Pure rules and
application tests remain the exhaustive authority for expression-operation
combinations, decimal edge cases, transport-shape permutations, and database
constraint details. Scenario tests select representative values that exercise
the business distinction and then use deep observers for the commit:

- one numeric and one Boolean input plus numeric/Boolean derived examples;
- one public and one restricted character field;
- one direct scalar change and one transitive derived change;
- one status with no modifiers and one with ordered modifiers;
- same-name distinct statuses and exact-instance removal;
- at least two worlds and all participant roles for isolation checks.

This avoids recreating the entire rules engine in browser data while retaining
the journeys as the authority for whether those rules produce a usable product.

### 8.4 Primary evidence tiers and cheap edges

Every scenario ID and named case has exactly one primary evidence tier. Other
observations may strengthen it, but cannot silently upgrade weaker coverage or
cause the same business operation to be repeated across browsers.

| Tier              | Intended coverage                                                                                                                                                                                                                   | Runtime rule                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `journey`         | `JRN-001` through `JRN-007` as checkpoints in the single lifecycle spine, plus safe inline ribs such as invalid visible input, partial onboarding, advisory preview, spectator projection, and the unfinished-work archive blocker. | Reuse the existing world, actor contexts, and next successful form. A rib must restore or preserve the current milestone.                     |
| `ui-boundary`     | Browser-only contracts that cannot be established by the spine: deep-link continuation, dirty-draft navigation, narrow/keyboard behavior, stale-screen recovery, event reconnection, and truthful transient-failure UI.             | Use the smallest supported setup, group compatible assertions, and never repeat the full author-to-table lifecycle or claim journey coverage. |
| `direct-contract` | Role/resource matrices, forged or cross-world references, stale revisions, expiry, idempotency, competing resolves, rollback, archive matrices, projection absence, and exact persistence/audit facts.                              | Run table-driven without a browser. Create only isolated, run-local, user-authored fixture state required by the contract.                    |
| `lower-layer`     | Exhaustive rule operations, scalar kinds, decimal boundaries, graph paths, effect permutations, transport mapping, pure route parsing, and migration constraints.                                                                   | Prefer deterministic frontend/Go/application tests measured in milliseconds.                                                                  |
| `harness-policy`  | Cross-cutting enforcement such as mutation-ledger integrity, runtime error collection, coverage ownership, redaction, and diagnostic completeness.                                                                                  | Attach once to the relevant execution or checkpoint rather than adding a product journey.                                                     |

Concurrency races, transport interruption, idempotent replay, malformed or
foreign references, controlled expiry, and broad actor/resource matrices are
not spine ribs: they can corrupt shared state, require special control, or are
cheaper and clearer as focused contracts. A scenario remains meaningfully
distinct at the business level even when its cheapest trustworthy evidence is
below the browser.

## 9. Complete implementation and runtime contract

This plan has one complete implementation delivery: add the scenario registry
and runtime, implement the lifecycle spine, attach every journey checkpoint and
safe rib, add the focused UI-boundary and direct-contract coverage, retain
exhaustive lower-layer ownership, enforce the harness policies, and remove
superseded browser duplication in the same change. No partial subset of
`JRN-001` through `JRN-007` is the target state.

Completion requires all of the following together:

- `lifecycle-spine.spec.ts` reaches all seven separately reported checkpoints
  from a clean database using only visible frontend mutations;
- every catalog ID and required named case is owned by `journey`,
  `ui-boundary`, `direct-contract`, `lower-layer`, or `harness-policy` evidence;
- one shared observation snapshot may satisfy several registered contracts,
  but each contract reports its own pass, failure, or `blocked-by` result;
- old broad browser tests are removed or narrowed once their registered
  coverage is present, so they do not rebuild the same world or replay the same
  lifecycle; and
- the complete repository E2E command meets the runtime gate below without
  retries, arbitrary sleeps, weakened assertions, seed vocabulary, or a
  back-channel mutation in the lifecycle spine.

### 9.1 Under-30-second whole-suite gate

The complete successful `./ci.sh e2e` wall clock must finish in **under 30
seconds** on the reference validation environment. Timing begins when the
command is invoked and ends when it exits; it includes frontend and backend
validation, dependency checks, production builds, database and server startup,
all lifecycle-spine/UI-boundary/direct-contract execution, reporting, and
cleanup. A browser-only selection, an individual test duration, excluded setup,
or a warm partial rerun does not satisfy this budget.

The design envelope leaves explicit headroom:

| Critical-path work                                                     | Target ceiling |
| ---------------------------------------------------------------------- | -------------- |
| Frontend/backend validation and reusable production artifacts          | 11 seconds     |
| Disposable database and application startup                            | 3 seconds      |
| All browser execution, including the lifecycle spine and UI boundaries | 10 seconds     |
| Direct contracts, coverage reporting, and cleanup                      | 3 seconds      |
| Reserved variability headroom                                          | 3 seconds      |

The wall clock, not the sum of separately reported test durations, is the
authority. The gate is accepted only after five consecutive retry-free
`./ci.sh e2e` runs each finish below 30 seconds. Failed-run trace capture may be
diagnosed separately, but successful runs record per-segment timing and query
counts so regressions identify their owner.

To stay inside the gate, the suite reuses build/server artifacts rather than
building again in browser setup, starts the browser once, creates actor
contexts lazily, performs the lifecycle only once, batches independent
read-only observations at milestones, and runs exhaustive matrices below the
browser. Increasing timeouts or excluding required coverage is not a runtime
optimization.

## 10. Change and review protocol

When product behavior changes:

1. Update or add the business scenario and its outcome contract here first.
2. Preserve existing IDs when meaning is unchanged; record replacement rather
   than recycling an ID.
3. Update the matching implementation locations in
   [code-mapping.md](code-mapping.md).
4. Update the behavior catalog/driver and validation adapters described in
   [architecture.md](architecture.md).
5. Run the smallest affected selection during development and the repository's
   authoritative validation before handoff.

A scenario review asks:

- Is this written as user intent rather than browser or transport mechanics?
- Are actor, preconditions, expected outcome, milestones, priority, and scopes
  explicit?
- Are every mutation and prerequisite authentic frontend actions?
- Do privacy assertions inspect serialized projections, not just visible DOM?
- Does an expected rejection also prove non-mutation?
- Does multi-user behavior use isolated contexts and observable convergence?
- Are examples wholly user-authored and free of privileged-name assumptions?
- Does the code map identify every implementation and validation region without
  moving low-level knowledge into this business plan?
