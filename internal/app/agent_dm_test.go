package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentAdjudicationPlanPreservesLifecycleAndRevisionGuards(t *testing.T) {
	t.Parallel()

	first, err := planAutomatedAdjudication(
		"open", agentFacilitatorSource, 4, 4, 0,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
	if err != nil {
		t.Fatalf("plan open agent adjudication: %v", err)
	}
	if !first.Begin || first.Revision != 5 {
		t.Fatalf("open plan = %#v, want begin at revision 5", first)
	}
	retry, err := planAutomatedAdjudication(
		"adjudicating", agentFacilitatorSource, 5, 5, 0,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
	if err != nil {
		t.Fatalf("plan retry agent adjudication: %v", err)
	}
	if retry.Begin || retry.Revision != 5 {
		t.Fatalf("retry plan = %#v, want no transition at revision 5", retry)
	}

	_, err = planAutomatedAdjudication(
		"open", terraFacilitatorSource, 4, 4, 0,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
	assertAutoDMStatusError(t, err, "interaction_lifecycle_conflict")
	_, err = planAutomatedAdjudication(
		"open", agentFacilitatorSource, 4, 3, 0,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
	assertAutoDMStatusError(t, err, "revision_conflict")
	_, err = planAutomatedAdjudication(
		"open", agentFacilitatorSource, 4, 4, 1,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
	assertAutoDMStatusError(t, err, "responses_incomplete")
}

func TestAgentResolutionRequestRejectsPrivateNotes(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"/agent-dm/resolve",
		strings.NewReader(`{
			"expected_revision":1,
			"expected_rules_revision":2,
			"idempotency_key":"one ruling",
			"narrative":"The door opens.",
			"private_notes":"hidden",
			"effects":[]
		}`),
	)
	var decoded agentDMResolveRequest
	if err := decodeJSON(request, &decoded); err == nil {
		t.Fatal("agent resolution unexpectedly accepted facilitator-private notes")
	}
}

func TestSummarizePublicCharacterProfile(t *testing.T) {
	t.Parallel()

	calling := "A careful scout"
	secret := ""
	summary := summarizePublicCharacterProfile(entityProfileResponse{
		Fields: []entityProfileFieldResponse{
			{Label: "Calling", Value: &calling},
			{Label: "Empty", Value: &secret},
		},
	})
	if summary == nil || *summary != "Calling: A careful scout" {
		t.Fatalf("profile summary = %#v", summary)
	}
}
