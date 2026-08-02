# Workflows

## Create and configure a world

1. Choose or create a local development profile.
2. Create a world from **Your worlds**.
3. Define the capacities that every entity may carry. Choose score or pool and
   configure the numeric default/bounds/step/unit.
4. Define the capabilities that every entity may carry. Choose binary or
   rating.
5. For each definition, decide whether a facilitator may change it in a live
   ruling.
6. Invite editors, players, or spectators through expiring links.
7. Enter play and create the roster. Sheets are generated from the active
   capacity/capability definitions.

Names and keys are ruleset-scoped and user-authored. Do not introduce a
canonical list of attributes, skills, entity classes, or privileged keys.

## Join a world

1. Open `/invite/{token}`.
2. If no local identity is selected, choose one without losing the invite URL.
3. Review the world, inviter, and offered role.
4. Redeem the link.
5. The world now appears in **Your worlds** and the user receives matching
   world/game membership.

Invite tokens are bearer secrets. Share them only with intended recipients;
authors can revoke a link at any time.

## Run an ad-hoc problem

Problems are runtime moments, never authored configuration.

1. The facilitator enters play and clicks **New problem**.
2. Write what is happening, with an optional short title.
3. Optionally select context entities and choose eligible player responders.
4. Present the problem. It becomes open and visible to its audience.
5. Eligible players offer one free-form action each; they may withdraw while
   the problem remains open.
6. The facilitator begins the ruling. The interaction becomes adjudicating and
   is hidden from non-facilitators until it is resolved.
7. Optionally choose the action at the center, narrate what becomes true, and
   add effects against mutable capacities/capabilities.
8. Preview to validate exact bounds, steps, permissions, and state revisions
   without writing.
9. Resolve with a fresh idempotency key. State changes, the immutable receipt,
   action selection, interaction status, and event cursor commit together.

The facilitator may also make a narrative-only ruling. A problem may be
cancelled before resolution. A world cannot be archived while any interaction
is draft, open, or adjudicating.

## Prepare and edit entity sheets

Creating an entity creates an empty normalized state root and assigns it to the
world's primary game. Logical defaults make every active universal mechanic
appear immediately; default values need not be redundantly stored.

Facilitators can use **Save sheet** for setup changes. The request supplies the
current state revision and replaces the logical state atomically. A stale
revision returns `409 revision_conflict`; reload before retrying.

During game time, prefer effects in a resolved ruling because they produce an
immutable before/after receipt. Direct sheet changes are intended for setup and
correction and do not append a game event.

## Archive resources

- Archive a capacity/capability when it should stop appearing on current sheets.
  Existing stored values and receipts remain.
- Revoke an invite to prevent future redemption; existing members remain.
- Archive a world only after all active problems are resolved/cancelled. This
  archives its primary game and prevents further configuration/play mutations.

There is no destructive delete workflow in the world UI.

## Compatibility engine workflows

The normalized rules engine and trusted legacy endpoints still support owner
schemas, conditions, configured problem definitions/instances, and configured
choice resolution for compatibility and low-level testing. They are not part of
the Worldwright frontend product. New UI work must not reintroduce pre-authored
problems into the world configuration flow.
