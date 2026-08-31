# Deployment readiness

This directory tracks the evidence, blockers, decisions, and exit criteria for
deploying Scryer beyond a trusted local environment. It complements the
system descriptions in [Operations](../operations.md) and
[Security](../security.md); it does not replace them.

**Current project state (2026-08-09):** trusted local development remains active,
and a public-addressable Railway preview is running with a managed PostgreSQL
service created fresh for that target. The preview is not designated public
production and has no production-audience or release commitment. Its existence
does not turn the broader readiness items here into local-development blockers
or imply that a public-release gate is open.

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
| Public-addressable Railway preview | Active | Conditional | Railway HTTPS, the exact external origin, a managed database created fresh for this target, one-replica rollout checks, and a non-persisting smoke journey are in place. Treat it only as a disposable preview with non-sensitive data while the operational controls below remain unresolved. |
| Public production | Not deployed | Blocked | No production launch is declared. Resolve backup/restore, monitoring, distributed abuse controls, privacy/support policy, capacity evidence, and external review before opening that gate. |

The active preview proves that the checked-in Railway configuration can produce
a healthy hosted process. It does not by itself make the target safe for an
unrestricted audience or durable real-user data.

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
   requirement.

If a public release is proposed, its release gate begins closed and opens only
after its target-specific blockers are resolved and the resulting behavior is
covered by proportionate evidence. No public-production gate is open today; the
running preview remains Conditional.
