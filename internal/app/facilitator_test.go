package app

import "testing"

func TestCurrentPlayRole(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		role        string
		facilitator bool
		want        string
	}{
		{name: "designated owner", role: "owner", facilitator: true, want: "facilitator"},
		{name: "designated player", role: "player", facilitator: true, want: "facilitator"},
		{name: "owner can play", role: "owner", want: "player"},
		{name: "editor can play", role: "editor", want: "player"},
		{name: "player", role: "player", want: "player"},
		{name: "spectator", role: "spectator", want: "spectator"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := currentPlayRole(test.role, test.facilitator); got != test.want {
				t.Fatalf("currentPlayRole(%q, %t) = %q, want %q", test.role, test.facilitator, got, test.want)
			}
		})
	}
}
