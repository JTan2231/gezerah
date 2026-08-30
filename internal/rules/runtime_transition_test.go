package rules

import (
	"errors"
	"testing"
)

func applyStatusEffectPlanItem(id ID, position int, instanceID ID, modifier StatusModifier) ConcreteEffect {
	const entityID ID = "e1"
	status := InlineStatus{ID: id, WorldID: "world", Modifiers: []StatusModifier{modifier}}
	return ConcreteEffect{
		ID: id, Position: position, Operation: EffectApplyStatus, EntityIDs: []ID{entityID},
		InlineStatus: &status,
		StatusInstances: map[ID]StatusInstance{entityID: {
			ID: instanceID, WorldID: "world", EntityID: entityID, SourceEffectID: id,
		}},
	}
}

func TestRuntimeTransitionAppliesScalarEffectsInPlanAndEntityOrder(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	plusTwo := MustDecimal("2")
	plusThree := MustDecimal("3")
	plan := TransitionPlan{Effects: []ConcreteEffect{
		{ID: "later", Position: 1, Operation: EffectAdjustNumber, EntityIDs: []ID{"e1"}, MechanicID: definition.ID, AdjustmentAmount: &plusThree},
		{ID: "first", Position: 0, Operation: EffectAdjustNumber, EntityIDs: []ID{"e2", "e1"}, MechanicID: definition.ID, AdjustmentAmount: &plusTwo},
	}}
	snapshot := RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
		"e1": numberOverrideRecord("e1", definition.ID, "1"),
		"e2": numberOverrideRecord("e2", definition.ID, "10"),
	}}}

	result, err := ApplyRuntimeTransition(plan, testEntities(), definitionMap(definition), nil, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.InputOverrides.ByEntity["e1"].Overrides[definition.ID].Number.String(); got != "6" {
		t.Fatalf("e1 score = %s, want 6", got)
	}
	if got := result.InputOverrides.ByEntity["e2"].Overrides[definition.ID].Number.String(); got != "12" {
		t.Fatalf("e2 score = %s, want 12", got)
	}
	if len(result.ScalarApplications) != 3 || result.ScalarApplications[0].EffectID != "first" || result.ScalarApplications[0].EntityID != "e2" || result.ScalarApplications[1].EntityID != "e1" || result.ScalarApplications[2].EffectID != "later" {
		t.Fatalf("scalar Application order = %+v", result.ScalarApplications)
	}
	if got := result.ScalarApplications[2].Before.Number.String(); got != "3" {
		t.Fatalf("later Effect saw %s, want earlier result 3", got)
	}
}

func TestRuntimeTransitionAllowsEmptyResolvedTarget(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	value := NewNumberMechanicValue(MustDecimal("2"))
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "set", Position: 0, Operation: EffectSet,
		MechanicID: definition.ID, Value: &value,
	}}}
	snapshot := RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{}}}

	result, err := ApplyRuntimeTransition(plan, testEntities(), definitionMap(definition), nil, snapshot)
	if err != nil {
		t.Fatalf("apply empty resolved target: %v", err)
	}
	if len(result.ScalarApplications) != 0 || len(result.ChangedEntityIDs) != 0 {
		t.Fatalf("empty target mutated input overrides: %+v", result)
	}
}

func TestRuntimeTransitionUsesAuthoredDefaultAndKeepsSparseOverrides(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.DefaultValue = NewNumberMechanicValue(MustDecimal("5"))
	zero := MustDecimal("0")
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "adjust", Position: 0, Operation: EffectAdjustNumber,
		EntityIDs: []ID{"e1"}, MechanicID: definition.ID, AdjustmentAmount: &zero,
	}}}
	snapshot := RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
		"e1": {EntityID: "e1", Overrides: map[ID]MechanicValue{}},
	}}}

	result, err := ApplyRuntimeTransition(plan, testEntities(), definitionMap(definition), nil, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	application := result.ScalarApplications[0]
	if application.Before.Number.String() != "5" || application.After.Number.String() != "5" || application.Changed {
		t.Fatalf("authored-default no-op Application = %+v", application)
	}
	if len(result.InputOverrides.ByEntity["e1"].Overrides) != 0 || len(result.ChangedEntityIDs) != 0 {
		t.Fatalf("authored-default no-op was stored: %+v", result)
	}
}

func TestRuntimeTransitionSetsBooleanAndNormalizesAuthoredDefault(t *testing.T) {
	t.Parallel()
	definition := testBooleanDefinition()
	trueValue := NewBooleanMechanicValue(true)
	falseValue := NewBooleanMechanicValue(false)
	plan := TransitionPlan{Effects: []ConcreteEffect{
		{ID: "on", Position: 0, Operation: EffectSet, EntityIDs: []ID{"e1"}, MechanicID: definition.ID, Value: &trueValue},
		{ID: "off", Position: 1, Operation: EffectSet, EntityIDs: []ID{"e1"}, MechanicID: definition.ID, Value: &falseValue},
	}}
	snapshot := RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
		"e1": {EntityID: "e1", Overrides: map[ID]MechanicValue{}},
	}}}

	result, err := ApplyRuntimeTransition(plan, testEntities(), definitionMap(definition), nil, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.InputOverrides.ByEntity["e1"].Overrides) != 0 {
		t.Fatalf("final authored default should not be stored: %+v", result.InputOverrides)
	}
	if !result.ScalarApplications[0].Changed || !result.ScalarApplications[1].Changed {
		t.Fatalf("both stored override transitions should be recorded as changes: %+v", result.ScalarApplications)
	}
}

func TestRuntimeTransitionPlanAndMissingInputOverridesUseDistinctErrorKinds(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	amount := MustDecimal("1")
	invalid := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "adjust", Position: 0, Operation: EffectAdjustNumber,
		EntityIDs: []ID{"e1"}, MechanicID: "missing", AdjustmentAmount: &amount,
	}}}
	if _, err := ApplyRuntimeTransition(
		invalid, testEntities(), definitionMap(definition), nil,
		RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{}},
	); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("invalid plan error = %v", err)
	}

	valid := invalid
	valid.Effects[0].MechanicID = definition.ID
	if _, err := ApplyRuntimeTransition(
		valid, testEntities(), definitionMap(definition), nil,
		RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{}}},
	); !errors.Is(err, ErrInvalidRuntimeSnapshot) {
		t.Fatalf("missing record error = %v", err)
	}
}

func TestRuntimeTransitionAppliesDistinctInlineStatusesAndRemovesExactInstance(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "10")
	modifier := StatusModifier{
		ID: "boost-score", Position: 0, MechanicID: score.ID,
		Operation: ModifierAddNumber, Value: NewNumberMechanicValue(MustDecimal("2")),
	}
	first := applyStatusEffectPlanItem("first-effect", 0, "first-instance", modifier)
	second := applyStatusEffectPlanItem("second-effect", 1, "second-instance", modifier)
	remove := ConcreteEffect{
		ID: "remove-effect", Position: 2, Operation: EffectRemoveStatus, EntityIDs: []ID{"e1"},
		StatusInstanceIDs: map[ID]ID{"e1": "first-instance"},
	}
	inlineStatuses := map[ID]InlineStatus{first.ID: *first.InlineStatus, second.ID: *second.InlineStatus}
	snapshot := RuntimeSnapshot{InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
		"e1": {EntityID: "e1", Overrides: map[ID]MechanicValue{}},
	}}}

	result, err := ApplyRuntimeTransition(
		TransitionPlan{Effects: []ConcreteEffect{remove, second, first}},
		testEntities(), definitionMap(score), inlineStatuses, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.StatusInstances) != 1 || result.StatusInstances[0].ID != "second-instance" {
		t.Fatalf("status instances = %+v, want only second instance", result.StatusInstances)
	}
	if len(result.StatusApplications) != 3 {
		t.Fatalf("Status Applications = %+v", result.StatusApplications)
	}
	if result.StatusApplications[2].StatusInstanceID != "first-instance" || !result.StatusApplications[2].Changed {
		t.Fatalf("remove Application = %+v", result.StatusApplications[2])
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
		InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
			"e1": {EntityID: "e1", Overrides: map[ID]MechanicValue{}},
		}},
		StatusInstances: []StatusInstance{{
			ID: "active", WorldID: "world", EntityID: "e1", SourceEffectID: "source", AppliedOrder: 1,
		}},
	}
	_, err := ApplyRuntimeTransition(
		TransitionPlan{Effects: []ConcreteEffect{remove}}, testEntities(), definitionMap(score),
		map[ID]InlineStatus{"source": {ID: "source", WorldID: "world"}}, snapshot,
	)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
}

func TestRuntimeTransitionFailureIsAtomicAcrossStatusAndScalarOverrides(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "0")
	score.Maximum = decimalPointer(MustDecimal("3"))
	modifier := StatusModifier{
		ID: "boost-score", Position: 0, MechanicID: score.ID,
		Operation: ModifierAddNumber, Value: NewNumberMechanicValue(MustDecimal("2")),
	}
	apply := applyStatusEffectPlanItem("apply-first", 0, "new-active", modifier)
	plusOne := MustDecimal("1")
	plan := TransitionPlan{Effects: []ConcreteEffect{
		apply,
		{ID: "fail-later", Position: 1, Operation: EffectAdjustNumber, EntityIDs: []ID{"e1"}, MechanicID: score.ID, AdjustmentAmount: &plusOne},
	}}
	snapshot := RuntimeSnapshot{
		InputOverrides:  InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{"e1": numberOverrideRecord("e1", score.ID, "3")}},
		StatusInstances: []StatusInstance{},
	}

	result, err := ApplyRuntimeTransition(
		plan, testEntities(), definitionMap(score), map[ID]InlineStatus{apply.ID: *apply.InlineStatus}, snapshot,
	)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
	if result.InputOverrides.ByEntity != nil || result.StatusInstances != nil || result.StatusApplications != nil {
		t.Fatalf("partial runtime result escaped: %+v", result)
	}
	if got := snapshot.InputOverrides.ByEntity["e1"].Overrides[score.ID].Number.String(); got != "3" {
		t.Fatalf("caller-owned input override changed to %s", got)
	}
}

func TestRuntimeTransitionRejectsDirectDerivedMutationAndMismatchedInlineInstance(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("base", "1")
	derived := namedDerived("derived", ValueNumber, mechanicReference(base.ID))
	setValue := NewNumberMechanicValue(MustDecimal("2"))
	modifier := StatusModifier{
		ID: "boost-derived", Position: 0, MechanicID: derived.ID,
		Operation: ModifierAddNumber, Value: NewNumberMechanicValue(MustDecimal("1")),
	}
	apply := applyStatusEffectPlanItem("bad-apply", 1, "bad", modifier)
	bad := apply.StatusInstances["e1"]
	bad.EntityID = "e2"
	apply.StatusInstances["e1"] = bad
	plan := TransitionPlan{Effects: []ConcreteEffect{
		{ID: "set-derived", Position: 0, Operation: EffectSet, EntityIDs: []ID{"e1"}, MechanicID: derived.ID, Value: &setValue},
		apply,
	}}
	errs := ValidateRuntimeTransitionPlan(
		plan, testEntities(), definitionMap(base, derived), map[ID]InlineStatus{apply.ID: *apply.InlineStatus},
	)
	if !hasValidationAt(errs, "derived_mechanic", "effects[0].mechanic_id") {
		t.Fatalf("derived target errors = %v", errs)
	}
	if !hasValidationAt(errs, "entity_mismatch", "effects[1].status_instances[e1].entity_id") {
		t.Fatalf("status instance errors = %v", errs)
	}
}

func TestMECV05DerivedMechanicHasNoStoredOverrideAndIsRejectedByEffects(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("base", "1")
	derived := namedDerived("derived", ValueNumber, mechanicReference(base.ID))

	invalidDefinition := derived
	invalidDefinition.DefaultValue = NewNumberMechanicValue(MustDecimal("2"))
	invalidDefinition.Minimum = decimalPointer(MustDecimal("0"))
	invalidDefinition.Mutable = true
	definitionErrors := ValidateMechanicDefinition(invalidDefinition)
	if !hasValidationAt(definitionErrors, "invalid_source", "default_value") ||
		!hasValidationAt(definitionErrors, "invalid_source", "source_kind") ||
		!hasValidationAt(definitionErrors, "invalid_source", "mutable") {
		t.Fatalf("MEC-V05 derived definition errors = %v", definitionErrors)
	}

	stored := InputOverrideRecord{EntityID: "e1", Overrides: map[ID]MechanicValue{
		derived.ID: NewNumberMechanicValue(MustDecimal("2")),
	}}
	overrideErrors := ValidateInputOverrideRecord(stored, testEntities()["e1"], definitionMap(base, derived))
	if !hasValidationAt(overrideErrors, "derived_mechanic_override", "overrides[derived]") {
		t.Fatalf("MEC-V05 derived stored override errors = %v", overrideErrors)
	}
	logical := MaterializeLogicalState(
		testEntities()["e1"],
		InputOverrideRecord{EntityID: "e1", Overrides: map[ID]MechanicValue{}},
		definitionMap(base, derived),
	)
	if _, writable := logical.InputValues[derived.ID]; writable {
		t.Fatalf("MEC-V05 derived mechanic leaked into logical input values: %+v", logical)
	}

	setValue := NewNumberMechanicValue(MustDecimal("3"))
	plan := TransitionPlan{Effects: []ConcreteEffect{{
		ID: "set-derived", Position: 0, Operation: EffectSet,
		EntityIDs: []ID{"e1"}, MechanicID: derived.ID, Value: &setValue,
	}}}
	errs := ValidateRuntimeTransitionPlan(
		plan, testEntities(), definitionMap(base, derived), nil,
	)
	if !hasValidationAt(errs, "derived_mechanic", "effects[0].mechanic_id") {
		t.Fatalf("MEC-V05 derived effect errors = %v", errs)
	}
	snapshot := RuntimeSnapshot{
		InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
			"e1": numberOverrideRecord("e1", base.ID, "1"),
		}},
		StatusInstances: []StatusInstance{},
	}
	result, err := ApplyRuntimeTransition(
		plan, testEntities(), definitionMap(base, derived), nil, snapshot,
	)
	if !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("MEC-V05 effect error = %v, want ErrInvalidTransition", err)
	}
	if result.InputOverrides.ByEntity != nil || result.StatusInstances != nil || result.ScalarApplications != nil {
		t.Fatalf("MEC-V05 partial transition result escaped: %+v", result)
	}
	if got := snapshot.InputOverrides.ByEntity["e1"].Overrides[base.ID].Number.String(); got != "1" {
		t.Fatalf("MEC-V05 caller-owned input changed to %s", got)
	}
}

func TestCONV02DerivedImmutableAndArchivedMechanicsRejectScalarEffects(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("base", "1")
	derived := namedDerived("derived", ValueNumber, mechanicReference(base.ID))
	immutable := namedNumberInput("immutable", "1")
	immutable.Mutable = false
	archived := namedNumberInput("archived", "1")
	archived.Archived = true
	mechanics := definitionMap(base, derived, immutable, archived)
	setValue := NewNumberMechanicValue(MustDecimal("2"))
	snapshot := RuntimeSnapshot{
		InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
			"e1": numberOverrideRecord("e1", base.ID, "1"),
		}},
		StatusInstances: []StatusInstance{},
	}

	cases := []struct {
		name string
		id   ID
		code string
	}{
		{name: "derived", id: derived.ID, code: "derived_mechanic"},
		{name: "immutable", id: immutable.ID, code: "mechanic_not_mutable"},
		{name: "archived", id: archived.ID, code: "archived_mechanic"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			plan := TransitionPlan{Effects: []ConcreteEffect{{
				ID: "rejected-" + testCase.id, Position: 0, Operation: EffectSet,
				EntityIDs: []ID{"e1"}, MechanicID: testCase.id, Value: &setValue,
			}}}
			errs := ValidateRuntimeTransitionPlan(plan, testEntities(), mechanics, nil)
			if !hasValidationAt(errs, testCase.code, "effects[0].mechanic_id") {
				t.Fatalf("CON-V02 %s errors = %v", testCase.name, errs)
			}
			result, err := ApplyRuntimeTransition(plan, testEntities(), mechanics, nil, snapshot)
			if !errors.Is(err, ErrInvalidTransition) {
				t.Fatalf("CON-V02 %s error = %v, want ErrInvalidTransition", testCase.name, err)
			}
			if result.InputOverrides.ByEntity != nil || result.StatusInstances != nil || result.ScalarApplications != nil {
				t.Fatalf("CON-V02 %s partial result escaped: %+v", testCase.name, result)
			}
			if got := snapshot.InputOverrides.ByEntity["e1"].Overrides[base.ID].Number.String(); got != "1" {
				t.Fatalf("CON-V02 %s changed caller input overrides to %s", testCase.name, got)
			}
		})
	}
}

func TestCONV03InvalidStatusModifiersProduceNoRuntimeTransition(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "1")
	mechanics := definitionMap(score)
	snapshot := RuntimeSnapshot{
		InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
			"e1": numberOverrideRecord("e1", score.ID, "1"),
		}},
		StatusInstances: []StatusInstance{},
	}

	cases := []struct {
		name     string
		modifier StatusModifier
		code     string
		path     string
	}{
		{
			name: "incompatible operand",
			modifier: StatusModifier{
				ID: "bad-kind", Position: 0, MechanicID: score.ID,
				Operation: ModifierAddNumber, Value: NewBooleanMechanicValue(true),
			},
			code: "value_kind_mismatch", path: "modifiers[0].value.kind",
		},
		{
			name: "unknown target",
			modifier: StatusModifier{
				ID: "bad-target", Position: 0, MechanicID: "unknown",
				Operation: ModifierAddNumber, Value: NewNumberMechanicValue(MustDecimal("1")),
			},
			code: "unknown_mechanic", path: "modifiers[0].mechanic_id",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			effect := applyStatusEffectPlanItem(
				"invalid-status", 0, "never-active", testCase.modifier,
			)
			statuses := map[ID]InlineStatus{effect.ID: *effect.InlineStatus}
			errs := ValidateInlineStatuses(statuses, mechanics)
			if !hasValidationAt(
				errs,
				testCase.code,
				"statuses[invalid-status]."+testCase.path,
			) {
				t.Fatalf("CON-V03 %s errors = %v", testCase.name, errs)
			}
			result, err := ApplyRuntimeTransition(
				TransitionPlan{Effects: []ConcreteEffect{effect}},
				testEntities(), mechanics, statuses, snapshot,
			)
			if !errors.Is(err, ErrInvalidDefinition) {
				t.Fatalf("CON-V03 %s error = %v, want ErrInvalidDefinition", testCase.name, err)
			}
			if result.InputOverrides.ByEntity != nil || result.StatusInstances != nil ||
				result.ScalarApplications != nil || result.StatusApplications != nil {
				t.Fatalf("CON-V03 %s partial result escaped: %+v", testCase.name, result)
			}
			if got := snapshot.InputOverrides.ByEntity["e1"].Overrides[score.ID].Number.String(); got != "1" {
				t.Fatalf("CON-V03 %s changed caller input overrides to %s", testCase.name, got)
			}
		})
	}
}

func TestRuntimeTransitionAutoAssignsAppliedOrderInAuthoredSequence(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "0")
	modifier := StatusModifier{
		ID: "modifier", Position: 0, MechanicID: score.ID,
		Operation: ModifierAddNumber, Value: NewNumberMechanicValue(MustDecimal("1")),
	}
	first := applyStatusEffectPlanItem("first-effect", 0, "first-active", modifier)
	second := applyStatusEffectPlanItem("second-effect", 1, "second-active", modifier)
	inlineStatuses := map[ID]InlineStatus{
		"existing": {ID: "existing", WorldID: "world"},
		first.ID:   *first.InlineStatus,
		second.ID:  *second.InlineStatus,
	}
	snapshot := RuntimeSnapshot{
		InputOverrides: InputOverrideSnapshot{ByEntity: map[ID]InputOverrideRecord{
			"e1": {EntityID: "e1", Overrides: map[ID]MechanicValue{}},
		}},
		StatusInstances: []StatusInstance{{
			ID: "existing-active", WorldID: "world", EntityID: "e1",
			SourceEffectID: "existing", AppliedOrder: 50,
		}},
	}
	result, err := ApplyRuntimeTransition(
		TransitionPlan{Effects: []ConcreteEffect{second, first}}, testEntities(), definitionMap(score), inlineStatuses, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	orders := map[ID]int64{}
	for _, status := range result.StatusInstances {
		orders[status.ID] = status.AppliedOrder
	}
	if orders["existing-active"] != 50 || orders["first-active"] != 51 || orders["second-active"] != 52 {
		t.Fatalf("assigned applied orders = %v", orders)
	}
	if first.StatusInstances["e1"].AppliedOrder != 0 || second.StatusInstances["e1"].AppliedOrder != 0 {
		t.Fatalf("caller-owned transition plan mutated")
	}
}
