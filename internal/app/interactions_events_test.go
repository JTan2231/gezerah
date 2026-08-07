package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestVisibleWorldEventsAudiencePolicyIncludesMarkedInvalidation(t *testing.T) {
	t.Parallel()

	got := strings.Join(strings.Fields(visibleWorldEventsAudiencePolicyQuery), " ")
	want := strings.Join(strings.Fields(`
		exists (
			select 1
			from interaction_audience_members audience
			where audience.interaction_id = event.interaction_id
				and audience.world_id = event.world_id
				and audience.membership_id = $4
		)
		and (
			interaction.status in ('open', 'resolved')
			or event.invalidates_interaction_audience
		)`), " ")
	if got != want {
		t.Fatalf("audience event policy = %q, want %q", got, want)
	}
}

func TestInteractionLifecycleInvalidatesOnlyPreviouslyVisibleAudience(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		command     string
		priorStatus string
		want        bool
	}{
		{name: "begin adjudication", command: "adjudicate", priorStatus: "open", want: true},
		{name: "cancel open", command: "cancel", priorStatus: "open", want: true},
		{name: "cancel draft", command: "cancel", priorStatus: "draft"},
		{name: "cancel adjudicating", command: "cancel", priorStatus: "adjudicating"},
		{name: "present draft", command: "present", priorStatus: "draft"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := interactionLifecycleInvalidatesAudience(test.command, test.priorStatus); got != test.want {
				t.Fatalf("interactionLifecycleInvalidatesAudience(%q, %q) = %t, want %t", test.command, test.priorStatus, got, test.want)
			}
		})
	}
}

func TestProjectVisibleWorldEventRedactsAudienceInvalidation(t *testing.T) {
	t.Parallel()

	interactionID := "f5160547-d5af-4e6d-a4d2-d3c3d99ce452"
	submissionID := "cc40a1dd-f079-4ba8-8fb0-289c111e300d"
	resolutionID := "55aab7c2-ee8a-40c3-85d8-9592199680a7"
	actorID := "57898ef8-85cf-43f3-a666-afdcfdd8cc54"
	createdAt := time.Date(2026, time.August, 7, 13, 14, 15, 0, time.UTC)
	for _, eventType := range []string{interactionAdjudicatingEventType, "interaction-cancelled"} {
		eventType := eventType
		t.Run(eventType, func(t *testing.T) {
			t.Parallel()
			event := worldEventResponse{
				ID:                42,
				Type:              eventType,
				InteractionID:     &interactionID,
				SubmissionID:      &submissionID,
				ResolutionID:      &resolutionID,
				ActorMembershipID: &actorID,
				CreatedAt:         createdAt,
			}

			got := projectVisibleWorldEvent(event, false, true)
			if got.ID != event.ID || !got.CreatedAt.Equal(event.CreatedAt) {
				t.Fatalf("cursor metadata changed: got %#v, source %#v", got, event)
			}
			if got.Type != interactionFeedInvalidatedEventType {
				t.Fatalf("type = %q, want %q", got.Type, interactionFeedInvalidatedEventType)
			}
			if got.InteractionID != nil || got.SubmissionID != nil || got.ResolutionID != nil || got.ActorMembershipID != nil {
				t.Fatalf("audience invalidation leaked resource identifiers: %#v", got)
			}
			payload, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal projected event: %v", err)
			}
			for _, field := range []string{
				"interaction_id", "submission_id", "resolution_id", "actor_membership_id",
			} {
				if strings.Contains(string(payload), `"`+field+`"`) {
					t.Fatalf("audience invalidation JSON contains %q: %s", field, payload)
				}
			}
		})
	}
}

func TestProjectVisibleWorldEventPreservesAuthorizedPayloads(t *testing.T) {
	t.Parallel()

	interactionID := "f5160547-d5af-4e6d-a4d2-d3c3d99ce452"
	actorID := "57898ef8-85cf-43f3-a666-afdcfdd8cc54"
	tests := []struct {
		name                           string
		facilitator                    bool
		invalidatesInteractionAudience bool
		eventType                      string
	}{
		{name: "facilitator adjudication", facilitator: true, invalidatesInteractionAudience: true, eventType: interactionAdjudicatingEventType},
		{name: "audience resolution", eventType: "resolution-applied"},
		{name: "unmarked audience cancellation", eventType: "interaction-cancelled"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			event := worldEventResponse{
				ID:                43,
				Type:              test.eventType,
				InteractionID:     &interactionID,
				ActorMembershipID: &actorID,
			}
			if got := projectVisibleWorldEvent(
				event, test.facilitator, test.invalidatesInteractionAudience,
			); got != event {
				t.Fatalf("projected event = %#v, want %#v", got, event)
			}
		})
	}
}
