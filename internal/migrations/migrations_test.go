package migrations

import (
	"strings"
	"testing"
)

func TestMigrationHistoryMatches(t *testing.T) {
	t.Parallel()

	available := []string{"001_worldwright.sql", "002_rules_graph_statuses.sql"}
	tests := []struct {
		name    string
		applied []string
		want    bool
	}{
		{name: "empty history", want: true},
		{name: "prefix", applied: []string{"001_worldwright.sql"}, want: true},
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
