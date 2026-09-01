# Security policy

## Supported versions

Gezerah does not yet publish versioned releases. Security fixes are made only
on the latest commit of the default branch.

| Version                 | Supported |
| ----------------------- | --------- |
| Latest default branch   | Yes       |
| Older commits and forks | No        |

The hosted instance is a conditional preview, not a supported
public-production service. See [deployment readiness](docs/deployment-readiness/README.md)
for its current boundaries.

## Report a vulnerability privately

Use GitHub private vulnerability reporting as the primary reporting route:
open this repository's **Security** tab, choose **Advisories**, and select
**Report a vulnerability**. Do not open a public issue, discussion, or pull
request for a suspected vulnerability.

If private vulnerability reporting is unavailable, contact the repository
owner through a private method listed on their GitHub profile and ask for a
secure reporting route without including exploit details. If no private route
is available, wait rather than publishing the report.

Include the affected commit, impact, prerequisites, reproduction steps, and a
minimal proof of concept when safe. Remove credentials, tokens, personal data,
and data from systems you do not own. Do not test against the hosted preview;
use a local disposable database and synthetic accounts.

Maintainers will coordinate disclosure and remediation in the private advisory.
No response or repair SLA is currently promised.
