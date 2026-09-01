# WebMCP Challenge eligibility: before and during the submission period

This is the judge-facing record of what already existed in Gezerah before the
WebMCP Challenge and what was added during the challenge submission period. It
also explains why this repository has two historical roots and how to inspect
the preserved development history.

> [!IMPORTANT]
> Gezerah is a pre-existing product. The work in the **before** section is not
> presented as challenge work. Judges should evaluate only the WebMCP extension
> added after the submission period opened, beginning with commit `aaa1d89`.

## Rule this record addresses

The [official WebMCP Challenge rules](https://webmcp.devpost.com/rules),
section 4 under **Project Requirements → New & Existing**, allow an existing
project only when it is meaningfully extended with WebMCP after the submission
period begins. They require entrants to provide “clear documentation
distinguishing prior work from new work” with dated history or equivalent
evidence, and say that judges evaluate a pre-existing project only on work
added during the submission period.

The official rules start that period at **August 25, 2026, 11:00 a.m. Pacific
Time (`2026-08-25T18:00:00Z`)**. This record uses that earlier, governing
boundary. OpenAI's [challenge page](https://openai.com/webmcp-challenge/) also
expressly confirms that entrants may add WebMCP support to an existing app.

## Judge shortcut

The eligibility boundary is one parent-child edge:

| Snapshot                    | Commit and original commit time                                                                                                                                | Meaning                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last pre-period product     | [`07e00ebc9f4e82368c13437a950b39985abd8135`](https://github.com/JTan2231/gezerah/commit/07e00ebc9f4e82368c13437a950b39985abd8135), `2026-08-10T23:22:54-05:00` | Tip of [`archive/pre-webmcp-baseline`](https://github.com/JTan2231/gezerah/tree/archive/pre-webmcp-baseline): a 36-commit product history with 247 tracked files and no WebMCP implementation. |
| First WebMCP implementation | [`aaa1d89000207ddd8e9678586601bce7facb3563`](https://github.com/JTan2231/gezerah/commit/aaa1d89000207ddd8e9678586601bce7facb3563), `2026-08-29T14:45:38-05:00` | Direct child of `07e00eb`; adds the first ChatGPT/WebMCP implementation during the submission period.                                                                                          |

Review the bounded change directly:

- [GitHub comparison: `07e00eb...aaa1d89`](https://github.com/JTan2231/gezerah/compare/07e00ebc9f4e82368c13437a950b39985abd8135...aaa1d89000207ddd8e9678586601bce7facb3563)
- `git diff --stat origin/archive/pre-webmcp-baseline aaa1d89000207ddd8e9678586601bce7facb3563`
- `git diff origin/archive/pre-webmcp-baseline aaa1d89000207ddd8e9678586601bce7facb3563`

That direct diff changes 36 files with 3,184 insertions and 202 deletions.

## What existed before the submission period

The preserved history begins at `631f809206efe4217675e07c6efeaf76f35de0df`
on August 1 and reaches the last pre-period snapshot `07e00eb` on August 10.
That snapshot already contains the working application rather than a challenge
scaffold:

- a Go, React, and PostgreSQL collaborative World editor and Play surface;
- account authentication, sessions, World memberships, invitations, and
  authorization boundaries;
- user-authored input and derived Mechanics, exact numeric evaluation,
  persistent Status instances, and transactional Effects;
- the complete live Problem, Action, Consequence, Resolution, receipt, and
  event flow;
- human and Terra facilitation, including the pre-existing server-side OpenAI
  Responses integration and facilitator handoff;
- backend, frontend, contract, browser, scenario, migration, deployment, and
  security tests and documentation; and
- a verified Railway deployment workflow and a running hosted preview.

The snapshot contains 247 tracked files across 36 commits. It has no matches
for `WebMCP`, `modelContext`, `registerTool`, or `ChatGPT`, and it does not
contain the WebMCP documentation, browser site-tool adapter, agent Facilitator
backend, agent migration, or WebMCP contract added later. Inspect it without
checking out the old tree:

```sh
git show origin/archive/pre-webmcp-baseline:README.md
git ls-tree -r --name-only origin/archive/pre-webmcp-baseline
git grep -n -i -E 'webmcp|modelContext|registerTool|ChatGPT' \
  origin/archive/pre-webmcp-baseline -- .
```

The final command intentionally produces no matches.

## What was added during the submission period

Commit `aaa1d89`, **Implement ChatGPT WebMCP dungeon master**, is the sole
child immediately following the pre-period baseline. Among its additions are:

- `docs/webmcp.md`;
- `internal/app/agent_dm.go` and its tests;
- `internal/migrations/007_agent_facilitator.sql`;
- `test/specs/contracts/webmcp-agent.contract.spec.ts`;
- `web/frontend/src/features/agentPlayTools.ts` and its tests; and
- `web/frontend/src/model-context.d.ts`.

That change adds the WebMCP browser tool registrations, authenticated page-tool
adapter, agent Facilitator HTTP and persistence boundary, database migration,
end-to-end contract, tests, and documentation. Later challenge-period commits
refine the ChatGPT start and Play experience, vocabulary, presentation,
templates, and acceptance evidence. For the complete submitted delta rather
than only the first implementation, compare the pre-period baseline with the
current default branch:

```sh
git diff --stat origin/archive/pre-webmcp-baseline master
git diff origin/archive/pre-webmcp-baseline master
```

Product renames, open-source packaging, and unrelated maintenance made during
the same period are visible in that broader comparison but are not presented
as the WebMCP extension. The parent-child comparison above isolates the first
implementation; the commit subjects and file-level diff make later refinements
separately inspectable.

## Why the Git history has two roots

Development originally took place in the 42-commit graph archived at
[`archive/pre-open-source-history`](https://github.com/JTan2231/gezerah/tree/archive/pre-open-source-history).
Its final commit is:

```text
1b66b63015d7c2dde262f138e3aeb3e3b00cf5c8  Prepare Gezerah for open source
tree a04464bff2feee056318873e2fa66b5c9fb517bb
```

When the repository was opened publicly, that prepared tree was published as a
new root commit rather than by publishing the local development graph:

```text
3739398af9e4c5f1b5d5fa59fa584ba38ec80dba  Initial open-source release
tree a04464bff2feee056318873e2fa66b5c9fb517bb
```

The identical tree hash proves that the public root is the exact snapshot at
the end of the preserved original graph. Because the prepared open-source
snapshot was published as a new root, the public branch no longer displayed
the before/after boundary that the challenge rules require judges to inspect.

On September 1, the retained original objects were made durable as two explicit
archive branches:

- `archive/pre-webmcp-baseline` → `07e00ebc9f4e82368c13437a950b39985abd8135`
- `archive/pre-open-source-history` → `1b66b63015d7c2dde262f138e3aeb3e3b00cf5c8`

The branches preserve the original graph without rewriting or splicing it into
the already-published default-branch chronology. GitHub exposes the archived
commits and comparison directly, and an ordinary clone receives them as
remote-tracking branches. No historical commit, parent, author date, committer
date, or tree was rewritten. The duplicate roots are therefore deliberate and
documented, not evidence of two different projects.

The archive refs themselves were created on September 1 solely to keep the
already-existing commits reachable and reviewable; the ref-creation date is
not offered as chronology evidence. The original commits are intentionally
unmodified historical evidence and therefore retain their original author
metadata plus non-secret deployment identifiers and a public test link that
the open-source preparation commit later removed.

The project used the working names **Worldwright**, **dnd**, and **Scryer**
before being named **Gezerah**. The archived commits and Railway records show
those renames in one continuous repository and deployment lineage.

## Corroborating Railway timestamps

Git commit times are not the only dating evidence. Railway's provider-side
deployment history still reports the following records with deployment UUIDs
and immutable image digests:

| Phase                   | Railway creation time      | Source identity      | Deployment and image                                                                                              |
| ----------------------- | -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Last pre-WebMCP product | `2026-08-11T04:23:36.144Z` | `Deploy 07e00eb ...` | `4b8f0197-1d95-40a0-a2f9-948ad3d9629b`; `sha256:274be785540ed42c3e9b078e0c1faf8395ed1aabcf13a07815817b8e11519d36` |
| First WebMCP product    | `2026-08-29T19:46:20.491Z` | `Deploy aaa1d89 ...` | `3f36607b-cffe-4e22-bb39-7d3c3179010e`; `sha256:c75d87ef22e904e215479051e2d263cd9ad232cd6c2f9e14918dfed99413eab1` |

The two commit-addressed deployments were created 42 seconds after their
corresponding Git commits. Byte-for-byte copies of the allowlisted
deployment-completion records captured at deployment time are archived here:

- [`4b8f0197-1d95-40a0-a2f9-948ad3d9629b.json`](evidence/webmcp-challenge/railway/4b8f0197-1d95-40a0-a2f9-948ad3d9629b.json)
  (`SHA-256 be9504b68bc28777761b833a0d83edfe01f154c8243d3ee079aa8c702509e925`)
- [`3f36607b-cffe-4e22-bb39-7d3c3179010e.json`](evidence/webmcp-challenge/railway/3f36607b-cffe-4e22-bb39-7d3c3179010e.json)
  (`SHA-256 6b657c83b684bbe66c1f5672d6fda42ebfd7a771820a169be0affaa8ffa4a49e`)

They contain exact full commit IDs, CI outcomes, Railway creation times,
public HTTP checks, and browser smoke results; they contain no credentials,
cookies, database URLs, or Railway variables.

Railway currently reports the old deployments as `REMOVED`; newer deployments
have since replaced them. The completion records captured each one as
`SUCCESS`, and the provider history retains their creation times, source
identities, and image digests.

## Reproduce the Git evidence

Fetch the archive refs explicitly, including from a single-branch clone:

```sh
git fetch origin \
  refs/heads/archive/pre-webmcp-baseline:refs/remotes/origin/archive/pre-webmcp-baseline \
  refs/heads/archive/pre-open-source-history:refs/remotes/origin/archive/pre-open-source-history

git log --graph --decorate --all --date=iso-strict \
  --format='%h %aI %s'

git show -s --format='%H%nparents %P%ndate %aI%ntree %T%nsubject %s' \
  origin/archive/pre-webmcp-baseline \
  aaa1d89000207ddd8e9678586601bce7facb3563 \
  origin/archive/pre-open-source-history \
  3739398af9e4c5f1b5d5fa59fa584ba38ec80dba

git rev-list --count origin/archive/pre-webmcp-baseline
git diff --shortstat origin/archive/pre-webmcp-baseline \
  aaa1d89000207ddd8e9678586601bce7facb3563
```

Expected anchors:

- pre-period commit count: `36`;
- `aaa1d89` has exactly one parent: `07e00eb`;
- bounded first WebMCP diff: `36 files changed, 3184 insertions(+), 202 deletions(-)`;
- `1b66b63` and `3739398` have the same tree:
  `a04464bff2feee056318873e2fa66b5c9fb517bb`.
