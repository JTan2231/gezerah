package app

import (
	"strings"
	"testing"

	"dnd/internal/rules"
)

func TestLiveConcreteEffectRequiresAnExplicitTarget(t *testing.T) {
	t.Parallel()
	definition := liveNumberDefinition(false)
	_, err := concreteEffectDTOToDomain(concreteEffectDTO{
		ID: string(definition.ID), Type: string(rules.EffectClear),
		StateVariableID: string(definition.ID),
	}, 0, map[rules.ID]rules.StateVariableDefinition{definition.ID: definition})
	if err == nil || !strings.Contains(err.Error(), "at least one entity_id") {
		t.Fatalf("error = %v, want explicit-target validation", err)
	}
}

func TestLiveConcreteEffectCannotNewlyUseArchivedVariable(t *testing.T) {
	t.Parallel()
	definition := liveNumberDefinition(true)
	_, err := concreteEffectDTOToDomain(concreteEffectDTO{
		ID: string(definition.ID), Type: string(rules.EffectClear), EntityIDs: []string{string(definition.ID)},
		StateVariableID: string(definition.ID),
	}, 0, map[rules.ID]rules.StateVariableDefinition{definition.ID: definition})
	if err == nil || !strings.Contains(err.Error(), "is archived") {
		t.Fatalf("error = %v, want archived-variable validation", err)
	}
}

func TestAdjudicationRequestBoundsIndexedAndNarrativeStrings(t *testing.T) {
	t.Parallel()
	revision := int64(0)
	summary := strings.Repeat("s", 10001)
	privateNotes := strings.Repeat("p", 20001)
	request := adjudicateInteractionRequest{
		ExpectedRevision: &revision,
		IdempotencyKey:   strings.Repeat("k", 201),
		ActionSummary:    &summary,
		Narrative:        strings.Repeat("n", 20001),
		PrivateNotes:     &privateNotes,
	}
	fields := validateAdjudicationRequest(&request, true)
	for _, field := range []string{"idempotency_key", "action_summary", "narrative", "private_notes"} {
		if fields[field] == "" {
			t.Errorf("%s was not bounded: %#v", field, fields)
		}
	}
}

func liveNumberDefinition(archived bool) rules.StateVariableDefinition {
	return rules.StateVariableDefinition{
		ID: "10000000-0000-4000-8000-000000000001", RuleSetID: "rules",
		ValueKind: rules.ValueNumber, Cardinality: rules.CardinalityOne,
		AllowedEffectOperations: []rules.EffectOperation{rules.EffectClear}, Archived: archived,
	}
}
