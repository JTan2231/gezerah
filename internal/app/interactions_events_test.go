package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type worldEventStreamResponseWriter struct {
	header    http.Header
	body      strings.Builder
	deadlines []time.Time
	flushes   int
}

func (w *worldEventStreamResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (*worldEventStreamResponseWriter) WriteHeader(int) {}

func (w *worldEventStreamResponseWriter) Write(data []byte) (int, error) {
	return w.body.Write(data)
}

func (w *worldEventStreamResponseWriter) Flush() {
	w.flushes++
}

func (w *worldEventStreamResponseWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}

func TestWorldEventRefreshDrainsFullBatchImmediately(t *testing.T) {
	t.Parallel()

	wake := make(chan struct{})
	defer close(wake)
	result := make(chan bool, 1)
	go func() {
		result <- waitForWorldEventRefresh(
			context.Background(), wake, make(chan time.Time), worldEventBatchLimit,
		)
	}()
	select {
	case refresh := <-result:
		if !refresh {
			t.Fatal("full event batch stopped the stream")
		}
	case <-time.After(time.Second):
		t.Fatal("full event batch waited for the fallback interval")
	}
}

func TestWorldEventRefreshStopsOnCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan bool, 1)
	go func() {
		result <- waitForWorldEventRefresh(
			ctx, make(chan struct{}), make(chan time.Time), worldEventBatchLimit-1,
		)
	}()
	cancel()
	select {
	case refresh := <-result:
		if refresh {
			t.Fatal("cancelled event stream requested another refresh")
		}
	case <-time.After(time.Second):
		t.Fatal("event stream did not stop after cancellation")
	}
}

func TestWorldEventStreamChunkResetsBoundedWriteDeadline(t *testing.T) {
	t.Parallel()

	writer := &worldEventStreamResponseWriter{}
	controller := http.NewResponseController(writer)
	started := time.Now()
	if err := writeWorldEventStreamChunk(writer, controller, ": keep-alive\n\n"); err != nil {
		t.Fatalf("write stream chunk: %v", err)
	}
	if got := writer.body.String(); got != ": keep-alive\n\n" {
		t.Fatalf("stream body = %q", got)
	}
	if writer.flushes != 1 {
		t.Fatalf("stream flushes = %d, want 1", writer.flushes)
	}
	if len(writer.deadlines) != 2 {
		t.Fatalf("write deadlines = %d, want one bounded deadline and one clear", len(writer.deadlines))
	}
	if deadline := writer.deadlines[0]; !deadline.After(started) || deadline.After(started.Add(worldEventWriteTimeout+time.Second)) {
		t.Errorf("write deadline %s is not bounded by %s", deadline, worldEventWriteTimeout)
	}
	if deadline := writer.deadlines[1]; !deadline.IsZero() {
		t.Errorf("deadline after flush = %s, want cleared deadline", deadline)
	}
}

func TestWorldEventStreamChunkOverridesGlobalWriteTimeout(t *testing.T) {
	t.Parallel()

	const (
		firstChunk  = "data: first\n\n"
		secondChunk = "data: second\n\n"
	)
	writeResult := make(chan error, 1)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		controller := http.NewResponseController(w)
		if err := writeWorldEventStreamChunk(w, controller, firstChunk); err != nil {
			writeResult <- err
			return
		}
		time.Sleep(50 * time.Millisecond)
		writeResult <- writeWorldEventStreamChunk(w, controller, secondChunk)
	}))
	server.Config.WriteTimeout = 10 * time.Millisecond
	server.Start()
	defer server.Close()

	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("build stream request: %v", err)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	body, readErr := io.ReadAll(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		t.Fatalf("read stream: %v", readErr)
	}
	if closeErr != nil {
		t.Fatalf("close stream response: %v", closeErr)
	}
	if err := <-writeResult; err != nil {
		t.Fatalf("write delayed stream chunk: %v", err)
	}
	if got := string(body); got != firstChunk+secondChunk {
		t.Fatalf("stream body = %q, want both chunks", got)
	}
}

func TestVisibleWorldEventsAudiencePolicyIncludesAutomatedAdjudicationAndInvalidation(t *testing.T) {
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
			or (
				interaction.status = 'adjudicating'
				and exists (
					select 1 from worlds assigned_world
					where assigned_world.id = interaction.world_id
							and assigned_world.facilitator_source in ('terra', 'agent')
				)
			)
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
		{name: "cancel adjudicating", command: "cancel", priorStatus: "adjudicating", want: true},
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

func TestTerraCurrentPlayerCanCancelOnlyUnfinishedTerraInteraction(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name              string
		facilitatorSource string
		status            string
		want              bool
	}{
		{name: "open Terra interaction", facilitatorSource: terraFacilitatorSource, status: "open", want: true},
		{name: "adjudicating Terra interaction", facilitatorSource: terraFacilitatorSource, status: "adjudicating", want: true},
		{name: "draft Terra interaction", facilitatorSource: terraFacilitatorSource, status: "draft"},
		{name: "resolved Terra interaction", facilitatorSource: terraFacilitatorSource, status: "resolved"},
		{name: "cancelled Terra interaction", facilitatorSource: terraFacilitatorSource, status: "cancelled"},
		{name: "open human interaction", facilitatorSource: "human", status: "open"},
		{name: "adjudicating human interaction", facilitatorSource: "human", status: "adjudicating"},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := terraCurrentPlayerCanCancelInteraction(test.facilitatorSource, test.status); got != test.want {
				t.Fatalf(
					"terraCurrentPlayerCanCancelInteraction(%q, %q) = %t, want %t",
					test.facilitatorSource, test.status, got, test.want,
				)
			}
		})
	}
}

func TestAutomatedCurrentPlayerCanCancelOnlyCurrentSourceUnfinishedInteraction(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name, assignedSource, interactionSource, status string
		want                                            bool
	}{
		{name: "agent open", assignedSource: agentFacilitatorSource, interactionSource: agentFacilitatorSource, status: "open", want: true},
		{name: "agent adjudicating", assignedSource: agentFacilitatorSource, interactionSource: agentFacilitatorSource, status: "adjudicating", want: true},
		{name: "agent cannot cancel Terra", assignedSource: agentFacilitatorSource, interactionSource: terraFacilitatorSource, status: "open"},
		{name: "Terra cannot cancel agent", assignedSource: terraFacilitatorSource, interactionSource: agentFacilitatorSource, status: "open"},
		{name: "human is not automated", assignedSource: "human", interactionSource: "human", status: "open"},
		{name: "final agent interaction", assignedSource: agentFacilitatorSource, interactionSource: agentFacilitatorSource, status: "resolved"},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := automatedCurrentPlayerCanCancelInteraction(
				test.assignedSource, test.interactionSource, test.status,
			); got != test.want {
				t.Fatalf("automatedCurrentPlayerCanCancelInteraction() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestProjectVisibleWorldEventRedactsAudienceInvalidation(t *testing.T) {
	t.Parallel()

	interactionID := "f5160547-d5af-4e6d-a4d2-d3c3d99ce452"
	actionID := "cc40a1dd-f079-4ba8-8fb0-289c111e300d"
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
				ActorSource:       terraFacilitatorSource,
				InteractionID:     &interactionID,
				ActionID:          &actionID,
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
			if got.ActorSource != terraFacilitatorSource {
				t.Fatalf("actor source = %q, want Terra attribution", got.ActorSource)
			}
			if got.InteractionID != nil || got.ActionID != nil || got.ResolutionID != nil || got.ActorMembershipID != nil {
				t.Fatalf("audience invalidation leaked resource identifiers: %#v", got)
			}
			payload, err := json.Marshal(got)
			if err != nil {
				t.Fatalf("marshal projected event: %v", err)
			}
			for _, field := range []string{
				"interaction_id", "action_id", "resolution_id", "actor_membership_id",
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
		{name: "audience resolution", eventType: "resolution-committed"},
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
