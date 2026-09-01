package app

import (
	"errors"
	"net/http"
	"testing"
)

func TestCharacterFieldVisibilityUsesWorldAndRestricted(t *testing.T) {
	t.Parallel()

	revision := int64(2)
	request := replaceWorldCharacterFieldsRequest{
		ExpectedRevision: &revision,
		Fields: []saveWorldCharacterFieldRequest{
			{Label: "Public detail"},
			{Label: "Private detail", Visibility: "restricted"},
		},
	}
	if fields := validateWorldCharacterFieldsRequest(&request); len(fields) != 0 {
		t.Fatalf("canonical visibility values were rejected: %v", fields)
	}
	if request.Fields[0].Visibility != "world" {
		t.Fatalf("empty visibility defaulted to %q, want world", request.Fields[0].Visibility)
	}

	request.Fields[0].Visibility = "public"
	if fields := validateWorldCharacterFieldsRequest(&request); fields["fields[0].visibility"] == "" {
		t.Fatalf("unsupported visibility was accepted: %v", fields)
	}
}

func TestRestrictedCharacterFieldReadAuthority(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		member         authorizedWorldMember
		controlsEntity bool
		want           bool
	}{
		{name: "owner", member: authorizedWorldMember{Role: "owner"}, want: true},
		{name: "editor", member: authorizedWorldMember{Role: "editor"}, want: true},
		{name: "human facilitator", member: authorizedWorldMember{Role: "player", Facilitator: true}, want: true},
		{name: "controller", member: authorizedWorldMember{Role: "player"}, controlsEntity: true, want: true},
		{name: "unassigned player", member: authorizedWorldMember{Role: "player"}, want: false},
		{name: "spectator", member: authorizedWorldMember{Role: "spectator"}, want: false},
		{name: "spectator with stale control", member: authorizedWorldMember{Role: "spectator"}, controlsEntity: true, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := canReadRestrictedCharacterFields(test.member, test.controlsEntity); got != test.want {
				t.Fatalf("canReadRestrictedCharacterFields() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestRestrictedProfileReadDoesNotGrantEditAuthority(t *testing.T) {
	t.Parallel()

	err := requireEntityProfileEditAccess(worldEntityProfileAccess{
		CanReadRestricted: true,
		CanEdit:           false,
	})
	var status *statusError
	if !errors.As(err, &status) {
		t.Fatalf("requireEntityProfileEditAccess() error = %v, want status error", err)
	}
	if status.Status != http.StatusForbidden || status.Code != "entity_profile_forbidden" {
		t.Fatalf("requireEntityProfileEditAccess() = (%d, %q), want (%d, %q)",
			status.Status, status.Code, http.StatusForbidden, "entity_profile_forbidden")
	}

	if err := requireEntityProfileEditAccess(worldEntityProfileAccess{CanEdit: true}); err != nil {
		t.Fatalf("requireEntityProfileEditAccess() rejected edit authority: %v", err)
	}
}
