package rules

import (
	"errors"
	"testing"
)

func inlineStatusEffect(id ID, position int, entityID, instanceID ID, modifier StatusModifier) ConcreteEffect {
	status := StatusSnapshot{ID: id, WorldID: "world", Modifiers: []StatusModifier{modifier}}
	return ConcreteEffect{
		ID: id, Position: position, Operation: EffectApplyStatus, EntityIDs: []ID{entityID},
		Status: &status,
		StatusInstances: map[ID]ActiveStatus{entityID: {
			ID: instanceID, WorldID: "world", EntityID: entityID, SourceEffectID: id,
		}},
	}
}

func TestRuntimeTransitionAppliesDistinctInlineStatusesAndRemovesExactInstance(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "10")
	modifier := StatusModifier{
		ID: "boost-score", Position: 0, MechanicID: score.ID,
		Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("2")),
	}
	first := inlineStatusEffect("first-effect", 0, "e1", "first-instance", modifier)
	second := inlineStatusEffect("second-effect", 1, "e1", "second-instance", modifier)
	remove := ConcreteEffect{
		ID: "remove-effect", Position: 2, Operation: EffectRemoveStatus, EntityIDs: []ID{"e1"},
		StatusInstanceIDs: map[ID]ID{"e1": "first-instance"},
	}
	statusSnapshots := map[ID]StatusSnapshot{first.ID: *first.Status, second.ID: *second.Status}
	snapshot := RuntimeSnapshot{State: StateSnapshot{Records: map[ID]StateRecord{
		"e1": {EntityID: "e1", Values: map[ID]StateValue{}},
	}}}

	result, err := ApplyRuntimeTransition(
		TransitionPlan{Effects: []ConcreteEffect{remove, second, first}},
		testEntities(), definitionMap(score), statusSnapshots, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ActiveStatuses) != 1 || result.ActiveStatuses[0].ID != "second-instance" {
		t.Fatalf("active statuses = %+v, want only second instance", result.ActiveStatuses)
	}
	if len(result.AppliedStatusCommands) != 3 {
		t.Fatalf("status commands = %+v", result.AppliedStatusCommands)
	}
	if result.AppliedStatusCommands[2].StatusInstanceID != "first-instance" || !result.AppliedStatusCommands[2].Changed {
		t.Fatalf("remove command = %+v", result.AppliedStatusCommands[2])
	}
}

func TestRuntimeTransitionRejectsMissingExactRemoveTarget(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "0")
	remove := ConcreteEffect{
		ID: "remove", Position: 0, Operation: EffectRemoveStatus, EntityIDs: []ID{"e1"},
		StatusInstanceIDs: map[ID]ID{"e1": "not-active"},
	}
	snapshot := RuntimeSnapshot{
		State: StateSnapshot{Records: map[ID]StateRecord{
			"e1": {EntityID: "e1", Values: map[ID]StateValue{}},
		}},
		ActiveStatuses: []ActiveStatus{{
			ID: "active", WorldID: "world", EntityID: "e1", SourceEffectID: "source", AppliedOrder: 1,
		}},
	}
	_, err := ApplyRuntimeTransition(
		TransitionPlan{Effects: []ConcreteEffect{remove}}, testEntities(), definitionMap(score),
		map[ID]StatusSnapshot{"source": {ID: "source", WorldID: "world"}}, snapshot,
	)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
}

func TestRuntimeTransitionFailureIsAtomicAcrossStatusAndScalarState(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "0")
	score.Maximum = decimalPointer(MustDecimal("3"))
	modifier := StatusModifier{
		ID: "boost-score", Position: 0, MechanicID: score.ID,
		Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("2")),
	}
	apply := inlineStatusEffect("apply-first", 0, "e1", "new-active", modifier)
	plusOne := MustDecimal("1")
	plan := TransitionPlan{Effects: []ConcreteEffect{
		apply,
		{ID: "fail-later", Position: 1, Operation: EffectAdjustNumber, EntityIDs: []ID{"e1"}, MechanicID: score.ID, AdjustmentAmount: &plusOne},
	}}
	snapshot := RuntimeSnapshot{
		State:          StateSnapshot{Records: map[ID]StateRecord{"e1": numberRecord("e1", score.ID, "3")}},
		ActiveStatuses: []ActiveStatus{},
	}

	result, err := ApplyRuntimeTransition(
		plan, testEntities(), definitionMap(score), map[ID]StatusSnapshot{apply.ID: *apply.Status}, snapshot,
	)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
	if result.State.Records != nil || result.ActiveStatuses != nil || result.AppliedStatusCommands != nil {
		t.Fatalf("partial runtime result escaped: %+v", result)
	}
	if got := snapshot.State.Records["e1"].Values[score.ID].Number.String(); got != "3" {
		t.Fatalf("caller-owned input state changed to %s", got)
	}
}

func TestRuntimeTransitionRejectsDirectDerivedMutationAndMismatchedInlineInstance(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("base", "1")
	derived := namedDerived("derived", ValueNumber, mechanicReference(base.ID))
	setValue := NewNumberValue(MustDecimal("2"))
	modifier := StatusModifier{
		ID: "boost-derived", Position: 0, MechanicID: derived.ID,
		Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("1")),
	}
	apply := inlineStatusEffect("bad-apply", 1, "e1", "bad", modifier)
	bad := apply.StatusInstances["e1"]
	bad.EntityID = "e2"
	apply.StatusInstances["e1"] = bad
	plan := TransitionPlan{Effects: []ConcreteEffect{
		{ID: "set-derived", Position: 0, Operation: EffectSet, EntityIDs: []ID{"e1"}, MechanicID: derived.ID, Value: &setValue},
		apply,
	}}
	errs := ValidateRuntimeTransitionPlan(
		plan, testEntities(), definitionMap(base, derived), map[ID]StatusSnapshot{apply.ID: *apply.Status},
	)
	if !hasValidationAt(errs, "derived_mechanic", "effects[0].mechanic_id") {
		t.Fatalf("derived target errors = %v", errs)
	}
	if !hasValidationAt(errs, "entity_mismatch", "effects[1].status_instances[e1].entity_id") {
		t.Fatalf("status instance errors = %v", errs)
	}
}

func TestRuntimeTransitionAutoAssignsAppliedOrderInAuthoredSequence(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "0")
	modifier := StatusModifier{
		ID: "modifier", Position: 0, MechanicID: score.ID,
		Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("1")),
	}
	first := inlineStatusEffect("first-effect", 0, "e1", "first-active", modifier)
	second := inlineStatusEffect("second-effect", 1, "e1", "second-active", modifier)
	statusSnapshots := map[ID]StatusSnapshot{
		"existing": {ID: "existing", WorldID: "world"},
		first.ID:   *first.Status,
		second.ID:  *second.Status,
	}
	snapshot := RuntimeSnapshot{
		State: StateSnapshot{Records: map[ID]StateRecord{
			"e1": {EntityID: "e1", Values: map[ID]StateValue{}},
		}},
		ActiveStatuses: []ActiveStatus{{
			ID: "existing-active", WorldID: "world", EntityID: "e1",
			SourceEffectID: "existing", AppliedOrder: 50,
		}},
	}
	result, err := ApplyRuntimeTransition(
		TransitionPlan{Effects: []ConcreteEffect{second, first}}, testEntities(), definitionMap(score), statusSnapshots, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	orders := map[ID]int64{}
	for _, status := range result.ActiveStatuses {
		orders[status.ID] = status.AppliedOrder
	}
	if orders["existing-active"] != 50 || orders["first-active"] != 51 || orders["second-active"] != 52 {
		t.Fatalf("assigned applied orders = %v", orders)
	}
	if first.StatusInstances["e1"].AppliedOrder != 0 || second.StatusInstances["e1"].AppliedOrder != 0 {
		t.Fatalf("caller-owned transition plan mutated")
	}
}
