package migrations

import (
	"regexp"
	"strings"
	"testing"
)

func TestMigrationHistoryMatches(t *testing.T) {
	t.Parallel()

	available := []string{
		"001_world_baseline.sql",
		"002_mechanic_graph_status_instances.sql",
		"003_interaction_audience_invalidations.sql",
		"004_password_auth.sql",
	}
	tests := []struct {
		name    string
		applied []string
		want    bool
	}{
		{name: "empty history", want: true},
		{name: "prefix", applied: []string{"001_world_baseline.sql"}, want: true},
		{name: "two-version prefix", applied: available[:2], want: true},
		{name: "complete", applied: available, want: true},
		{name: "missing predecessor", applied: []string{"002_mechanic_graph_status_instances.sql"}, want: false},
		{name: "unknown version", applied: []string{"001_removed.sql"}, want: false},
		{name: "extra version", applied: []string{"001_world_baseline.sql", "002_next.sql", "003_unknown.sql"}, want: false},
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

func TestTerraMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("005_terra.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"add column facilitator_source text not null default 'human'",
		"worlds_facilitator_source_valid",
		"facilitator_source in ('human', 'terra')",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing Terra contract fragment %q", fragment)
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
		"facilitator_source = 'human' and facilitator_membership_id is not null",
		"facilitator_source = 'terra' and facilitator_membership_id is null",
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

func TestAgentFacilitatorMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("007_agent_facilitator.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"worlds_facilitator_source_valid",
		"facilitator_source in ('human', 'terra', 'agent')",
		"facilitator_source in ('terra', 'agent') and facilitator_membership_id is null",
		"facilitator_source in ('terra', 'agent') and created_by_membership_id is null",
		"facilitator_source in ('terra', 'agent') and resolved_by_membership_id is null",
		"actor_source in ('human', 'terra', 'agent')",
		"actor_source in ('terra', 'agent') and actor_membership_id is null",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing agent facilitator contract fragment %q", fragment)
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
		"action_id is null",
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

	contents, err := files.ReadFile("001_world_baseline.sql")
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

func TestCoreVocabularyMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("001_world_baseline.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	for _, fragment := range []string{
		"roster_revision bigint not null default 0",
		"create table entity_logical_states (",
		"entity_logical_states_revision_nonnegative",
		"create table entity_input_value_overrides (",
		"entity_input_value_overrides_logical_state_fk",
		"references entity_logical_states (entity_id, world_id)",
		"visibility text not null default 'world'",
		"visibility in ('world', 'restricted')",
		"create table entity_profile_values (",
		"entity_profile_values_character_field_fk",
		"create table interaction_actions (",
		"interaction_actions_one_selected_unique",
		"selected_action_id uuid",
		"interaction_resolutions_selected_action_fk",
		"references interaction_actions (id, interaction_id, world_id)",
		"status text not null default 'building'",
		"interaction_resolutions_status_valid check (status in ('building', 'committed'))",
		"interaction_resolutions_committed_shape",
		"resolved_at timestamptz",
		"action_id uuid",
		"'action-submitted', 'action-withdrawn', 'resolution-committed'",
		"world_events_action_fk",
		"create function protect_committed_resolution_tree()",
		"interaction_resolutions_protect_committed",
		"create table interaction_resolution_scalar_applications (",
		"interaction_resolution_scalar_applications_effect_fk",
		"interaction_resolution_scalar_applications_protect_committed",
	} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing canonical core contract fragment %q", fragment)
		}
	}
}

func TestLogicalStatePersistenceVocabularyIsCanonical(t *testing.T) {
	t.Parallel()

	entries, err := files.ReadDir(".")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		contents, err := files.ReadFile(entry.Name())
		if err != nil {
			t.Fatalf("read migration %s: %v", entry.Name(), err)
		}
		for _, forbiddenFragment := range []string{
			"state_" + "records",
			"state_" + "values",
			"entity_profile_" + "field_values",
		} {
			if strings.Contains(string(contents), forbiddenFragment) {
				t.Errorf("migration %s contains forbidden persistence name %q", entry.Name(), forbiddenFragment)
			}
		}
	}
}

func TestMechanicGraphStatusInstancesMigrationContract(t *testing.T) {
	t.Parallel()

	contents, err := files.ReadFile("002_mechanic_graph_status_instances.sql")
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(contents)
	required := []string{
		"create table world_mechanic_graphs",
		"insert into world_mechanic_graphs (world_id)",
		"create trigger worlds_create_mechanic_graph after insert on worlds",
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
		"create table interaction_resolution_inline_status_modifiers",
		"interaction_resolution_inline_status_modifiers_effect_fk",
		"interaction_resolution_inline_status_modifiers_protect_committed",
		"add column rules_revision bigint",
		"'apply-status', 'remove-status'",
		"create table interaction_resolution_status_applications",
		"create table interaction_resolution_effective_changes",
		"'character-fields-updated', 'rules-updated'",
		"interaction_resolution_status_applications_protect_committed",
		"interaction_resolution_effective_changes_protect_committed",
	}
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Errorf("migration is missing contract fragment %q", fragment)
		}
	}

	lower := strings.ToLower(sql)
	if strings.Contains(lower, " json ") || strings.Contains(lower, " jsonb ") {
		t.Error("mechanic graph and status persistence must remain normalized, not canonical JSON")
	}
	if strings.Contains(lower, "world_status_definitions") || strings.Contains(lower, "world_status_definition_modifiers") {
		t.Error("statuses must be consequence-owned snapshots, not a world-scoped definition catalog")
	}
}
