# Workflows

## Create and configure a world

1. Open `/`, choose **Build**, then sign up or sign in. Signup requires a
   username, display name, and password but no email address.
2. Create a world from the Build library. The creator's owner membership is the
   initial human facilitator. In **Settings**, write the world description;
   Terra uses it as the campaign brief when later designated in Play.
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
8. Open **Roster & sheets** in Build. Create the roster and optionally assign
   active non-spectators as an entity's controllers; that entity is presented
   as their character. Sheets are generated from the active capacity/capability
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
6. A current player waits for an owner/editor to assign a controlled entity. After assignment,
   fill the world's required character fields. Partial drafts may be saved, but
   live play opens only after their controlled-character setup is ready.

Invite tokens are bearer secrets. Share them only with intended recipients;
authors can revoke a link at any time. Preview and redemption both require an
authenticated account, and redemption binds the membership to that account.

## Run an ad-hoc problem

Problems are runtime moments, never authored configuration.

First enter the world through `/play` and inspect the Dungeon Master shown in
the header. Between problems, an owner/editor or the current human facilitator
may assign any active non-spectator or Terra. The former human facilitator
immediately returns to the current-player role; durable world access does not
change, and their persistent `play_status` determines whether they return to a
ready seat or character setup.

For a human facilitator:

1. Click **New problem**, write what is happening, optionally add a title, and
   choose context and eligible ready current-player responders. The default
   audience is every active membership whose `play_status` is ready, including
   spectators.
2. Present the problem. Eligible players offer one free-form action each,
   optionally attribute it to a ready controlled character, and may withdraw
   while the problem is open.
3. Begin private adjudication and describe **What transpires?**.
4. Ask Luna to preserve that prose while compiling an optional selected
   action/summary and effects. Review the advisory preview.
5. Resolve with a fresh idempotency key. The normal path rechecks revisions and
   commits base/status changes, provenance, receipt, action selection,
   interaction lifecycle, and event together.

For Terra:

1. While no interaction is unfinished, any ready current player clicks **Ask
   Terra to continue**. Terra uses the campaign brief, current table, and recent
   history to create and present the problem.
2. Every ready active member is in the audience, every ready non-spectator is a
   responder, and ready controlled entities are context.
3. Each responder submits an action or clicks **Pass**; pass is stored as the
   ordinary action text `I pass.`.
4. After all responders have acted or passed, any ready player asks Terra to
   decide. Terra writes the Consequence, Luna compiles it, and the server
   previews and resolves it without a human edit or approval stage.
5. If the provider call fails after adjudication starts, reload and retry with
   the same idempotency key. The interaction remains visible while pending.

For recovery from a Terra problem stuck waiting on a responder or a failed
adjudication, the world owner alone may choose **Take over**. This is allowed
only when that Terra-authored open/adjudicating problem is the sole unfinished
interaction and assigns the owner as human facilitator. The owner's own
submitted action, if any, is withdrawn; other submissions remain. For an open
problem the owner closes and adjudicates manually; for an adjudicating problem
the owner goes directly to the human ruling UI. No other handoff is allowed
while an interaction is unfinished.

Luna may compile a narrative-only Consequence with no effects. A problem may be
cancelled before resolution. A world cannot be archived while any interaction
is draft, open, or adjudicating.

## Prepare and edit entity sheets

Creating an entity creates an empty normalized state root and status-set root.
Logical defaults make every active input appear immediately; derived mechanics
evaluate from the graph and need no stored row.

Owners/editors use **Roster & sheets** in Build for **Save sheet** setup
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
2. An owner/editor creates or selects an ordinary entity in **Roster & sheets**
   in Build.
3. Use **Controllers** to select any number of active non-spectator memberships. The
   world table revision guards the complete replacement.
4. Until setup is complete, the controller sees only their controlled entities
   and the configured profile form—not the live table.
5. Fill any subset and choose **Save character**. The command checks both the
   profile revision and the character-field schema revision.
6. Complete every field for that entity. Its derived status becomes `ready`,
   and a current player with ready controlled-character setup enters live play.

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
