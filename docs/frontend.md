# Frontend

## Stack

The frontend is a client-rendered React 19 + TypeScript 5.9 application built
with Vite 7 and managed with Bun. It intentionally has a small dependency
surface:

- no external router;
- no global/server-state library;
- no form or runtime-schema library;
- no component or CSS framework;
- no service worker or offline data layer.

Browser-native `fetch`, the History API, local storage, `crypto.randomUUID()`,
`<dialog>`, and React hooks provide the application infrastructure.

TypeScript is configured strictly, including unchecked-index and exact-optional
property checks. ESLint includes React hooks, refresh, and JSX accessibility
rules. Stylelint checks the global CSS, Prettier checks formatting, and Knip
checks unused code.

## Source layout

| Path                    | Responsibility                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `index.html`            | HTML shell, root element, and metadata.                                              |
| `src/main.tsx`          | React root, `StrictMode`, and global CSS imports.                                    |
| `src/App.tsx`           | Ruleset boot/loading/onboarding state and top-level feature selection.               |
| `src/routes.ts`         | Route type, labels, and final-path-segment parsing.                                  |
| `src/api/client.ts`     | Fetch adapter, error class, path helpers, and development identity storage.          |
| `src/api/types.ts`      | Compile-time HTTP contract used by the UI.                                           |
| `src/hooks/`            | Collection loading, draft protection, and live-game event refresh.                   |
| `src/domain/`           | Pure display/default/compatibility/duplication helpers with unit tests.              |
| `src/components/`       | Shared shell, workspace, primitives, state-value editor, and concrete-effect editor. |
| `src/features/`         | Screen-level data loading, editors, commands, and workflow UI.                       |
| `src/styles/tokens.css` | Color, spacing-adjacent, typography, radius, and shadow tokens.                      |
| `src/styles/app.css`    | Global component/layout/responsive styles.                                           |

## Boot and routing

`main.tsx` mounts `<App />` beneath `StrictMode`. `App` immediately loads
`/api/rule-sets` and chooses the selected ruleset from local storage or the
first returned item.

Boot states are:

- loading skeleton while rulesets load;
- retry/error view if the initial request fails;
- full-page ruleset onboarding when no rulesets exist;
- normal application shell when a ruleset is selected.

Routes are final pathname segments rather than a route tree:

| URL                    | Screen label      | Feature          |
| ---------------------- | ----------------- | ---------------- |
| `/app/overview`        | Setup guide       | `Overview`       |
| `/app/owner-schemas`   | Owner schemas     | `OwnerSchemas`   |
| `/app/state-variables` | State variables   | `StateVariables` |
| `/app/conditions`      | Conditions        | `Conditions`     |
| `/app/problems`        | Problems          | `Problems`       |
| `/app/entities`        | Entities          | `Entities`       |
| `/app/state`           | State inspector   | `StateInspector` |
| `/app/instances`       | Problem instances | `Instances`      |
| `/app/runtime`         | Runtime           | `Runtime`        |
| `/app/play`            | Play              | `Play`           |

Unknown/fallback segments render Overview without rewriting the address. A
navigation button uses `history.pushState`, updates React state, and moves focus
to `#main-content`. `popstate` re-reads the route. There is no nested route
outlet or URL-encoded selected resource.

The shell groups navigation as Start, Define, World, Simulate, and Play. It
contains a skip link, ruleset selector, create/edit ruleset controls, accessible
current-route state, and the main focus target. At narrow breakpoints the
ruleset selector and create/edit controls are hidden; ruleset management is
currently a wide-layout-only shell capability.

## Client state model

There is no global store or React context. Ownership is hierarchical:

1. `App` owns current ruleset and route.
2. Each mounted feature owns its selected resource and screen state.
3. `useCollection<T>` owns one collection request.
4. `useDraft<T>` owns the baseline and editable aggregate.
5. Successful commands replace/append returned resources in the local feature
   collection or explicitly reload it.

Unmounting a route discards its feature state. Draft protection is cooperative,
not application-wide: editors wired through `useDraft` are protected by the
main navigation and browser unload, while other forms may be discarded without
a prompt. Drafts are not durably stored.

### `useCollection`

The collection hook accepts a URL or `null`. A null URL disables the request and
clears its state. For an active URL it:

- starts a typed GET through the API adapter;
- aborts obsolete requests on path/version change;
- retains existing items while reloading the same path;
- clears items when the path changes;
- exposes `reload()` and `replaceItem()`.

Collections are not shared or deduplicated. Different features, and even one
overview screen, may issue independent requests for the same resource.

### `useDraft`

The draft hook keeps source, baseline, and draft values. Dirty state is computed
with `JSON.stringify`, which works for the JSON-shaped ordered editor models in
this application but should be reconsidered for non-JSON values or objects with
unstable key insertion order.

Dirty `useDraft` editors increment a module-level count, set
`document.documentElement.dataset.draftDirty`, and register `beforeunload`.
`confirmDiscardDraft()` uses the browser confirm dialog. `App` calls it for
route and ruleset-selector changes, and `ResourceWorkspace` calls it for
selection and creation changes.

`useDirtyGuard` by itself sets only the shared dirty marker. The State Inspector
uses that lighter guard, so main navigation and ruleset selection prompt, but
switching its entity or unloading the page does not. Browser `popstate`,
ruleset creation, condition/problem duplication, onboarding, and Play forms are
also outside the complete guard path.

### Local storage

| Key                                        | Value                                                 |
| ------------------------------------------ | ----------------------------------------------------- |
| `dnd.selected-rule-set`                    | Last selected ruleset UUID.                           |
| `dnd.selected-user`                        | Last selected development user UUID.                  |
| `dnd.selected-game.<ruleset-id>.<user-id>` | Last selected game for that ruleset/user combination. |

These are preferences/identity hints, not trusted authorization data or durable
draft storage.

## API integration

`api<T>()` uses relative paths and:

- adds `Accept: application/json`;
- adds `Content-Type: application/json` when a body is present;
- reads the selected user and adds `X-DND-User-ID` when non-empty;
- maps a failed fetch to status-0 `network_error` with a draft-preservation
  message;
- maps the server error envelope to `ApiError(status, code, message, fields)`;
- casts successful bodies to `T`.

There is no runtime validation of success payloads. `src/api/types.ts` is a
compile-time contract and must be kept synchronized with backend DTOs.

The error field map is retained but current screens usually render the general
message rather than attaching every error to its corresponding input.

Path helpers URL-encode IDs and construct ruleset/game/play bases. Normal
development and production both use relative `/api` calls; Vite proxies them
only during development.

## Shared UI infrastructure

### Application shell

`AppShell` is the responsive sidebar/top-navigation frame. It deliberately uses
buttons plus History API state rather than anchor-driven route components.

### Resource workspace

`ResourceWorkspace` is the common configuration master/detail pattern:

- searchable resource list;
- active/archived/all filter;
- optional grouping;
- create action;
- loading/retry/empty/no-match states;
- discard confirmation before selection changes;
- sticky list and editor layout on wide screens.

Resource-specific features supply title, metadata, grouping, and editor.

### UI primitives

`components/ui.tsx` contains headers, panels, fields, radio/check cards, save
bar, error/empty/loading states, status badges, and ordered-item controls. They
centralize semantics such as `aria-live`, alert roles, explicit button types,
and accessible reordering labels.

### Typed value editor

`StateValueEditor` renders metadata-driven controls for every value kind and
cardinality:

- short or long text;
- bounded/stepped number;
- explicit true/false Boolean choice;
- declared choice select;
- measurement amount plus unit;
- reference picker filtered by target schemas plus fallback name;
- repeated rows and explicit empty set for `many`.

The server remains authoritative for duplicate set values, exact decimals,
steps, bounds, reference scope, and archived resources. Frontend numeric
contracts and controls use JavaScript `number` and `valueAsNumber`, so the UI
cannot losslessly round-trip arbitrary exact decimals outside JavaScript's safe
precision.

### Concrete effect editor

`ConcreteEffectEditor` authors live ruling effects. For selected entities, it
offers only variables every selected entity can own. Operations are the
intersection of structural kind/cardinality compatibility and the variable's
explicit allowlist. It uses the typed value editor for `set` and single-scalar
inputs for add/remove.

## Screen behavior

### Overview

Loads owner schemas, state variables, entities, conditions, problems, and
instances and displays a six-step readiness guide. Readiness is presence-based,
not a deep validity audit. Each card navigates to its editor.

### Ruleset onboarding and details

`RuleSetOnboarding` creates name, stable key, and description. The key
auto-slugifies from the name until manually edited. The `RuleSetEditor` overlay
patches name and description while showing the durable key read-only.

### Owner schemas

Creates/replaces/archives label, key, and description. Its resource list is
archive-aware. Label-driven key slugging stops once the user diverges from the
generated key.

### Entities

Edits display name, optional key, schema capabilities, and archive state. It
shows state revision and warns that removing a schema can invalidate state or
bindings. Retained archived schemas remain visible but are not offered for new
selection.

### State variables

The largest configuration editor controls ownership, kind, cardinality,
options/units/bounds/references, missing behavior/default, default storage
normalization, presentation, condition eligibility, allowed operations, order,
and archive state.

Changing kind/cardinality rebuilds compatible defaults, clears incompatible
presentation, removes incompatible effects, and disables invalid condition
addressability. The catalog groups by presentation group and sorts by group,
display order, then label.

### Conditions

Authors ordered parameters and nested expression trees, supported predicates,
and quantifiers. Pure helpers generate readable summaries. A saved condition
can be evaluated with concrete entity bindings; the screen renders the root
met/unmet/unknown status and message plus the missing-state count. It does not
render the nested evaluation tree. Duplication is server-side.

### Problems

Authors a whole problem aggregate: instance schema template, ordered targets,
availability invocations, choices, automatic or condition-selected outcomes,
and ordered effects. New problems start with one blank automatic choice. Empty
consequence effects are intentionally valid. Local choice duplication generates
fresh owned IDs; server-side problem duplication deep-copies the entire
aggregate.

### Problem instances

Creates an entity from an active problem definition and binds supplied targets.
The definition/display identity is creation-only in this screen; existing
edits replace bindings with the current binding revision. The UI filters
eligible entities, avoids duplicates within a target, limits additions by
maximum/cardinality, displays minimum progress, and shows automatic
self-bindings. The server enforces the minimum and all binding invariants.

### State inspector

Loads one entity's logical state and derives applicable variables from schema
membership while retaining stored legacy/archived values. It distinguishes
stored, defaulted, and unknown provenance. Saving sends the complete override
map and expected state revision, then replaces the screen with the authoritative
response.

### Configured Runtime

Selects a problem instance and automatically previews each choice. It renders
availability/incomplete explanations, supports an explicit advisory preview,
and resolves applied choices with the binding revision guard. Applied-effect
rows show before/after/no-op state and condition evaluation. It reloads
instances after a commit.

### Play

Play is game-centric rather than problem-definition-centric. It manages:

- local development user selection/creation;
- games filtered to the selected ruleset and current user;
- facilitator game creation, membership, entity assignment, and archive;
- interaction feed and role/status capability controls;
- draft/present/adjudicate/cancel lifecycle;
- player action submit/withdraw;
- facilitator narrative, selected action, concrete effects, preview, and
  idempotent resolve;
- immutable resolved receipt display.

The client generates an interaction UUID before create. If create has an
ambiguous network failure, it GETs that UUID before deciding the create failed.
Resolve uses a client-generated idempotency key so an ambiguous committed
request can be retried safely.

The screen hides controls based on role/status for usability, but these are not
security checks. The server performs all authorization and visibility filtering.

## Live refresh

`useGameEvents` implements SSE with streaming `fetch`, rather than native
`EventSource`, so it can attach the development identity header.

For a selected game it:

1. opens `/api/games/{id}/events` with `Accept: text/event-stream` and identity;
2. incrementally decodes frames and tracks the latest `id:` cursor;
3. calls a supplied refresh callback for any frame with non-empty `data:`;
4. reconnects after 1.5 seconds using `?after=<cursor>`;
5. also calls refresh every three seconds as a compatibility fallback;
6. aborts the stream/timers when the game or component changes.

The parser does not use event payload content; any visible event invalidates
games, interactions, entities, variables, and available-entity collections.
This is deliberately simple and can cause redundant queries under frequent
events.

## Pure frontend domain helpers

| Module                       | Responsibility                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `domain/options.ts`          | Kind metadata, compatible controls/effects, condition eligibility, initial typed defaults/predicates, and slugging. |
| `domain/collections.ts`      | Immutable ordered item movement.                                                                                    |
| `domain/conditionSummary.ts` | Human-readable expression summaries with variable metadata.                                                         |
| `domain/problemDrafts.ts`    | Deep choice duplication with fresh owned IDs and collision-free keys.                                               |
| `domain/play.ts`             | Concrete effect operation/variable eligibility and initial effect construction.                                     |

Nested authored IDs use `crypto.randomUUID()` before submission. Reference IDs
to schemas/variables/conditions/entities are retained; owned nested resource IDs
are regenerated during duplication.

## Styling and responsive layout

The UI is a dark, global-CSS application. `tokens.css` defines palette,
semantic status colors, radii, shadows, and system font stacks. `app.css` owns
all component and responsive styling.

Wide layouts use a fixed sidebar, bounded main content, sticky resource lists,
and sticky save bars. At 980px the shell becomes a top navigation region,
ruleset management controls are hidden, and master/detail layouts collapse. At
680px form grids, headers, identity controls, and action areas stack. Loading
animation is disabled under `prefers-reduced-motion`.

Accessibility features include:

- skip link and focused main target after in-app navigation;
- semantic labels and fieldsets;
- `aria-current`, live regions, alerts, busy states, and accessible reorder
  labels;
- native dialog behavior for Play modals and an ARIA modal ruleset editor;
- strong focus-visible outlines;
- reduced-motion support.

There is no current automated axe audit, screen-reader matrix, localization
layer, or mobile browser project.

## Build behavior

Vite uses base `/`, proxies `/api` to `http://localhost:8080`, and writes the
production build to `web/static` with `emptyOutDir`. The correct production
build order is frontend first, Go binary second, because the Go compiler embeds
the current contents of that directory.

Generated assets are ignored by Git. Running `./ci.sh` does not populate the
active checkout's `web/static` because validation occurs in an isolated
worktree.

## Frontend tests and current gaps

Bun unit tests cover options/compatibility, condition summaries, problem draft
duplication, and live effect construction. Playwright covers label/role-based
authoring with one initial keyboard-focus check,
configured preview/resolve/rollback/defaults, role-separated Play, privacy,
idempotency, archival, multi-context live refresh, and SSE connection/event
coverage. Because live refresh retains a polling fallback, the test does not
isolate SSE as the cause of each UI refresh.

Current gaps include:

- no component-level React tests;
- no runtime API response validation;
- no lossless arbitrary-precision decimal round-trip through frontend controls;
- no shared query cache or request deduplication;
- no durable draft/offline support;
- no automated accessibility audit;
- desktop Chromium only in browser CI;
- field-level API errors are not consistently bound to individual inputs.

## Adding or changing a feature

1. Update `src/api/types.ts` with the backend wire contract.
2. Add pure compatibility/default/summary logic under `src/domain` and unit-test
   it when possible.
3. Reuse `useCollection`, `useDraft`, `ResourceWorkspace`, and typed editors
   where their semantics match.
4. Keep role-based hiding as UX only; add authorization in the backend.
5. Preserve revision/idempotency behavior on mutation workflows.
6. Exercise loading, empty, error, archive, narrow-screen, keyboard, and dirty-
   draft states.
7. Add a Playwright scenario for a new cross-layer workflow and update the
   corresponding docs.
