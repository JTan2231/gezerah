# Deployment readiness

This directory tracks the evidence, blockers, decisions, and exit criteria for
deploying Wrought beyond a trusted local environment. It complements the
system descriptions in [Operations](../operations.md) and
[Security](../security.md); it does not replace them.

**Current project state (2026-09-03):** trusted local development remains
active, and the canonical Wrought subdomain preview is live on Railway with a
managed PostgreSQL service. DNS and the Railway custom domain are verified, and
the canonical root, API health, asset, Play, Build, and anonymous invalid-signin
browser checks pass. The personal site at <https://joeytan.dev> remains
entirely on its unchanged GitHub Pages deployment. The preview is not designated
public production and has no production-audience commitment. Its existence does
not turn the broader readiness items here into local-development blockers or
imply that a public-release gate is open.

Readiness documents use these labels for a target's gate if that target is
pursued:

- **Ready**: implemented, verified, and acceptable for the stated deployment.
- **Conditional**: implemented in part or safe only under stated constraints.
- **Blocked**: must be resolved before the stated deployment.
- **Not audited**: no readiness conclusion has been made yet.

## Current project state and future gates

| Deployment target | Current state | Gate | Reason |
| --- | --- | --- | --- |
| Local trusted development | Active | Ready | Native signup/signin and server sessions work through the managed Vite origin. |
| Railway provider endpoint | Active for diagnostics | Conditional | The generated hostname remains available for deployment diagnostics but is not the canonical browser origin. |
| Canonical Wrought subdomain preview | Active | Conditional | DNS, the Railway custom domain, and canonical HTTP/browser smoke are verified; secure-session behavior, public-production readiness, and ChatGPT acceptance remain separate gates. |
| Public production | Not deployed | Blocked | No production launch is declared. Resolve backup/restore, monitoring, distributed abuse controls, privacy/support policy, capacity evidence, and external review before opening that gate. |

The canonical preview verifies the hosted process, dedicated browser origin,
and root-mounted routing. It does not verify secure-session cookie issuance and
is not safe by implication for an unrestricted audience or durable real-user
data. Wrought's independent browser origin leaves the apex personal-site
deployment unchanged.

See [Operations](../operations.md#subdomain-topology-and-cutover) and
[Security](../security.md#dedicated-subdomain-origin).

The cutover uses two distinct release stages. First,
`./deploy.sh deploy --pre-dns` records `schemaVersion: 2` and
`releaseStage: "pre-dns"`
evidence from HTTP checks against the generated Railway hostname; it never runs
the browser authentication probe. After DNS and certificate readiness plus
obsolete-domain cleanup, `./deploy.sh verify` must record
`releaseStage: "post-cutover"` against exactly `https://wrought.joeytan.dev`
and the cleaned domain allowlist. Both stages
require the manifest's 30-second health-check timeout. The post-cutover invalid
signin probe verifies the canonical origin and anonymous login boundary, not
session-cookie issuance or attributes.

### ChatGPT delegated-start readiness

A target must not describe its public ChatGPT launch or delegated-start path as
accepted until the stable [ChatGPT acceptance scenario](../testing.md#chatgpt-acceptance)
passes against that exact deployed candidate. Repository CI, the
Agent-facilitator command contract, site-tool page integration, and the
non-persisting deployed smoke do
not exercise the signed-in ChatGPT product and cannot supply that record.

This readiness statement covers only the first-version public scope: choosing
and copying one bundled ready-made World, claiming one complete Character, and
beginning Play through the Start and Play site-tool surfaces. Custom Build,
saved-World discovery, invites and multiplayer onboarding, and incomplete
profile completion must not be claimed as accepted ChatGPT entry behavior.

The repository owns the stable scenario and pass criteria. A separately operated
external handbook may own a dated acceptance record for an exact candidate; it
does not change the gate definition or replace repository evidence.

No new dated three-turn record has been supplied for the Wrought rename and
`https://wrought.joeytan.dev/play/new` attachment, so the rebranded candidate is
not currently claimed as ChatGPT accepted.

## Audit index

- [Identity, users, memberships, invitations, and onboarding](identity-access.md)
  — audited 2026-08-07.

## Deferred readiness work

The identity/access remediation is implemented. Scope the following work to a
concrete change in the active preview's audience, data sensitivity, intended
lifetime, or production status; do not treat it as speculative work owed by
local development:

1. production data, migration, backup, restore, and privacy operations;
2. observability, alerting, capacity, and incident response;
3. distributed/proxy-aware abuse controls and external security review;
4. Railway configuration, deployment verification, and rollback evidence;
5. the no-email password-loss and account-support policy, plus any future MFA
   requirement; and
6. a passing ChatGPT acceptance record for the exact candidate if public
   delegated start is offered.

If a public release is proposed, its release gate begins closed and opens only
after its target-specific blockers are resolved and the resulting behavior is
covered by proportionate evidence. No public-production gate is open today; the
running preview remains Conditional.
