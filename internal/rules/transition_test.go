package rules

import (
	"errors"
	"testing"
)

func TestConcreteTransitionAppliesInPlanAndEntityOrder(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	plusTwo := MustDecimal("2")
	plusThree := MustDecimal("3")
	plan := TransitionPlan{Effects: []ConcreteEffect{
		{ID: "later", Position: 1, Operation: EffectAdjustNumber, EntityIDs: []ID{"e1"}, StateVariableID: definition.ID, AdjustmentAmount: &plusThree},
		{ID: "first", Position: 0, Operation: EffectAdjustNumber, EntityIDs: []ID{"e2", "e1"}, StateVariableID: definition.ID, AdjustmentAmount: &plusTwo},
	}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "1"),
		"e2": numberRecord("e2", definition.ID, "10"),
	}}

	result, err := ApplyTransition(plan, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.State.Records["e1"].Values[definition.ID].Values[0].Number.String(); got != "6" {
		t.Fatalf("e1 score = %s, want 6", got)
	}
	if got := result.State.Records["e2"].Values[definition.ID].Values[0].Number.String(); got != "12" {
		t.Fatalf("e2 score = %s, want 12", got)
	}
	if len(result.AppliedEffects) != 3 || result.AppliedEffects[0].EffectID != "first" || result.AppliedEffects[0].EntityID != "e2" || result.AppliedEffects[1].EntityID != "e1" || result.AppliedEffects[2].EffectID != "later" {
		t.Fatalf("application order = %+v", result.AppliedEffects)
	}
	if result.AppliedEffects[2].Before.Values[0].Number.String() != "3" {
		t.Fatalf("later effect did not observe earlier result: %+v", result.AppliedEffects[2])
	}
}

func TestConcreteTransitionFailureLeavesInputSnapshotUntouched(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	maximum := MustDecimal("3")
	definition.NumberMaximum = &maximum
	plusOne := MustDecimal("1")
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "adjust", Position: 0, Operation: EffectAdjustNumber,
		EntityIDs: []ID{"e1", "e2"}, StateVariableID: definition.ID, AdjustmentAmount: &plusOne,
	}}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "1"),
		"e2": numberRecord("e2", definition.ID, "3"),
	}}

	_, err := ApplyTransition(plan, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, snapshot)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
	if got := snapshot.Records["e1"].Values[definition.ID].Values[0].Number.String(); got != "1" {
		t.Fatalf("input snapshot was partially mutated: %s", got)
	}
}

func TestConcreteTransitionRejectsIneligibleAndDuplicateTargets(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	value := NewSingleValue(NewNumberValue(MustDecimal("1")))
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "set", Position: 0, Operation: EffectSet,
		EntityIDs: []ID{"inst", "inst"}, StateVariableID: definition.ID, Operand: &value,
	}}}
	errs := ValidateTransitionPlan(plan, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition})
	if !hasValidationCode(errs, "ineligible_state_owner") || !hasValidationCode(errs, "duplicate") {
		t.Fatalf("validation errors = %v", errs)
	}
}

func TestConcreteTransitionAllowsAnEmptyResolvedTarget(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "clear", Position: 0, Operation: EffectClear,
		StateVariableID: definition.ID,
	}}}
	result, err := ApplyTransition(plan, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, StateSnapshot{Records: map[ID]StateRecord{}})
	if err != nil {
		t.Fatalf("apply empty resolved target: %v", err)
	}
	if len(result.AppliedEffects) != 0 || len(result.ChangedRecordIDs) != 0 {
		t.Fatalf("empty target mutated state: %+v", result)
	}
}

func TestConcreteTransitionRejectsReferenceDefaultOutsideEntityScope(t *testing.T) {
	t.Parallel()
	defaultValue := NewSingleValue(NewReferenceValue("e2", nil))
	definition := StateVariableDefinition{
		ID: "focus", RuleSetID: "rs", Key: "world.focus", Label: "Focus",
		OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueReference, Cardinality: CardinalityOne,
		MissingKind: MissingDefault, DefaultValue: &defaultValue,
		AllowedEffectOperations: []EffectOperation{EffectClear},
	}
	entities := map[ID]Entity{"e1": testEntities()["e1"]}
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "clear", Position: 0, Operation: EffectClear,
		EntityIDs: []ID{"e1"}, StateVariableID: definition.ID,
	}}}
	errs := ValidateTransitionPlan(plan, entities, map[ID]StateVariableDefinition{definition.ID: definition})
	if !hasValidationCode(errs, "unknown_reference_entity") {
		t.Fatalf("validation errors = %v", errs)
	}
}
