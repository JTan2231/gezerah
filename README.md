# Wrought

> **WebMCP Challenge judges:** Wrought predates the challenge; only the WebMCP
> extension is submission-period work. See the
> [eligibility record](WEBMCP_CHALLENGE_ELIGIBILITY.md) for the exact boundary.

Wrought is a collaborative world editor and live-play surface for improvised roleplaying.
Authors define each World's mechanics and Characters; a human, Terra, or ChatGPT can facilitate Play.
It keeps configuration and play history durable without imposing built-in world vocabulary.

## Run locally

```sh
createdb wrought
(cd web/frontend && bun install --frozen-lockfile)
./run.sh
```

Open <http://127.0.0.1:5173/>.

## Everyday commands

```sh
./run.sh status
./run.sh tail
./run.sh restart all
./run.sh stop
./ci.sh
```

## Where to look

- [System documentation](docs/README.md)
- [Setup and local operation](docs/development.md)
- [Testing](docs/testing.md)
- [Deployment and recovery](docs/operations.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security](SECURITY.md)

Wrought is licensed under the [MIT License](LICENSE).
