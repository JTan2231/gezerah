package migrations

import (
	"regexp"
	"strings"
	"testing"
)

func TestMigrationHistoryMatches(t *testing.T) {
	t.Parallel()

	available := []string{
		"001_worldwright.sql",
		"002_rules_graph_statuses.sql",
		"003_interaction_audience_invalidations.sql",
		"004_password_auth.sql",
	}
	tests := []struct {
		name    string
		applied []string
		want    bool
	}{
		{name: "empty history", want: true},
		{name: "prefix", applied: []string{"001_worldwright.sql"}, want: true},
		{name: "two-version prefix", applied: available[:2], want: true},
		{name: "complete", applied: available, want: true},
		{name: "missing predecessor", applied: []string{"002_rules_graph_statuses.sql"}, want: false},
		{name: "unknown version", applied: []string{"001_removed.sql"}, want: false},
		{name: "extra version", applied: []string{"001_worldwright.sql", "002_next.sql", "003_unknown.sql"}, want: false},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := migrationHistoryMatches(available, test.applied); got != test.want {
				t.Fatalf("migrationHistoryMatches(%v, %v) = %t, want %t", available, test.applied, got, test.want)
			}
		})
	}
}

func TestPasswordAuthenticationMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("004_password_auth.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"if exists (select 1 from users)",
		"add column username text not null",
		"add column normalized_username text not null",
		"add column password_hash text not null",
		"users_normalized_username_unique",
		"users_password_hash_argon2id",
		"users_status_valid",
		"create table auth_sessions",
		"token_hash text not null unique",
		"idle_expires_at timestamptz not null",
		"absolute_expires_at timestamptz not null",
		"revoked_at timestamptz",
		"auth_sessions_token_hash_shape",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing authentication contract fragment %q", fragment)
		}
	}

	start := strings.Index(sql, "create table auth_sessions (")
	if start < 0 {
		t.Fatal("migration has no auth_sessions table")
	}
	end := strings.Index(sql[start:], "\n);")
	if end < 0 {
		t.Fatal("auth_sessions table has no closing delimiter")
	}
	table := sql[start : start+end]
	for _, rawColumn := range []*regexp.Regexp{
		regexp.MustCompile(`(?m)^\s*token\s+`),
		regexp.MustCompile(`(?m)^\s*session_token\s+`),
		regexp.MustCompile(`(?m)^\s*raw_token\s+`),
		regexp.MustCompile(`(?m)^\s*csrf_token\s+`),
	} {
		if rawColumn.MatchString(table) {
			t.Errorf("auth_sessions persists a raw secret column matching %s", rawColumn)
		}
	}
}

func TestAutoDMMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("005_auto_dm.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"add column dm_source text not null default 'human'",
		"worlds_dm_source_valid",
		"dm_source in ('human', 'terra')",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing Auto DM contract fragment %q", fragment)
		}
	}
}

func TestFacilitatorAssignmentMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("006_facilitator_assignment.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"add column facilitator_membership_id uuid",
		"worlds_facilitator_assignment_shape",
		"dm_source = 'human' and facilitator_membership_id is not null",
		"dm_source = 'terra' and facilitator_membership_id is null",
		"worlds_facilitator_membership_fk",
		"deferrable initially deferred",
		"add column facilitator_source text not null default 'human'",
		"interactions_facilitator_actor_shape",
		"interaction_resolutions_created_actor_shape",
		"add column actor_source text not null default 'human'",
		"world_events_actor_shape",
		"'facilitator-changed'",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing facilitator assignment contract fragment %q", fragment)
		}
	}
}

func TestInteractionAudienceInvalidationMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("003_interaction_audience_invalidations.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"add column invalidates_interaction_audience boolean not null default false",
		"world_events_audience_invalidation_shape",
		"not invalidates_interaction_audience",
		"interaction_id is not null",
		"submission_id is null",
		"resolution_id is null",
		"event_type in ('interaction-adjudicating', 'interaction-cancelled')",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing contract fragment %q", fragment)
		}
	}
}

func TestWorldInvitePersistenceStoresOnlyTokenDigests(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("001_worldwright.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	start := strings.Index(sql, "create table world_invites (")
	if start < 0 {
		t.Fatal("migration has no world_invites table")
	}
	end := strings.Index(sql[start:], "\n);")
	if end < 0 {
		t.Fatal("world_invites table has no closing delimiter")
	}
	table := sql[start : start+end]
	if !strings.Contains(table, "token_hash text not null unique") {
		t.Error("world_invites must persist a unique token digest")
	}
	for _, rawColumn := range []*regexp.Regexp{
		regexp.MustCompile(`(?m)^\s*token\s+`),
		regexp.MustCompile(`(?m)^\s*invite_token\s+`),
		regexp.MustCompile(`(?m)^\s*raw_token\s+`),
	} {
		if rawColumn.MatchString(table) {
			t.Errorf("world_invites persists a raw bearer column matching %s", rawColumn)
		}
	}
}

func TestRulesGraphStatusesMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("002_rules_graph_statuses.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	required := []string{
		"create table world_rule_sets",
		"insert into world_rule_sets (world_id)",
		"create trigger worlds_create_rule_set after insert on worlds",
		"add column source_kind text not null default 'input'",
		"create table world_mechanic_expression_nodes",
		"'mechanic-reference'",
		"create table entity_status_sets",
		"insert into entity_status_sets (entity_id, world_id)",
		"create trigger entities_create_status_set after insert on entities",
		"create table entity_status_instances",
		"source_resolution_id uuid not null",
		"source_effect_id uuid not null",
		"status_name text not null",
		"applied_order bigint generated always as identity",
		"create table entity_status_instance_modifiers",
		"create table interaction_resolution_status_effect_modifiers",
		"interaction_resolution_status_effect_modifiers_effect_fk",
		"interaction_resolution_status_effect_modifiers_protect_applied",
		"add column rules_revision bigint",
		"'apply-status', 'remove-status'",
		"create table interaction_resolution_status_applications",
		"create table interaction_resolution_effective_changes",
		"'character-fields-updated', 'rules-updated'",
		"interaction_resolution_status_applications_protect_applied",
		"interaction_resolution_effective_changes_protect_applied",
	}
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing contract fragment %q", fragment)
		}
	}

	lower := strings.ToLower(sql)
	if strings.Contains(lower, " json ") || strings.Contains(lower, " jsonb ") {
		t.Error("rules graph and status persistence must remain normalized, not canonical JSON")
	}
	if strings.Contains(lower, "world_status_definitions") || strings.Contains(lower, "world_status_definition_modifiers") {
		t.Error("statuses must be consequence-owned snapshots, not a world-scoped definition catalog")
	}
}
