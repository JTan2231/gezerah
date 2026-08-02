#!/bin/sh
set -eu

repo_root="$(CDPATH= cd "$(dirname "$0")" && pwd)"
database_url="${DND_DATABASE_URL:-${DATABASE_URL:-postgres://localhost:5432/dnd?sslmode=disable}}"
assume_yes=0

usage() {
	cat <<'EOF'
Usage: ./reset-db.sh [--yes]

Deletes all application data from the configured local development database.
The database schema and migration history are preserved. Without --yes, the
database name must be typed to confirm the reset.
EOF
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf '%s is required but was not found in PATH\n' "$1" >&2
		exit 1
	fi
}

psql_scalar() {
	psql \
		-X \
		--quiet \
		--no-align \
		--tuples-only \
		--set=ON_ERROR_STOP=1 \
		--dbname="$database_url" \
		--command="$1"
}

case "$#" in
0)
	;;
1)
	case "$1" in
	-y | --yes)
		assume_yes=1
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		printf 'unknown option: %s\n\n' "$1" >&2
		usage >&2
		exit 2
		;;
	esac
	;;
*)
	usage >&2
	exit 2
	;;
esac

require_command psql
require_command curl

database_name="$(psql_scalar 'select current_database()')"
server_address="$(psql_scalar "select coalesce(inet_server_addr()::text, '')")"
is_local_server="$(psql_scalar "select inet_server_addr() is null or inet_server_addr() <<= inet '127.0.0.0/8' or inet_server_addr() <<= inet '::1/128'")"

if [ "$is_local_server" != "t" ]; then
	printf 'Refusing to reset database "%s": PostgreSQL server %s is not local.\n' \
		"$database_name" "$server_address" >&2
	exit 1
fi

case "$database_name" in
'' | postgres | template0 | template1)
	printf 'Refusing to reset PostgreSQL system database "%s".\n' "$database_name" >&2
	exit 1
	;;
esac

public_table_count="$(psql_scalar "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$public_table_count" = "0" ]; then
	printf 'Local database "%s" is already empty.\n' "$database_name"
	exit 0
fi

is_dnd_database="$(psql_scalar "select to_regclass('public.schema_migrations') is not null and to_regclass('public.rule_sets') is not null")"
if [ "$is_dnd_database" != "t" ]; then
	printf 'Refusing to reset database "%s": it does not look like a migrated Worldwright database.\n' \
		"$database_name" >&2
	exit 1
fi

printf 'Target: local PostgreSQL database "%s" (%s)\n' \
	"$database_name" "${server_address:-local socket}"
printf 'This permanently deletes all application data while preserving migrations.\n'

if [ "$assume_yes" -ne 1 ]; then
	printf 'Type the database name to continue: '
	if ! IFS= read -r confirmation; then
		printf '\nReset cancelled.\n' >&2
		exit 1
	fi
	if [ "$confirmation" != "$database_name" ]; then
		printf 'Reset cancelled.\n'
		exit 1
	fi
fi

state_dir="${DND_RUN_STATE_DIR:-$repo_root/.dnd/run}"
backend_was_running=0
backend_stopped=0
backend_pid=""
if [ -f "$state_dir/backend.pid" ]; then
	backend_pid="$(sed -n '1p' "$state_dir/backend.pid")"
	case "$backend_pid" in
	'' | *[!0-9]*)
		backend_pid=""
		;;
	esac
	if [ "$backend_pid" != "" ] && kill -0 "$backend_pid" >/dev/null 2>&1; then
		backend_was_running=1
	fi
fi

restore_backend() {
	status=$?
	trap - EXIT HUP INT TERM
	if [ "$backend_stopped" -eq 1 ] && [ "$backend_was_running" -eq 1 ]; then
		backend_stopped=0
		if ! "$repo_root/run.sh" start backend; then
			printf 'The managed backend could not be restarted.\n' >&2
			status=1
		fi
	fi
	exit "$status"
}

handle_signal() {
	exit 130
}

trap restore_backend EXIT
trap handle_signal HUP INT TERM

"$repo_root/run.sh" stop backend
backend_stopped=1

if curl -fsS --max-time 1 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
	printf 'Refusing to reset while an unmanaged backend is reachable on port 8080; stop it and retry.\n' >&2
	exit 1
fi

psql \
	-X \
	--set=ON_ERROR_STOP=1 \
	--dbname="$database_url" <<'SQL'
begin;
set local lock_timeout = '5s';

do $reset$
declare
	table_list text;
begin
	select string_agg(
		format('%I.%I', schemaname, tablename),
		', ' order by schemaname, tablename
	)
	into table_list
	from pg_tables
	where schemaname = 'public'
	  and tablename <> 'schema_migrations';

	if table_list is not null then
		execute 'truncate table ' || table_list || ' restart identity';
	end if;
end
$reset$;

commit;
SQL

printf 'Local database "%s" was reset; schema and migration history were preserved.\n' \
	"$database_name"
