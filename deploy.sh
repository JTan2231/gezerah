#!/bin/sh
set -eu

repo_root="$(CDPATH= cd "$(dirname "$0")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
	printf 'bun is required but was not found in PATH\n' >&2
	exit 1
fi

cd "$repo_root/test"
bun install --frozen-lockfile
exec bun run deploy -- "$@"
