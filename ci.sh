#!/bin/sh
set -u

clock_milliseconds() {
	if command -v perl >/dev/null 2>&1; then
		perl -MTime::HiRes=time -e 'printf "%.0f\n", time * 1000'
		return
	fi
	if command -v python3 >/dev/null 2>&1; then
		python3 -c 'import time; print(time.time_ns() // 1_000_000)'
		return
	fi
	seconds="$(date +%s)" || return 1
	printf '%s000\n' "$seconds"
}

case "${WROUGHT_CI_STARTED_MS:-}" in
"" | *[!0-9]*)
	ci_invocation_started_ms="$(clock_milliseconds)" || exit 1
	;;
*)
	if [ "${WROUGHT_CI_IN_WORKTREE:-}" = "1" ]; then
		ci_invocation_started_ms="$WROUGHT_CI_STARTED_MS"
	else
		ci_invocation_started_ms="$(clock_milliseconds)" || exit 1
	fi
	;;
esac

cd "$(dirname "$0")"

go_required_version="go1.25.14"
golangci_lint_required_version="2.12.2"
govulncheck_version="v1.6.0"
golangci_lint_binary=""
govulncheck_binary=""

section() {
	printf '\n==> %s\n' "$1"
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		return 1
	fi
}

require_go() {
	require_command go || return 1
	go_actual_version="$(go env GOVERSION)" || return 1
	if [ "$go_actual_version" != "$go_required_version" ]; then
		printf '%s is required, but the active Go toolchain is %s\n' \
			"$go_required_version" "$go_actual_version" >&2
		return 1
	fi
}

require_golangci_lint() {
	golangci_lint_actual_version="$("$golangci_lint_binary" version --short)" || return 1
	if [ "$golangci_lint_actual_version" != "$golangci_lint_required_version" ]; then
		printf 'golangci-lint %s is required, but the cached binary reports %s\n' \
			"$golangci_lint_required_version" "$golangci_lint_actual_version" >&2
		return 1
	fi
}

require_govulncheck() {
	govulncheck_build_info="$(go version -m "$govulncheck_binary")" || return 1
	govulncheck_actual_path="$(
		printf '%s\n' "$govulncheck_build_info" |
			awk '$1 == "path" { print $2; exit }'
	)"
	govulncheck_actual_version="$(
		printf '%s\n' "$govulncheck_build_info" |
			awk '$1 == "mod" && $2 == "golang.org/x/vuln" { print $3; exit }'
	)"
	if [ "$govulncheck_actual_path" != "golang.org/x/vuln/cmd/govulncheck" ] ||
		[ "$govulncheck_actual_version" != "$govulncheck_version" ]; then
		printf 'govulncheck %s is required, but the cached binary reports %s@%s\n' \
			"$govulncheck_version" \
			"${govulncheck_actual_path:-unknown}" \
			"${govulncheck_actual_version:-unknown}" >&2
		return 1
	fi
}

download_ci_file() {
	download_url="$1"
	download_destination="$2"
	download_temporary="$download_destination.tmp.$$"
	if ! curl --fail --location --silent --show-error --retry 3 \
		--output "$download_temporary" "$download_url"; then
		rm -f "$download_temporary"
		return 1
	fi
	mv "$download_temporary" "$download_destination"
}

file_sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
		return
	fi
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{print $1}'
		return
	fi
	printf 'sha256sum or shasum is required to verify downloaded CI tools\n' >&2
	return 1
}

provision_golangci_lint() {
	require_command curl || return 1
	require_command tar || return 1

	tool_os="$(go env GOOS)" || return 1
	tool_arch="$(go env GOARCH)" || return 1
	case "$tool_os/$tool_arch" in
	darwin/amd64)
		expected_sha256="f6f06d94b6241521c53d15450c5209b028270bf966f842afb11c030c79f5bc16"
		;;
	darwin/arm64)
		expected_sha256="a9c54498731b3128f79e090be6110f3e5fffccc617b08142ed244d4126c73f29"
		;;
	linux/amd64)
		expected_sha256="8df580d2670fed8fa984aac0507099af8df275e665215f5c7a2ae3943893a553"
		;;
	linux/arm64)
		expected_sha256="44cd40a8c76c86755375adfeea52cfd3533cb43d7bd647771e0ae065e166df3a"
		;;
	*)
		printf 'golangci-lint provisioning does not support GOOS/GOARCH=%s/%s\n' \
			"$tool_os" "$tool_arch" >&2
		return 1
		;;
	esac

	tool_name="golangci-lint-$golangci_lint_required_version-$tool_os-$tool_arch"
	tool_dir="$ci_cache_dir/tools/golangci-lint/$golangci_lint_required_version"
	golangci_lint_binary="$tool_dir/$tool_name/golangci-lint"
	mkdir -p "$tool_dir" || return 1
	archive_name="$tool_name.tar.gz"
	archive_path="$tool_dir/$archive_name"
	release_url="https://github.com/golangci/golangci-lint/releases/download/v$golangci_lint_required_version"

	if [ ! -f "$archive_path" ]; then
		download_ci_file "$release_url/$archive_name" "$archive_path" || return 1
	fi
	actual_sha256="$(file_sha256 "$archive_path")" || return 1
	if [ "$actual_sha256" != "$expected_sha256" ]; then
		printf 'Checksum verification failed for %s\n' "$archive_name" >&2
		return 1
	fi

	extract_dir="$(mktemp -d "$tmp_dir/golangci-lint-install.XXXXXX")" || return 1
	if ! tar -xzf "$archive_path" -C "$extract_dir"; then
		rm -rf "$extract_dir"
		return 1
	fi
	if [ ! -x "$extract_dir/$tool_name/golangci-lint" ]; then
		printf 'Downloaded golangci-lint archive has an unexpected layout\n' >&2
		rm -rf "$extract_dir"
		return 1
	fi
	mkdir -p "$tool_dir/$tool_name" || {
		rm -rf "$extract_dir"
		return 1
	}
	staged_binary="$golangci_lint_binary.tmp.$$"
	cp "$extract_dir/$tool_name/golangci-lint" "$staged_binary" || {
		rm -rf "$extract_dir"
		return 1
	}
	chmod +x "$staged_binary" || {
		rm -f "$staged_binary"
		rm -rf "$extract_dir"
		return 1
	}
	mv "$staged_binary" "$golangci_lint_binary" || {
		rm -f "$staged_binary"
		rm -rf "$extract_dir"
		return 1
	}
	rm -rf "$extract_dir"
	require_golangci_lint
}

provision_govulncheck() {
	tool_dir="$ci_cache_dir/tools/govulncheck/${govulncheck_version#v}"
	govulncheck_binary="$tool_dir/govulncheck"
	if [ -x "$govulncheck_binary" ]; then
		require_govulncheck
		return
	fi

	install_dir="$(mktemp -d "$tmp_dir/govulncheck-install.XXXXXX")" || return 1
	if ! GOBIN="$install_dir" \
		go install "golang.org/x/vuln/cmd/govulncheck@$govulncheck_version"; then
		rm -rf "$install_dir"
		return 1
	fi
	if [ ! -x "$install_dir/govulncheck" ]; then
		printf 'Installed govulncheck command is missing or not executable\n' >&2
		rm -rf "$install_dir"
		return 1
	fi
	mkdir -p "$tool_dir" || {
		rm -rf "$install_dir"
		return 1
	}
	staged_binary="$govulncheck_binary.tmp.$$"
	cp "$install_dir/govulncheck" "$staged_binary" || {
		rm -rf "$install_dir"
		return 1
	}
	chmod +x "$staged_binary" || {
		rm -f "$staged_binary"
		rm -rf "$install_dir"
		return 1
	}
	mv "$staged_binary" "$govulncheck_binary" || {
		rm -f "$staged_binary"
		rm -rf "$install_dir"
		return 1
	}
	rm -rf "$install_dir"
	require_govulncheck
}

report_timing() {
	timing_name="$1"
	timing_started_ms="$2"
	timing_finished_ms="$3"
	timing_elapsed_ms=$((timing_finished_ms - timing_started_ms))
	awk -v name="$timing_name" -v elapsed="$timing_elapsed_ms" \
		'BEGIN { printf "==> Timing: %s %.3fs\n", name, elapsed / 1000 }'
}

run_timed_stage() {
	timed_stage_name="$1"
	shift
	timed_stage_started_ms="$(clock_milliseconds)" || return 1
	"$@"
	timed_stage_status=$?
	timed_stage_finished_ms="$(clock_milliseconds)" || return 1
	report_timing \
		"$timed_stage_name" \
		"$timed_stage_started_ms" \
		"$timed_stage_finished_ms"
	return "$timed_stage_status"
}

cleanup() {
	status=$?
	trap - EXIT INT TERM
	cleanup_started_ms="$(clock_milliseconds)" || cleanup_started_ms=""

	for background_pid in \
		"${frontend_checks_pid:-}" \
		"${backend_checks_pid:-}" \
		"${test_install_pid:-}" \
		"${frontend_format_pid:-}" \
		"${frontend_lint_pid:-}" \
		"${frontend_css_pid:-}" \
		"${frontend_test_pid:-}" \
		"${frontend_dead_pid:-}" \
		"${frontend_type_pid:-}" \
		"${backend_vuln_pid:-}" \
		"${test_format_pid:-}" \
		"${test_type_pid:-}" \
		"${test_scenario_pid:-}" \
		"${production_builds_pid:-}"; do
		if [ "$background_pid" != "" ] && kill -0 "$background_pid" >/dev/null 2>&1; then
			kill "$background_pid" >/dev/null 2>&1 || true
			wait "$background_pid" >/dev/null 2>&1 || true
		fi
	done

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

	cleanup_finished_ms="$(clock_milliseconds)" || cleanup_finished_ms=""
	if [ "$cleanup_started_ms" != "" ] && [ "$cleanup_finished_ms" != "" ]; then
		report_timing "cleanup" "$cleanup_started_ms" "$cleanup_finished_ms"
	fi

	if [ "${enforce_e2e_budget:-0}" = "1" ]; then
		whole_finished_ms="$(clock_milliseconds)" || whole_finished_ms=""
		if [ "$whole_finished_ms" = "" ]; then
			printf 'Could not read the final clock for the E2E runtime gate\n' >&2
			status=1
		else
			whole_elapsed_ms=$((whole_finished_ms - ci_invocation_started_ms))
			awk -v elapsed="$whole_elapsed_ms" \
				'BEGIN { printf "==> Timing: whole ./ci.sh e2e %.3fs (required: <60.000s)\n", elapsed / 1000 }'
			if [ "$status" -eq 0 ] && [ "$whole_elapsed_ms" -ge 60000 ]; then
				printf 'E2E runtime budget exceeded: %dms is not under 60000ms\n' \
					"$whole_elapsed_ms" >&2
				status=1
			fi
		fi
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
	worktree_preparation_started_ms="$(clock_milliseconds)" || return 1

	base_commit="$(git rev-parse --verify HEAD)" || return 1
	tmp_index="$tmp_dir/snapshot.index"
	ci_worktree_path="$tmp_dir/worktree"

	section "CI: preparing isolated worktree"
	GIT_INDEX_FILE="$tmp_index" git read-tree "$base_commit" || return 1
	GIT_INDEX_FILE="$tmp_index" git add -A -- . || return 1
	tree="$(GIT_INDEX_FILE="$tmp_index" git write-tree)" || return 1
	snapshot_commit="$(
		printf 'Wrought CI snapshot\n' |
			GIT_AUTHOR_NAME='WROUGHT CI' \
			GIT_AUTHOR_EMAIL='ci@wrought.invalid' \
			GIT_COMMITTER_NAME='WROUGHT CI' \
			GIT_COMMITTER_EMAIL='ci@wrought.invalid' \
			git commit-tree "$tree" -p "$base_commit"
	)" || return 1

	git worktree add --detach "$ci_worktree_path" "$snapshot_commit" || return 1
	worktree_preparation_finished_ms="$(clock_milliseconds)" || return 1
	report_timing \
		"isolated-worktree preparation" \
		"$worktree_preparation_started_ms" \
		"$worktree_preparation_finished_ms"

	if [ "${WROUGHT_CI_CACHE_DIR:-}" = "" ]; then
		shared_cache_dir="$(pwd -P)/.wrought/cache/ci"
	else
		case "$WROUGHT_CI_CACHE_DIR" in
		/*)
			shared_cache_dir="$WROUGHT_CI_CACHE_DIR"
			;;
		*)
			shared_cache_dir="$(pwd -P)/$WROUGHT_CI_CACHE_DIR"
			;;
		esac
	fi
	mkdir -p "$shared_cache_dir" || return 1

	section "CI: running checks in isolated worktree"
	worktree_checks_started_ms="$(clock_milliseconds)" || return 1
	WROUGHT_CI_CACHE_DIR="$shared_cache_dir" \
		WROUGHT_CI_STARTED_MS="$ci_invocation_started_ms" \
		WROUGHT_CI_IN_WORKTREE=1 \
		"$ci_worktree_path/ci.sh" "$@"
	worktree_checks_status=$?
	worktree_checks_finished_ms="$(clock_milliseconds)" || return 1
	report_timing \
		"isolated-worktree checks" \
		"$worktree_checks_started_ms" \
		"$worktree_checks_finished_ms"
	return "$worktree_checks_status"
}

configure_ci_caches() {
	ci_cache_dir="${WROUGHT_CI_CACHE_DIR:-$tmp_dir/cache}"
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
		"$ci_cache_dir/xdg" \
		"$tmp_dir/golangci-lint" || return 1

	export TMPDIR="$ci_cache_dir/tmp"
	export XDG_CACHE_HOME="$ci_cache_dir/xdg"
	export GOCACHE="$ci_cache_dir/go-build"
	export GOMODCACHE="$ci_cache_dir/go-mod"
	export GOTMPDIR="$ci_cache_dir/go-tmp"
	export GOLANGCI_LINT_CACHE="$tmp_dir/golangci-lint"
	export NODE_COMPILE_CACHE="$ci_cache_dir/node-compile"
	export PLAYWRIGHT_BROWSERS_PATH="$playwright_browsers_path"
	export WROUGHT_BUN_CACHE_DIR="$ci_cache_dir/bun"
	export BUN_INSTALL_CACHE_DIR="$ci_cache_dir/bun"
}

bun_ci() {
	bun install --frozen-lockfile --cache-dir "$WROUGHT_BUN_CACHE_DIR"
}

run_frontend() {
	run_frontend_checks || return 1
	run_frontend_build || return 1
}

run_frontend_checks() {
	require_command bun || return 1

	section "Frontend: installing locked dependencies"
	(cd web/frontend && bun_ci) || return 1

	frontend_format_log="$tmp_dir/frontend-format.log"
	frontend_lint_log="$tmp_dir/frontend-lint.log"
	frontend_css_log="$tmp_dir/frontend-css.log"
	frontend_test_log="$tmp_dir/frontend-test.log"
	frontend_dead_log="$tmp_dir/frontend-dead.log"
	frontend_type_log="$tmp_dir/frontend-type.log"

	(
		section "Frontend: checking formatting"
		cd web/frontend && bun run format:check
	) >"$frontend_format_log" 2>&1 &
	frontend_format_pid=$!
	(
		section "Frontend: linting TypeScript and React"
		cd web/frontend && bun run lint
	) >"$frontend_lint_log" 2>&1 &
	frontend_lint_pid=$!
	(
		section "Frontend: linting CSS"
		cd web/frontend && bun run lint:css
	) >"$frontend_css_log" 2>&1 &
	frontend_css_pid=$!
	(
		section "Frontend: running unit tests"
		cd web/frontend && bun run test
	) >"$frontend_test_log" 2>&1 &
	frontend_test_pid=$!
	(
		section "Frontend: checking unused code"
		cd web/frontend && bun run check:dead
	) >"$frontend_dead_log" 2>&1 &
	frontend_dead_pid=$!
	(
		section "Frontend: type checking"
		cd web/frontend && bun run check
	) >"$frontend_type_log" 2>&1 &
	frontend_type_pid=$!

	wait "$frontend_format_pid"
	frontend_format_status=$?
	frontend_format_pid=""
	wait "$frontend_lint_pid"
	frontend_lint_status=$?
	frontend_lint_pid=""
	wait "$frontend_css_pid"
	frontend_css_status=$?
	frontend_css_pid=""
	wait "$frontend_test_pid"
	frontend_test_status=$?
	frontend_test_pid=""
	wait "$frontend_dead_pid"
	frontend_dead_status=$?
	frontend_dead_pid=""
	wait "$frontend_type_pid"
	frontend_type_status=$?
	frontend_type_pid=""

	cat \
		"$frontend_format_log" \
		"$frontend_lint_log" \
		"$frontend_css_log" \
		"$frontend_test_log" \
		"$frontend_dead_log" \
		"$frontend_type_log"

	for frontend_status in \
		"$frontend_format_status" \
		"$frontend_lint_status" \
		"$frontend_css_status" \
		"$frontend_test_status" \
		"$frontend_dead_status" \
		"$frontend_type_status"; do
		if [ "$frontend_status" -ne 0 ]; then
			printf 'Parallel frontend validation failed\n' >&2
			return 1
		fi
	done

	return 0
}

run_frontend_build() {
	require_command bun || return 1

	section "Frontend: building production assets"
	(cd web/frontend && bunx vite build)
}

run_database_smoke() {
	if [ "${WROUGHT_TEST_DATABASE_URL:-}" = "" ]; then
		section "Database: skipped (WROUGHT_TEST_DATABASE_URL is unset)"
		return 0
	fi

	section "Database: applying migrations through application startup"
	smoke_log="$tmp_dir/database-smoke.log"
	WROUGHT_ADDR=127.0.0.1:0 \
		WROUGHT_DATABASE_URL="$WROUGHT_TEST_DATABASE_URL" \
		WROUGHT_LOG_LEVEL=debug \
		"$tmp_dir/wrought" >"$smoke_log" 2>&1 &
	smoke_pid=$!

	attempt=0
	while [ "$attempt" -lt 80 ]; do
		if grep -q '"msg":"Wrought listening"' "$smoke_log"; then
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
	run_backend_checks || return 1
	run_backend_build || return 1
}

run_backend_checks() {
	run_backend_core_checks || return 1
	run_backend_vulnerability_check
}

run_backend_core_checks() {
	require_go || return 1
	go_packages="$(go list ./... | grep -v '/web/frontend/node_modules/')" || return 1
	set --
	for go_package in $go_packages; do
		go_package_dir="$(go list -f '{{.Dir}}' "$go_package")" || return 1
		set -- "$@" "$go_package_dir"
	done

	section "Backend: checking Go formatting"
	find . \
		\( -path './.git' -o -path './web/frontend/node_modules' \) -prune -o \
		-type f -name '*.go' -print |
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

	section "Backend: running golangci-lint $golangci_lint_required_version"
	provision_golangci_lint || return 1
	"$golangci_lint_binary" config verify || return 1
	"$golangci_lint_binary" run "$@" || return 1

	section "Backend: running tests"
	mkdir -p test/artifacts || return 1
	go_test_results="test/artifacts/go-test-results.jsonl"
	if ! go test -json $go_packages >"$go_test_results"; then
		cat "$go_test_results" >&2
		return 1
	fi

	section "Developer tooling: checking shell syntax"
	sh -n ci.sh deploy.sh run.sh reset-db.sh || return 1

	return 0
}

run_backend_vulnerability_check() {
	require_go || return 1
	go_packages="$(go list ./... | grep -v '/web/frontend/node_modules/')" || return 1

	section "Backend: checking reachable vulnerabilities with govulncheck $govulncheck_version"
	provision_govulncheck || return 1
	"$govulncheck_binary" -test $go_packages
}

run_backend_build() {
	require_go || return 1

	section "Backend: building Wrought binary"
	go build -trimpath -o "$tmp_dir/wrought" ./cmd/wrought || return 1

	run_database_smoke || return 1
}

run_parallel_validation() {
	frontend_checks_log="$tmp_dir/frontend-checks.log"
	backend_checks_log="$tmp_dir/backend-checks.log"
	backend_vuln_log="$tmp_dir/backend-vuln.log"
	test_install_log="$tmp_dir/test-install.log"
	parallel_checks_started_ms="$(clock_milliseconds)" || return 1

	(
		run_timed_stage "frontend validation" run_frontend_checks
	) >"$frontend_checks_log" 2>&1 &
	frontend_checks_pid=$!
	(
		run_timed_stage "backend validation" run_backend_core_checks
	) >"$backend_checks_log" 2>&1 &
	backend_checks_pid=$!
	(
		run_timed_stage "backend vulnerability validation" run_backend_vulnerability_check
	) >"$backend_vuln_log" 2>&1 &
	backend_vuln_pid=$!
	(
		run_timed_stage "E2E dependency install" run_test_install
	) >"$test_install_log" 2>&1 &
	test_install_pid=$!

	wait "$frontend_checks_pid"
	frontend_checks_status=$?
	frontend_checks_pid=""
	wait "$backend_checks_pid"
	backend_checks_status=$?
	backend_checks_pid=""
	wait "$backend_vuln_pid"
	backend_vuln_status=$?
	backend_vuln_pid=""
	wait "$test_install_pid"
	test_install_status=$?
	test_install_pid=""

	section "Frontend validation log"
	cat "$frontend_checks_log"
	section "Backend validation log"
	cat "$backend_checks_log"
	section "Backend vulnerability validation log"
	cat "$backend_vuln_log"
	section "E2E dependency install log"
	cat "$test_install_log"

	parallel_checks_finished_ms="$(clock_milliseconds)" || return 1
	report_timing \
		"parallel frontend/backend validation" \
		"$parallel_checks_started_ms" \
		"$parallel_checks_finished_ms"

	if [ "$frontend_checks_status" -ne 0 ] || \
		[ "$backend_checks_status" -ne 0 ] || \
		[ "$backend_vuln_status" -ne 0 ] || \
		[ "$test_install_status" -ne 0 ]; then
		printf 'Parallel validation failed: frontend=%d backend=%d vuln=%d e2e-install=%d\n' \
			"$frontend_checks_status" "$backend_checks_status" \
			"$backend_vuln_status" \
			"$test_install_status" >&2
		return 1
	fi
}

run_production_builds() {
	run_frontend_build || return 1
	run_backend_build || return 1
}

run_test_install() {
	(cd test && bun_ci)
}

run_test_format_check() {
	(cd test && bun run format:check)
}

run_test_type_check() {
	(cd test && bun run check)
}

run_test_scenario_checks() {
	(
		cd test || exit 1
		mkdir -p artifacts || exit 1
		bun test src/deployment src/scenario/architecture-tests \
			--reporter=junit \
			--reporter-outfile artifacts/scenario-architecture-results.xml || exit 1
		bun run verify:scenarios
	)
}

run_parallel_test_validation() {
	test_format_log="$tmp_dir/test-format.log"
	test_type_log="$tmp_dir/test-type.log"
	test_scenario_log="$tmp_dir/test-scenario.log"
	(
		run_timed_stage "E2E formatting" run_test_format_check
	) >"$test_format_log" 2>&1 &
	test_format_pid=$!
	(
		run_timed_stage "E2E type checking" run_test_type_check
	) >"$test_type_log" 2>&1 &
	test_type_pid=$!
	(
		run_timed_stage "E2E scenario architecture" run_test_scenario_checks
	) >"$test_scenario_log" 2>&1 &
	test_scenario_pid=$!

	wait "$test_format_pid"
	test_format_status=$?
	test_format_pid=""
	wait "$test_type_pid"
	test_type_status=$?
	test_type_pid=""
	wait "$test_scenario_pid"
	test_scenario_status=$?
	test_scenario_pid=""

	section "E2E formatting log"
	cat "$test_format_log"
	section "E2E type-check log"
	cat "$test_type_log"
	section "E2E scenario-runtime log"
	cat "$test_scenario_log"

	if [ "$test_format_status" -ne 0 ] || \
		[ "$test_type_status" -ne 0 ] || \
		[ "$test_scenario_status" -ne 0 ]; then
		printf 'Parallel E2E validation failed: format=%d type=%d scenario=%d\n' \
			"$test_format_status" "$test_type_status" \
			"$test_scenario_status" >&2
		return 1
	fi
}

run_parallel_build_and_test_validation() {
	production_builds_log="$tmp_dir/production-builds.log"
	(
		run_timed_stage "production artifact builds" run_production_builds
	) >"$production_builds_log" 2>&1 &
	production_builds_pid=$!

	run_parallel_test_validation
	test_validation_status=$?
	wait "$production_builds_pid"
	production_builds_status=$?
	production_builds_pid=""

	section "Production artifact build log"
	cat "$production_builds_log"

	if [ "$test_validation_status" -ne 0 ] || \
		[ "$production_builds_status" -ne 0 ]; then
		printf 'Parallel build/E2E validation failed: validation=%d builds=%d\n' \
			"$test_validation_status" "$production_builds_status" >&2
		return 1
	fi
}

run_browser_scenarios() {
	if [ ! -x "$tmp_dir/wrought" ]; then
		printf 'The verified E2E application binary is missing or not executable: %s\n' \
			"$tmp_dir/wrought" >&2
		return 1
	fi
	(
		cd test &&
			WROUGHT_E2E_APP_BINARY="$tmp_dir/wrought" \
			WROUGHT_E2E_DIAGNOSTICS=0 \
			WROUGHT_E2E_REQUIRE_COMPLETE_COVERAGE=1 \
			bun run e2e
	)
}

run_e2e() {
	if [ ! -f test/package.json ]; then
		section "E2E: skipped (test/package.json is not present yet)"
		return 0
	fi

	require_command bun || return 1
	require_go || return 1

	section "E2E: running browser scenarios"
	run_timed_stage "E2E browser scenarios" run_browser_scenarios || return 1
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/wrought-ci.XXXXXX")" || exit 1
ci_worktree_path=""
smoke_pid=""
frontend_checks_pid=""
backend_checks_pid=""
backend_vuln_pid=""
test_install_pid=""
frontend_format_pid=""
frontend_lint_pid=""
frontend_css_pid=""
frontend_test_pid=""
frontend_dead_pid=""
frontend_type_pid=""
test_format_pid=""
test_type_pid=""
test_scenario_pid=""
production_builds_pid=""
enforce_e2e_budget=0
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

if [ "$target" = "e2e" ] && [ "${WROUGHT_CI_IN_WORKTREE:-}" != "1" ]; then
	enforce_e2e_budget=1
fi

if [ "${WROUGHT_CI_IN_WORKTREE:-}" != "1" ]; then
	run_in_isolated_worktree "$@"
	exit $?
fi

configure_ci_caches || exit 1

case "$target" in
all)
	run_parallel_validation || exit 1
	run_parallel_build_and_test_validation || exit 1
	run_e2e || exit 1
	;;
frontend)
	run_frontend || exit 1
	;;
backend)
	run_backend || exit 1
	;;
e2e)
	run_parallel_validation || exit 1
	run_parallel_build_and_test_validation || exit 1
	run_e2e || exit 1
	;;
esac

section "CI checks passed"
