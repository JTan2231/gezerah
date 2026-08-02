package app

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestEventCursorAcceptsQueryAndReconnectHeader(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest("GET", "/api/games/game/events?after=42", nil)
	request.Header.Set("Last-Event-ID", "7")
	got, err := eventCursor(request)
	if err != nil || got != 42 {
		t.Fatalf("query cursor = %d, %v; want 42, nil", got, err)
	}

	request = httptest.NewRequest("GET", "/api/games/game/events", nil)
	request.Header.Set("Last-Event-ID", "7")
	got, err = eventCursor(request)
	if err != nil || got != 7 {
		t.Fatalf("header cursor = %d, %v; want 7, nil", got, err)
	}

	request = httptest.NewRequest("GET", "/api/games/game/events", nil)
	got, err = eventCursor(request)
	if err != nil || got != 0 {
		t.Fatalf("empty cursor = %d, %v; want 0, nil", got, err)
	}
}

func TestEventCursorRejectsMalformedAndNegativeValues(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{"-1", "1.5", "later"} {
		request := httptest.NewRequest("GET", "/api/games/game/events?after="+raw, nil)
		if _, err := eventCursor(request); err == nil {
			t.Errorf("cursor %q was accepted", raw)
		}
	}
}

func TestUniqueInOrderPreservesAuthoredContextPosition(t *testing.T) {
	got := uniqueInOrder([]string{"third", "first", "third", "second", "first"})
	want := []string{"third", "first", "second"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("uniqueInOrder() = %#v, want %#v", got, want)
	}
}

func TestInteractionDraftMatchesNormalizedAggregate(t *testing.T) {
	t.Parallel()
	title, notes := "Bridge", "Hidden hinge"
	current := interactionResponse{
		Title: &title, Prompt: "What do you do?", PrivateNotes: &notes,
		AudienceMembershipIDs:          []string{"audience"},
		EligibleResponderMembershipIDs: []string{"responder"},
		EntityIDs:                      []string{"first", "second"},
	}
	request := saveInteractionRequest{Title: &title, Prompt: current.Prompt, PrivateNotes: &notes}
	related := interactionAudience{
		AudienceIDs: []string{"audience"}, ResponderIDs: []string{"responder"},
		EntityIDs: []string{"first", "second"},
	}
	if !interactionDraftMatches(current, request, related) {
		t.Fatal("identical normalized draft was treated as changed")
	}
	related.EntityIDs = []string{"second", "first"}
	if interactionDraftMatches(current, request, related) {
		t.Fatal("authored entity-order change was treated as a no-op")
	}
}
