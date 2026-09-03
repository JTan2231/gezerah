# Working agreement

Semantics-Project: gezerah

Use `./ci.sh` to validate code changes. Focused targets are available with
`./ci.sh frontend`, `./ci.sh backend`, and `./ci.sh e2e`.

For changes to the ChatGPT launch, either site-tool surface, registration or
readiness behavior, or ChatGPT-facing instructions, update `docs/webmcp.md` and
`docs/testing.md` with the implementation. Run the focused frontend checks and
the site-tool page integration through `./ci.sh e2e`, then run `./ci.sh` before
requesting review. CI is not a ChatGPT acceptance run: do not describe a candidate as
ChatGPT accepted or promote that experience to public production until the
stable ChatGPT acceptance scenario has a passing dated record.

`./run.sh` controls local development. With no arguments it starts the Go API
and Vite frontend in the background and exits. Use `./run.sh status`,
`./run.sh restart backend|frontend|all`, `./run.sh stop`, `./run.sh logs`, and
`./run.sh tail`. Runtime state and logs live under ignored `.wrought/`; stop managed
services when debugging is complete.

Do not add built-in entity classes, privileged configured keys, canonical JSON
storage, or runtime/world seed vocabulary. Configuration is user-authored and
world-scoped. The project-level terminology metadata maintained by Semantics is
documentation state; it must not become built-in runtime vocabulary or give
world-authored or problem-authored terms engine-level meaning.

We do not have active users. Please do not consider them in your design considerations.

The registered Semantics repository identified by the stable marker above is authoritative for
maintained platform and product terminology and its semantic history. Before
answering questions about the product or architecture, use Chancery contract
`semantics.repository.explore` to query it. Do not read or edit Semantics state
directly. Code, tests, and product documentation remain authoritative for
behavior and implementation facts.

Please refer `docs/` before making any code changes or considerations.
