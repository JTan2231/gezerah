package app

import (
	"testing"

	"github.com/JTan2231/wrought/internal/rules"
)

func TestConsequenceOwnedStatusesWithSameNameRemainDistinct(t *testing.T) {
	t.Parallel()
	first := rules.InlineStatus{ID: "first-effect", WorldID: "world"}
	second := rules.InlineStatus{ID: "second-effect", WorldID: "world"}
	firstEffect := rules.ConcreteEffect{
		ID: first.ID, Position: 0, Operation: rules.EffectApplyStatus,
		EntityIDs: []rules.ID{"entity"}, InlineStatus: &first,
		StatusInstances: map[rules.ID]rules.StatusInstance{"entity": {
			ID: "first-instance", WorldID: "world", EntityID: "entity", SourceEffectID: first.ID,
		}},
	}
	secondEffect := rules.ConcreteEffect{
		ID: second.ID, Position: 1, Operation: rules.EffectApplyStatus,
		EntityIDs: []rules.ID{"entity"}, InlineStatus: &second,
		StatusInstances: map[rules.ID]rules.StatusInstance{"entity": {
			ID: "second-instance", WorldID: "world", EntityID: "entity", SourceEffectID: second.ID,
		}},
	}
	entities := map[rules.ID]rules.Entity{"entity": {ID: "entity", WorldID: "world"}}
	inlineStatuses := map[rules.ID]rules.InlineStatus{first.ID: first, second.ID: second}
	snapshot := rules.RuntimeSnapshot{InputOverrides: rules.InputOverrideSnapshot{ByEntity: map[rules.ID]rules.InputOverrideRecord{
		"entity": {EntityID: "entity", Overrides: map[rules.ID]rules.MechanicValue{}},
	}}}
	transition, err := rules.ApplyRuntimeTransition(
		rules.TransitionPlan{Effects: []rules.ConcreteEffect{firstEffect, secondEffect}},
		entities, map[rules.ID]rules.MechanicDefinition{}, inlineStatuses, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	inlineStatusesForConsequence := consequenceInlineStatuses{
		InlineStatuses: inlineStatuses,
		Details: map[rules.ID]inlineStatusDetails{
			first.ID:  {Name: "Poisoned", Modifiers: []statusModifierResponse{}},
			second.ID: {Name: "Poisoned", Modifiers: []statusModifierResponse{}},
		},
	}
	results, err := statusApplicationResults(transition.StatusApplications, nil, inlineStatusesForConsequence)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].StatusName != "Poisoned" || results[1].StatusName != "Poisoned" || results[0].StatusInstanceID == results[1].StatusInstanceID {
		t.Fatalf("same-name results lost distinct identity: %+v", results)
	}

	remove := rules.ConcreteEffect{
		ID: "remove-effect", Position: 0, Operation: rules.EffectRemoveStatus,
		EntityIDs:         []rules.ID{"entity"},
		StatusInstanceIDs: map[rules.ID]rules.ID{"entity": "first-instance"},
	}
	removed, err := rules.ApplyRuntimeTransition(
		rules.TransitionPlan{Effects: []rules.ConcreteEffect{remove}}, entities,
		map[rules.ID]rules.MechanicDefinition{}, inlineStatuses,
		rules.RuntimeSnapshot{InputOverrides: transition.InputOverrides, StatusInstances: transition.StatusInstances},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.StatusInstances) != 1 || removed.StatusInstances[0].ID != "second-instance" {
		t.Fatalf("exact removal affected the wrong same-name Status instance: %+v", removed.StatusInstances)
	}
}

func TestValidateAdjudicationInlineStatusShapes(t *testing.T) {
	t.Parallel()
	revision, rulesRevision := int64(3), int64(7)
	request := adjudicateInteractionRequest{
		ExpectedRevision: &revision, ExpectedRulesRevision: &rulesRevision,
		Narrative: "The poison takes hold.",
		Effects: []concreteEffectDTO{{
			ID:   "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			Type: "apply-status",
			Targets: []statusLifecycleEffectTargetDTO{{
				EntityID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			}},
			InlineStatus: &inlineStatusDTO{Name: "Poisoned", Modifiers: []saveStatusModifierRequest{}},
		}},
	}
	if fields := validateAdjudicationRequest(&request, false); len(fields) != 0 {
		t.Fatalf("valid inline status rejected: %v", fields)
	}

	request.Effects[0].Type = "remove-status"
	request.Effects[0].InlineStatus = nil
	request.Effects[0].Targets[0].StatusInstanceID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	if fields := validateAdjudicationRequest(&request, false); len(fields) != 0 {
		t.Fatalf("valid exact removal rejected: %v", fields)
	}

	request.Effects[0].Targets[0].StatusInstanceID = ""
	fields := validateAdjudicationRequest(&request, false)
	if fields["effects[0].targets[0].status_instance_id"] == "" {
		t.Fatalf("missing exact instance was accepted: %v", fields)
	}
}
