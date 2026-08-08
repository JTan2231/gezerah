# Deployment readiness

This directory tracks the evidence, blockers, decisions, and exit criteria for
deploying Worldwright beyond a trusted local environment. It complements the
system descriptions in [Operations](../operations.md) and
[Security](../security.md); it does not replace them.

**Current project state (2026-08-08):** no hosted deployment is running or
planned, and there is no production database, production user population,
external audience, release commitment, or concerned external party. The only
active target is trusted local development. Everything here about a non-local
target is dormant reference material, not work owed now and not a blocker to
local development.

Readiness documents use these labels for a target's gate if that target is
pursued:

- **Ready**: implemented, verified, and acceptable for the stated deployment.
- **Conditional**: implemented in part or safe only under stated constraints.
- **Blocked**: must be resolved before the stated deployment.
- **Not audited**: no readiness conclusion has been made yet.

## Current project state and future gates

| Deployment target | Current state | Gate if pursued | Reason |
| --- | --- | --- | --- |
| Local trusted development | Active | Ready | Native signup/signin and server sessions work through the managed Vite origin. |
| Domainless/private Railway staging | Not deployed | Conditional | If proposed, name its owner and audience, set the exact HTTPS public origin, attach a fresh database, and restrict access while operational controls are evaluated. |
| Browser-accessible preview on an untrusted network | Not deployed | Conditional | If proposed, define its audience and data policy, then require HTTPS, non-sensitive data, verified secure cookies, and deployment-level abuse controls. |
| Public production | Not deployed | Blocked | No launch is planned and there are no users or concerned parties. If proposed, resolve backup/restore, monitoring, distributed abuse controls, privacy/support policy, capacity evidence, and external review before opening its gate. |

Checked-in Railway configuration does not mean a deployment exists or is
planned. Creating one would activate a target-specific review; a healthy
process would not by itself make that target safe for public use.

## Audit index

- [Identity, users, memberships, invitations, and onboarding](identity-access.md)
  — audited 2026-08-07.

## Deferred readiness work

The identity/access remediation is implemented. Do not perform the following as
speculative launch work. If someone proposes a non-local target, first identify
the owner, audience, data sensitivity, and intended lifetime; then scope the
relevant evidence from this list:

1. production data, migration, backup, restore, and privacy operations;
2. observability, alerting, capacity, and incident response;
3. distributed/proxy-aware abuse controls and external security review;
4. Railway configuration, deployment verification, and rollback evidence;
5. the no-email password-loss and account-support policy, plus any future MFA
   requirement.

If a public release is ever proposed, its release gate begins closed and opens
only after its target-specific blockers are resolved and the resulting behavior
is covered by proportionate evidence. No such gate is active today.
