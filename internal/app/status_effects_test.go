package app

import (
	"testing"

	"dnd/internal/rules"
)

func TestConsequenceOwnedStatusesWithSameNameRemainDistinct(t *testing.T) {
	t.Parallel()
	first := rules.StatusSnapshot{ID: "first-effect", WorldID: "world"}
	second := rules.StatusSnapshot{ID: "second-effect", WorldID: "world"}
	firstEffect := rules.ConcreteEffect{
		ID: first.ID, Position: 0, Operation: rules.EffectApplyStatus,
		EntityIDs: []rules.ID{"entity"}, Status: &first,
		StatusInstances: map[rules.ID]rules.ActiveStatus{"entity": {
			ID: "first-instance", WorldID: "world", EntityID: "entity", SourceEffectID: first.ID,
		}},
	}
	secondEffect := rules.ConcreteEffect{
		ID: second.ID, Position: 1, Operation: rules.EffectApplyStatus,
		EntityIDs: []rules.ID{"entity"}, Status: &second,
		StatusInstances: map[rules.ID]rules.ActiveStatus{"entity": {
			ID: "second-instance", WorldID: "world", EntityID: "entity", SourceEffectID: second.ID,
		}},
	}
	entities := map[rules.ID]rules.Entity{"entity": {ID: "entity", WorldID: "world"}}
	statusSnapshots := map[rules.ID]rules.StatusSnapshot{first.ID: first, second.ID: second}
	snapshot := rules.RuntimeSnapshot{State: rules.StateSnapshot{Records: map[rules.ID]rules.StateRecord{
		"entity": {EntityID: "entity", Values: map[rules.ID]rules.StateValue{}},
	}}}
	transition, err := rules.ApplyRuntimeTransition(
		rules.TransitionPlan{Effects: []rules.ConcreteEffect{firstEffect, secondEffect}},
		entities, map[rules.ID]rules.MechanicDefinition{}, statusSnapshots, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	configuration := resolutionStatusConfiguration{
		Snapshots: statusSnapshots,
		Responses: map[rules.ID]statusEffectSnapshot{
			first.ID:  {Name: "Poisoned", Modifiers: []statusModifierResponse{}},
			second.ID: {Name: "Poisoned", Modifiers: []statusModifierResponse{}},
		},
	}
	receipts, err := statusReceipts(transition.AppliedStatusCommands, nil, configuration)
	if err != nil {
		t.Fatal(err)
	}
	if len(receipts) != 2 || receipts[0].StatusName != "Poisoned" || receipts[1].StatusName != "Poisoned" || receipts[0].StatusInstanceID == receipts[1].StatusInstanceID {
		t.Fatalf("same-name receipts lost distinct identity: %+v", receipts)
	}

	remove := rules.ConcreteEffect{
		ID: "remove-effect", Position: 0, Operation: rules.EffectRemoveStatus,
		EntityIDs:         []rules.ID{"entity"},
		StatusInstanceIDs: map[rules.ID]rules.ID{"entity": "first-instance"},
	}
	removed, err := rules.ApplyRuntimeTransition(
		rules.TransitionPlan{Effects: []rules.ConcreteEffect{remove}}, entities,
		map[rules.ID]rules.MechanicDefinition{}, statusSnapshots,
		rules.RuntimeSnapshot{State: transition.State, ActiveStatuses: transition.ActiveStatuses},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed.ActiveStatuses) != 1 || removed.ActiveStatuses[0].ID != "second-instance" {
		t.Fatalf("exact removal affected the wrong same-name status: %+v", removed.ActiveStatuses)
	}
}

func TestValidateAdjudicationStatusEffectShapes(t *testing.T) {
	t.Parallel()
	revision, rulesRevision := int64(3), int64(7)
	request := adjudicateInteractionRequest{
		ExpectedRevision: &revision, ExpectedRulesRevision: &rulesRevision,
		Narrative: "The poison takes hold.",
		Effects: []concreteEffectDTO{{
			ID:   "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			Type: "apply-status",
			Targets: []statusEffectTargetDTO{{
				EntityID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			}},
			Status: &statusEffectSpecDTO{Name: "Poisoned", Modifiers: []saveStatusModifierRequest{}},
		}},
	}
	if fields := validateAdjudicationRequest(&request, false); len(fields) != 0 {
		t.Fatalf("valid inline status rejected: %v", fields)
	}

	request.Effects[0].Type = "remove-status"
	request.Effects[0].Status = nil
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
