# Workflows

## Create and configure a world

1. Open `/`, choose **Build**, then sign up or sign in. Signup requires a
   username, display name, and password but no email address.
2. Create a world from the Builder library.
3. Define the capacities that every entity may carry. Choose score or pool,
   then choose an input with default/bounds/step or a derived typed expression.
4. Define capabilities the same way, using binary or rating scalar shape.
5. For each input, decide whether a facilitator may change it in a live
   Consequence.
   Derived values are calculated and cannot be targeted directly.
6. Open **Character fields** and publish the ordered text prompts that every
   player-controlled entity must complete. Labels and guidance are authored for
   this world; zero fields is valid.
7. Invite editors, players, or spectators through expiring links.
8. Open **Roster & sheets** in Builder. Create the roster and optionally assign
   active players as an entity's controllers; that entity is presented as their
   character. Sheets are generated from the active capacity/capability
   definitions.
9. Return to `/`, choose **Play**, select the world, and enter the live table.

Every mechanic publication validates the proposed complete graph and advances
the world rules revision. A type mismatch, invalid reference, or dependency
cycle rejects the save atomically and reports the expression path.

Names are world-scoped and user-authored. Do not introduce a canonical list of
attributes, skills, entity classes, or privileged names.

## Join a world

1. Open `/play/invite/{token}` for a player/spectator invitation or
   `/build/invite/{token}` for an editor invitation.
2. Sign up or sign in if needed; the invite URL remains intact throughout.
3. Review the world, inviter, and offered role.
4. Redeem the link.
5. The world now appears in the corresponding Play or Build library and the
   user receives one world membership.
6. A player waits for a DM to assign a controlled entity. After assignment,
   fill the world's required character fields. Partial drafts may be saved, but
   live play opens only after one controlled character is complete.

Invite tokens are bearer secrets. Share them only with intended recipients;
authors can revoke a link at any time. Preview and redemption both require an
authenticated account, and redemption binds the membership to that account.

## Run an ad-hoc problem

Problems are runtime moments, never authored configuration.

1. The facilitator enters the world through `/play` and clicks **New problem**.
2. Write what is happening, with an optional short title.
3. The UI automatically includes every active member whose play status is
   ready in the audience. Optionally select active uncontrolled or ready
   controlled context entities and choose eligible player responders.
   Onboarding players are excluded from the audience and responder choices;
   setup-required controlled entities are excluded from context.
4. Present the problem. It becomes open and visible to its audience.
5. Eligible players offer one free-form action each; they may attribute it to a
   ready controlled character and may withdraw while the problem remains open.
6. The facilitator begins adjudication. The interaction becomes adjudicating
   and is hidden from non-facilitators until it is resolved.
7. Optionally choose the action at the center and author the problem's
   **Consequence**: one prose summary plus ordered targeted effects. Each scalar
   effect changes one mutable input on one entity. An apply-status effect
   defines its name, optional description, and ordered literal modifiers inline
   for one or more entity targets; each remove-status effect selects one exact
   active status instance on one entity.
8. Optionally run an advisory preview with the current rules revision to
   validate exact bounds, steps, types, inline status modifiers, exact removal
   targets, permissions, status lifecycle, and resulting effective values
   without writing. Preview does not reserve the revision.
9. Resolve, with or without a prior preview, using a fresh idempotency key.
   Base-state changes, persistent status instances with source-problem
   provenance, modifier snapshots,
   effective-change receipt, action selection, interaction status, and event
   cursor commit together.

The facilitator may also commit a summary-only Consequence. A problem may be
cancelled before resolution. A world cannot be archived while any interaction
is draft, open, or adjudicating.

## Prepare and edit entity sheets

Creating an entity creates an empty normalized state root and status-set root.
Logical defaults make every active input appear immediately; derived mechanics
evaluate from the graph and need no stored row.

Facilitators use **Roster & sheets** in Builder for **Save sheet** setup
changes. The request supplies current state and rules revisions and replaces
only the logical input map atomically. A derived ID is rejected. A stale
revision returns `409 revision_conflict`; reload before retrying. Sheets are
read-only in Play.

The sheet shows effective values for every mechanic. For an input, intrinsic is
stored/defaulted logical state; for a derived mechanic, intrinsic is its
expression result. Active status modifiers then produce effective value in
deterministic order. Status chips and modifier trails explain the difference
without baking it into base state.

During play, prefer effects in a resolved Consequence because they produce an
immutable before/after receipt. Direct sheet changes are intended for setup and
correction and do not append a world event.

## Assign and author characters

1. An owner/editor publishes character fields for the world. Each active field
   is required for every controlled entity; visibility is configured once on
   the field rather than chosen by each player.
2. A facilitator creates or selects an ordinary entity in **Roster & sheets**
   in Builder.
3. Use **Controllers** to select any number of active player memberships. The
   world table revision guards the complete replacement.
4. Until setup is complete, the controller sees only their controlled entities
   and the configured profile form—not the live table.
5. Fill any subset and choose **Save character**. The command checks both the
   profile revision and the character-field schema revision.
6. Complete every field for that entity. Its derived status becomes `ready`,
   and a player with at least one ready controlled entity enters live play.

Control is many-to-many. Removing a controller revokes authoring and action
attribution authority without deleting values. Adding a required field returns
affected characters to setup; adding/removing fields is blocked during an
unfinished problem. Players do not receive direct sheet-state mutation
permission. Archived worlds/entities preserve profiles as read-only material.

## Archive resources

- Archive a capacity/capability when it should stop appearing on current
  sheets. Active derived-mechanic dependents must be archived and active
  statuses whose modifiers target it must be removed first; existing stored
  values, removed status snapshots, and receipts remain.
- Revoke an invite to prevent future redemption; existing members remain.
- Archive a world only after all active problems are resolved/cancelled. This
  prevents further configuration and play mutations.

There is no destructive delete workflow in the world UI.
