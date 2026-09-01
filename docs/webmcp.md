# ChatGPT play through WebMCP

The public ChatGPT launch navigates the person's ordinary web browser to
`chatgpt.com` with a prefilled starter prompt and a request to attach the exact
`/play/new` Start site-tool page. It does not invoke the ChatGPT desktop app or
a desktop custom scheme. On a supported ChatGPT surface, delegated start uses
that page and the later `/play/{world_id}` Play site-tool page to choose and copy
a ready-made World, claim a Character, and begin Play. ChatGPT is the
Facilitator, while the signed-in person remains a current player.

The attached pages remain the canonical application surfaces. They display the
available authored choices, current Problem, current-player Action, Resolution
history, Entity sheets, and logical state. ChatGPT changes durable state only
through their site tools, which reuse the existing same-origin API. Chat is the
lived scene, not a second state store: it presents the same public Consequence
and next-Problem prose that Gezerah persists while the exact record remains in
Gezerah.

This integration uses the browser's imperative WebMCP API. It is not a remote
MCP server and does not add a second authentication system.

## Delegated-start contract

Delegated start is intentionally smaller than general Gezerah onboarding. Its
first public version covers only the three release-bundled World templates and
their complete, ready-made Characters.

The person may state a play preference about setting, Character, tone, or
difficult choices. ChatGPT applies that preference to the authored options. If
the person says to choose, asks for a surprise, or gives no preference, ChatGPT
chooses without running a setup questionnaire. Once the first Problem is
presented, the person's ordinary required decision is the in-fiction Action;
ChatGPT records and resolves it unless the person explicitly delegates that
fictional decision too.

The launch supplies the complete delegated-start instructions as a prefilled
starter prompt. Its final line, `My play preference: surprise me.`, is the sole
setup input: the person may send it unchanged or replace that preference. The
instructions require ChatGPT to preserve the person's agency over later
in-fiction Actions. Home encodes `surface=work`, the prompt, and the absolute
`/play/new` URL as ordinary `https://chatgpt.com/` query parameters; those
parameters request the conversation and attachment but do not prove support.

After authentication, ChatGPT must use the ready Start and Play site tools for
application operations. It must never make a browser-control request. In
particular, it must not ask the person to click a template, copy a World, choose
a Character in Gezerah, navigate between Gezerah pages, name a site tool, or
take control of the attached browser tab. If state changes or a command fails,
ChatGPT inspects current state and retries only when safe. If site-tool readiness
cannot be established, it reports that delegated start is unavailable without
turning manual browser operation into the nominal ChatGPT flow.

Signing in is the sole ordinary manual application boundary. Authentication
controls and platform-owned safety UI are not browser-control requests from the
assistant.

Custom Build guidance, saved-World discovery, invitation and multiplayer
onboarding, and completion of an incomplete Character profile remain ordinary
implemented Gezerah capabilities. They are outside the first public delegated-
start entry and must not be presented as if ChatGPT can complete them through
the Start site-tool surface.

## Authentication and trust boundary

- A successful supported ChatGPT launch attaches the exact `/play/new` page. If
  the attached browser profile is signed out, the person signs in to Gezerah in
  that tab. An existing Safari or Chrome login is not assumed to carry over.
- Site tools call the existing same-origin API client. The host-only HttpOnly
  session cookie, exact-origin check, session-derived CSRF token, World
  authorization, optimistic revisions, idempotency, and input validation remain
  authoritative.
- WebMCP does not provide a cryptographic ChatGPT principal. The server permits
  agent commands because they come from an authenticated, ready current player
  in a World whose facilitator source is explicitly `agent`. A client header or
  claimed agent name is never trusted.
- Password entry, signup, signin, invites, account changes, unrestricted Entity
  control, and World authoring are not site tools.
- No cross-origin API allowance, JavaScript-readable session credential, OAuth
  connection to ChatGPT, iframe exception, or server-side OpenAI key is needed.

The `agent` Facilitator is a non-membership source, like Terra, but it never
calls an OpenAI model from the server. It lets the same authenticated membership
retain current play role `player` and records agent-authored Interactions,
Resolutions, and World events with `agent` attribution. Terra's Continue and
Decide commands continue to require a Terra-facilitated World and are
unavailable when ChatGPT is Facilitator.

## Delegated start and Play

1. From Home, the person chooses **Open in ChatGPT**. The ordinary browser
   navigates to `chatgpt.com` with the starter prompt and exact `/play/new`
   attachment request. A successful supported launch opens one conversation
   with that page in a top-level attached browser tab.
2. The person signs in there if necessary. After authentication and successful
   registration of both Start tools, the Start site-tool surface becomes ready.
3. ChatGPT inspects all three equal ready-made templates, applies the person's
   play preference or makes a reasonable choice, and copies that template. The
   command navigates the same attached browser tab to the new ordinary
   `/play/{world_id}` page.
4. When the Play site-tool surface becomes ready, ChatGPT inspects Play, chooses
   an available Character using the same preference, and claims it. Template
   profiles are complete, so a successful claim makes the current player ready.
   ChatGPT reads the static Play-handbook topics it needs before facilitating.
5. ChatGPT inspects the newly ready Play state and presents the first improvised
   Problem from the World description, Mechanics, profiles, and logical state.
6. The person describes an in-fiction Action in chat. ChatGPT records the
   Action, resolves the Problem with public narrative and optional valid
   Effects, refreshes Play, and presents the next Problem.

The attached page refreshes its authoritative state after each mutation.
Closing its tab or navigating away removes its site tools; reopening the
authenticated page restores the relevant surface from current durable state.
The same ChatGPT conversation may continue while the attached browser tab
remains open.

There is no episode scheduler or authored encounter sequence. The World
description, Mechanics, and available Entities set the stage; ChatGPT and the
current player determine what happens.

The separate **Start a World with ChatGPT** material in the Build library remains
general-purpose guidance for a custom World. It is not delegated start and is
not the public ChatGPT Play entry.

## Site-tool pages and surfaces

Site-tool support means the top-level browser exposes
`document.modelContext.registerTool`. Site-tool readiness additionally requires
every tool expected from the current mounted, authenticated page to register
successfully. Catalog and World data loading remains separate; commands fail
closed when their required authoritative data is unavailable or invalid. A
supported but signed-out, partially registered, or ineligible page is not ready.
Registered handlers remain closed until the complete surface succeeds, and a
partial failure tears down every registration from that attempt.

Registrations use an `AbortController`, so callbacks from a prior route or state
are removed whenever the React view changes or unmounts. Navigation from Start
to Play therefore replaces the Start surface with the Play surface in the same
attached browser tab.

### Start site-tool page

The authenticated `/play/new` page exposes exactly the two delegated-start
commands:

- `inspect_world_templates` returns the complete three-template catalog with the
  authored information needed to apply a play preference, and fails closed if
  the API does not return exactly three templates.
- `copy_world_template` accepts one inspected `template_id`, creates an
  independent agent-facilitated World with a stable client destination UUID for
  safe retry, and navigates the same attached tab to `/play/{world_id}`.

These commands do not expose custom Build, saved Worlds, invitations, multiplayer
setup, or arbitrary World authoring.

### Play site-tool page

An active `/play/{world_id}` page registers the six-command Play surface only
when the World
uses the `agent` Facilitator and the signed-in membership is a current player.
The membership's Play status and command-specific state still authorize each
command independently, so registration never bypasses the server gates:

- `inspect_play` returns the current-player-visible World, World mechanic graph,
  roster, profiles, Entity sheets, active Problem, Actions, and recent
  Resolutions.
- `read_play_handbook` returns the static platform facilitation contract. It
  accepts `all` or one of `role-and-authority`, `play-loop`,
  `state-and-effects`, `narrative-presentation`, `fiction-and-privacy`, and
  `failure-and-recovery`. It is read-only and returns no live World state.
- `claim_entity` atomically claims one currently available Entity while the
  membership is waiting for a Character.
- `present_problem` creates and immediately presents one Problem to the ready
  Play audience. The server rejects a second unfinished Problem.
- `submit_action` records the signed-in current player's Action against the
  active Problem, using an Entity controlled by that membership.
- `resolve_problem` begins agent adjudication and applies a Consequence with
  optional concrete Effects under revision and idempotency protection.

Tool handlers reuse the frontend API adapter and refresh the authoritative page
state after mutations. Results are concise structured data for ChatGPT; the
backend response and refreshed UI remain the source of truth.

Tool discovery provides the handbook's topic index; `read_play_handbook` is the
corresponding detailed read. The platform handbook owns general facilitation
and presentation behavior. Dynamic `inspect_play` results and World-authored
descriptions, profiles, Mechanics, Statuses, and Problem prose supply the
particular setting and state; the handbook does not introduce a built-in
ontology, privileged configured keys, or seed vocabulary. Command descriptions
retain short local reminders at the point where an omission would be costly.

### Narrative presentation contract

ChatGPT presents Play as meaningful continuous prose. A person's decision is
apparent through what their Character attempts and the world's causal response,
not through a repeated approval or an `Action submitted` announcement. State is
apparent through changed conditions, access, treatment, pressure, injury,
equipment, and other observable consequences, not through a receipt-shaped
ledger inserted into every turn. Implicit means embodied rather than hidden: if
the person asks for an exact Mechanic, Status, value, or other information their
current-player view may reveal, ChatGPT answers directly and exactly.

The public Consequence prose passed to `resolve_problem` is the prose ChatGPT
presents after the commit. After refreshing Play, the persisted next Problem is
the next movement of the same scene. ChatGPT does not generate a second summary
of Applications and effective changes, or an unpersisted narrative bridge
between the Consequence and Problem. Gezerah retains the exact Action,
Consequence, Effects, Resolution receipt, Entity sheets, and history for audit
and direct inspection.

When establishing or materially changing a location, ChatGPT uses a small
handful of concrete details, including innocuous texture filtered through
world-visible profile prose, effective Mechanics, active Statuses, equipment,
and demonstrated temperament. It describes observable attention rather than
private thoughts, never promotes a user-authored Perception-like label into a
privileged key or invented check, and keeps suggested Actions non-exhaustive.
Restricted prose and hidden facts remain private.

A failed mutation is never converted into a fictional success or consequence.
ChatGPT explains the operational failure plainly, refreshes authoritative state,
and retries only when the command contract makes that safe. Ordinary scene prose
does not expose site-tool names, registration, revisions, idempotency, lifecycle
status, or other control-plane details unless they are needed to explain an
actual failure.

## Agent-facilitator command contract companion

The automated Agent-facilitator command contract writes
`test/artifacts/agent-facilitator-command-database-trace.json` as a diagnostic
companion to its replayed Play commands. The trace contains a baseline plus
state after `claim_entity`, `present_problem`, `submit_action`,
`resolve_problem`, and an idempotent `resolve_problem` replay. Each step records
its operation and durable references, the tables changed since the preceding
step, and the complete safe World-scoped projection at that boundary.

Every state is observed in a read-only, repeatable-read transaction. The
projection uses explicit columns and stable ordering; it omits identities,
authentication and invitation secrets, restricted profile prose,
Facilitator-only notes, and idempotency keys. It is test evidence, not canonical
product storage or a production export endpoint.

Run the contract directly when the ignored artifact needs to remain in the
working checkout:

```sh
(cd test && bunx playwright test specs/contracts/agent-facilitator-command.contract.spec.ts --workers=1)
```

The generated values describe a disposable contract replay. A completed ChatGPT
acceptance run cannot be given exact historical physical snapshots from the
final database alone: World events are invalidation cursors rather than an audit
log. Exact snapshots for a run must be captured at its mutation boundaries or
recreated by replaying it.

## Availability and acceptance

WebMCP support is experimental and rollout-dependent. Home intentionally
launches `chatgpt.com`, but the launch target and query parameters do not by
themselves establish that the ChatGPT web surface honored the page attachment
or can register its tools. OpenAI's current Site tools documentation describes
support in ChatGPT's top-level built-in browser; iframe and declarative
registrations are not discovered there. See
<https://learn.chatgpt.com/docs/webmcp>.

If the web launch opens ChatGPT but the requested page is not attached or the
Start surface cannot become ready, acceptance is blocked by the current ChatGPT
surface. Do not silently fall back to a desktop custom scheme or turn manual
browser operation into delegated start.

Automated Agent-facilitator command, site-tool registration, site-tool page
integration, and deployed-smoke checks do not exercise the signed-in ChatGPT
product and model. Run the stable
[ChatGPT acceptance scenario](testing.md#chatgpt-acceptance) when required by
the change-trigger matrix. A passing run is required before a changed ChatGPT
entry or site-tool experience is described as accepted or promoted as the
public delegated-start path.

Acceptance covers the complete boundary:

- the Home launch navigates to `chatgpt.com`, and one conversation opens with
  the exact `/play/new` page attached;
- authentication is the only ordinary manual Gezerah operation;
- the Start surface becomes ready and ChatGPT inspects and copies one template;
- the same attached tab navigates to Play, where ChatGPT inspects, claims,
  re-inspects, and presents the first Problem;
- ChatGPT makes no browser-control request and asks for no redundant setup
  decision;
- three natural-language Actions are submitted and resolved, each transition
  presents its persisted Consequence and next Problem as continuous scene prose
  without workflow chatter or a receipt-shaped state summary; and
- reloaded Play and durable history agree with the chat.
