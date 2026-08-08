# Deployment readiness

This directory tracks the evidence, blockers, decisions, and exit criteria for
deploying Worldwright beyond a trusted local environment. It complements the
system descriptions in [Operations](../operations.md) and
[Security](../security.md); it does not replace them.

Readiness documents use these labels:

- **Ready**: implemented, verified, and acceptable for the stated deployment.
- **Conditional**: implemented in part or safe only under stated constraints.
- **Blocked**: must be resolved before the stated deployment.
- **Not audited**: no readiness conclusion has been made yet.

## Current release posture

| Deployment target | Status | Reason |
| --- | --- | --- |
| Local trusted development | Ready | Native signup/signin and server sessions work through the managed Vite origin. |
| Domainless/private Railway staging | Conditional | Set the exact HTTPS public origin, attach a fresh database, and restrict access while operational controls are evaluated. |
| Browser-accessible preview on an untrusted network | Conditional | UUID impersonation is closed; use HTTPS, non-sensitive data, verified secure cookies, and deployment-level abuse controls. |
| Public production | Blocked | Authentication is implemented, but backup/restore, monitoring, distributed abuse controls, privacy/support policy, capacity evidence, and external review remain open. |

Creating a Railway deployment does not change these classifications. A healthy
deployment is not automatically a safe public deployment.

## Audit index

- [Identity, users, memberships, invitations, and onboarding](identity-access.md)
  — audited 2026-08-07.

## Next readiness audits

The identity/access remediation is implemented. Follow-up documents should
cover:

1. production data, migration, backup, restore, and privacy operations;
2. observability, alerting, capacity, and incident response;
3. distributed/proxy-aware abuse controls and external security review;
4. Railway configuration, deployment verification, and rollback evidence;
5. the no-email password-loss and account-support policy, plus any future MFA
   requirement.

The public-release gate remains closed until every public-production blocker is
resolved and the resulting behavior is covered by automated tests.
