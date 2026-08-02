# Frontend

## Product surface

The React application is organized around a world, not around the underlying
rules-engine resources. A signed-in development identity sees only worlds it
owns or has joined. Authors configure three user-authored lists:

- **capacities**: numeric scores or pools carried by every entity;
- **capabilities**: binary or rated skills carried by every entity;
- **character fields**: ordered text prompts required for each player-controlled
  entity before it can enter play.

Entity sheets are generated from active mechanics. An entity controlled by an
active player is presented as that player's character, with a separately loaded
profile generated from the world's active character fields. Those values never
become engine state.
Problems are not a configuration resource in this UI. A facilitator describes
each problem at the table, players offer free-form actions, and the facilitator
resolves the moment with public narration and optional typed state effects.

The older generic ruleset/condition/configured-problem HTTP surface remains an
engine compatibility layer, but it is not linked or loaded by the frontend.

## Stack and source layout

The frontend is React 19 and strict TypeScript, built by Vite and managed with
Bun. It uses browser `fetch`, History API routing, local storage, and native
form controls. There is no router, global-state library, form framework,
component framework, or service worker.

| Path                              | Responsibility                                                        |
| --------------------------------- | --------------------------------------------------------------------- |
| `src/App.tsx`                     | Development identity gate and top-level route selection.              |
| `src/worldRoutes.ts`              | World/invite path parsing and URL construction.                        |
| `src/api/client.ts`               | JSON fetch adapter, errors, path helpers, and identity header.         |
| `src/api/types.ts`                | Compile-time contract for the world and live-play APIs.                |
| `src/components/StudioUI.tsx`     | Brand, fields, modal, notices, loading/empty states, avatars, roles.   |
| `src/features/WorldLibrary.tsx`   | Membership-filtered world library and world creation.                 |
| `src/features/WorldWorkspace.tsx` | Role-aware configuration/play shell.                                  |
| `src/features/MechanicsWorkspace.tsx` | Capacity/capability master-detail editor.                         |
| `src/features/CharacterFieldsWorkspace.tsx` | Atomic ordered character-requirement editor.                 |
| `src/features/PeopleWorkspace.tsx` | Members, invite creation, one-time token display, and revocation.    |
| `src/features/SettingsWorkspace.tsx` | World details and owner-only archive command.                       |
| `src/features/WorldPlay.tsx`      | Roster, generated sheets, ad-hoc problem lifecycle, history/receipts. |
| `src/features/EntityProfilePanel.tsx` | Configured-field reader/editor with completion and visibility.    |
| `src/hooks/`                      | Collection/resource loading, dirty guards, and SSE refresh.           |
| `src/styles/tokens.css`           | The only file allowed to contain literal design colors.               |
| `src/styles/app.css`              | Responsive library, editor, invitation, and dark play-table layouts.  |

ESLint includes hooks and JSX accessibility rules. Stylelint enforces tokenized
colors and bounded selector complexity. Prettier, TypeScript, Bun tests, and
Knip are all part of frontend CI.

## Routing and identity

Routes are parsed without an external router:

| URL                                                   | Surface                         |
| ----------------------------------------------------- | ------------------------------- |
| `/worlds`                                             | Current identity's world list.  |
| `/invite/{opaque-token}`                              | Public invite preview/redeem.   |
| `/worlds/{world-id}/capacities/{mechanic-id?}`        | Capacity catalog/editor.        |
| `/worlds/{world-id}/capabilities/{mechanic-id?}`      | Capability catalog/editor.      |
| `/worlds/{world-id}/character-fields`                 | Required character-field editor. |
| `/worlds/{world-id}/people`                           | Members and invite links.       |
| `/worlds/{world-id}/settings`                         | World details/lifecycle.        |
| `/worlds/{world-id}/play`                             | Live table.                     |

Unknown paths fall back to `/worlds` behavior. A bare world path opens
capacities. Players and spectators who request configuration are sent to the
play surface in memory; the server independently enforces the same boundary.

`dnd.selected-user` stores the selected local-development user UUID. The API
client sends it as `X-DND-User-ID`. Invite URLs remain in the address bar while
the identity gate is shown, so choosing a profile returns the user to the
invitation rather than losing the token. This storage is an identity adapter,
not production authentication.

## World library

`WorldLibrary` requests only `GET /api/worlds`; it never enumerates rulesets.
Cards show the user's role, active member count, capacity/capability counts, and
last activity. Owners/editors can configure or enter play. Players/spectators
can only enter play. Creating a world immediately opens the capacity editor.

## Static configuration

The workspace sidebar contains exactly:

- Capacities;
- Capabilities;
- Character fields;
- People & invites;
- Settings;
- Enter play.

Capacity modes are `score` and `pool`. Capability modes are `binary` and
`rating`. Numeric definitions can declare default, minimum, maximum, step, and
unit. `mutable_during_play` determines whether the definition can be targeted
by a facilitator ruling. There are no privileged configured keys or predefined
mechanic names; stable internal keys are generated by the server and are not a
user-facing ontology.

The editor uses explicit save, a dirty/unload guard, archive rather than delete,
and a generated-sheet preview. Archiving removes a mechanic from new/current
sheet presentation while preserving stored values and historical receipts.

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

Redeeming a link creates matching world and game membership rows. Returning to
the same valid link as an existing active member is idempotent and does not
silently escalate the existing role.

## Play surface

The live table has three regions on wide screens: roster, current problem and
history, and selected entity sheet. It collapses to a single-column flow on
narrow screens.

An editor/facilitator can create a generic entity and optionally assign one or
more active players as controllers. Every active capacity and capability
appears automatically on its sheet, with configured defaults. Facilitators may
replace controller sets and make direct setup edits. During a ruling they can
apply effects only to active definitions whose `mutable_during_play` flag
permits it.

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
client does not request game, mechanics, interactions, or the event stream
until `play_status` becomes `ready`; it polls the world/entity summaries so a
DM assignment or profile save transitions into the live table. If requirements
later make the player incomplete, a stream close/reconnect also triggers the
same authoritative reload.

The interaction lifecycle is:

1. facilitator clicks **New problem** and writes the moment in free text;
2. optional ready context entities and play-ready player responders are selected;
3. players offer or withdraw one free-form action while the problem is open,
   optionally attributing it to one of their ready controlled entities;
4. facilitator closes submissions and enters private adjudication;
5. facilitator optionally selects an action, writes the public outcome, and
   adds typed effects;
6. preview validates the transition without writing;
7. resolve atomically stores state, the ruling receipt, lifecycle change, and
   event cursor;
8. resolved narration and before/after effects appear in world history.

There is deliberately no problem-template catalog, problem editor, or
pre-game problem route.

`useGameEvents` holds the authorized SSE stream and also refreshes every three
seconds as a compatibility fallback. Event data is treated as invalidation;
the client reloads authoritative game, entity, and interaction resources rather
than reconstructing state from the event payload.

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
