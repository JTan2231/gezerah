# Frontend

## Product surface

The React application presents two deliberately separate product areas over the
same world model. `/play` is the table and `/build` is the authoring studio; the
root route only asks which area the user wants to enter. A signed-in development
identity sees only worlds it owns or has joined. Authors configure three
user-authored lists:

- **capacities**: numeric input or derived scores/pools carried by every entity;
- **capabilities**: Boolean/numeric input or derived skills carried by every entity;
- **character fields**: ordered text prompts required for each player-controlled
  entity before it can enter play.

Entity sheets are generated from active mechanics and expose intrinsic versus
effective values plus active-status explanations. An entity controlled by an
active player is presented as that player's character, with a separately loaded
profile generated from the world's active character fields. Those values never
become engine state.
Problems are not a configuration resource in this UI. A facilitator describes
each problem at the table, players offer free-form actions, and the facilitator
resolves the moment with a Consequence: one public prose summary and optional
ordered typed scalar/status effects. Applying a status defines it in that
problem and snapshots it onto each affected entity.

## Stack and source layout

The frontend is React 19 and strict TypeScript, built by Vite and managed with
Bun. It uses browser `fetch`, History API routing, local storage, and native
form controls. There is no router, global-state library, form framework,
component framework, or service worker.

| Path                                        | Responsibility                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/App.tsx`                               | Neutral home, development identity boundary, redirects, and top-level area selection. |
| `src/worldRoutes.ts`                        | Play and Build path parsing plus URL construction.                                    |
| `src/api/client.ts`                         | JSON fetch adapter, errors, path helpers, and identity header.                        |
| `src/api/types.ts`                          | Compile-time contract for the world and live-play APIs.                               |
| `src/components/StudioUI.tsx`               | Brand, fields, modal, notices, loading/empty states, avatars, roles.                  |
| `src/features/HomeChoice.tsx`               | Data-free root choice between Play and Build.                                         |
| `src/features/BuildLibrary.tsx`             | Owner/editor Builder library and world creation.                                      |
| `src/features/PlayLibrary.tsx`              | Membership-filtered table picker.                                                     |
| `src/features/BuildWorkspace.tsx`           | Owner/editor-only Builder shell.                                                      |
| `src/features/PlayWorkspace.tsx`            | Independent Play shell and world loader.                                              |
| `src/features/RosterWorkspace.tsx`          | Builder entity, controller, profile, and direct sheet setup.                          |
| `src/features/RosterModals.tsx`             | Builder-only entity creation and controller assignment dialogs.                       |
| `src/features/EntityDetail.tsx`             | Shared profile tabs and generated sheet reader/editor presentation.                   |
| `src/features/MechanicsWorkspace.tsx`       | Input/derived mechanic and recursive expression master-detail editor.                 |
| `src/features/CharacterFieldsWorkspace.tsx` | Atomic ordered character-requirement editor.                                          |
| `src/features/PeopleWorkspace.tsx`          | Members, invite creation, one-time token display, and revocation.                     |
| `src/features/SettingsWorkspace.tsx`        | World details and owner-only archive command.                                         |
| `src/features/WorldPlay.tsx`                | Read-only live roster/sheets, ad-hoc problem lifecycle, history/receipts.             |
| `src/features/EntityProfilePanel.tsx`       | Character-field reader/editor with completion and visibility.                         |
| `src/hooks/`                                | Collection/resource loading, dirty guards, and SSE refresh.                           |
| `src/styles/tokens.css`                     | The only file allowed to contain literal design colors.                               |
| `src/styles/app.css`                        | Responsive library, editor, invitation, and dark play-table layouts.                  |

ESLint includes hooks and JSX accessibility rules. Stylelint enforces tokenized
colors and bounded selector complexity. Prettier, TypeScript, Bun tests, and
Knip are all part of frontend CI.

## Routing and identity

Routes are parsed without an external router:

| URL                                             | Surface                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `/`                                             | Neutral Play or Build choice; no API load.    |
| `/play`                                         | Current identity's table list.                |
| `/play/{world-id}`                              | Onboarding or live table.                     |
| `/play/invite/{opaque-token}`                   | Player/spectator invite preview and redeem.   |
| `/build`                                        | Editable-world list and world creation.       |
| `/build/{world-id}/capacities/{mechanic-id?}`   | Capacity catalog/editor.                      |
| `/build/{world-id}/capabilities/{mechanic-id?}` | Capability catalog/editor.                    |
| `/build/{world-id}/character-fields`            | Required character-field editor.              |
| `/build/{world-id}/roster`                      | Entity, controller, profile, and sheet setup. |
| `/build/{world-id}/people`                      | Members and invite links.                     |
| `/build/{world-id}/settings`                    | World details/lifecycle.                      |
| `/build/invite/{opaque-token}`                  | Editor invite preview and redeem.             |

Unknown paths render a not-found screen rather than silently opening a library.
A bare Builder world path canonicalizes to capacities. A player or spectator
cannot cause Play to render under a Build URL; the Builder shows an explicit
access boundary and offers a deliberate transition to Play.

`dnd.selected-user` stores the selected local-development user UUID. The API
client sends it as `X-DND-User-ID`. The root choice bypasses identity selection
and does not fetch users or worlds. Play, Build, and invite URLs remain in the
address bar while the identity gate is shown, so choosing a profile returns the
user to the requested area rather than losing the path or token. This storage is
an identity adapter, not production authentication.

## World library

Both libraries request `GET /api/worlds`. The Build library filters to
owner/editor memberships, offers world creation, and
opens the capacity editor. The Play library shows every admitted world and
emphasizes role, player readiness, table size, and last activity. Neither
library exposes actions belonging to the other area.

## Static configuration

The Builder sidebar contains exactly:

- Capacities;
- Capabilities;
- Character fields;
- Roster & sheets;
- People & invites;
- Settings.

Capacity modes are `score` and `pool`. Capability modes are `binary` and
`rating`. An input numeric definition can declare default, minimum, maximum,
step, and unit; an input Boolean defaults to false. A derived definition uses a
recursive expression builder with literal/reference leaves, typed numeric and
Boolean operations, comparisons, and conditionals. The editor filters
operations/references by expected kind for guidance; the server remains the
authority and rejects invalid types or cycles when saved. Only inputs may set
`mutable_during_play`.

The capacity and capability editors use explicit save, a dirty/unload guard,
archive rather than delete, and a generated-sheet preview. Archiving removes a
mechanic from new use while preserving stored input, active status snapshots,
and historical receipts. The server explains dependency conflicts when an
active derived mechanic still needs an archived target. There are no
privileged configured keys or predefined mechanic names; stable internal IDs
are not a user-facing ontology.

The character-field screen edits the whole ordered requirement set as one
draft. Each field has a user-authored label, optional guidance, and either
table or controller/DM visibility. Every published field is required; there is
no per-field required toggle. Publishing uses the current schema revision,
preserves durable IDs, and warns when adding/removing requirements can change
existing character readiness.

## People and invite links

Editors can mint player, spectator, or editor links with an expiry from one to
90 days. The raw token is returned only by the create response. The screen
builds the same-origin URL, offers a clipboard action, and warns that the token
will not be listed again. Existing invite rows show creator, role, use count,
expiry/revocation state, and an explicit revoke command.

Redeeming a link creates or reactivates one world membership. Returning to the
same valid link as an existing active member is idempotent and does not silently
escalate the existing role.

## Play surface

The live table has three regions on wide screens: roster, current problem and
history, and selected entity sheet. It collapses to a single-column flow on
narrow screens.

An editor/facilitator creates world entities, assigns active player
controllers, edits profiles, and makes direct setup sheet changes in the
Builder roster. Every active capacity and capability appears automatically on
the generated sheet. Inputs begin at configured defaults; derived values are
calculated from the current graph. The sheet displays active status chips,
labels derived fields as calculated, and can expand the modifier trail from
intrinsic to effective value. Builder inputs edit only base input values and
send both state and mechanic-rules revisions. Play renders sheets read-only.
Each active status exposes its optional description and the source problem, so
equal names remain distinguishable without becoming keys.

The roster labels entities controlled by the current membership as “Your
character” and otherwise names active controllers. The selected entity panel
has Character and Sheet tabs. Active controllers and facilitators fill the
configured fields and may save partial drafts; other members see only completed
table-visible prose. Mechanical sheet inputs remain disabled for players.
Profile values are fetched only for the selected entity rather than embedded in
the roster collection.

A player who has no controlled entity sees a waiting screen. A player whose
controlled entities are all incomplete sees only the onboarding profile UI,
including completion counts and every field they are authorized to fill. The
client does not request live interactions or the event stream until
`play_status` becomes `ready`; onboarding uses world/entity/profile resources.
If requirements later make the player incomplete, stream reconnect also
triggers an authoritative reload.

The interaction lifecycle is:

1. facilitator clicks **New problem** and writes the moment in free text;
2. optional ready context entities and play-ready player responders are selected;
3. players offer or withdraw one free-form action while the problem is open,
   optionally attributing it to one of their ready controlled entities;
4. facilitator closes submissions and enters private adjudication;
5. facilitator optionally selects an action and authors the **Consequence** as
   one public prose summary plus ordered targeted effects;
6. scalar `set`/`adjust-number` effects select entities and inputs; an
   `apply-status` effect selects entity targets and defines the status name,
   optional description, and ordered literal modifiers inline; a
   `remove-status` effect selects an exact active status instance for each
   entity target;
7. preview submits the mechanic rules revision and validates/evaluates the
   whole transition without writing;
8. resolve atomically stores base state, status instances/snapshots with source
   problem, resolution, and effect IDs, the receipt, lifecycle change, and
   event cursor;
9. resolved Consequence summary, direct applications, and effective
   before/after changes appear in world history.

There is deliberately no problem-template catalog, problem editor, or
pre-authored problem route.

`useWorldEvents` holds the authorized SSE stream and reconnects with its last
cursor when the connection ends. Event data is treated as invalidation; the
client reloads authoritative world, entity, and interaction resources rather
than reconstructing state from the event payload. `rules-updated` also reloads
the revision-wrapped mechanic catalog. Play waits until mechanic and entity
rules revisions agree before allowing a Consequence built from them.

## Client state and errors

`useCollection` and `useResource` abort obsolete requests, retain same-path
values during refresh, and expose explicit reload functions. Editors keep local
drafts; drafts are not persisted. Successful commands use returned resources
or reload the authoritative collection.

`api<T>()` sends same-origin JSON, maps the server error envelope to `ApiError`,
and exposes field errors where forms can attach them. Successful payloads are
compile-time typed but are not runtime-schema validated. Numeric controls use
JavaScript numbers, so arbitrary-precision decimal authoring is still an API-
only capability.

## Accessibility and responsive behavior

The UI uses semantic headings, fieldsets, labels, explicit button types, focus
rings, alert/status roles, an Escape-close modal, a skip link, and reduced-
motion handling. Desktop configuration uses a persistent sidebar and
master-detail editor. Below 950px it switches to a sticky world/section bar;
catalogs, forms, play roster, and sheets reflow rather than relying on horizontal
page scrolling.
