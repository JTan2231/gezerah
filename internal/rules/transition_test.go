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
		{ID: "later", Position: 1, Operation: EffectAdjustNumber, EntityIDs: []ID{"e1"}, MechanicID: definition.ID, AdjustmentAmount: &plusThree},
		{ID: "first", Position: 0, Operation: EffectAdjustNumber, EntityIDs: []ID{"e2", "e1"}, MechanicID: definition.ID, AdjustmentAmount: &plusTwo},
	}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "1"),
		"e2": numberRecord("e2", definition.ID, "10"),
	}}

	result, err := ApplyTransition(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.State.Records["e1"].Values[definition.ID].Number.String(); got != "6" {
		t.Fatalf("e1 score = %s, want 6", got)
	}
	if got := result.State.Records["e2"].Values[definition.ID].Number.String(); got != "12" {
		t.Fatalf("e2 score = %s, want 12", got)
	}
	if len(result.AppliedEffects) != 3 || result.AppliedEffects[0].EffectID != "first" || result.AppliedEffects[0].EntityID != "e2" || result.AppliedEffects[1].EntityID != "e1" || result.AppliedEffects[2].EffectID != "later" {
		t.Fatalf("application order = %+v", result.AppliedEffects)
	}
	if got := result.AppliedEffects[2].Before.Number.String(); got != "3" {
		t.Fatalf("later effect saw %s, want earlier result 3", got)
	}
}

func TestConcreteTransitionFailureLeavesInputSnapshotUntouched(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.Maximum = decimalPointer(MustDecimal("3"))
	plusOne := MustDecimal("1")
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "adjust", Position: 0, Operation: EffectAdjustNumber,
		EntityIDs: []ID{"e1", "e2"}, MechanicID: definition.ID, AdjustmentAmount: &plusOne,
	}}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "1"),
		"e2": numberRecord("e2", definition.ID, "3"),
	}}

	_, err := ApplyTransition(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, snapshot)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
	if got := snapshot.Records["e1"].Values[definition.ID].Number.String(); got != "1" {
		t.Fatalf("input snapshot was partially mutated: %s", got)
	}
}

func TestConcreteTransitionRejectsInvalidTargetsAndMechanics(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	value := NewNumberValue(MustDecimal("1"))
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "set", Position: 0, Operation: EffectSet,
		EntityIDs: []ID{"other", "archived", "archived"}, MechanicID: definition.ID, Value: &value,
	}}}
	errs := ValidateTransitionPlan(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition})
	for _, code := range []string{"cross_world_reference", "archived_entity", "duplicate"} {
		if !hasValidationCode(errs, code) {
			t.Errorf("expected %s, got %v", code, errs)
		}
	}

	definition.Mutable = false
	errs = ValidateTransitionPlan(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition})
	if !hasValidationCode(errs, "mechanic_not_mutable") {
		t.Fatalf("expected mechanic_not_mutable, got %v", errs)
	}
}

func TestConcreteTransitionAllowsAnEmptyResolvedTarget(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	value := NewNumberValue(MustDecimal("2"))
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "set", Position: 0, Operation: EffectSet,
		MechanicID: definition.ID, Value: &value,
	}}}
	result, err := ApplyTransition(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, StateSnapshot{Records: map[ID]StateRecord{}})
	if err != nil {
		t.Fatalf("apply empty resolved target: %v", err)
	}
	if len(result.AppliedEffects) != 0 || len(result.ChangedRecordIDs) != 0 {
		t.Fatalf("empty target mutated state: %+v", result)
	}
}

func TestTransitionUsesDefaultsAndKeepsSparseState(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.DefaultValue = NewNumberValue(MustDecimal("5"))
	zero := MustDecimal("0")
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "adjust", Position: 0, Operation: EffectAdjustNumber,
		EntityIDs: []ID{"e1"}, MechanicID: definition.ID, AdjustmentAmount: &zero,
	}}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{"e1": {EntityID: "e1", Values: map[ID]StateValue{}}}}
	result, err := ApplyTransition(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	application := result.AppliedEffects[0]
	if application.Before.Number.String() != "5" || application.After.Number.String() != "5" || application.Changed {
		t.Fatalf("default no-op receipt = %+v", application)
	}
	if len(result.State.Records["e1"].Values) != 0 || len(result.ChangedRecordIDs) != 0 {
		t.Fatalf("default no-op was stored: %+v", result)
	}
}

func TestTransitionSetsBooleanAndNormalizesDefault(t *testing.T) {
	t.Parallel()
	definition := testBooleanDefinition()
	trueValue := NewBooleanValue(true)
	falseValue := NewBooleanValue(false)
	plan := TransitionPlan{Effects: []ConcreteEffect{
		{ID: "on", Position: 0, Operation: EffectSet, EntityIDs: []ID{"e1"}, MechanicID: definition.ID, Value: &trueValue},
		{ID: "off", Position: 1, Operation: EffectSet, EntityIDs: []ID{"e1"}, MechanicID: definition.ID, Value: &falseValue},
	}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{"e1": {EntityID: "e1", Values: map[ID]StateValue{}}}}
	result, err := ApplyTransition(plan, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.State.Records["e1"].Values) != 0 {
		t.Fatalf("final default should not be stored: %+v", result.State)
	}
	if !result.AppliedEffects[0].Changed || !result.AppliedEffects[1].Changed {
		t.Fatalf("both stored transitions should be recorded as changes: %+v", result.AppliedEffects)
	}
}

func TestTransitionPlanAndMissingStateUseDistinctErrorKinds(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	amount := MustDecimal("1")
	invalid := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "adjust", Position: 0, Operation: EffectAdjustNumber,
		EntityIDs: []ID{"e1"}, MechanicID: "missing", AdjustmentAmount: &amount,
	}}}
	if _, err := ApplyTransition(invalid, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, StateSnapshot{}); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("invalid plan error = %v", err)
	}

	valid := invalid
	valid.Effects[0].MechanicID = definition.ID
	if _, err := ApplyTransition(valid, testEntities(), map[ID]MechanicDefinition{definition.ID: definition}, StateSnapshot{Records: map[ID]StateRecord{}}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("missing record error = %v", err)
	}
}
