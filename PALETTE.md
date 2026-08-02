# World palette implementation plan

## Outcome

Add one optional, user-authored appearance palette to each world. The palette
is shared by every member of that world and compiles into coordinated light
Studio and dark Play presentation profiles.

The implementation follows the useful part of Arcade's palette system:

```text
relational color intent
    -> versioned frontend compiler
    -> validated semantic CSS tokens
    -> variables scoped to one world workspace
    -> ordinary component CSS
```

Only compact, scene-independent intent is persisted. Generated CSS colors are
never stored in PostgreSQL or accepted from the API.

## Decisions

- Appearance belongs to a world, not to an individual viewer.
- A world has zero or one appearance override in the first release.
- A missing override uses the current checked-in Worldwright colors exactly.
- The author chooses surface hue/colorfulness and may optionally choose a
  separate accent hue/colorfulness.
- The compiler owns lightness, foregrounds, borders, state colors, shadows,
  gamut mapping, and contrast.
- The same intent is compiled separately for the light Studio and dark Play
  contexts. These are presentation profiles, not a viewer light/dark setting.
- Owners and editors may change appearance for an active world. Players and
  spectators may read the resulting appearance but may not change it.
- Appearance changes restyle current and historical presentation. Resolution
  receipts and other historical records do not snapshot colors.
- Danger, success, membership-role, and other meaning-bearing status colors
  remain application-controlled and are not recolored by a world palette.
- The first release has no named palette catalog, per-entity palette, palette
  archive flow, import/export, or seeded palette row.
- The renderer model name is an internal format version, not ruleset
  vocabulary or a privileged configured key.

## Product behavior

### Default worlds

Creating a world does not insert appearance configuration. `appearance` is
`null` in the world response and the frontend uses its versioned standard
intent/fallback token snapshot. Existing worlds therefore retain their current
appearance without a data backfill.

### Editing appearance

Add an **Appearance** panel to World Settings. It launches a larger editor with:

- a surface color wheel;
- hue and colorfulness range inputs as precise, keyboard-accessible controls;
- **Follow surface** and **Custom accent** modes;
- a second wheel when a custom accent is enabled;
- side-by-side Studio and Play previews;
- a **Restore standard colors** draft action;
- explicit Cancel and Save actions;
- unsaved-change protection through the existing draft guard.

Restoring standard colors changes the local draft to the standard intent. It
does not write until Save is selected. Saving those values creates or updates a
normal user-authored appearance row; a special reset endpoint is unnecessary.

The editor must explain that hue and colorfulness select the world's material
identity while Worldwright derives readable surfaces and ink.

### Applying appearance

The active world's compiled variables are installed on `.world-workspace`, not
on `document.documentElement`. This gives the following behavior:

- the fixed sidebar, content, Play surface, and in-tree modals inherit the
  world palette;
- leaving the world automatically restores the application fallback;
- colors from one world cannot leak into another world or the identity gate;
- the world library remains a stable neutral surface while each card may use a
  small compiled swatch/monogram treatment;
- invite preview remains neutral in the first release.

The workspace should not render until its authoritative `World` resource has
loaded, so users never see an unthemed workspace followed by a themed one.

### Shared updates

Saving appearance appends a `world-appearance-updated` primary-game event in
the same transaction. `WorldPlay` includes the parent world's reload callback
in its existing SSE/poll invalidation path. Other members at the table then see
the new appearance without reconstructing state from the event payload.

The world library does not maintain an event stream; an already-open library
reflects a remote appearance change on its next normal reload.

## Palette intent and rendering contract

### HTTP shape

The material intent is a small tagged object:

```json
{
  "model": "worldwright-pigment-v1",
  "surface_hue": 28,
  "surface_colorfulness": 46,
  "accent_hue": 42,
  "accent_colorfulness": 72
}
```

The accent pair is optional. When both fields are absent, the compiler derives
a coordinated accent from the surface. Supplying exactly one accent field is
invalid.

| Field                  | Constraint                | Meaning                                 |
| ---------------------- | ------------------------- | --------------------------------------- |
| `model`                | Exact supported version   | Selects immutable compiler semantics.   |
| `surface_hue`          | Integer `0..359`          | Hue of the world's underlying material. |
| `surface_colorfulness` | Integer `0..100`          | Chroma strength of the material.        |
| `accent_hue`           | Optional integer `0..359` | Independent action/highlight hue.       |
| `accent_colorfulness`  | Optional integer `0..100` | Independent action/highlight chroma.    |

The TypeScript type must encode the accent pair as a discriminated union so a
partial pair is not representable in normal frontend code.

### Model versioning

`worldwright-pigment-v1` is a compatibility boundary. Once shipped, changing a
formula in a way that materially restyles existing stored intents requires one
of:

1. preserving the v1 compiler and adding a new model version; or
2. an explicit migration and documented compatibility decision.

Refactoring that produces byte-identical token output does not require a new
model.

### Compiler inputs

Create a frozen `standardWorldPaletteIntent` in frontend code. It is product
presentation fallback data, not a database seed or user-authored ruleset
vocabulary. Calibrate it so the generated standard snapshot preserves the
current Worldwright appearance.

Port only the proven color primitives needed from Arcade:

- sRGB/linear RGB conversion;
- OKLCH conversion;
- gamut clamping;
- luminance and contrast ratio;
- color distance;
- shortest-path hue interpolation;
- foreground lightness search for minimum contrast;
- CSS serialization.

Do not port Arcade's viewer-theme preference machinery, post-format model, or
the full application scene/material renderer unless the smaller compiler
cannot reproduce the required hierarchy.

### Profile compilation

Compile the same intent through two calibrated profiles:

- `worldwright-studio-v1`: warm/light page and raised-surface hierarchy;
- `worldwright-play-v1`: dark table, raised panels, fields, and luminous accent.

Users do not directly control lightness. Each profile owns fixed lightness and
maximum chroma ranges appropriate to its context. The profile derives:

- ordered page and surface levels;
- default and strong borders;
- primary, secondary, muted, and faint text;
- resting, hover, selected, and on-accent roles;
- sidebar surfaces and text;
- Play spotlight endpoints;
- color-aware shadow values.

The compiler must return both serialized CSS values and numeric rendered colors
so tests can validate contrast and state separation without reparsing CSS.

### Semantic token inventory

Define an exact, frozen `worldPaletteTokenNames` list. The initial inventory
should cover these roles; implementation may split a role only when a real CSS
consumer requires a separate value.

| Family             | Roles                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Studio canvas      | page, deep page, soft page, surface, muted surface                                            |
| Studio content     | primary text, soft text, muted text, faint text                                               |
| Studio interaction | border, strong border, accent, strong accent, soft accent, on-accent, focus ring              |
| Sidebar            | base, raised, selected, border, text, copy, muted, faint, accent                              |
| Play canvas        | page, raised surface, soft surface, field, border                                             |
| Play content       | primary text, soft text, strong text, muted text                                              |
| Play interaction   | accent, strong accent, on-accent, selection border, spotlight, transparent spotlight endpoint |
| Elevation          | soft, card, and modal shadows                                                                 |

Use usage-based names such as `--color-play-surface` and
`--color-accent-surface`; do not add hue-based names such as `--orange-500`.

The current variables in `web/frontend/src/styles/tokens.css` mix material and
hue names (`--paper`, `--ember`, `--night`, and `--play`). Migrate affected
rules in `app.css` to the new semantic names as part of the compiler phase.
Preserve fixed status and role tokens separately.

### Required validation

Every legal intent must compile safely. At minimum, validate:

- primary text at `7:1` against its primary surface;
- secondary/muted text at `4.5:1` against every surface where it is used;
- interactive borders and focus indicators at `3:1` against adjacent colors;
- increasing Studio surface hierarchy;
- distinct Play surface hierarchy;
- measurable separation between resting, hover, and selected states;
- complete, exact token names with no missing or unexpected outputs;
- finite, gamut-safe RGB channels and valid CSS serialization;
- standard intent output against a checked-in token snapshot;
- representative hue/colorfulness grids, both accent modes, and every boundary
  value in both profiles.

Prefer compiler formulas that make the entire accepted input domain safe. The
UI must not offer coordinates that only sometimes pass validation.

## Persistence

### Migration

Use the next available migration number. Migration `009` is currently present
for player-controlled entities, so this plan expects
`internal/migrations/010_world_appearance.sql` when implemented against the
current worktree.

Create a one-to-zero-or-one relational aggregate:

```sql
create table world_appearances (
    rule_set_id uuid primary key,
    material_model text not null,
    surface_hue integer not null,
    surface_colorfulness integer not null,
    accent_hue integer,
    accent_colorfulness integer,
    revision bigint not null default 1,
    created_by_user_id uuid not null,
    updated_by_user_id uuid not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
```

Add named constraints for:

- `rule_set_id` referencing `world_profiles(rule_set_id)` with cascade delete;
- creator/updater IDs referencing `users(id)` with restrict delete;
- `material_model = 'worldwright-pigment-v1'`;
- surface and accent hue ranges;
- surface and accent colorfulness ranges;
- the accent fields being either both null or both non-null;
- `revision > 0`.

Attach the shared `set_updated_at()` trigger. No secondary index is required
for the primary-key lookup.

Do not:

- insert rows for existing or newly created worlds;
- add a `system_key` or named built-in palette;
- store generated tokens, hex colors, CSS, or a JSON aggregate;
- reference the appearance from rules-engine state or receipts.

### Revision semantics

Appearance has an independent revision so a color edit does not conflict with
a simultaneous world name/description edit.

- Missing appearance has logical revision `0`.
- Creating the row requires `expected_revision: 0` and returns revision `1`.
- Replacing an existing row requires its exact positive revision.
- A successful replacement increments the appearance revision once.
- A mismatch returns the standard `409 revision_conflict` response.
- Lock `world_profiles` before testing row absence so concurrent first writes
  cannot both insert.
- Normalize and compare the complete intent before writing. An exact semantic
  no-op returns the current resource without a revision increment or game
  event.

## HTTP API

### World response

Extend every `World` response from `GET /api/worlds`,
`GET /api/worlds/{world_id}`, creation, update, and archive with an explicit
nullable field:

```json
{
  "appearance": {
    "material_intent": {
      "model": "worldwright-pigment-v1",
      "surface_hue": 28,
      "surface_colorfulness": 46
    },
    "revision": 3,
    "updated_at": "2026-08-02T12:00:00Z"
  }
}
```

Use `"appearance": null` when no override exists. Returning an explicit null
keeps absence distinct from an accidentally omitted scan/serialization field.
Audit fields may remain database-only in the first response contract.

Update `loadWorldResponse` with a left join. Keep the appearance summary in the
existing world load so the library and workspace do not issue a second read.

### Mutation route

Add:

```text
PUT /api/worlds/{world_id}/appearance
```

Authority: owner/editor of an active world.

Request:

```json
{
  "expected_revision": 0,
  "material_intent": {
    "model": "worldwright-pigment-v1",
    "surface_hue": 28,
    "surface_colorfulness": 46,
    "accent_hue": 42,
    "accent_colorfulness": 72
  }
}
```

Response: the saved appearance resource, including its authoritative revision
and `updated_at`.

Validation and errors:

- malformed JSON or unknown fields follow the existing strict decoder;
- unsupported model, out-of-range/non-integer coordinates, or a partial accent
  pair return `422 validation_failed` with field paths;
- missing/malformed world ID follows existing world routes;
- non-members remain hidden/forbidden through existing membership checks;
- players and spectators receive `403 world_editor_required`;
- archived worlds receive the existing `409 world_archived` behavior;
- stale appearance writes receive `409 revision_conflict` with expected and
  actual revisions.

Do not accept actor IDs, ruleset IDs, CSS values, or generated token maps in the
request.

### Transaction

The PUT handler transaction should:

1. resolve the current user and require active owner/editor membership;
2. lock `world_profiles` and obtain the primary game ID;
3. load `world_appearances` for update when present;
4. compare logical/current and expected revisions;
5. return immediately for a normalized semantic no-op;
6. insert or replace the complete appearance intent;
7. append `world-appearance-updated` to the primary game's event stream using
   the acting game membership;
8. commit;
9. return the authoritative saved appearance.

The database row and invalidation event must commit or roll back together.

## Backend work

### API types and normalization

Update `internal/app/api_worlds.go` with:

- `worldAppearanceMaterialIntentResponse`;
- `worldAppearanceResponse`;
- a nullable `Appearance` field on `worldResponse`;
- `replaceWorldAppearanceRequest`;
- request normalization that produces one canonical internal value.

Keep the model constant and validation helpers close to the world appearance
adapter. Appearance is presentation data and does not belong in
`internal/rules`.

### Handlers and storage

Prefer a focused `internal/app/handlers_world_appearance.go` rather than making
`handlers_worlds.go` substantially larger. It should own:

- route registration or the appearance route handler;
- intent normalization;
- row scan helpers;
- create/replace transaction orchestration;
- semantic equality;
- response loading.

Update `registerWorldRoutes` and `loadWorldResponse` in
`internal/app/handlers_worlds.go`. Extend the `game_events` type constraint in
the migration for `world-appearance-updated`.

Do not load appearance through domain snapshot loaders or pass it to the rules
engine.

### Backend tests

Add focused application tests for:

- accepted derived-accent and explicit-accent inputs;
- unsupported model;
- every numeric boundary and representative invalid values;
- partial accent pairs;
- canonical semantic equality;
- create revision zero semantics;
- stale-revision conflict mapping;
- owner/editor authorization and player/spectator denial through browser-backed
  coverage;
- archived-world denial;
- cross-world isolation;
- event insertion and atomic rollback through end-to-end coverage.

## Frontend work

### File layout

Add a small, local palette package:

```text
web/frontend/src/palette/
  color.ts
  types.ts
  worldPalette.ts
  worldPalette.test.ts
  snapshot.ts
  check.ts
  index.ts
```

Add settings UI components under the existing component/feature organization,
for example:

```text
web/frontend/src/components/appearance/
  WorldAppearanceEditor.tsx
  WorldAppearancePreview.tsx
  PaletteWheel.tsx
  paletteDraft.ts
```

If the components remain used only by Settings, colocating them under
`features/` is also acceptable; choose one location and keep all appearance
editor helpers together.

Do not add a third-party color library unless the ported, tested primitives are
insufficient.

### API types

Update `web/frontend/src/api/types.ts` with:

- `WorldPaletteMaterialIntent`;
- `WorldAppearance`;
- `World.appearance: WorldAppearance | null`;
- `ReplaceWorldAppearanceRequest` if request DTOs are named in this module.

Keep the material intent shape aligned with the API and use `undefined`/field
absence—not `null`—for the optional accent pair in requests.

### CSS token migration

1. Inventory every current color and shadow token and classify it as
   palette-derived or fixed semantic status.
2. Add the new semantic fallback tokens to `styles/tokens.css` with values that
   preserve the current default rendering.
3. Mechanically replace affected `app.css` consumers with semantic names.
4. Keep danger, success, role, and lifecycle tokens outside the generated
   allowlist.
5. Keep literal colors out of component CSS. `tokens.css` remains the complete
   CSS runtime-failure fallback, while compiler calibration and generated
   snapshot values live only under `src/palette`.
6. Remove legacy hue/material aliases after all consumers have migrated; do not
   leave permanent duplicate naming systems.

The palette checker must compare the generated token-name set with both the
frozen allowlist and fallback declarations so compiler/CSS drift fails CI.

### Workspace integration

In `WorldWorkspace`:

1. resolve `world.appearance?.material_intent ?? standardWorldPaletteIntent`;
2. compile it with `useMemo`;
3. assert or surface an impossible-invalid-state error during development;
4. install the complete token map through the workspace element's `style`;
5. pass `resource.reload` to `WorldPlay` so its event invalidation refreshes the
   parent world.

Do not imperatively mutate document-root styles. A typed helper should bridge
the custom-property record to `React.CSSProperties` in one place.

### World library integration

Compile each world's resolved intent for a small card identity treatment only:

- world monogram background/foreground;
- optional narrow wash or border accent;
- no wholesale recoloring of the library page or role/status pills.

Memoize at the world-card component boundary. The world list is capped, but a
palette compile should still occur only when its intent changes.

### Settings integration

Add the Appearance panel as a separate aggregate/form beneath world details.
It must:

- use the appearance revision rather than `world.revision`;
- use `0` when `world.appearance` is null;
- preview on every local draft change without writing;
- disable Save for an unchanged or invalid draft;
- retain the draft after an API error;
- accept the returned appearance as the new baseline after save;
- call `onWorldChanged` after save so the workspace applies authoritative data;
- participate in `useDirtyGuard` and before-unload protection;
- close on Escape only when doing so will not silently lose a dirty draft;
- expose all wheel behavior through labelled range inputs for keyboard and
  assistive-technology users;
- stack controls and previews cleanly at the existing `950px` and `680px`
  breakpoints.

## Palette validation command

Add a focused frontend command:

```json
{
  "scripts": {
    "check:palette": "bun scripts/check-palette.ts"
  }
}
```

The exact script filename may be `.ts` or `.mjs`; use the simplest form Bun can
execute without a build step. The command must:

- compile and validate the standard intent;
- compare the standard tokens with the checked-in snapshot;
- compare generated and fallback token names;
- validate both profiles across a representative coordinate grid;
- report useful token/contrast details on failure;
- exit nonzero on any issue.

Wire `bun run check:palette` into `run_frontend` in `ci.sh`, immediately after
CSS linting and before unit tests. Document it in `docs/testing.md`.

## Test plan

### Pure frontend tests

Cover:

- intent canonicalization and validation;
- derived versus explicit accents;
- hue wrap and shortest-path interpolation;
- gamut clamping and CSS serialization;
- contrast correction in both directions;
- exact standard snapshot;
- required/unexpected token detection;
- Studio and Play surface ordering;
- hover/selected separation;
- draft conversion, equality, restore-standard behavior, and validation;
- every hue/colorfulness boundary;
- representative grids for both profiles and both accent modes.

Avoid brittle component pixel snapshots. Test the compiler numerically and use
browser screenshots for visual inspection.

### End-to-end acceptance

Extend the world/play Playwright coverage with at least two browser contexts:

1. create a world and confirm it has `appearance: null`;
2. confirm the standard workspace remains visually/token-wise unchanged;
3. save a custom derived-accent palette as owner/editor;
4. reload and confirm the intent/revision persists;
5. verify the library card and workspace expose the compiled custom variables;
6. verify a player sees the same world appearance;
7. verify player and spectator PUT attempts are forbidden;
8. open two editor contexts and verify a stale appearance revision conflicts;
9. save a second appearance while another member is in Play and verify the
   event-driven world reload applies it;
10. verify another world retains the standard palette;
11. verify archived worlds retain appearance for reading and reject changes;
12. submit invalid/partial material intent directly and verify field errors.

Prefer assertions against persisted intent and installed CSS custom properties
over exact screenshot pixels in automated E2E.

### Manual visual verification

Use `./run.sh` for local inspection, then stop managed services when finished.
Check:

- standard, neutral, highly colorful, and custom-accent examples;
- Settings, mechanics, people, Play, entity Story/Sheet, modals, and history;
- hover, focus, disabled, selected, success, danger, and role states;
- desktop, `<=950px`, and `<=680px` layouts;
- reduced motion and keyboard-only operation;
- the absence of horizontal overflow in the palette editor;
- a remote appearance update while another browser remains in Play.

## Documentation updates required with implementation

Update the canonical documentation in the same change:

- `docs/README.md`: add world appearance to the system summary/invariants if
  terminology warrants it;
- `docs/architecture.md`: describe presentation intent, client compilation,
  scoped token installation, and event invalidation;
- `docs/domain-model.md`: add the optional world appearance aggregate and make
  its separation from mechanics/state explicit;
- `docs/api.md`: document the nullable world field, PUT route, payload,
  authority, revision, and errors;
- `docs/backend.md`: document handler/storage ownership and transaction;
- `docs/database.md`: document `world_appearances`, constraints, and absence
  semantics;
- `docs/frontend.md`: document the editor, compiler, semantic tokens, and
  workspace scope;
- `docs/workflows.md`: add authoring and restoring world appearance;
- `docs/testing.md`: document `check:palette` and coverage;
- `docs/security.md`: include appearance mutation in owner/editor authorization
  where route authority is catalogued.

`PALETTE.md` remains the implementation record until delivery. Once all work is
complete and canonical docs contain the lasting behavior, either mark this
plan complete or remove it in the final cleanup according to repository
preference.

## Delivery sequence

### Phase 1: Compiler and semantic-token foundation

- [ ] Add color primitives, types, compiler, validation, and snapshot.
- [ ] Define the standard intent and calibrate both profiles.
- [ ] Introduce semantic fallback tokens with no intentional visual change.
- [ ] Migrate affected CSS consumers and remove legacy aliases.
- [ ] Add unit tests and `check:palette`.
- [ ] Wire palette validation into `./ci.sh frontend`.
- [ ] Run `./ci.sh frontend`.

This phase must be independently shippable: there is no persistence or editor,
and the application still renders the standard palette everywhere.

### Phase 2: Persistence and API

- [ ] Add the next migration and event type.
- [ ] Add API DTOs and normalization.
- [ ] Add the focused appearance handler/transaction.
- [ ] Extend every World response with nullable appearance.
- [ ] Add backend tests for validation and helpers.
- [ ] Update API/database/backend/domain documentation.
- [ ] Run `./ci.sh backend`.

This phase must preserve world creation without inserting appearance rows.

### Phase 3: Scoped runtime application

- [ ] Apply compiled variables at `WorldWorkspace` scope.
- [ ] Add restrained world-card identity styling.
- [ ] Connect world reload to Play invalidation.
- [ ] Verify standard intent remains visually unchanged.
- [ ] Add frontend integration coverage.
- [ ] Run `./ci.sh frontend`.

### Phase 4: Appearance editor

- [ ] Add draft helpers and accessible palette wheel.
- [ ] Add Studio/Play previews.
- [ ] Add the Settings panel/modal and save workflow.
- [ ] Add restore-standard and dirty-guard behavior.
- [ ] Add responsive styling and frontend tests.
- [ ] Run `./ci.sh frontend`.

### Phase 5: End-to-end and documentation completion

- [ ] Add multi-role, revision, isolation, persistence, and live-update E2E.
- [ ] Perform manual visual verification at required breakpoints.
- [ ] Update all remaining canonical docs.
- [ ] Run `./ci.sh e2e`.
- [ ] Run full `./ci.sh` as the final validation.
- [ ] Stop any services started with `./run.sh`.

## Acceptance criteria

The palette work is complete when all of the following are true:

- [ ] Existing and new worlds without appearance rows render the current
      standard design without intentional drift.
- [ ] The database contains only normalized, ruleset-scoped palette intent and
      no generated colors, canonical JSON, system keys, or seeded palette rows.
- [ ] Owners/editors can save appearance; players/spectators cannot.
- [ ] Appearance uses an independent optimistic revision and stale writes fail.
- [ ] Surface-linked and custom accents both persist and compile correctly.
- [ ] Studio and Play receive coordinated but separately calibrated profiles.
- [ ] All generated text, controls, borders, and states satisfy the documented
      contrast and distinction checks.
- [ ] Fixed danger, success, and role semantics remain recognizable and
      accessible under every tested palette.
- [ ] Palette variables are scoped to one world and cannot leak across routes
      or worlds.
- [ ] Remote Play clients receive appearance changes through authoritative
      reload invalidation.
- [ ] Settings previews, dirty protection, keyboard controls, and responsive
      layouts work as specified.
- [ ] `check:palette`, frontend, backend, E2E, and full CI all pass.
- [ ] Canonical documentation matches the implemented behavior.

## Deferred extensions

Do not broaden the first implementation to include these. They can build on
the same compiler and intent model later:

- personal viewer `system`/light/dark preference;
- multiple named palettes within one world;
- per-entity, per-mechanic, per-profile-section, or per-interaction assignment;
- palette archive/reference management;
- palette import/export or cross-world copying;
- arbitrary raw hex foreground/background editing;
- historical palette snapshots on interactions or receipts;
- server-side CSS compilation.

A named palette catalog should be introduced only after there is a concrete
reuse or assignment surface. If that happens, use a ruleset-scoped relational
table and composite foreign keys, with no built-in named row or privileged key.

## Principal risks and mitigations

| Risk                                                                           | Mitigation                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Existing token names blur hue and usage.                                       | Complete the semantic-token migration before applying runtime overrides.                                      |
| Compiler output drifts from CSS fallbacks.                                     | Compare exact token names and the standard snapshot in `check:palette`.                                       |
| User coordinates create unreadable states.                                     | Restrict user intent to hue/colorfulness; derive lightness and enforce contrast for the full accepted domain. |
| A formula change silently restyles every world.                                | Treat `material_model` as an immutable, versioned rendering contract.                                         |
| World colors leak into the library or another world.                           | Install variables only on `.world-workspace`; use an explicitly scoped card swatch in the library.            |
| Appearance writes race with one another or world settings.                     | Use a dedicated revision and lock the world root during create/update.                                        |
| Remote players retain stale colors.                                            | Append a game event atomically and include world reload in the existing Play invalidation callback.           |
| The Arcade implementation is ported wholesale and adds unnecessary complexity. | Reuse only tested color math and compiler patterns needed by Worldwright's two profiles.                      |
| Highly colorful palettes overpower game semantics.                             | Cap profile chroma, keep semantic status colors fixed, and use restrained surfaces.                           |
