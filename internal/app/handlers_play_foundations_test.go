package app

import (
	"errors"
	"net/http/httptest"
	"testing"
)

func TestPlayActorIDRequiresTrustedDevelopmentHeader(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("GET", "/api/games", nil)
	_, err := playActorID(request)
	var status *statusError
	if !errors.As(err, &status) || status.Code != "authentication_required" {
		t.Fatalf("missing header error = %T %v, want authentication_required", err, err)
	}

	request.Header.Set(playUserHeader, "not-a-uuid")
	_, err = playActorID(request)
	if !errors.As(err, &status) || status.Code != "invalid_identity" {
		t.Fatalf("malformed header error = %T %v, want invalid_identity", err, err)
	}

	const userID = "10000000-0000-4000-8000-000000000001"
	request.Header.Set(playUserHeader, userID)
	got, err := playActorID(request)
	if err != nil || got != userID {
		t.Fatalf("valid header = %q, %v, want %q, nil", got, err, userID)
	}
}

func TestPlayFoundationClosedVocabularies(t *testing.T) {
	t.Parallel()

	for _, role := range []string{"facilitator", "player", "spectator"} {
		if !validGameRole(role) {
			t.Errorf("valid role %q was rejected", role)
		}
	}
	if validGameRole("dungeon-master") {
		t.Fatal("configured-looking role was accepted as an application role")
	}
	for _, status := range []string{"invited", "active", "left"} {
		if !validGameMembershipStatus(status) {
			t.Errorf("valid membership status %q was rejected", status)
		}
	}
	if validGameMembershipStatus("resolved") {
		t.Fatal("unrelated status was accepted")
	}
}
