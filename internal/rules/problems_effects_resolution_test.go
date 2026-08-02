package rules

import (
	"errors"
	"testing"
)

func TestInvocationAndTargetBindingValidation(t *testing.T) {
	t.Parallel()
	maximum := 1
	problem := ProblemDefinition{
		ID: "problem", RuleSetID: "rs", Key: "world.problem", Name: "Problem",
		Targets: []ProblemTargetDefinition{{
			ID: "subject", Key: "subject", Label: "Subject", Cardinality: CardinalityOne,
			MinimumBindings: 1, MaximumBindings: &maximum, BindingSource: BindingSupplied,
			RequiredOwnerSchemaIDs: []ID{"owner"},
		}},
	}
	condition := numberCondition(CardinalityOne, QuantifierSingle, 0, OperatorGreaterThan, "0")
	invocation := ConditionInvocation{
		ID: "invocation", ConditionSetID: condition.ID,
		Arguments: []ConditionInvocationArgument{{ParameterID: "parameter", TargetDefinitionID: "subject"}},
	}
	if errs := ValidateConditionInvocation(invocation, problem, condition); len(errs) != 0 {
		t.Fatalf("valid invocation rejected: %v", errs)
	}
	mapped, err := MapInvocationBindings(invocation, TargetBindings{"subject": {"e2"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(mapped["parameter"]) != 1 || mapped["parameter"][0] != "e2" {
		t.Fatalf("mapped bindings = %v", mapped)
	}

	instance := ProblemInstance{ID: "inst", RuleSetID: "rs", ProblemDefinitionID: problem.ID, Bindings: TargetBindings{"subject": {"e1"}}}
	if errs := ValidateTargetBindings(problem, instance, instance.Bindings, testEntities()); len(errs) != 0 {
		t.Fatalf("valid target bindings rejected: %v", errs)
	}
	bad := TargetBindings{"subject": {"inst"}}
	if errs := ValidateTargetBindings(problem, instance, bad, testEntities()); !hasValidationCode(errs, "ineligible_binding") {
		t.Fatalf("expected owner-schema rejection, got %v", errs)
	}
	bad = TargetBindings{"subject": {"e1", "e2"}}
	if errs := ValidateTargetBindings(problem, instance, bad, testEntities()); !hasValidationCode(errs, "too_many_bindings") {
		t.Fatalf("expected binding maximum rejection, got %v", errs)
	}
}

func TestProblemInstanceAutomaticBinding(t *testing.T) {
	t.Parallel()
	one := 1
	problem := ProblemDefinition{
		ID: "problem", RuleSetID: "rs", Key: "world.problem", Name: "Problem",
		InstanceOwnerSchemaIDs: []ID{"owner"},
		Targets: []ProblemTargetDefinition{{
			ID: "instance-target", Key: "instance", Label: "Instance", Cardinality: CardinalityOne,
			MinimumBindings: 1, MaximumBindings: &one, BindingSource: BindingProblemInstance,
			RequiredOwnerSchemaIDs: []ID{"owner"},
		}},
	}
	entities := testEntities()
	instanceEntity := entities["inst"]
	instanceEntity.OwnerSchemaIDs = []ID{"owner"}
	entities["inst"] = instanceEntity
	instance := ProblemInstance{
		ID: "inst", RuleSetID: "rs", ProblemDefinitionID: problem.ID,
		Bindings: TargetBindings{"instance-target": {"inst"}},
	}
	if errs := ValidateProblemInstance(problem, instance, entities); len(errs) != 0 {
		t.Fatalf("valid automatic instance binding rejected: %v", errs)
	}
	instance.Bindings["instance-target"] = []ID{"e1"}
	if errs := ValidateProblemInstance(problem, instance, entities); !hasValidationCode(errs, "invalid_instance_binding") {
		t.Fatalf("expected automatic binding rejection, got %v", errs)
	}
}

func TestOrderedEffectsTraverseBindingsAndObserveEarlierChanges(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definitions := map[ID]StateVariableDefinition{definition.ID: definition}
	problem := effectProblem(CardinalityMany)
	consequence := ConsequenceSet{ID: "consequence", Effects: []Effect{
		{ID: "second", Position: 1, Operation: EffectAdjustNumber, TargetDefinitionID: "subjects", StateVariableID: definition.ID, AdjustmentAmount: decimalPointer(MustDecimal("3"))},
		{ID: "first", Position: 0, Operation: EffectAdjustNumber, TargetDefinitionID: "subjects", StateVariableID: definition.ID, AdjustmentAmount: decimalPointer(MustDecimal("2"))},
	}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "1"),
		"e2": numberRecord("e2", definition.ID, "10"),
	}}
	updated, applied, changed, err := ApplyConsequence(
		consequence,
		problem,
		TargetBindings{"subjects": {"e2", "e1"}},
		testEntities(), definitions, snapshot,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := updated.Records["e1"].Values[definition.ID].Values[0].Number.String(); got != "6" {
		t.Fatalf("e1 score = %s, want 6", got)
	}
	if got := updated.Records["e2"].Values[definition.ID].Values[0].Number.String(); got != "15" {
		t.Fatalf("e2 score = %s, want 15", got)
	}
	if len(applied) != 4 || applied[0].EffectID != "first" || applied[0].EntityID != "e2" || applied[1].EntityID != "e1" || applied[2].EffectID != "second" {
		t.Fatalf("application order = %+v", applied)
	}
	if applied[2].Before.Values[0].Number.String() != "12" || applied[2].After.Values[0].Number.String() != "15" {
		t.Fatalf("later effect did not observe earlier state: %+v", applied[2])
	}
	if len(changed) != 2 || changed[0] != "e1" || changed[1] != "e2" {
		t.Fatalf("changed records = %v", changed)
	}
}

func TestEffectFailureIsAtomicAcrossEntities(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.NumberMaximum = decimalPointer(MustDecimal("3"))
	definitions := map[ID]StateVariableDefinition{definition.ID: definition}
	problem := effectProblem(CardinalityMany)
	consequence := ConsequenceSet{ID: "consequence", Effects: []Effect{{
		ID: "adjust", Operation: EffectAdjustNumber, TargetDefinitionID: "subjects", StateVariableID: definition.ID,
		AdjustmentAmount: decimalPointer(MustDecimal("1")),
	}}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "1"),
		"e2": numberRecord("e2", definition.ID, "3"),
	}}
	_, _, _, err := ApplyConsequence(consequence, problem, TargetBindings{"subjects": {"e1", "e2"}}, testEntities(), definitions, snapshot)
	if !errors.Is(err, ErrEffectApplication) {
		t.Fatalf("error = %v, want ErrEffectApplication", err)
	}
	if got := snapshot.Records["e1"].Values[definition.ID].Values[0].Number.String(); got != "1" {
		t.Fatalf("input snapshot was partially mutated: %s", got)
	}
}

func TestAddAndRemoveAreIdempotent(t *testing.T) {
	t.Parallel()
	definition := StateVariableDefinition{
		ID: "tags", RuleSetID: "rs", Key: "world.tags", Label: "Tags", OwnerSchemaIDs: []ID{"owner"},
		ValueKind: ValueText, Cardinality: CardinalityMany, MissingKind: MissingUnknown,
		AllowedEffectOperations: []EffectOperation{EffectAddValue, EffectRemoveValue},
	}
	problem := effectProblem(CardinalityMany)
	xOperand := NewSingleValue(NewTextValue("x"))
	yOperand := NewSingleValue(NewTextValue("y"))
	consequence := ConsequenceSet{ID: "consequence", Effects: []Effect{
		{ID: "add-existing", Position: 0, Operation: EffectAddValue, TargetDefinitionID: "subjects", StateVariableID: definition.ID, Operand: &xOperand},
		{ID: "remove-absent", Position: 1, Operation: EffectRemoveValue, TargetDefinitionID: "subjects", StateVariableID: definition.ID, Operand: &yOperand},
	}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": {OwnerEntityID: "e1", Values: map[ID]StateValue{definition.ID: NewManyValue(NewTextValue("x"))}},
	}}
	updated, applied, changed, err := ApplyConsequence(consequence, problem, TargetBindings{"subjects": {"e1"}}, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 0 || applied[0].Changed || applied[1].Changed {
		t.Fatalf("idempotent operations reported changes: changed=%v applied=%+v", changed, applied)
	}
	if !StateValuesEqual(updated.Records["e1"].Values[definition.ID], snapshot.Records["e1"].Values[definition.ID]) {
		t.Fatal("idempotent operations changed state")
	}
}

func TestClearRemovesPersistenceEvenWhenDefaultIsLogicallyEqual(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	defaultValue := NewSingleValue(NewNumberValue(MustDecimal("7")))
	definition.MissingKind = MissingDefault
	definition.DefaultValue = &defaultValue
	definition.OmitDefaultWhenStored = false
	problem := effectProblem(CardinalityOne)
	consequence := ConsequenceSet{ID: "consequence", Effects: []Effect{{
		ID: "clear", Operation: EffectClear, TargetDefinitionID: "subjects", StateVariableID: definition.ID,
	}}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "7"),
	}}
	updated, applied, changed, err := ApplyConsequence(consequence, problem, TargetBindings{"subjects": {"e1"}}, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, stored := updated.Records["e1"].Values[definition.ID]; stored {
		t.Fatal("clear left a persisted value")
	}
	if len(applied) != 1 || !applied[0].Changed || len(changed) != 1 {
		t.Fatalf("persistence change was not reported: applied=%+v changed=%v", applied, changed)
	}
	if !StateValuesEqual(*applied[0].Before, *applied[0].After) {
		t.Fatal("clear should reveal the logically equal default")
	}
}

func TestSetNormalizesOmittedDefault(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	defaultValue := NewSingleValue(NewNumberValue(MustDecimal("3")))
	definition.MissingKind = MissingDefault
	definition.DefaultValue = &defaultValue
	definition.OmitDefaultWhenStored = true
	problem := effectProblem(CardinalityOne)
	operand := CloneStateValue(defaultValue)
	consequence := ConsequenceSet{ID: "consequence", Effects: []Effect{{
		ID: "set-default", Operation: EffectSet, TargetDefinitionID: "subjects", StateVariableID: definition.ID, Operand: &operand,
	}}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": numberRecord("e1", definition.ID, "4"),
	}}
	updated, _, changed, err := ApplyConsequence(consequence, problem, TargetBindings{"subjects": {"e1"}}, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if _, stored := updated.Records["e1"].Values[definition.ID]; stored {
		t.Fatal("value equal to omitted default remained persisted")
	}
	if len(changed) != 1 || changed[0] != "e1" {
		t.Fatalf("changed records = %v", changed)
	}
}

func TestResolveChoiceMetUnmetUnknownAndUnavailable(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name            string
		initial         *string
		availability    bool
		expectedStatus  ResolutionStatus
		expectedOutcome ID
		expectedValue   string
	}{
		{name: "met", initial: stringPointer("1"), expectedStatus: ResolutionApplied, expectedOutcome: "met-outcome", expectedValue: "2"},
		{name: "unmet", initial: stringPointer("0"), expectedStatus: ResolutionApplied, expectedOutcome: "unmet-outcome", expectedValue: "0"},
		{name: "unknown", initial: nil, expectedStatus: ResolutionIncomplete},
		{name: "unavailable", initial: stringPointer("0"), availability: true, expectedStatus: ResolutionUnavailable},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			input := resolutionInput(test.initial, test.availability)
			result, err := ResolveChoice(input)
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != test.expectedStatus {
				t.Fatalf("status = %s, want %s", result.Status, test.expectedStatus)
			}
			if result.OutcomeID != test.expectedOutcome {
				t.Fatalf("outcome = %s, want %s", result.OutcomeID, test.expectedOutcome)
			}
			if test.expectedStatus == ResolutionApplied {
				got := result.State.Records["e1"].Values["score"].Values[0].Number.String()
				if got != test.expectedValue {
					t.Fatalf("resolved score = %s, want %s", got, test.expectedValue)
				}
			}
			if test.expectedStatus == ResolutionIncomplete && len(result.IncompleteEvaluations) != 1 {
				t.Fatalf("incomplete explanations = %+v", result.IncompleteEvaluations)
			}
		})
	}
}

func TestResolveChoiceAutomaticOutcome(t *testing.T) {
	t.Parallel()
	input := resolutionInput(stringPointer("1"), false)
	value := NewSingleValue(NewNumberValue(MustDecimal("3")))
	automatic := &ChoiceOutcome{
		ID: "automatic-outcome", Branch: OutcomeAutomatic, Label: "Automatic",
		Consequences: ConsequenceSet{ID: "automatic-consequence", Effects: []Effect{{
			ID: "automatic-effect", Operation: EffectSet, TargetDefinitionID: "subject", StateVariableID: "score", Operand: &value,
		}}},
	}
	input.Problem.Choices[0].Resolution = ChoiceResolution{Type: ResolutionAutomatic, Automatic: automatic}
	result, err := ResolveChoice(input)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != ResolutionApplied || result.OutcomeID != automatic.ID {
		t.Fatalf("automatic result = %+v", result)
	}
	if got := result.State.Records["e1"].Values["score"].Values[0].Number.String(); got != "3" {
		t.Fatalf("automatic score = %s", got)
	}
}

func TestResolveChoiceUnavailableDominatesUnknownAvailability(t *testing.T) {
	t.Parallel()
	input := resolutionInput(nil, false)
	one := 1
	secondTarget := ProblemTargetDefinition{
		ID: "definite-subject", Key: "definite-subject", Label: "Definite subject",
		Cardinality: CardinalityOne, MinimumBindings: 1, MaximumBindings: &one,
		BindingSource: BindingSupplied, RequiredOwnerSchemaIDs: []ID{"owner"}, Position: 1,
	}
	input.Problem.Targets = append(input.Problem.Targets, secondTarget)
	input.Problem.AvailableWhen = &ConditionInvocation{
		ID: "unknown-availability", ConditionSetID: "condition",
		Arguments: []ConditionInvocationArgument{{ParameterID: "parameter", TargetDefinitionID: "subject"}},
	}
	input.Problem.Choices[0].AvailableWhen = &ConditionInvocation{
		ID: "unmet-availability", ConditionSetID: "condition",
		Arguments: []ConditionInvocationArgument{{ParameterID: "parameter", TargetDefinitionID: secondTarget.ID}},
	}
	input.Instance.Bindings[secondTarget.ID] = []ID{"e2"}
	input.Bindings = input.Instance.Bindings
	input.Snapshot.Records["e2"] = numberRecord("e2", "score", "0")

	result, err := ResolveChoice(input)
	if err != nil {
		t.Fatalf("resolve choice: %v", err)
	}
	if result.Status != ResolutionUnavailable {
		t.Fatalf("status = %s, want %s", result.Status, ResolutionUnavailable)
	}
	if len(result.AvailabilityEvaluations) != 2 ||
		result.AvailabilityEvaluations[0].Status != ConditionUnknown ||
		result.AvailabilityEvaluations[1].Status != ConditionUnmet {
		t.Fatalf("availability evaluations = %+v", result.AvailabilityEvaluations)
	}
	if len(result.IncompleteEvaluations) != 0 {
		t.Fatalf("unavailable result carried incomplete evaluations: %+v", result.IncompleteEvaluations)
	}
}

func effectProblem(cardinality Cardinality) ProblemDefinition {
	minimum := 0
	var maximum *int
	if cardinality == CardinalityOne {
		minimum = 1
		value := 1
		maximum = &value
	}
	return ProblemDefinition{
		ID: "problem", RuleSetID: "rs", Key: "world.problem", Name: "Problem",
		Targets: []ProblemTargetDefinition{{
			ID: "subjects", Key: "subjects", Label: "Subjects", Cardinality: cardinality,
			MinimumBindings: minimum, MaximumBindings: maximum, BindingSource: BindingSupplied,
			RequiredOwnerSchemaIDs: []ID{"owner"},
		}},
	}
}

func resolutionInput(initial *string, availability bool) ResolutionInput {
	definition := testNumberDefinition()
	condition := numberCondition(CardinalityOne, QuantifierSingle, 0, OperatorGreaterThan, "0")
	one := 1
	target := ProblemTargetDefinition{
		ID: "subject", Key: "subject", Label: "Subject", Cardinality: CardinalityOne,
		MinimumBindings: 1, MaximumBindings: &one, BindingSource: BindingSupplied,
		RequiredOwnerSchemaIDs: []ID{"owner"},
	}
	invocation := func(id ID) *ConditionInvocation {
		return &ConditionInvocation{
			ID: id, ConditionSetID: condition.ID,
			Arguments: []ConditionInvocationArgument{{ParameterID: "parameter", TargetDefinitionID: target.ID}},
		}
	}
	metValue := NewSingleValue(NewNumberValue(MustDecimal("2")))
	unmetValue := NewSingleValue(NewNumberValue(MustDecimal("0")))
	choice := ChoiceDefinition{
		ID: "choice", Key: "choice", Name: "Choice",
		Resolution: ChoiceResolution{
			Type:       ResolutionCondition,
			Invocation: invocation("resolution-invocation"),
			Met: &ChoiceOutcome{
				ID: "met-outcome", Branch: OutcomeMet, Label: "Met",
				Consequences: ConsequenceSet{ID: "met-consequence", Effects: []Effect{{
					ID: "met-effect", Operation: EffectSet, TargetDefinitionID: target.ID, StateVariableID: definition.ID, Operand: &metValue,
				}},
				},
			},
			Unmet: &ChoiceOutcome{
				ID: "unmet-outcome", Branch: OutcomeUnmet, Label: "Unmet",
				Consequences: ConsequenceSet{ID: "unmet-consequence", Effects: []Effect{{
					ID: "unmet-effect", Operation: EffectSet, TargetDefinitionID: target.ID, StateVariableID: definition.ID, Operand: &unmetValue,
				}},
				},
			},
		},
	}
	if availability {
		choice.AvailableWhen = invocation("availability-invocation")
	}
	problem := ProblemDefinition{
		ID: "problem", RuleSetID: "rs", Key: "world.problem", Name: "Problem",
		Targets: []ProblemTargetDefinition{target}, Choices: []ChoiceDefinition{choice},
	}
	record := StateRecord{OwnerEntityID: "e1", Values: map[ID]StateValue{}}
	if initial != nil {
		record = numberRecord("e1", definition.ID, *initial)
	}
	instance := ProblemInstance{
		ID: "inst", RuleSetID: "rs", ProblemDefinitionID: problem.ID, BindingRevision: 4,
		Bindings: TargetBindings{target.ID: {"e1"}},
	}
	return ResolutionInput{
		Problem: problem, Instance: instance, ChoiceID: choice.ID,
		OwnerSchemas: testSchemas(), Entities: testEntities(),
		Definitions: map[ID]StateVariableDefinition{definition.ID: definition},
		Conditions:  map[ID]ConditionSet{condition.ID: condition},
		Bindings:    instance.Bindings,
		Snapshot:    StateSnapshot{Records: map[ID]StateRecord{"e1": record}},
	}
}

func stringPointer(value string) *string { return &value }
