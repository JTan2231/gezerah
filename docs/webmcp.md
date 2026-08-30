# ChatGPT play through WebMCP

The ChatGPT play surface is an authenticated top-level Play page. ChatGPT is
the Dungeon Master, the signed-in person remains a current player, and the page remains
the canonical Play surface: it displays the current Problem, current-player Action,
Resolution history, Entity sheets, and logical state.

This integration uses the browser's imperative WebMCP API. It is not a remote
MCP server and it does not add a second authentication system.

## Session and trust boundary

- The current player opens the exact `/play/{world_id}` page in ChatGPT's built-in
  browser and signs in to this application there. ChatGPT's browser profile is
  separate from an ordinary Safari or Chrome profile, so an existing session
  is not assumed to carry over.
- Page tools call the existing same-origin API client. The host-only HttpOnly
  session cookie, exact-origin check, session-derived CSRF token, world
  authorization, optimistic revisions, idempotency, and input validation remain
  authoritative.
- WebMCP does not provide a cryptographic ChatGPT principal. The server permits
  agent commands because the request comes from an authenticated, ready
  current player in a World whose facilitator source is explicitly
  `agent`. A client header or claimed agent name is never trusted.
- Password entry, signup, signin, invites, account changes, unrestricted entity
  control, and world authoring are not page tools.
- No cross-origin API allowance, JavaScript-readable session credential, OAuth
  connection to ChatGPT, iframe exception, or server-side OpenAI key is needed.

The `agent` facilitator is a non-membership source, like Terra, but it never
calls an OpenAI model from the server. It lets the same authenticated membership
retain current play role `player` and records agent-authored Interactions, Resolutions, and
World events with `agent` attribution. Terra's Continue and Decide commands continue
to require a Terra-facilitated World and are unavailable in agent mode.

## Current-player journey

1. An owner authors a world, mechanics, and a small roster through Build, then
   assigns ChatGPT as Dungeon Master.
2. **Open in ChatGPT** launches the desktop app with the exact Play URL and a
   starter prompt. Copying the prompt remains available as a fallback. The
   current player opens Play in ChatGPT's top-level built-in browser and signs in.
3. If the current player has no Character, the page and its Entity-selection tool
   expose only eligible, unclaimed Entities. Claiming one is an atomic server
   command that makes it the current player's Character rather than granting unrestricted
   Controller editing.
4. ChatGPT inspects Play, presents an improvised Problem, records the current player's
   chosen Action, and resolves the
   Problem with a narrative and optional valid Effects.
5. The page refreshes after each command. Closing or navigating away from the
   page removes its tools; reopening the authenticated Play page restores them
   from current durable state.

There is no episode scheduler or authored encounter sequence. The World description,
Mechanics, and available Entities set the stage; ChatGPT and the current player determine
what happens.

## Page tools

The Play page registers tools only when `document.modelContext` is available,
the World uses the `agent` facilitator, and the signed-in membership has the
required current play role and Play status. Registrations use an `AbortController`, so stale callbacks
are removed whenever the React view changes or unmounts.

- `inspect_play` returns the current-player-visible World, world mechanic graph,
  roster, profiles, Entity sheets, active Problem, Actions, and recent Resolutions.
- `claim_entity` atomically claims one currently available Entity while the
  membership is waiting for a Character.
- `present_problem` creates and immediately presents one Problem to the ready
  Play audience. The server rejects a second unfinished Problem.
- `submit_action` records the signed-in current player's Action against the active
  Problem, using an Entity controlled by that membership.
- `resolve_problem` begins agent adjudication and applies a Consequence with
  optional concrete Effects under revision and idempotency protection.

The tool handlers reuse the frontend API adapter and refresh the Play surface
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
- two simultaneous claims for one Entity producing exactly one winner;
- a World with facilitator source `agent` leaving the membership's current play role as `player`;
- Terra routes and provider calls remaining unavailable in agent mode;
- a full inspect, claim, present, submit, resolve, reload, and inspect loop in
  ChatGPT with the page and durable history agreeing.
