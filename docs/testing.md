# Testing and validation

## Validation entrypoint

Use the repository validator for code changes:

```sh
./ci.sh
```

Focused targets are:

```sh
./ci.sh frontend
./ci.sh backend
./ci.sh e2e
```

`all` is the default. The E2E target runs the complete frontend and backend
target first, then browser tests; it is not a browser-only shortcut.

GitHub Actions runs the default validator on `master` pushes and pull requests,
alongside a checksum-verified full-history Gitleaks scan. Pull requests that
change dependencies also run GitHub's dependency review, and Dependabot checks
the Go, Bun, and GitHub Actions ecosystems weekly.

## ChatGPT validation vocabulary and ownership

The ChatGPT integration has four distinct evidence boundaries:

| Term | Boundary |
| ---- | -------- |
| **Agent-facilitator command contract** | Automated HTTP and PostgreSQL evidence for current-player authority, agent attribution, revisions, idempotency, and durable Play transitions. It does not invoke ChatGPT or WebMCP registration. |
| **Site-tool registration test** | Automated frontend evidence for site-tool names, schemas, registration, command adaptation, route changes, refresh, and recoverable errors through a controlled `document.modelContext`. It does not invoke ChatGPT. |
| **Site-tool page integration** | Automated browser evidence that the Start or Play page exposes the intended surface when site-tool support and application state make it ready. It does not evaluate model behavior. |
| **ChatGPT acceptance scenario** | The stable, normative model-in-the-loop scenario below. A **ChatGPT acceptance run** executes it against one exact source or deployed candidate in an **acceptance environment**. A **ChatGPT acceptance record** is the dated result of that run. |

Use **journey** only for the repository's UI-authentic lifecycle test; an
automated site-tool check and a ChatGPT acceptance scenario are not journeys.
Use **ChatGPT launch**, not “handoff,” for opening the conversation and attached
browser tab. Authentication **session**, **Facilitator reassignment**, and
**Facilitator recovery** retain their distinct product meanings.

The repository owns the stable acceptance scenario, trigger matrix, and pass
criteria. The static platform Play handbook exposed by `read_play_handbook`
owns model-facing facilitation and presentation guidance; it does not store
acceptance evidence or redefine product state. Dated acceptance records are
operational state and do not belong in canonical documentation. A separately
operated external handbook may retain those records, but it does not redefine
the scenario, establish product truth, or replace repository validation.

### Change-trigger matrix

Every code change still requires the complete `./ci.sh` repository check. Apply the
additional expectations below when ChatGPT behavior is in scope:

| Changed boundary | Focused iteration | External acceptance expectation |
| ---------------- | ----------------- | ------------------------------- |
| Canonical Wrought base path, ChatGPT web-launch URL, absolute attached-page request, starter instructions, delegated-start copy, or Start site-tool support/readiness | Frontend tests plus `./ci.sh e2e` | Run the ChatGPT acceptance scenario against the exact candidate before describing the change as accepted or promoting it as the public delegated-start entry. |
| Start or Play site-tool registration, name, schema, description, command adapter, navigation, refresh, or recovery behavior | Site-tool registration and page-integration tests, the Agent-facilitator command contract as applicable, then `./ci.sh` | Run the ChatGPT acceptance scenario before an acceptance claim or public promotion. |
| Agent-facilitator command authority, attribution, concurrency, idempotency, or persistence with no ChatGPT-visible behavior change | Focused backend/contract coverage, then `./ci.sh` | Not required unless the public ChatGPT interaction or acceptance oracle changed. |
| World prose-guide transport, Play-handbook topic/content, or ChatGPT-visible Problem, Consequence, state, privacy, attention, decision, voice, or failure guidance | Focused frontend/contract coverage, then `./ci.sh` | Run all three turns of the ChatGPT acceptance scenario before an acceptance claim or public promotion. |
| Unrelated product or infrastructure behavior | Applicable focused validator, then `./ci.sh` | Not required. |

An unperformed or blocked acceptance run does not make automated validation
fail, but it must be reported as such and cannot support a claim that the
candidate's ChatGPT experience passed acceptance.

The Wrought rename, canonical `https://wrought.joeytan.dev` attachment URL,
and root-mounted subdomain deployment change this boundary. No new dated three-turn
ChatGPT acceptance record has been supplied for that candidate, so
the rebranded launch is currently **not claimed as ChatGPT accepted**. Automated
CI, site-tool integration, and deployed smoke may validate the implementation
without changing that statement.

## Isolated worktree behavior

On first invocation, `ci.sh`:

1. resolves current `HEAD`;
2. builds a temporary Git index from it;
3. stages all tracked and untracked non-ignored working-tree changes into that
   temporary index;
4. writes a tree and synthetic commit without modifying the real index;
5. creates a detached temporary worktree;
6. reinvokes itself there with the configured shared tool cache;
7. removes the worktree and temporary files on exit.

This design validates unsaved/untracked source changes while keeping dependency
installs and generated frontend assets out of the active checkout. Ignored
files are not copied, so tests must not depend on local `.wrought`, `node_modules`,
`web/static` output, or test artifacts.

Bun downloads, Go build and module data, pinned tool binaries, and Node compile
caches live under the ignored `.wrought/cache/ci` directory by default, or under
`WROUGHT_CI_CACHE_DIR` when configured. The detached worktree still owns
dependency installations, build output, analyzer result caches, and runtime
state; only path-independent caches survive between invocations. An explicit
`PLAYWRIGHT_BROWSERS_PATH` is preserved, and otherwise the normal user browser
cache is reused on macOS/Linux when one can be resolved.

The validator requires a valid Git repository with a `HEAD` commit.

## Target matrix

### Frontend

`./ci.sh frontend` performs a frozen Bun dependency install, then runs these six
checks concurrently:

- Prettier format check;
- ESLint for TypeScript/React/accessibility rules;
- Stylelint for `src/**/*.css`;
- Bun unit tests;
- Knip unused-code analysis;
- TypeScript check.

After all six pass, it runs `bunx vite build` for the production assets. The CI
build does not repeat the TypeScript check performed in the validation group.

### Backend

`./ci.sh backend` performs:

1. `gofmt` cleanliness check over Go files;
2. `go mod tidy -diff`;
3. `go vet` over application packages;
4. golangci-lint 2.12.2 with the repository's curated strict configuration;
5. `go test` over application packages;
6. govulncheck 1.6.0 over production and test reachability;
7. shell syntax checking for `ci.sh`, `deploy.sh`, `run.sh`, and `reset-db.sh`;
8. trimmed `cmd/wrought` binary build;
9. optional application-startup/migration smoke test.

The validator downloads the official golangci-lint 2.12.2 archive into the
shared CI tool cache, verifies its published SHA-256 checksum, and invokes that
exact binary directly. The accepted macOS/Linux amd64/arm64 checksums are pinned
in `ci.sh`. Its checked-in configuration uses an explicit analyzer
allowlist, analyzes tests, enables strict ignored-error checks, and requires
every `//nolint` directive to be specific, used, and explained. The validator
passes only first-party package directories, as individually quoted arguments,
so Go source found under frontend dependencies is not analyzed and checkout
paths containing spaces remain valid.

The validator installs the pinned govulncheck command into the shared CI tool
cache without modifying `go.mod` or `go.sum`, validates its embedded module path
and version on reuse, then invokes it directly with `-test`. Reachable production
or test vulnerabilities fail the target. The tool uses the shared Go caches, but
its vulnerability database query is live and therefore requires network access.
The focused backend target runs that scan after the other backend checks. The
default and E2E targets run the same read-only scan as a separate validation
lane alongside those checks, and require both lanes to pass.

Application tests cover the five-minute session-touch boundary, immediate
continuation after a full SSE event batch, cancellation while waiting, rolling
write-deadline set/clear behavior, a real stream surviving the ordinary server
write timeout, and request-context propagation from the process root.

The smoke test runs only when `WROUGHT_TEST_DATABASE_URL` is set. It starts the
built binary against that exact database, waits for the listening log, and
stops it. The database must be explicitly disposable because startup installs
the schema.

### End to end

`./ci.sh e2e` first runs frontend validation, backend validation, and the frozen
`test/` dependency install concurrently. It then runs the production artifact
builds (Vite followed by the Go binary and optional database smoke test) in
parallel with three independent test-project checks: Prettier, TypeScript, and
the scenario-runtime architecture tests plus catalog verification. After both
groups pass, it runs the Playwright scenarios through the custom launcher.

The verified Go binary already embeds the verified frontend assets and is passed
to Playwright global setup. The successful command, including detached-worktree
preparation, every frontend/backend check, builds, browser and contract tests,
database/server lifecycle, reporting, and cleanup, has a hard wall-clock budget
of less than 60 seconds. Stage timings and the final invocation-to-cleanup time
are printed on every E2E run; exceeding the budget fails the target.

Even without the optional backend smoke variable, E2E requires a reachable
PostgreSQL admin database.

### Deployed smoke

The operator-initiated deployment path adds a narrow check of the actual hosted
system after the broader local suite. It has two explicit release stages:

```sh
./deploy.sh deploy --pre-dns
./deploy.sh verify
```

`deploy --pre-dns` is the generated-provider, HTTP-only stage. It deploys the
release, selects the exact generated Railway `*.up.railway.app` hostname, and
runs the HTTPS requests below without launching a browser. The CLI forces the
browser result to skipped because the generated host is not the configured
authentication origin. `--pre-dns` is not valid with `verify`.

Normal `deploy` and `verify` are post-cutover stages. They require exactly
`https://wrought.joeytan.dev`, exactly one custom domain
(`wrought.joeytan.dev`), and
one generated Railway provider hostname aligned with the current service name;
unexpected custom domains fail the allowlist gate. They run the browser probe
unless `--no-browser` is explicit.

Both successful deploy mode and verify mode require the selected Railway web and
PostgreSQL services and database volume to be healthy and the active web
manifest to use `/api/health`, a 30-second health-check timeout, one
replica, and more than ten seconds of draining. Database health includes
Railway's non-migrating flag, the pinned volume name, `READY` state, at least 5
GB, and the standard
`/var/lib/postgresql/data` mount. They refuse to attest while another web
rollout is unresolved. HTTP checks then require HTTPS with no redirects; the
Wrought app shell at `/`; `ok:true` health JSON at `/api/health`; the same
shell at direct `/play/...` and `/build/...` SPA routes; and every same-origin
`/assets/**` JavaScript and stylesheet discovered from the Wrought HTML.

Unless `--no-browser` is explicit, a headless Playwright check loads the hosted
Wrought Home at `https://wrought.joeytan.dev`,
validates its title and delegated-start heading, and verifies that the sole
candidate ChatGPT launch targets `https://chatgpt.com/` with its starter prompt and
the candidate's exact absolute `/play/new` attachment URL. It then opens
that Start-page
authentication boundary directly and submits an intentionally unknown
randomized username. It requires the expected 401 and generic credential error
and fails on page exceptions, console warnings/errors, same-origin request
failures, or unexpected same-origin 4xx/5xx responses. The probe creates no
account or other durable application fixture. Chrome's generic console noise is
tolerated only when accounted for by the expected anonymous `GET /api/me` and
invalid-signin `POST /api/auth/signin` 401 responses; those UI and response
boundaries are asserted directly. This proves the launch URL construction, not
that ChatGPT web honored the attachment request or exposed Site tools. Because
the credentials are deliberately invalid, it also proves only the canonical
origin and anonymous login-error boundary. It does not issue a session and is
not evidence for `__Host-wrought_session` creation, flags, path, or scope.

This smoke test deliberately does not replay the 141-scenario suite against the
hosted database. `./ci.sh` owns broad, deterministic product behavior against a
disposable database; deployed smoke owns the narrower Railway build, service,
public TLS/proxy, root-mounted routing, deployed-origin, asset, and database-read-path
boundary.
Passing runs write an allowlisted, secret-free record with `schemaVersion: 2`
and private file permissions. `releaseStage` distinguishes `pre-dns` from
`post-cutover`, and the recorded manifest includes
`healthcheckTimeout: 30`. Deploy mode reserves
`.wrought/deployments/<deployment-id>.json`; verify mode writes a distinct
`<deployment-id>.verify.<run-id>.json` record so it cannot replace deploy
provenance.

### ChatGPT acceptance

CI, the Agent-facilitator command contract, site-tool registration tests,
site-tool page integration, and deployed smoke do not substitute for a
model-in-the-loop run in the signed-in ChatGPT product. The following
three-turn scenario is the sole normative acceptance case for public delegated
start and narrative presentation.

#### Acceptance environment

The run must identify one exact clean source artifact or deployed candidate and
use:

- its production frontend and Go artifact at one exact HTTPS browser origin,
  with the canonical Wrought application at `/`;
- an isolated synthetic Wrought account and disposable data boundary;
- a fresh or deliberately cleared ChatGPT web conversation with site-tool
  support;
- the top-level attached browser tab, not an iframe; and
- an operator-controlled cleanup path that cannot remove broader development or
  hosted data.

A disposable local candidate may be built from the exact source, run on
`127.0.0.1:8080` against a uniquely named PostgreSQL database, and exposed with
an official checksum-verified `cloudflared tunnel --no-autoupdate --url
http://127.0.0.1:8080`. Set `WROUGHT_PUBLIC_ORIGIN` to the resulting HTTPS
origin, treat it as public while alive, and require `/api/health`
through that origin to return `ok:true`. The candidate Home is
`<origin>/`; the origin value itself never contains a path. Do not
expose the normal `./run.sh` Vite/backend pair or reuse development or hosted
data.

#### Stable scenario

The acceptance participant performs only these actions:

1. Open the candidate's Wrought Home page at `<origin>/` and choose
   **Open in ChatGPT**. For the canonical deployed candidate this is
   `https://wrought.joeytan.dev`, and the requested attached page must be
   `https://wrought.joeytan.dev/play/new`.
2. Sign in to Wrought in the attached browser tab if required.
3. Send the prefilled starter prompt with its final
   `My play preference: surprise me.` line unchanged. A run may separately
   exercise a replacement preference, but the normative case requires no setup
   choice.
4. After ChatGPT presents the first Problem, answer with one natural-language
   in-fiction Action. Answer each of the next two Problems the same way, for
   exactly three completed player turns.

ChatGPT must perform the remaining application sequence without participant
browser operation:

1. use the ready Start surface to call `inspect_world_templates`, choose from the
   complete three-template catalog, and call `copy_world_template`;
2. continue in the same conversation while the same attached tab navigates to
   `/play/{world_id}` and the Play surface becomes ready;
3. call `inspect_play`, choose and `claim_entity`, call `inspect_play` again,
   read the relevant `read_play_handbook` topics, and `present_problem`;
4. for each of the three participant responses, record it with `submit_action`,
   resolve it with `resolve_problem`, refresh Play, and present the next
   Problem.

#### Pass and failure criteria

A run passes only when all of the following are observed:

- the Home launch navigates to `chatgpt.com`, and the exact absolute Start page
  for the candidate's `/play/new` route is attached in one conversation;
- authentication is the participant's only manual Wrought operation;
- site-tool support and readiness are established on both Start and Play pages;
- ChatGPT makes zero browser-control requests and asks zero setup questions
  after the prefilled play preference is sent;
- Start-to-Play navigation happens in the same attached browser tab;
- the first Problem opens with a short expositional statement saying who the
  selected Character is and what they are currently doing, without repeating
  that introduction in later Problems, then establishes concrete, innocuous
  details filtered through visible Character information without private
  thoughts, hidden facts, invented privileged Mechanics, or exhaustive
  suggested Actions;
- the copied template's current prose guide is recognizable across Problems and
  Consequences through diction, rhythm, narrative distance, imagery, and the
  handling of in-world language, without being quoted or mentioned as an
  instruction;
- specialized institutional or technical language belongs clearly to a person,
  display, document, or other in-world source when the guide calls for that
  distinction; the narrator otherwise uses the guide's ordinary human register
  rather than turning facilitation rules or application concepts into labels;
- the first Problem uses up to about 180 presented words across five to seven
  short narrative beats when the opening needs them, and fewer when it does not;
  each whole Consequence-plus-next-Problem passage normally contains 100–140
  presented words across five to seven beats, with the range applying once to
  the combined passage rather than separately to each saved part;
- each ordinary scene passage selects rather than inventories detail, uses at
  most one brief state-orientation sentence when that is sufficient, does not
  both dramatize and restate the same change, and ends the persisted Problem at
  one decision point: a direct question that leaves every eligible responder
  free to act or a clear cliffhanger; any examples are at most three compact,
  non-exhaustive possibilities in one sentence;
- direct exact-state answers, operational-failure explanations, and
  participant-requested detail are outside the ordinary scene target; if
  multiple Actions, accessibility, or causal clarity require more space, the
  excess is no greater than necessary, the dated record states why, and the next
  ordinary passage returns to the compact cadence;
- each submitted Action and durable history faithfully represents the
  participant's stated or explicitly delegated fictional decision without
  adding another decision or Action on the participant's behalf, and the
  world's causal response makes that decision apparent without a repeated
  approval or workflow acknowledgement;
- each public Problem prompt and Consequence narrative presented in chat agrees
  with the persisted public prose, and each committed Consequence flows into the
  persisted next Problem without a second receipt-shaped Effect, Application,
  or effective-change summary and without an unpersisted bridge;
- durable changes are embodied in observable conditions, access, treatment,
  pressure, injury, equipment, or similarly meaningful prose rather than a
  routine state ledger; exact current-player-visible Mechanics, Statuses, and
  values are still answered directly if asked;
- ordinary scene prose exposes no site-tool names, registration/readiness,
  revisions, idempotency, Interaction lifecycle, or other control-plane state;
- a mutation failure, if one occurs, is reported as an operational failure and
  is never presented as fictional success;
- all three Actions, committed Resolutions and Effects, and following Problems
  are coherent; and
- reloaded Play and durable history agree with the chat.

Voice review is a human judgment over each complete passage and the three-turn
sequence. Automated coverage proves that the guide reaches the intended writer
and stays out of Luna's context; acceptance does not use a growing forbidden-
word list as a substitute for literary consistency.

If `chatgpt.com` opens but does not honor the attachment request or expose the
required Site-tool support, record the run as blocked at that boundary. Do not
substitute the desktop app or a participant-operated Wrought flow for the web
acceptance candidate.

Any assistant-authored request to click, navigate, copy, select, take control,
or otherwise operate Wrought is a failure. A platform-owned authentication or
safety control is not an assistant-authored browser-control request. Classify a
run as blocked rather than failed only when the acceptance environment or
external ChatGPT availability prevents the scenario from reaching the behavior
under test.

#### Acceptance record

The dated record must identify the exact source or deployment candidate, date,
acceptance-environment kind, ChatGPT surface, stated play preference, result
(`passed`, `failed`, or `blocked`), browser-control-request count, and cleanup
result. For every step reached, it records the World and Character, participant
Actions and persisted submitted Actions, public Consequences and following
Problems, each scene passage's presented word and beat counts, any cadence
exception rationale, and whether the transcript was reviewed for presentation
and control-plane leakage. It also records the conversation count, setup-
question count, and any platform-owned confirmation count separately. A failed
or blocked record must state the observed reason.

Do not publish the transcript or record the password, session cookie, CSRF token,
database URL, invitation secret, or transient tunnel URL. An external handbook
may retain the dated record; canonical repository documentation retains only
this stable scenario and its criteria.

For a disposable Quick Tunnel run, end exposure first: stop `cloudflared`, then
stop the standalone application. Confirm port 8080 has no listener, drop only
the exact disposable database, and remove only the exact temporary directory.
A Quick Tunnel creates no account-owned DNS or tunnel resource to delete.

Quick Tunnels do not support SSE and have no uptime guarantee. This scenario
proves the single-player delegated-start and Play command loop because each
site-tool mutation refreshes the authoritative page state; it is not evidence
for SSE delivery or multiplayer freshness.

## Test layers

### Rules engine tests

Files under `internal/rules/*_test.go` construct storage-neutral domain maps and
snapshots. Coverage includes:

- zero-valid immutable decimal canonicalization and arithmetic;
- exact decimal-string HTTP transport, canonical responses, and rejection of
  JSON number tokens for decimal fields;
- input/derived numeric/Boolean definition and value validation;
- authored-default logical input values and stored-override normalization;
- recursive expression type inference with precise field paths;
- self/multi-node cycle rejection, deterministic dependency ordering, and
  defensive runtime cycle handling;
- exact numeric, Boolean, comparison, and conditional expression evaluation;
- intrinsic/effective evaluation, dependency propagation, and deterministic
  status modifier ordering;
- ordered scalar Effects observing earlier logical-input mutations;
- atomic failure and default behavior across scalar and status-lifecycle Effect transitions;
- inline status apply, exact-instance removal, automatic application order,
  same-name coexistence, and target/world-scope validation.

These are the preferred tests for mechanical semantics because they are fast,
deterministic, and independent of SQL/HTTP.

### Application tests

Files under `internal/app/*_test.go` focus on adapter behavior without a live
PostgreSQL integration fixture. They cover:

- configuration precedence and log levels;
- strict JSON and the error envelope;
- root-mounted static/SPA routing, missing-asset 404 behavior, and panic
  recovery;
- API Mechanic values and exact numeric transport;
- interaction mappings and generated IDs;
- archived-mechanic and dependency guards;
- event cursor parsing and matching;
- audience-removal event projection and request/panic-log bearer redaction;
- username/password hashing and parsing, origin/cookie/session middleware, and
  live effect validation;
- world creation, invite token hashing, capacity/capability mapping,
  character-field/profile validation, and semantic no-op comparison;
- recursive expression transport/storage reconstruction, derived-source
  validation, cycle field mapping, inline status modifier normalization, exact
  remove-target validation, and active derived-dependency guards;
- unknown API route families return `404 endpoint_not_found`.

Migration contract tests also require digest-only invitation storage, the
world mechanic graph/status tables, root-creation triggers, normalized storage
(no JSON/JSONB aggregate),
resolution-owned inline status modifiers, status source-provenance columns,
expanded Resolution-receipt tables, immutable Resolution-receipt triggers, constrained audience
invalidation, normalized usernames/Argon2id/session-token digests, and the
human/Terra/agent facilitator assignment and attribution shapes. They assert
the nullable, bounded World prose-guide column and
that Status authoring rows are owned by the
resolution rather than world configuration. For authentication, the static
migration contract requires the password-hash/token-digest columns and shape
constraints and rejects raw-token/session-token/CSRF columns in `auth_sessions`;
it does not inspect stored runtime values. The authentication contract's
targeted SQL reads perform the value comparison for signup-created rows against
the presented password and cookie token.

The current PostgreSQL-backed HTTP integration coverage comes primarily from
Playwright rather than a dedicated Go handler/database suite.

### Frontend unit tests

Bun tests under `web/frontend/src/**/*.test.{ts,tsx}` cover pure helpers, the
API adapter, and backend-independent view rendering:

- human-readable API vocabulary and past/future relative timestamps;
- exact-decimal text validation, canonicalization, and sign handling without
  JavaScript number coercion;
- derived mechanic mode/result-kind changes, including expression preservation
  and reset behavior;
- password minimum-length behavior;
- invite/world route parsing, URL encoding, default sections, selected mechanic
  round trips, and root-relative Play and Build routing;
- same-origin cookie requests, unsafe-method CSRF injection, removal of the
  caller-supplied UUID identity header, stale-CSRF recovery, session-safe mutation replay, and
  current-versus-superseded 401 authentication teardown;
- ChatGPT web-launch URL and starter-instruction construction, including the
  sole play-preference input and prohibition on browser-control requests; and
- World-settings prose-guide editing and clearing; and
- Start and six-command Play site-tool registration outcomes, schemas, prose-guide
  transport and bounded authority, static
  Play-handbook topics and presentation contract, API adaptation, idempotent
  retry state, route replacement, and recoverable errors through a controlled
  `document.modelContext`.

Backend-independent `*View.tsx` components also have fixture-driven rendering
tests. They use `react-dom/server`'s `renderToStaticMarkup`, which is already
available through the React runtime, so ordinary presentation tests need no DOM
emulator, browser, server process, API mock, or new test framework. Fixtures
cover materially different semantic states such as loading/empty, populated,
dirty, busy, validation failure, unavailable access, onboarding, and live
content as applicable.

View tests make focused semantic assertions against headings, status copy,
field values, disabled commands, and important accessibility attributes. They
do not use large markup snapshots. Pure mapping helpers should be tested
separately when a controller performs nontrivial DTO-to-view or
draft-to-command translation.

Static rendering intentionally does not execute effects or pointer/keyboard
events. Keep deterministic state changes in pure helpers, and use Playwright
when correctness depends on interaction, focus, routing, the API, revisions,
authorization, privacy, SSE, or multiple browser identities. The architectural
lint rule is the complementary proof that shared components, `*View.tsx`, and
`*ViewModel.{ts,tsx}` modules cannot acquire an API, route, resource-hook,
`fetch`, or event-stream dependency.

### Scenario and contract tests

`test/specs/scenarios/lifecycle-spine.spec.ts` is the one UI-authentic browser
execution. Four isolated, persistent owner/editor/player/spectator contexts
sign up through the UI and carry one user-authored world from account creation
and configuration through invites,
waiting/setup/readiness, editor authority, a shared live round, same-name Status-instance
application and exact removal, and owner-authored archive. `JRN-001` through
`JRN-007` remain separately named Playwright checkpoints inside that one test.
The spine does not use API writes, storage injection, or prepared state.

Fast PostgreSQL-backed contracts under `test/specs/contracts/` use independent
cookie jars and in-memory CSRF tokens. Ordinary product setup and commands go
through the public HTTP API. The authentication contract additionally uses test-
only direct SQL to expire or age a session, disable an account, seed the session-
cap fixture, and inspect password/session digests and timestamps. Those probes
make otherwise slow or unreachable persistence states deterministic; they are
not evidence that the same states are exposed through a product API. The
contracts retain the exact server evidence that does not need another browser
journey:

- `authentication.contract.spec.ts` covers signup/signin, cookie attributes,
  session bootstrap, anonymous forged-header denial, authenticated header
  ignoring, origin/CSRF failures, logout scopes, password replacement, and
  revoked-session behavior. Its targeted SQL reads verify that signup fixtures
  have distinct Argon2id hashes, session rows contain a digest rather than the
  cookie value, and authentication responses omit the inspected credentials. It
  also verifies that recent activity does not rewrite session timestamps,
  activity older than five minutes touches once, subsequent activity is
  coalesced, and repeated SSE reauthorization does not extend idle expiry;
- `access-and-invites.contract.spec.ts` covers world isolation, invitation-token
  secrecy, admission, membership-role/current-play-role denial, editor archive denial, and revocation;
- `profile-and-readiness.contract.spec.ts` covers play-status
  transitions, controlled-Entity authority, Entity-profile privacy projections, stale
  writes, and readiness regression after a character-field-set change;
- `mechanic-graph-and-status-instances.contract.spec.ts` covers world mechanic graph publication and atomic
  graph rejection, exact logical-input-value/effective-value results and Status-instance provenance in Resolution receipts, preview
  non-persistence, exact replay/conflicting replay, one-winner Resolution, and
  exact Status-instance removal;
- `authorization-matrices.contract.spec.ts` and
  `resource-lifecycle.contract.spec.ts` cover closed invitation states, membership-role and
  cross-world matrices, archived/incomplete resources, and atomic rejection;
- `concurrency-and-status-instance-matrices.contract.spec.ts` covers named Status-instance targets
  and Resolution race/replay matrices;
- `agent-facilitator-command.contract.spec.ts` covers current-player authority,
  agent attribution, Character claim, Problem/Action/Resolution transitions,
  exact mechanical changes, and idempotent replay with a World-scoped database
  trace; and
- `world-templates.contract.spec.ts` covers the complete three-item catalog,
  versioned prose guides, and exact guide materialization into independent
  copied Worlds; and
- `direct-gap-closures.contract.spec.ts` owns the remaining small authority,
  lifecycle, cancellation, projection, and no-audience contracts.

Focused browser contracts under `test/specs/ui-boundaries/` cover only behavior
whose visible UI is itself material: entry/deep-link/accessibility boundaries,
signup/signin/logout/reload, dirty-draft and stale-screen recovery,
authored-profile/control workflows, and event-stream reconnection. They use
ordinary HTTP fixture setup and do not
claim lifecycle-journey evidence.

`test/specs/integrations/delegated-start.site-tools.spec.ts` is the automated
site-tool page integration. It installs a controlled browser WebMCP harness,
starts from authenticated `/play/new`, invokes the complete Start surface,
requires same-tab navigation, invokes the Play
inspect/claim/inspect/read-handbook/present/submit/resolve sequence, presents the
next Problem, reloads, and checks durable agreement. It also proves that no
trusted setup controls were clicked. It does not invoke ChatGPT, exercise the
separate authentication boundary, evaluate three turns of model presentation,
or supply a ChatGPT acceptance record.

The dependency-free runtime under `test/src/scenario/` owns the 141-ID/five-tier
registry, required named cases, behavior/outcome contracts, checkpoint and
blocked-by semantics, mutation epochs, observation reuse, redacted evidence,
and performance records. Its millisecond verification runs before Playwright.

## E2E harness lifecycle

When invoked through `./ci.sh e2e`, Playwright global setup:

1. creates `test/artifacts` and removes stale runtime metadata;
2. validates the prebuilt binary supplied by the root validator; that binary
   already embeds the production frontend from the same invocation;
3. creates a unique database named `wrought_e2e_<timestamp>_<random>`;
4. selects a free loopback port;
5. starts the application with debug logging and the disposable URL as its
   exact public origin;
6. waits up to 10 seconds for `/api/health`;
7. writes the base URL and disposable database URL to ignored runtime metadata,
   created with mode `0600`.

A direct `(cd test && bun run e2e)` invocation has the same application boundary
but falls back to building the frontend and a temporary Go binary itself.

Teardown terminates the process group on POSIX systems or the child process on
Windows, closes the log, drops the database, removes any fallback binary
directory, and removes runtime metadata. Setup also removes stale metadata
before starting the application.

The disposable database URL is a narrowly scoped controlled-time fixture for
direct contracts. `INV-V01[expired]` signs up its account and creates its world,
membership, and
invite through public HTTP, then a test-only helper validates the invite's
canonical UUID and uses `psql` to move only that row's `expires_at` into the
past. Preview, redemption, membership, and use-count evidence still comes from
public HTTP. The helper is not a product endpoint, is not exported by the
scenario/journey runtime, and must not be used by the UI-authentic spine.

Database URL precedence is:

1. `WROUGHT_TEST_DATABASE_URL`;
2. `WROUGHT_E2E_ADMIN_DATABASE_URL`;
3. `WROUGHT_DATABASE_URL`;
4. `postgres://localhost:5432/postgres?sslmode=disable`.

The harness rewrites the selected URL's database path to `/postgres` for admin
commands, then creates its unique database with the remaining URL properties.

## Browser selection

The E2E launcher tries, in order:

1. Playwright's already-installed Chromium;
2. common system Chrome/Chromium locations for the platform;
3. `bunx playwright install chromium`.

The Playwright config reads `WROUGHT_E2E_BROWSER_EXECUTABLE`, but the custom launcher
performs the discovery sequence before starting Playwright. A discovered system
browser replaces the configured value; if no bundled or system browser exists,
the launcher installs Chromium before it can proceed. The variable is therefore
not a reliable discovery/install bypass in the current harness.

The required configuration runs one Desktop Chrome/Chromium project, two
workers, no retries, and a 20-second per-test ceiling inside the stricter
60-second whole-command budget. The lifecycle spine is still one serial test.
Only specs that own separate generated aggregates overlap; shared-database
assertions remain world- or exact-resource-scoped.

## Artifacts

On E2E runs, inspect:

| Path | Content |
| ---- | ------- |
| `test/artifacts/app-server.log` | Application stdout/stderr for the disposable server. |
| `test/artifacts/go-test-results.jsonl` | Machine-readable `go test -json` output. |
| `test/artifacts/scenario-architecture-results.xml` | JUnit output from scenario-runtime architecture tests. |
| `test/artifacts/playwright/` | Per-test results and screenshots captured on failure. |
| `test/artifacts/report/` | HTML report. |
| `test/artifacts/scenario-test-results.json` | Exact Playwright owner results and durations. |
| `test/artifacts/scenario-coverage.json` | Final 141-row scenario inventory; root E2E requires all passed. |
| `test/artifacts/agent-facilitator-command-database-trace.json` | Per-command World database states for the Agent-facilitator command contract. |

The agent-facilitator command database trace is a mode-`0600`, test-only JSON
sidecar. It records a baseline, the state after every mutating tool-equivalent
command, the changed tables at each boundary, and an idempotent replay. Capture
uses one read-only, repeatable-read transaction per state and an explicit
World-scoped projection.
Identity/authentication rows, invitation secrets, private notes, restricted
profile prose, and idempotency keys are excluded. The trace is attached to the
Playwright result as `agent-facilitator-command-database-trace` as well as
written at the path above.

Deployment verification records are separate from test artifacts. They live at
`.wrought/deployments/`, are ignored by Git, and contain only allowlisted
project/service IDs and names, whether CI passed/was skipped/was not run,
deployment state, manifest and database-volume facts, public URL, check
measurements, and timestamps. Deploy records identify the clean commit
uploaded; verify records label `localCommit` only as local checkout context and
do not infer the hosted source identity. They never contain database URLs,
Railway variables, cookies, authorization headers, CSRF values, or response
bodies.

The active checkout usually receives no artifacts when invoked through root
`ci.sh`, because the entire run occurs in the disposable worktree that is
removed afterward. To preserve artifacts for interactive debugging, run the
test project directly in the working checkout after installing dependencies.
A direct run also rebuilds ignored production output under `web/static` in that
checkout. Run the Agent-facilitator command contract directly to preserve its database
sidecar:

```sh
(cd test && bunx playwright test specs/contracts/agent-facilitator-command.contract.spec.ts --workers=1)
```

Passing required runs do not record trace or video. Set
`WROUGHT_E2E_DIAGNOSTICS=1` on a direct diagnostic run to retain both on failure;
the root performance-gated target deliberately keeps them off.

## Fast local iteration

The authoritative final repository check remains `./ci.sh`, but focused direct
commands can shorten a debugging loop:

```sh
go test ./internal/rules
go test ./internal/app
(cd web/frontend && bun test)
(cd web/frontend && bun run check)
(cd test && bun run verify:scenarios)
(cd test && bunx playwright test specs/integrations/delegated-start.site-tools.spec.ts --workers=1)
```

For browser work, the root E2E target is safest because it verifies all layers.
If running `(cd test && bun run e2e)` directly, ensure frontend/test dependencies
are installed and disposable database credentials are configured.

## Adding tests

### Mechanical rule

Add a table-driven or focused test in `internal/rules`. Assert both successful
output and validation error code/path. Include atomic input preservation when
the operation can fail after partial progress.

For graph changes, cover inferred result kind, arity, unknown/cross-world and
archived references, concrete cycle paths, deterministic topological order, and
runtime defensive failure. For Status-instance changes, cover literal kind, stable
modifier ordering, distinct instances per apply target, exact active-instance
removal, same-name coexistence, and snapshot preservation. Resolve idempotency,
rather than a name/definition lookup, must prevent duplicate lifecycle
mutations.

### Transport or persistence mapping

Test strict tagged shapes, generated/preserved IDs, exact numeric conversion,
inline apply specifications, exact remove targets, source provenance, and
round-trip response form. Add database-backed browser coverage if a
constraint/transaction is essential to correctness.

### Frontend behavior

Extract pure logic to `src/domain` and unit-test edge cases. Add Playwright when
the change involves server data, routing, keyboard workflow, revisions,
authorization, privacy, or multiple users.

### Live Play behavior

Use separate identities/contexts. Assert forbidden status codes directly, and
assert sensitive JSON properties are absent rather than merely invisible in the
DOM. Test preview non-persistence, resolve atomicity, stale revisions,
idempotency replay/conflict, event refresh, and archive/final-state rules as
applicable.

### Migration

Exercise an empty database through E2E. The migration-history test accepts only
prefixes of the full `001`–current chain, and focused SQL contracts assert the
current schema behavior. Set `WROUGHT_TEST_DATABASE_URL` only to a database that
can be destroyed or modified without consequence.

## Current gaps

- no dedicated Go PostgreSQL integration-test fixture;
- no DOM-emulated component interaction suite or automated visual-regression
  comparison beyond static view rendering and Playwright workflows;
- no source line/branch coverage threshold in the root validator;
- no accessibility audit such as axe;
- no Firefox, WebKit, mobile, or retry project;
- no load, proxy/multi-replica, long-duration SSE soak, fault-injection, or
  backup/restore tests;
