# Product glossary

This glossary is the single authority for Scryer product and architecture
vocabulary. The domain model and API reference define detailed behavior and
transport shapes; this document defines what their terms mean and how the
terms relate.

## Vocabulary ownership

Scryer keeps three kinds of vocabulary separate:

| Kind | Authority | Contents |
| ---- | --------- | -------- |
| Platform terminology | Defined by the product and this glossary. | Concepts such as World, Mechanic, Entity, Problem, Interaction, Consequence, and Resolution. |
| World-authored vocabulary | Defined by a world's authors and scoped to that World. | World and Entity names, Mechanic names, character-field labels and guidance, profile prose, and the World description. |
| Problem-authored vocabulary | Defined during one live Problem and its Consequence. | Problem prose, Action text, Consequence narrative and selected-Action summary, and inline status names, descriptions, and literal modifier values. |

World-authored and problem-authored terms are data, not built-in product
classes or privileged keys. The platform supplies their structure and
validation but does not seed their content.

## Scope, identity, and authority

| Term | Meaning |
| ---- | ------- |
| **World** | The sole authorization, configuration, entity, live-play, history, and event boundary. |
| **World configuration** | Durable user-authored setup belonging to one World, including Mechanics and character fields. Problems and status catalogs are not configuration. |
| **World description** | World-authored prose that orients invited members and serves as Terra's world brief. It does not define mechanical behavior. |
| **World mechanic graph** | The World's complete Mechanic definitions and the dependency references among derived Mechanics. It is one aggregate within the World, not another product scope. |
| **Revision** | An optimistic concurrency version for one mutable aggregate. A command supplies the revision it observed and conflicts if that aggregate has advanced. |
| **Rules revision** | The optimistic concurrency version of the world mechanic graph. |
| **World roster** | The World's memberships, Entities, and control relationships considered as one concurrency boundary. It is not another authorization scope or a synonym for Play. |
| **Roster revision** | The optimistic concurrency version used when World roster membership, Entity, or control composition could race. |
| **User account** | An authenticated real-person identity. |
| **World membership** | A user account's durable relationship to one World. |
| **Membership role** | A World membership's durable access level: owner, editor, player, or spectator. It governs World and Build authority. |
| **Facilitator assignment** | The World's designation of exactly one facilitator source: a human World membership, Terra, or an agent. |
| **Facilitator source** | The authorial source selected by the facilitator assignment: human, Terra, or agent. |
| **Facilitator** | The product label and domain authority for the source that authors and adjudicates Problems. A human facilitator is an assigned active non-spectator membership; Terra and an agent are non-membership facilitator sources. |
| **Current play role** | A membership's derived responsibility in Play: facilitator, player, or spectator. It does not change the membership role. |
| **Membership status** | A World membership's lifecycle state: `active` or `left`. It is not play readiness. |
| **Play status** | A membership's derived player-seat readiness: `waiting-for-character`, `setup-required`, `ready`, or `unavailable` when the membership is inactive. It remains distinct from membership status and current play role. |
| **Invite** | A revocable, expiring bearer link that grants a configured non-owner membership role. |
| **Controller** | An active non-spectator World membership connected to an Entity through the control relationship. Controller is a relationship, not a membership role. |

Use **membership role**, **current play role**, or **play status** instead of an
unqualified “role” or “status.” Use **current player** when live-play behavior
depends on the derived play role rather than the durable player membership
role. Contextual API and database fields such as a World membership's `role`
or an Interaction's `status` retain those compact spellings because their
owning resource supplies the qualification; product and architecture prose
must name the qualified concept.

## Entities and presentation

| Term | Meaning |
| ---- | ------- |
| **Entity** | A durable fictional subject that owns mechanical state. |
| **Character** | The product projection of an Entity with at least one active non-spectator Controller. Character is not an engine class. |
| **Character status** | An Entity's derived control/onboarding state: `not-controlled`, `setup-required`, or `ready`. It is distinct from play status and Status instances. |
| **Character field** | An ordered, world-authored required text prompt shared by controlled Entities. |
| **Character-field visibility** | `world` exposes a completed field value to active World members; `restricted` limits it to Controllers, owners/editors, and the designated human facilitator. Product prose calls these world-visible and restricted. |
| **Character-field set** | The World's complete ordered active character-field configuration and its revision. |
| **Entity profile** | One Entity's nonmechanical text values for the World's character fields. |
| **Entity sheet** | The generated mechanical view of an Entity's Mechanics, logical input values, evaluated values, and active status instances. |

A profile is prose; a sheet is mechanical state. Neither field labels nor
Entity names determine mechanical behavior.

## Mechanics and state

| Term | Meaning |
| ---- | ------- |
| **Mechanic** | A world-scoped typed scalar definition that applies to every Entity. Each Mechanic has an author-facing classification, mode, and source. |
| **Capacity** | A numeric Mechanic classified as a score or pool. |
| **Capability** | A Boolean binary or numeric rating Mechanic. |
| **Mode** | A Mechanic's author-facing shape: score, pool, binary, or rating. |
| **Value kind** | The scalar type of a Mechanic: number or Boolean. |
| **Input mechanic** | A Mechanic that owns an authored default and may have a stored override for an Entity. |
| **Derived mechanic** | A Mechanic that owns a typed expression over other Mechanics and has no stored override. |
| **Stored override** | An optional persisted input value for one Entity and one input Mechanic. |
| **Logical input value** | An input Mechanic's stored override when present, otherwise its authored default. Scalar Effects read and change this value. |
| **Logical state** | The complete map of logical input values for one Entity. Derived values and status modifiers are not stored in it. |
| **Intrinsic value** | An input's logical input value or a derived Mechanic's expression result, before modifiers targeting that Mechanic. |
| **Effective value** | A Mechanic's intrinsic value after Status modifiers from active instances. Derived references consume effective values. |
| **Status set** | One Entity's collection of active and historical Status instances, with its own optimistic revision. |

State language should name the relevant layer: **stored override**, **logical
input value**, **logical state**, **intrinsic value**, or **effective value**.

## Live play and history

| Term | Meaning |
| ---- | ------- |
| **Problem** | The user-facing prompt presented during Play. It is improvised, never reusable World configuration. |
| **Interaction** | The technical lifecycle aggregate that carries a Problem, its audience, responders, context Entities, Actions, adjudication, and conclusion. |
| **Audience** | The memberships allowed to see a presented Interaction. |
| **Responder** | A ready current player eligible to submit one Action to an Interaction. |
| **Context Entity** | An Entity included as relevant context for a Problem. Context does not grant control or mutation authority. |
| **Action** | One eligible responder's submitted response to a Problem. Passing is stored as an ordinary Action. |
| **Adjudication** | The phase in which Action entry is closed and the facilitator authors the Consequence. |
| **Consequence** | The public narrative of what transpires, optional selected-Action metadata, and zero or more ordered requested Effects. Its definition does not depend on who authored it or whether Luna compiled its Effects. |
| **Effect** | A requested set, numeric adjustment, status application, or exact status removal in a Consequence. |
| **Inline status** | The name, optional description, and ordered status modifiers authored inside one apply-status Effect. |
| **Status instance** | A durable, Entity-specific snapshot created for one apply-status target, with source provenance and immutable modifier snapshots. |
| **Status modifier** | A literal operation from a Status instance that participates in effective-value evaluation. It is not a Consequence Effect. |
| **Application** | The concrete per-target result of executing one requested Effect. |
| **Effective change** | A recorded before/after effective value that changed during Resolution, including transitive derived changes. |
| **Resolution** | The committed conclusion of an Interaction. It applies the Consequence and finalizes the Interaction atomically. |
| **Resolution receipt** | The immutable audit tree for a committed Resolution: Consequence, requested Effects, Applications, effective changes, provenance, and matched rules revision. |
| **World event** | An append-only invalidation cursor and resource reference. It tells clients what to reload; it is not a state snapshot. |

Use **Problem** in product language and **Interaction** for the API, database,
and lifecycle aggregate. Use **Consequence** for the authored plan before
commit, **Resolution** for the committed conclusion, and **resolution receipt**
for its immutable audit record.

## Facilitation components

| Term | Meaning |
| ---- | ------- |
| **Human facilitator** | The active non-spectator membership selected by the facilitator assignment. The person authors a Consequence and decides whether to commit it. |
| **Terra** | A non-membership facilitator source that authors Problems and Consequences through server-side model calls and resolves them autonomously. |
| **Agent** | A non-membership facilitator source that accepts Problem and Consequence authorship from an authenticated page agent while the signed-in membership remains a current player. |
| **Luna** | The compiler that converts Consequence narrative into optional selected-Action metadata and ordered Effects. Luna is not a facilitator source and does not commit Resolutions. |
