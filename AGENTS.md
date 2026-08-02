# Working agreement

Use `./ci.sh` to validate code changes. Focused targets are available with
`./ci.sh frontend`, `./ci.sh backend`, and `./ci.sh e2e`.

`./run.sh` controls local development. With no arguments it starts the Go API
and Vite frontend in the background and exits. Use `./run.sh status`,
`./run.sh restart backend|frontend|all`, `./run.sh stop`, `./run.sh logs`, and
`./run.sh tail`. Runtime state and logs live under ignored `.dnd/`; stop managed
services when debugging is complete.

Do not add built-in entity classes, privileged configured keys, canonical JSON
storage, or seed vocabulary. Configuration is user-authored and ruleset-scoped.
