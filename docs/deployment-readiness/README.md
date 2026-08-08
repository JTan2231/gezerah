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
| Local trusted development | Ready | This is the environment assumed by the current identity adapter. |
| Domainless/private Railway staging | Conditional | Suitable for infrastructure validation with non-sensitive data after CI passes and access remains restricted. |
| Browser-accessible preview on an untrusted network | Blocked | A caller can select or forge any local user UUID and inherit that user's world authority. |
| Public production | Blocked | Real authentication, protected account provisioning, hardened invitations, and the remaining security/operational controls are not implemented. |

Creating a Railway deployment does not change these classifications. A healthy
deployment is not automatically a safe public deployment.

## Audit index

- [Identity, users, memberships, invitations, and onboarding](identity-access.md)
  — audited 2026-08-07.

## Next readiness audits

The identity and access audit is the first application-level audit. Follow-up
documents should cover:

1. production authentication and account lifecycle design;
2. HTTP/browser security and abuse controls;
3. production data, migration, backup, restore, and privacy operations;
4. observability, alerting, capacity, and incident response;
5. Railway configuration, deployment verification, and rollback evidence.

The public-release gate remains closed until every public-production blocker is
resolved and the resulting behavior is covered by automated tests.
