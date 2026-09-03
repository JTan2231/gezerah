# Workflows

## Delegate a ready-made start to ChatGPT

1. From Wrought Home at `https://wrought.joeytan.dev`, choose **Play with
   ChatGPT**. The ordinary web browser navigates to `chatgpt.com` with a starter
   prompt and a request to attach the exact
   `https://wrought.joeytan.dev/play/new` Start site-tool page. It does not
   invoke the desktop app. On a supported ChatGPT surface, one conversation
   opens with that page in a top-level attached browser tab.
2. Sign in there if necessary. Send the prefilled starter prompt, leaving its
   final `My play preference: surprise me.` line unchanged or replacing that
   preference with ordinary language. Authentication is the only ordinary
   manual Wrought operation.
3. Once the Start site-tool surface is ready, ChatGPT inspects the three equal
   starting templates, including their prose guides, applies a setting,
   Character, tone, or other play preference or makes a reasonable choice, and
   copies one into a new independent World. The attached tab navigates to
   `https://wrought.joeytan.dev/play/{world_id}`.
4. Once the Play site-tool surface is ready, ChatGPT inspects the World, chooses
   and claims one of its available Characters, and inspects the resulting ready
   Play state. Every bundled template profile is complete. ChatGPT reads the
   static platform Play handbook for its authority, Play-loop, presentation,
   privacy, and recovery contract.
5. ChatGPT improvises and presents the first Problem from the World description,
   prose guide, Mechanics, profiles, and logical state. The person responds with an
   in-fiction Action in chat; ChatGPT records and resolves it and presents the
   next Problem.

After sign-in, ChatGPT performs these application operations through site tools
and never makes a browser-control request. If the person says to choose, asks for
a surprise, or supplies no preference, ChatGPT does not require a setup
questionnaire.

During Play, chat is the lived scene and Wrought is the exact durable record.
ChatGPT embodies decisions and state through causal, observable prose, presents
the persisted public Consequence followed by the persisted next Problem, and
does not insert a separate workflow acknowledgement, Resolution-receipt summary,
or unpersisted bridge. It answers exact visible mechanical questions directly.
A failed mutation is reported operationally and is never fictionalized.

This candidate delegated-start path covers only the bundled ready-made World
templates and complete Characters. Custom Build, saved-World discovery,
invitation and multiplayer onboarding, and incomplete profile completion remain
ordinary Wrought workflows rather than ChatGPT entry capabilities.

Templates are versioned Markdown in the application release, but a selected
copy is ordinary relational World data. Later template edits never alter an
existing World. The copy contains no pre-authored Problem, live Status instance,
or pre-authored Play history beyond its ordinary `world-created` event. There
is no exposed manual template-copy or Character-claim workflow in this public
version.

## Create and configure a world

1. Open internal `/build`, then sign up or sign in. Signup requires a
   username, display name, and password but no email address. The Build library
   offers copyable **Start a World with ChatGPT** guidance for shaping the idea
   and guiding this configuration; it is not delegated start, and every durable
   change remains the person's.
2. Create a world from the Build library. The creator's owner membership is the
   initial human facilitator. In **Settings**, write the world description and,
   optionally, a prose guide describing how model-authored Problems and
   Consequences should sound. Terra uses the description as its world brief and
   the guide for expression when later designated in Play. The guide shapes
   writing, not facts, rules, privacy, or player decisions.
3. Define the capacities that every entity may carry. Choose score or pool,
   then choose an input with default/bounds/step or a derived typed expression.
4. Define capabilities the same way, using binary or rating scalar shape.
5. For each input, decide whether a facilitator may change it in a live
   Consequence.
   Derived values are expression-evaluated and cannot be targeted directly.
6. Open **Character fields** and publish the ordered text prompts that every
   controlled Entity must complete. Labels and guidance are authored for
   this world; zero fields is valid.
7. Invite editors, players, or spectators through expiring links.
8. Open **Roster & sheets** in Build. Create the roster and optionally assign
   active non-spectators as an entity's controllers; that entity is presented
   as their character. Sheets are generated from the active capacity/capability
   definitions.
9. Return to `/`, choose **Play**, select the World, and enter Play.

Every mechanic publication validates the proposed complete graph and advances
the rules revision. A type mismatch, invalid reference, or dependency
cycle rejects the save atomically and reports the expression path.

Names are world-scoped and user-authored. Do not introduce a canonical list of
attributes, skills, entity classes, or privileged names.

## Join a world

1. Open `/play/invite/{token}` for a player/spectator invitation or
   `/build/invite/{token}` for an editor invitation.
2. Sign up or sign in if needed; the invite URL remains intact throughout.
3. Review the world, inviter, and offered membership role.
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

First enter the world through `/play` and inspect the Facilitator shown in
the header. Between Problems, an owner/editor or the current human Facilitator
may assign any active non-spectator or Terra. Delegated template copy establishes
the agent assignment before the attached tab enters Play; the ordinary Play
picker does not start agent facilitation. A replaced human Facilitator
immediately returns to current play role `player`; their membership role does
not change, and their persistent `play_status` determines whether they return to
a ready seat or character setup.

For a human facilitator:

1. Click **New problem**, write what is happening, optionally add a title, and
   choose context and eligible ready current-player responders. The default
   audience is every active membership whose `play_status` is ready, including
   spectators.
2. Present the problem. Responders offer one free-form Action each,
   optionally attribute it to a ready controlled character, and may withdraw
   while the problem is open.
3. Begin private adjudication and describe **What transpires?**.
4. Ask Luna to preserve that prose while compiling optional selected-Action
   metadata and Effects. Review the advisory preview.
5. Resolve with a fresh idempotency key. The normal path rechecks revisions and
   commits logical-state/Status-instance lifecycle changes, provenance, Resolution receipt,
   selected-Action metadata, Interaction lifecycle, and World event together.

For Terra:

1. While no interaction is unfinished, any ready current player clicks **Ask
   Terra to continue**. Terra uses the world brief, current prose guide, current
   Entity sheets, and recent history to create and present the problem.
2. Every ready active member is in the audience, every ready non-spectator is a
   responder, and ready controlled entities are context.
3. Each responder submits an Action or clicks **Pass**; pass is stored as the
   ordinary Action text `I pass.`.
4. While the problem is open or Terra is adjudicating it, any ready current
   player may confirm **Skip problem**. Skip uses the ordinary cancellation
   command, ends the Problem without a Consequence, and returns Play to
   idle with Terra still assigned. It does not generate a replacement; a ready
   current player must explicitly ask Terra to continue again.
5. After all responders have acted or passed, any ready current player asks Terra to
   decide. Terra writes the Consequence, Luna compiles it, and the server
   previews and resolves it without a human edit or approval stage.
6. If the provider call fails after adjudication starts, reload and retry with
   the same idempotency key. The interaction remains visible while pending.

For recovery from a Terra problem stuck waiting on a responder or a failed
adjudication, the world owner alone may choose **Take over**. This is allowed
only when that Terra-authored open/adjudicating problem is the sole unfinished
interaction and assigns the owner as human facilitator. The owner's own
Action, if any, is withdrawn; other Actions remain. For an open
problem the owner closes and adjudicates manually; for an adjudicating problem
the owner goes directly to the human Consequence UI. No other Facilitator reassignment is allowed
while an interaction is unfinished.

Luna may compile a narrative-only Consequence with no effects. A human
facilitator may cancel any unfinished problem; a ready current player may skip
a Terra-authored open or adjudicating problem while Terra remains assigned.
Presented cancellations remain visible to their audience as history, while a
cancelled draft remains private. A world cannot be archived while any
interaction is draft, open, or adjudicating.

## Prepare and edit entity sheets

Creating an Entity creates an empty normalized logical-state root and status-set root.
Logical defaults make every active input appear immediately; derived mechanics
evaluate from the graph and need no stored override.

Owners/editors use **Roster & sheets** in Build for **Save logical state** setup
changes. The request supplies current logical-state and rules revisions and replaces
only the logical input map atomically. A derived ID is rejected. A stale
revision returns `409 revision_conflict`; reload before retrying. Sheets are
read-only in Play.

The sheet shows effective values for every Mechanic. For an input, intrinsic is
its stored override or authored default; for a derived Mechanic, intrinsic is its
expression result. Active Status-instance modifiers then produce effective value in
deterministic order. Status chips and modifier trails explain the difference
without baking it into logical state.

During Play, prefer Effects in a committed Resolution because they produce an
immutable Resolution receipt with before/after facts. Direct sheet changes are intended for setup and
correction and do not append a world event.

## Assign and author characters

1. An owner/editor publishes character fields for the world. Each active field
   is required for every controlled entity; visibility is configured once on
   the field rather than chosen by each player.
2. An owner/editor creates or selects an ordinary entity in **Roster & sheets**
   in Build.
3. Use **Controllers** to select any number of active non-spectator memberships. The
   World roster revision guards the complete replacement.
4. Until setup is complete, the controller sees only their controlled entities
   and the configured profile form—not Play.
5. Fill any subset and choose **Save profile**. The command checks both the
   profile revision and the character-field-set revision.
6. Complete every field for that Entity. Its Character status becomes `ready`,
   and a current player with ready controlled-character setup enters live play.

Control is many-to-many. Removing a controller revokes authoring and action
attribution authority without deleting values. Adding a required field returns
affected characters to setup; adding/removing fields is blocked during an
unfinished Problem. Players do not receive direct logical-state mutation
permission. Archived worlds/entities preserve profiles as read-only material.

## Archive resources

- Archive a capacity/capability when it should stop appearing on current
  sheets. Active derived-Mechanic dependents must be archived and active Status
  instances whose modifiers target it must be removed first; existing stored
  overrides, removed Status instances, modifier snapshots, and Resolution receipts remain.
- Revoke an invite to prevent future redemption; existing members remain.
- Archive a world only after all active problems are resolved/cancelled. This
  prevents further configuration and play mutations.

There is no destructive delete workflow in the world UI.
