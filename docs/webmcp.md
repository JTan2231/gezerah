# ChatGPT play through WebMCP

The ChatGPT play surface is an authenticated top-level Play page. ChatGPT is
the Dungeon Master, the signed-in person remains a player, and the page remains
the canonical table: it displays the current problem, player submission,
resolution history, character sheets, and durable state.

This integration uses the browser's imperative WebMCP API. It is not a remote
MCP server and it does not add a second authentication system.

## Session and trust boundary

- The player opens the exact `/play/{world_id}` page in ChatGPT's built-in
  browser and signs in to this application there. ChatGPT's browser profile is
  separate from an ordinary Safari or Chrome profile, so an existing session
  is not assumed to carry over.
- Page tools call the existing same-origin API client. The host-only HttpOnly
  session cookie, exact-origin check, session-derived CSRF token, world
  authorization, optimistic revisions, idempotency, and input validation remain
  authoritative.
- WebMCP does not provide a cryptographic ChatGPT principal. The server permits
  agent-DM commands because the request comes from an authenticated, ready,
  non-spectator player in a world whose facilitator source is explicitly
  `agent`. A client header or claimed agent name is never trusted.
- Password entry, signup, signin, invites, account changes, unrestricted entity
  control, and world authoring are not page tools.
- No cross-origin API allowance, JavaScript-readable session credential, OAuth
  connection to ChatGPT, iframe exception, or server-side OpenAI key is needed.

The `agent` facilitator is a non-membership source, like Terra, but it never
calls an OpenAI model from the server. It lets the same authenticated membership
remain a player and records agent-authored interactions, resolutions, and
events with `agent` attribution. Terra's Continue and Decide commands continue
to require a Terra-facilitated world and are unavailable in agent mode.

## Player journey

1. An owner authors a world, mechanics, and a small roster through Build, then
   assigns ChatGPT as Dungeon Master.
2. **Open in ChatGPT** launches the desktop app with the exact Play URL and a
   starter prompt. Copying the prompt remains available as a fallback. The
   player opens Play in ChatGPT's top-level built-in browser and signs in.
3. If the player has no character, the page and its character-selection tool
   expose only eligible, unclaimed preset characters. Claiming one is an atomic
   server command rather than unrestricted controller editing.
4. ChatGPT inspects the visible table, presents an improvised problem, records
   the player's chosen action as that player's submission, and resolves the
   problem with narrative and optional rules-valid effects.
5. The page refreshes after each command. Closing or navigating away from the
   page removes its tools; reopening the authenticated Play page restores them
   from current durable state.

There is no episode scheduler or authored encounter sequence. The world brief,
rules, and available characters set the stage; ChatGPT and the player determine
what happens.

## Page tools

The Play page registers tools only when `document.modelContext` is available,
the world uses the `agent` facilitator, and the signed-in membership has the
required play state. Registrations use an `AbortController`, so stale callbacks
are removed whenever the React view changes or unmounts.

- `inspect_game` returns the current player-visible world, rules, roster,
  profiles, active problem, submissions, and recent resolutions.
- `claim_character` atomically claims one currently eligible preset character
  while the membership is waiting for a character.
- `present_problem` creates and immediately presents one problem to the ready
  table. The server rejects a second unfinished problem.
- `submit_action` records the signed-in player's action against the active
  problem, using an entity controlled by that membership.
- `resolve_problem` begins agent adjudication and applies a narrative ruling and
  optional concrete effects with revision and idempotency protection.

The tool handlers reuse the frontend API adapter and refresh the visible table
after mutations. Tool results are concise structured text for ChatGPT; the
backend response and reloaded UI are the source of truth.

## Availability and testing

WebMCP support is experimental and rollout-dependent. OpenAI's current Site
tools documentation describes support in ChatGPT's built-in browser and
requires JavaScript registration from the top-level page; iframe and
declarative registrations are not currently discovered there. See
<https://learn.chatgpt.com/docs/webmcp>.

Release validation should cover:

- a fresh ChatGPT browser profile signing in on the Play page;
- exact-origin mutations and CSRF refresh after reload;
- anonymous, spectator, unready, wrong-world, stale-revision, and duplicate
  command failures;
- two simultaneous claims for one character producing exactly one winner;
- an `agent` world leaving the membership's current play role as `player`;
- Terra routes and provider calls remaining unavailable in agent mode;
- a full inspect, claim, present, submit, resolve, reload, and inspect loop in
  ChatGPT with the page and durable history agreeing.
