# Working agreement

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
`./run.sh tail`. Runtime state and logs live under ignored `.gezerah/`; stop managed
services when debugging is complete.

Do not add built-in entity classes, privileged configured keys, canonical JSON
storage, or seed vocabulary. Configuration is user-authored and world-scoped.

We do not have active users. Please do not consider them in your design considerations.

Always consult `docs/glossary.md` before answering questions about the product
or architecture.

Please refer `docs/` before making any code changes or considerations.
