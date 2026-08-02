#!/bin/sh
set -u

cd "$(dirname "$0")"

section() {
	printf '\n==> %s\n' "$1"
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		return 1
	fi
}

cleanup() {
	status=$?
	trap - EXIT INT TERM

	if [ "${smoke_pid:-}" != "" ] && kill -0 "$smoke_pid" >/dev/null 2>&1; then
		kill "$smoke_pid" >/dev/null 2>&1 || true
		wait "$smoke_pid" >/dev/null 2>&1 || true
	fi

	if [ "${ci_worktree_path:-}" != "" ]; then
		git worktree remove --force "$ci_worktree_path" >/dev/null 2>&1 || {
			rm -rf "$ci_worktree_path"
			git worktree prune >/dev/null 2>&1 || true
		}
	fi

	if [ "${tmp_dir:-}" != "" ] && [ -d "$tmp_dir" ]; then
		chmod -R u+w "$tmp_dir" >/dev/null 2>&1 || true
		rm -rf "$tmp_dir"
	fi
	exit "$status"
}

usage() {
	cat <<'EOF'
Usage: ./ci.sh [all|frontend|backend|e2e|test]

Runs all checks by default in an isolated temporary Git worktree.
EOF
}

run_in_isolated_worktree() {
	require_command git || return 1

	base_commit="$(git rev-parse --verify HEAD)" || return 1
	tmp_index="$tmp_dir/snapshot.index"
	ci_worktree_path="$tmp_dir/worktree"

	section "CI: preparing isolated worktree"
	GIT_INDEX_FILE="$tmp_index" git read-tree "$base_commit" || return 1
	GIT_INDEX_FILE="$tmp_index" git add -A -- . || return 1
	tree="$(GIT_INDEX_FILE="$tmp_index" git write-tree)" || return 1
	snapshot_commit="$(
		printf 'dnd ci snapshot\n' |
			GIT_AUTHOR_NAME='DND CI' \
			GIT_AUTHOR_EMAIL='ci@dnd.invalid' \
			GIT_COMMITTER_NAME='DND CI' \
			GIT_COMMITTER_EMAIL='ci@dnd.invalid' \
			git commit-tree "$tree" -p "$base_commit"
	)" || return 1

	git worktree add --detach "$ci_worktree_path" "$snapshot_commit" || return 1

	section "CI: running checks in isolated worktree"
	DND_CI_IN_WORKTREE=1 "$ci_worktree_path/ci.sh" "$@"
}

configure_ci_caches() {
	ci_cache_dir="$tmp_dir/cache"
	playwright_browsers_path="${PLAYWRIGHT_BROWSERS_PATH:-}"

	if [ "$playwright_browsers_path" = "" ]; then
		case "$(uname -s 2>/dev/null || printf unknown)" in
		Darwin)
			if [ "${HOME:-}" != "" ]; then
				playwright_browsers_path="$HOME/Library/Caches/ms-playwright"
			fi
			;;
		Linux)
			if [ "${XDG_CACHE_HOME:-}" != "" ]; then
				playwright_browsers_path="$XDG_CACHE_HOME/ms-playwright"
			elif [ "${HOME:-}" != "" ]; then
				playwright_browsers_path="$HOME/.cache/ms-playwright"
			fi
			;;
		esac
	fi
	if [ "$playwright_browsers_path" = "" ]; then
		playwright_browsers_path="$ci_cache_dir/ms-playwright"
	fi

	mkdir -p \
		"$ci_cache_dir/bun" \
		"$ci_cache_dir/go-build" \
		"$ci_cache_dir/go-mod" \
		"$ci_cache_dir/go-tmp" \
		"$ci_cache_dir/node-compile" \
		"$ci_cache_dir/tmp" \
		"$ci_cache_dir/xdg" || return 1

	export TMPDIR="$ci_cache_dir/tmp"
	export XDG_CACHE_HOME="$ci_cache_dir/xdg"
	export GOCACHE="$ci_cache_dir/go-build"
	export GOMODCACHE="$ci_cache_dir/go-mod"
	export GOTMPDIR="$ci_cache_dir/go-tmp"
	export NODE_COMPILE_CACHE="$ci_cache_dir/node-compile"
	export PLAYWRIGHT_BROWSERS_PATH="$playwright_browsers_path"
	export DND_BUN_CACHE_DIR="$ci_cache_dir/bun"
	export BUN_INSTALL_CACHE_DIR="$ci_cache_dir/bun"
}

bun_ci() {
	bun install --frozen-lockfile --cache-dir "$DND_BUN_CACHE_DIR"
}

run_frontend() {
	require_command bun || return 1

	section "Frontend: installing locked dependencies"
	(cd web/frontend && bun_ci) || return 1

	section "Frontend: checking formatting"
	(cd web/frontend && bun run format:check) || return 1

	section "Frontend: linting TypeScript and React"
	(cd web/frontend && bun run lint) || return 1

	section "Frontend: linting CSS"
	(cd web/frontend && bun run lint:css) || return 1

	section "Frontend: running unit tests"
	(cd web/frontend && bun run test) || return 1

	section "Frontend: checking unused code"
	(cd web/frontend && bun run check:dead) || return 1

	section "Frontend: type checking"
	(cd web/frontend && bun run check) || return 1

	section "Frontend: building production assets"
	(cd web/frontend && bun run build) || return 1
}

run_database_smoke() {
	if [ "${DND_TEST_DATABASE_URL:-}" = "" ]; then
		section "Database: skipped (DND_TEST_DATABASE_URL is unset)"
		return 0
	fi

	section "Database: applying migrations through application startup"
	smoke_log="$tmp_dir/database-smoke.log"
	DND_ADDR=127.0.0.1:0 \
		DND_DATABASE_URL="$DND_TEST_DATABASE_URL" \
		DND_LOG_LEVEL=debug \
		"$tmp_dir/dnd" >"$smoke_log" 2>&1 &
	smoke_pid=$!

	attempt=0
	while [ "$attempt" -lt 80 ]; do
		if grep -q '"msg":"dnd listening"' "$smoke_log"; then
			sleep 0.25
			if ! kill -0 "$smoke_pid" >/dev/null 2>&1; then
				printf 'Application exited immediately after startup:\n' >&2
				cat "$smoke_log" >&2
				wait "$smoke_pid" >/dev/null 2>&1 || true
				smoke_pid=""
				return 1
			fi
			kill "$smoke_pid" >/dev/null 2>&1 || true
			wait "$smoke_pid" >/dev/null 2>&1 || true
			smoke_pid=""
			return 0
		fi
		if ! kill -0 "$smoke_pid" >/dev/null 2>&1; then
			printf 'Application exited during database smoke test:\n' >&2
			cat "$smoke_log" >&2
			wait "$smoke_pid" >/dev/null 2>&1 || true
			smoke_pid=""
			return 1
		fi
		attempt=$((attempt + 1))
		sleep 0.25
	done

	printf 'Application did not finish startup within 20 seconds:\n' >&2
	cat "$smoke_log" >&2
	return 1
}

run_backend() {
	require_command go || return 1
	go_packages="$(go list ./... | grep -v '/web/frontend/node_modules/')" || return 1

	section "Backend: checking Go formatting"
	find . -type f -name '*.go' ! -path './.git/*' ! -path './web/frontend/node_modules/*' -print |
		sort |
		while IFS= read -r file; do
			gofmt -l "$file"
		done >"$tmp_dir/gofmt.out" || return 1
	if [ -s "$tmp_dir/gofmt.out" ]; then
		printf 'The following Go files need gofmt:\n' >&2
		cat "$tmp_dir/gofmt.out" >&2
		return 1
	fi

	section "Backend: checking module tidiness"
	go mod tidy -diff || return 1

	section "Backend: running go vet"
	go vet $go_packages || return 1

	section "Backend: running tests"
	go test $go_packages || return 1

	section "Backend: building dnd binary"
	go build -trimpath -o "$tmp_dir/dnd" ./cmd/dnd || return 1

	section "Developer tooling: checking shell syntax"
	sh -n ci.sh run.sh reset-db.sh || return 1

	run_database_smoke || return 1
}

run_e2e() {
	if [ ! -f test/package.json ]; then
		section "E2E: skipped (test/package.json is not present yet)"
		return 0
	fi

	require_command bun || return 1
	require_command go || return 1

	section "E2E: installing locked dependencies"
	(cd test && bun_ci) || return 1

	section "E2E: checking formatting"
	(cd test && bun run format:check) || return 1

	section "E2E: type checking"
	(cd test && bun run check) || return 1

	section "E2E: running browser scenarios"
	(cd test && bun run e2e) || return 1
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dnd-ci.XXXXXX")" || exit 1
ci_worktree_path=""
smoke_pid=""
trap cleanup EXIT INT TERM

target="all"
if [ "$#" -gt 1 ]; then
	usage >&2
	exit 2
fi
if [ "$#" -eq 1 ]; then
	case "$1" in
	all | --all)
		target="all"
		;;
	frontend | front | --frontend | --front)
		target="frontend"
		;;
	backend | back | --backend | --back)
		target="backend"
		;;
	e2e | test | --e2e | --test)
		target="e2e"
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		printf 'Unknown CI target: %s\n\n' "$1" >&2
		usage >&2
		exit 2
		;;
	esac
fi

if [ "${DND_CI_IN_WORKTREE:-}" != "1" ]; then
	run_in_isolated_worktree "$@"
	exit $?
fi

configure_ci_caches || exit 1

case "$target" in
all)
	run_frontend || exit 1
	run_backend || exit 1
	run_e2e || exit 1
	;;
frontend)
	run_frontend || exit 1
	;;
backend)
	run_backend || exit 1
	;;
e2e)
	run_frontend || exit 1
	run_backend || exit 1
	run_e2e || exit 1
	;;
esac

section "CI checks passed"
