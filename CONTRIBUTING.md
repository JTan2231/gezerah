# Contributing to Wrought

Thank you for helping improve Wrought. Please read the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating. Ordinary support
and bug-reporting guidance is in [SUPPORT.md](SUPPORT.md); suspected security
issues must follow [SECURITY.md](SECURITY.md).

## Before changing code

Use the installed `semantics.repository.explore` contract to read the
registered Semantics repository identified by the root participation marker,
then read the relevant document under [`docs/`](docs/README.md):

```sh
/Users/joey/.local/bin/chancery show semantics.repository.explore
```

The repository defines project terminology; code, tests, and product documents
remain authoritative for actual behavior. In particular:

- configuration and vocabulary are user-authored and World-scoped;
- do not add built-in Entity classes, privileged configured keys, canonical
  JSON storage, or seed vocabulary;
- keep membership role, current play role, and play status distinct;
- update the corresponding documentation when behavior or a public contract
  changes.

The [development guide](docs/development.md) covers prerequisites, local setup,
managed services, and focused change recipes.

## Making a change

1. Open an issue first for a substantial feature, architecture change, or
   behavior whose intended contract is unclear.
2. Keep the change focused and add tests at the narrowest useful layer.
3. Preserve unrelated work in the checkout and do not commit generated assets,
   dependencies, credentials, or test artifacts.
4. Run a focused validator while iterating, then run the complete validator
   before requesting review:

   ```sh
   ./ci.sh
   ```

   Focused targets are `./ci.sh frontend`, `./ci.sh backend`, and
   `./ci.sh e2e`.

5. If the change affects ChatGPT launch, delegated start, a Start or Play
   site-tool surface, or ChatGPT-visible narration, follow the
   [ChatGPT change-trigger matrix](docs/testing.md#change-trigger-matrix).
6. Stop any managed services used for debugging with `./run.sh stop`.

## Pull requests

Describe the user-visible outcome, important design choices, tests run, and any
remaining limitations. For a change covered by the ChatGPT trigger matrix,
report its acceptance state as `passed`, `failed`, `blocked`, or `not run`; do
not imply that automated validation exercised ChatGPT. Keep commits reviewable
and avoid combining unrelated cleanup with the requested change. A pull request
should leave documentation, tests, and implementation describing the same
behavior.
