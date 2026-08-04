package migrations

import "testing"

func TestMigrationHistoryMatches(t *testing.T) {
	t.Parallel()

	available := []string{"001_worldwright.sql", "002_next.sql"}
	tests := []struct {
		name    string
		applied []string
		want    bool
	}{
		{name: "empty history", want: true},
		{name: "prefix", applied: []string{"001_worldwright.sql"}, want: true},
		{name: "complete", applied: available, want: true},
		{name: "missing predecessor", applied: []string{"002_next.sql"}, want: false},
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
