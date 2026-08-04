package migrations

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const migrationAdvisoryLockID int64 = 3016533762926936644

//go:embed *.sql
var files embed.FS

func Run(ctx context.Context, db *pgxpool.Pool) error {
	conn, err := db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `select pg_advisory_lock($1)`, migrationAdvisoryLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	defer func() {
		unlockCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = conn.Exec(unlockCtx, `select pg_advisory_unlock($1)`, migrationAdvisoryLockID)
	}()

	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	var ledgerExists bool
	if err := conn.QueryRow(ctx, `select to_regclass('public.schema_migrations') is not null`).Scan(&ledgerExists); err != nil {
		return fmt.Errorf("check migration ledger: %w", err)
	}
	if !ledgerExists {
		var readyForBaseline bool
		if err := conn.QueryRow(ctx, `
			select not exists (
				select 1
				from pg_depend namespace_dependency
				where namespace_dependency.refclassid = 'pg_namespace'::regclass
					and namespace_dependency.refobjid = 'public'::regnamespace
					and not (
						namespace_dependency.classid = 'pg_extension'::regclass
						and exists (
							select 1
							from pg_extension extension
							where extension.oid = namespace_dependency.objid
								and extension.extname = 'pgcrypto'
						)
					)
					and not exists (
						select 1
						from pg_depend extension_dependency
						join pg_extension extension
							on extension.oid = extension_dependency.refobjid
						where extension_dependency.classid = namespace_dependency.classid
							and extension_dependency.objid = namespace_dependency.objid
							and extension_dependency.deptype = 'e'
							and extension.extname = 'pgcrypto'
					)
			)
		`).Scan(&readyForBaseline); err != nil {
			return fmt.Errorf("inspect database before baseline: %w", err)
		}
		if !readyForBaseline {
			return fmt.Errorf("database is not empty and has no current migration ledger; use a fresh empty database")
		}

		if _, err := conn.Exec(ctx, `
			create table public.schema_migrations (
				version text primary key,
				applied_at timestamptz not null default now()
			)
		`); err != nil {
			return fmt.Errorf("create schema_migrations: %w", err)
		}
	}

	rows, err := conn.Query(ctx, `select version from public.schema_migrations order by version`)
	if err != nil {
		return fmt.Errorf("read migration history: %w", err)
	}
	applied := make([]string, 0, len(names))
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			rows.Close()
			return fmt.Errorf("read migration version: %w", err)
		}
		applied = append(applied, version)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("read migration history: %w", err)
	}
	rows.Close()
	if !migrationHistoryMatches(names, applied) {
		return fmt.Errorf("database schema does not match this build; use a fresh empty database (local development: run ./reset-db.sh)")
	}

	for _, name := range names[len(applied):] {
		sql, err := files.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}

		if _, err := tx.Exec(ctx, `set local search_path = public, pg_catalog`); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("set migration search path for %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `insert into public.schema_migrations (version) values ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}

	return nil
}

func migrationHistoryMatches(available, applied []string) bool {
	if len(applied) > len(available) {
		return false
	}
	for index, version := range applied {
		if available[index] != version {
			return false
		}
	}
	return true
}
