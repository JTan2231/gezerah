#!/bin/sh
set -eu

repo_root="$(CDPATH= cd "$(dirname "$0")" && pwd)"
state_dir="${DND_RUN_STATE_DIR:-$repo_root/.dnd/run}"
log_dir="${DND_RUN_LOG_DIR:-$repo_root/.dnd/log}"

usage() {
	cat <<'EOF'
Usage:
  ./run.sh
  ./run.sh start [all|backend|frontend]
  ./run.sh stop [all|backend|frontend]
  ./run.sh restart [all|backend|frontend]
  ./run.sh status [all|backend|frontend]
  ./run.sh logs [all|backend|frontend]
  ./run.sh tail [all|backend|frontend]

With no arguments, ./run.sh starts both services in the background and exits.
EOF
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		exit 1
	fi
}

normalize_service() {
	case "$1" in
	backend | back | api)
		printf 'backend\n'
		;;
	frontend | front | web | vite)
		printf 'frontend\n'
		;;
	*)
		return 1
		;;
	esac
}

pid_path() {
	printf '%s/%s.pid\n' "$state_dir" "$1"
}

log_path() {
	printf '%s/%s.log\n' "$log_dir" "$1"
}

read_pid() {
	service_pid_path="$(pid_path "$1")"
	if [ ! -f "$service_pid_path" ]; then
		return 1
	fi
	service_pid="$(sed -n '1p' "$service_pid_path")"
	case "$service_pid" in
	'' | *[!0-9]*)
		return 1
		;;
	esac
	printf '%s\n' "$service_pid"
}

process_alive() {
	kill -0 "$1" >/dev/null 2>&1
}

probe_service() {
	case "$1" in
	backend)
		curl -fsS --max-time 1 http://127.0.0.1:8080/api/health >/dev/null 2>&1
		;;
	frontend)
		curl -fsS --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1
		;;
	esac
}

display_url() {
	case "$1" in
	backend)
		printf 'http://localhost:8080\n'
		;;
	frontend)
		printf 'http://127.0.0.1:5173\n'
		;;
	esac
}

wait_for_start() {
	service_name="$1"
	service_pid="$2"
	attempt=0
	while [ "$attempt" -lt 240 ]; do
		if probe_service "$service_name"; then
			printf '%s ready at %s\n' "$service_name" "$(display_url "$service_name")"
			printf '%s logs: %s\n' "$service_name" "$(log_path "$service_name")"
			return 0
		fi
		if ! process_alive "$service_pid"; then
			rm -f "$(pid_path "$service_name")"
			printf '%s exited before becoming ready; see %s\n' \
				"$service_name" "$(log_path "$service_name")" >&2
			return 1
		fi
		attempt=$((attempt + 1))
		sleep 0.25
	done
	printf '%s did not become ready within 60 seconds; see %s\n' \
		"$service_name" "$(log_path "$service_name")" >&2
	return 1
}

prepare_start() {
	service_name="$1"
	service_pid="$(read_pid "$service_name" 2>/dev/null || true)"
	if [ "$service_pid" != "" ] && process_alive "$service_pid"; then
		if probe_service "$service_name"; then
			printf '%s already running at %s (pid %s)\n' \
				"$service_name" "$(display_url "$service_name")" "$service_pid"
			return 1
		fi
		printf '%s has managed pid %s but is not healthy; run ./run.sh restart %s\n' \
			"$service_name" "$service_pid" "$service_name" >&2
		exit 1
	fi
	if [ "$service_pid" != "" ]; then
		rm -f "$(pid_path "$service_name")"
		printf '%s had stale pid %s; cleaned state\n' "$service_name" "$service_pid"
	fi
	if probe_service "$service_name"; then
		printf '%s is reachable at %s without managed state; leaving it alone\n' \
			"$service_name" "$(display_url "$service_name")"
		return 1
	fi
	mkdir -p "$state_dir" "$log_dir"
	return 0
}

start_backend() {
	require_command go
	require_command curl
	if ! prepare_start backend; then
		return 0
	fi

	backend_addr="${DND_ADDR:-:8080}"
	case "$backend_addr" in
	:8080 | localhost:8080 | 127.0.0.1:8080)
		;;
	*)
		printf 'DND_ADDR=%s does not match the Vite proxy target http://localhost:8080\n' "$backend_addr" >&2
		return 1
		;;
	esac

	backend_dir="$state_dir/backend"
	backend_bin="$backend_dir/dnd"
	backend_log="$(log_path backend)"
	mkdir -p "$backend_dir"

	printf 'Building backend\n'
	(cd "$repo_root" && go build -o "$backend_bin" ./cmd/dnd)
	printf '\n==> backend start %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$backend_log"
	(
		cd "$repo_root"
		DND_ADDR="$backend_addr" nohup "$backend_bin" >>"$backend_log" 2>&1 </dev/null &
		printf '%s\n' "$!" >"$(pid_path backend)"
	)
	backend_pid="$(read_pid backend)"
	printf 'starting backend (pid %s)\n' "$backend_pid"
	wait_for_start backend "$backend_pid"
}

start_frontend() {
	require_command bun
	require_command curl
	if ! prepare_start frontend; then
		return 0
	fi

	frontend_dir="$repo_root/web/frontend"
	frontend_log="$(log_path frontend)"
	if [ ! -x "$frontend_dir/node_modules/.bin/vite" ]; then
		printf 'Installing frontend dependencies\n'
		(cd "$frontend_dir" && bun install --frozen-lockfile)
	fi

	printf '\n==> frontend start %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$frontend_log"
	(
		cd "$frontend_dir"
		nohup bun run dev --host 127.0.0.1 --port 5173 --strictPort >>"$frontend_log" 2>&1 </dev/null &
		printf '%s\n' "$!" >"$(pid_path frontend)"
	)
	frontend_pid="$(read_pid frontend)"
	printf 'starting frontend (pid %s)\n' "$frontend_pid"
	wait_for_start frontend "$frontend_pid"
}

start_service() {
	case "$1" in
	backend)
		start_backend
		;;
	frontend)
		start_frontend
		;;
	esac
}

stop_service() {
	service_name="$1"
	service_pid="$(read_pid "$service_name" 2>/dev/null || true)"
	if [ "$service_pid" = "" ]; then
		if probe_service "$service_name"; then
			printf '%s is reachable at %s without managed state; leaving it alone\n' \
				"$service_name" "$(display_url "$service_name")"
		else
			printf '%s already stopped\n' "$service_name"
		fi
		return 0
	fi
	if ! process_alive "$service_pid"; then
		rm -f "$(pid_path "$service_name")"
		printf '%s was already stopped; cleaned stale pid %s\n' "$service_name" "$service_pid"
		return 0
	fi

	printf 'stopping %s (pid %s)\n' "$service_name" "$service_pid"
	kill "$service_pid" >/dev/null 2>&1 || true
	attempt=0
	while [ "$attempt" -lt 50 ]; do
		if ! process_alive "$service_pid"; then
			rm -f "$(pid_path "$service_name")"
			printf '%s stopped\n' "$service_name"
			return 0
		fi
		attempt=$((attempt + 1))
		sleep 0.1
	done

	kill -9 "$service_pid" >/dev/null 2>&1 || true
	sleep 0.1
	if process_alive "$service_pid"; then
		printf '%s did not stop; pid %s is still alive\n' "$service_name" "$service_pid" >&2
		return 1
	fi
	rm -f "$(pid_path "$service_name")"
	printf '%s stopped after forced shutdown\n' "$service_name"
}

status_service() {
	service_name="$1"
	service_pid="$(read_pid "$service_name" 2>/dev/null || true)"
	if [ "$service_pid" = "" ]; then
		if probe_service "$service_name"; then
			printf '%-10s %-20s %s\n' "$service_name" reachable "unmanaged at $(display_url "$service_name")"
		else
			printf '%-10s %-20s %s\n' "$service_name" stopped "log $(log_path "$service_name")"
		fi
		return 0
	fi
	if ! process_alive "$service_pid"; then
		rm -f "$(pid_path "$service_name")"
		printf '%-10s %-20s %s\n' "$service_name" stopped "cleaned stale pid $service_pid"
		return 0
	fi
	if probe_service "$service_name"; then
		printf '%-10s %-20s %s\n' "$service_name" running "pid $service_pid at $(display_url "$service_name")"
	else
		printf '%-10s %-20s %s\n' "$service_name" starting/unhealthy "pid $service_pid; log $(log_path "$service_name")"
	fi
}

for_target() {
	action="$1"
	target="$2"
	case "$target" in
	all)
		if [ "$action" = "stop_service" ]; then
			stop_service frontend
			stop_service backend
		else
			"$action" backend
			"$action" frontend
		fi
		;;
	*)
		service_name="$(normalize_service "$target")" || {
			printf 'unknown service: %s\n\n' "$target" >&2
			usage >&2
			exit 2
		}
		"$action" "$service_name"
		;;
	esac
}

command_name="start"
target="all"
if [ "$#" -gt 2 ]; then
	usage >&2
	exit 2
fi
if [ "$#" -ge 1 ]; then
	command_name="$1"
fi
if [ "$#" -eq 2 ]; then
	target="$2"
fi

case "$command_name" in
start | up)
	for_target start_service "$target"
	;;
stop | down)
	for_target stop_service "$target"
	;;
restart)
	for_target stop_service "$target"
	for_target start_service "$target"
	;;
status | ps)
	require_command curl
	printf '%-10s %-20s %s\n' SERVICE STATE DETAIL
	for_target status_service "$target"
	;;
logs | log)
	case "$target" in
	all)
		printf '%-10s %s\n' backend "$(log_path backend)"
		printf '%-10s %s\n' frontend "$(log_path frontend)"
		;;
	*)
		service_name="$(normalize_service "$target")" || {
			printf 'unknown service: %s\n' "$target" >&2
			exit 2
		}
		printf '%-10s %s\n' "$service_name" "$(log_path "$service_name")"
		;;
	esac
	;;
tail | follow)
	require_command tail
	mkdir -p "$log_dir"
	case "$target" in
	all)
		: >>"$(log_path backend)"
		: >>"$(log_path frontend)"
		tail -n 80 -f "$(log_path backend)" "$(log_path frontend)"
		;;
	*)
		service_name="$(normalize_service "$target")" || {
			printf 'unknown service: %s\n' "$target" >&2
			exit 2
		}
		: >>"$(log_path "$service_name")"
		tail -n 80 -f "$(log_path "$service_name")"
		;;
	esac
	;;
help | -h | --help)
	usage
	;;
*)
	printf 'unknown command: %s\n\n' "$command_name" >&2
	usage >&2
	exit 2
	;;
esac
