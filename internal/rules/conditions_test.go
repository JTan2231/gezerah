package rules

import "testing"

func TestConditionValidationAndEvaluation(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definitions := map[ID]StateVariableDefinition{definition.ID: definition}
	condition := numberCondition(CardinalityOne, QuantifierSingle, 0, OperatorGreaterThan, "5")
	if errs := ValidateConditionSet(condition, testSchemas(), definitions); len(errs) != 0 {
		t.Fatalf("valid condition rejected: %v", errs)
	}

	tests := []struct {
		name     string
		record   StateRecord
		expected ConditionStatus
		missing  int
	}{
		{
			name:     "met",
			record:   numberRecord("e1", definition.ID, "6"),
			expected: ConditionMet,
		},
		{
			name:     "unmet",
			record:   numberRecord("e1", definition.ID, "5"),
			expected: ConditionUnmet,
		},
		{
			name:     "unknown",
			record:   StateRecord{OwnerEntityID: "e1", Values: map[ID]StateValue{}},
			expected: ConditionUnknown,
			missing:  1,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			evaluation, err := EvaluateCondition(
				condition,
				ParameterBindings{"parameter": {"e1"}},
				testEntities(),
				definitions,
				StateSnapshot{Records: map[ID]StateRecord{"e1": test.record}},
			)
			if err != nil {
				t.Fatal(err)
			}
			if evaluation.Status != test.expected {
				t.Fatalf("status = %s, want %s", evaluation.Status, test.expected)
			}
			if len(evaluation.MissingValues) != test.missing {
				t.Fatalf("missing = %v", evaluation.MissingValues)
			}
			if evaluation.Root.ExpressionID != "criterion" || evaluation.Root.ParameterID != "parameter" {
				t.Fatalf("explanation lost stable IDs: %+v", evaluation.Root)
			}
			if len(evaluation.Root.EntityResults) != 1 || evaluation.Root.EntityResults[0].EntityID != "e1" {
				t.Fatalf("entity explanations = %+v", evaluation.Root.EntityResults)
			}
		})
	}
}

func TestDefaultIsEvaluatedRatherThanUnknown(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	defaultValue := NewSingleValue(NewNumberValue(MustDecimal("8")))
	definition.MissingKind = MissingDefault
	definition.DefaultValue = &defaultValue
	condition := numberCondition(CardinalityOne, QuantifierSingle, 0, OperatorGreaterThan, "5")
	evaluation, err := EvaluateCondition(
		condition,
		ParameterBindings{"parameter": {"e1"}},
		testEntities(),
		map[ID]StateVariableDefinition{definition.ID: definition},
		StateSnapshot{Records: map[ID]StateRecord{"e1": {OwnerEntityID: "e1", Values: map[ID]StateValue{}}}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if evaluation.Status != ConditionMet || len(evaluation.MissingValues) != 0 {
		t.Fatalf("default evaluation = %+v", evaluation)
	}
}

func TestThreeValuedGroupTruthTables(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		typeName ExpressionType
		count    int
		values   []ConditionStatus
		expected ConditionStatus
	}{
		{"all met", ExpressionAll, 0, []ConditionStatus{ConditionMet, ConditionMet}, ConditionMet},
		{"all unknown", ExpressionAll, 0, []ConditionStatus{ConditionMet, ConditionUnknown}, ConditionUnknown},
		{"all unmet dominates", ExpressionAll, 0, []ConditionStatus{ConditionUnknown, ConditionUnmet}, ConditionUnmet},
		{"any unmet", ExpressionAny, 0, []ConditionStatus{ConditionUnmet, ConditionUnmet}, ConditionUnmet},
		{"any unknown", ExpressionAny, 0, []ConditionStatus{ConditionUnmet, ConditionUnknown}, ConditionUnknown},
		{"any met dominates", ExpressionAny, 0, []ConditionStatus{ConditionUnknown, ConditionMet}, ConditionMet},
		{"at least met", ExpressionAtLeast, 2, []ConditionStatus{ConditionMet, ConditionUnknown, ConditionMet}, ConditionMet},
		{"at least unknown", ExpressionAtLeast, 2, []ConditionStatus{ConditionMet, ConditionUnknown, ConditionUnmet}, ConditionUnknown},
		{"at least unmet", ExpressionAtLeast, 2, []ConditionStatus{ConditionMet, ConditionUnmet, ConditionUnmet}, ConditionUnmet},
	}
	for _, test := range tests {
		status, ok := CombineConditionStatuses(test.typeName, test.count, test.values)
		if !ok || status != test.expected {
			t.Errorf("%s: (%s, %v), want %s", test.name, status, ok, test.expected)
		}
	}
}

func TestPluralQuantifierSemanticsIncludingEmptyBindings(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		quantifier ConditionQuantifier
		count      int
		values     []ConditionStatus
		expected   ConditionStatus
	}{
		{"empty any", QuantifierAny, 0, nil, ConditionUnmet},
		{"empty all", QuantifierAll, 0, nil, ConditionMet},
		{"empty at least", QuantifierAtLeast, 1, nil, ConditionUnmet},
		{"any unknown", QuantifierAny, 0, []ConditionStatus{ConditionUnmet, ConditionUnknown}, ConditionUnknown},
		{"all unknown", QuantifierAll, 0, []ConditionStatus{ConditionMet, ConditionUnknown}, ConditionUnknown},
		{"at least potentially met", QuantifierAtLeast, 2, []ConditionStatus{ConditionMet, ConditionUnknown}, ConditionUnknown},
		{"at least impossible", QuantifierAtLeast, 2, []ConditionStatus{ConditionMet, ConditionUnmet}, ConditionUnmet},
	}
	for _, test := range tests {
		status, ok := combineQuantifiedStatuses(test.quantifier, test.count, test.values)
		if !ok || status != test.expected {
			t.Errorf("%s: (%s, %v), want %s", test.name, status, ok, test.expected)
		}
	}
}

func TestConditionEvaluationPreservesBindingOrderAndDeduplicatesMissing(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	condition := numberCondition(CardinalityMany, QuantifierAll, 0, OperatorGreaterThan, "0")
	secondCriterion := condition.Root
	secondCriterion.ID = "criterion-2"
	secondCriterion.Position = 1
	condition.Root = ConditionExpression{
		ID:       "root",
		Type:     ExpressionAll,
		Children: []ConditionExpression{condition.Root, secondCriterion},
	}
	bindings := ParameterBindings{"parameter": {"e2", "e1"}}
	snapshot := StateSnapshot{Records: map[ID]StateRecord{
		"e1": {OwnerEntityID: "e1", Values: map[ID]StateValue{}},
		"e2": {OwnerEntityID: "e2", Values: map[ID]StateValue{}},
	}}
	evaluation, err := EvaluateCondition(condition, bindings, testEntities(), map[ID]StateVariableDefinition{definition.ID: definition}, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if evaluation.Status != ConditionUnknown {
		t.Fatalf("status = %s", evaluation.Status)
	}
	if got := evaluation.Root.Children[0].EntityResults; len(got) != 2 || got[0].EntityID != "e2" || got[1].EntityID != "e1" {
		t.Fatalf("entity result order = %+v", got)
	}
	if len(evaluation.MissingValues) != 2 || evaluation.MissingValues[0].EntityID != "e1" || evaluation.MissingValues[1].EntityID != "e2" {
		t.Fatalf("deduplicated deterministic missing addresses = %+v", evaluation.MissingValues)
	}
}

func TestConditionValidationRejectsUnsupportedManyValuedStateAndOversizedTree(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.Cardinality = CardinalityMany
	condition := numberCondition(CardinalityOne, QuantifierSingle, 0, OperatorGreaterThan, "0")
	if errs := ValidateConditionSet(condition, testSchemas(), map[ID]StateVariableDefinition{definition.ID: definition}); !hasValidationCode(errs, "unsupported_state_cardinality") {
		t.Fatalf("expected many-state rejection, got %v", errs)
	}

	definition.Cardinality = CardinalityOne
	expression := condition.Root
	for depth := 0; depth < MaximumConditionDepth; depth++ {
		expression = ConditionExpression{ID: ID("group-" + string(rune('a'+depth))), Type: ExpressionAll, Children: []ConditionExpression{expression}}
	}
	condition.Root = expression
	if errs := ValidateConditionSet(condition, testSchemas(), map[ID]StateVariableDefinition{definition.ID: definition}); !hasValidationCode(errs, "condition_too_deep") {
		t.Fatalf("expected depth rejection, got %v", errs)
	}
}

func TestEveryInitialPredicateOperator(t *testing.T) {
	t.Parallel()
	number := NewSingleValue(NewNumberValue(MustDecimal("5")))
	boolean := NewSingleValue(NewBooleanValue(true))
	choice := NewSingleValue(NewChoiceValue("red"))
	five := MustDecimal("5")
	four := MustDecimal("4")
	six := MustDecimal("6")
	truth := true
	tests := []struct {
		name      string
		predicate Predicate
		value     StateValue
		expected  bool
	}{
		{"eq", Predicate{Kind: PredicateNumber, Operator: OperatorEqual, NumberValue: &five}, number, true},
		{"gt", Predicate{Kind: PredicateNumber, Operator: OperatorGreaterThan, NumberValue: &four}, number, true},
		{"gte", Predicate{Kind: PredicateNumber, Operator: OperatorGreaterThanOrEqual, NumberValue: &five}, number, true},
		{"lt", Predicate{Kind: PredicateNumber, Operator: OperatorLessThan, NumberValue: &six}, number, true},
		{"lte", Predicate{Kind: PredicateNumber, Operator: OperatorLessThanOrEqual, NumberValue: &five}, number, true},
		{"between", Predicate{Kind: PredicateNumberRange, Operator: OperatorBetween, Minimum: &four, Maximum: &six}, number, true},
		{"boolean is", Predicate{Kind: PredicateBoolean, Operator: OperatorIs, BooleanValue: &truth}, boolean, true},
		{"choice is", Predicate{Kind: PredicateChoice, Operator: OperatorIs, ChoiceOptionIDs: []ID{"red"}}, choice, true},
		{"choice one-of", Predicate{Kind: PredicateChoiceSet, Operator: OperatorOneOf, ChoiceOptionIDs: []ID{"blue", "red"}}, choice, true},
		{"choice misses", Predicate{Kind: PredicateChoiceSet, Operator: OperatorOneOf, ChoiceOptionIDs: []ID{"blue"}}, choice, false},
	}
	for _, test := range tests {
		actual, err := predicateMatches(test.predicate, test.value)
		if err != nil {
			t.Errorf("%s: %v", test.name, err)
			continue
		}
		if actual != test.expected {
			t.Errorf("%s = %t, want %t", test.name, actual, test.expected)
		}
	}
}

func numberCondition(parameterCardinality Cardinality, quantifier ConditionQuantifier, count int, operator PredicateOperator, operand string) ConditionSet {
	value := MustDecimal(operand)
	return ConditionSet{
		ID: "condition", RuleSetID: "rs", Key: "world.condition", Name: "Condition",
		Parameters: []ConditionParameter{{
			ID: "parameter", Key: "subject", Label: "Subject", Cardinality: parameterCardinality,
			RequiredOwnerSchemaIDs: []ID{"owner"}, Position: 0,
		}},
		Root: ConditionExpression{
			ID: "criterion", Type: ExpressionCriterion, Position: 0,
			Criterion: &ConditionCriterion{
				ParameterID: "parameter", Quantifier: quantifier, RequiredCount: count, StateVariableID: "score",
				Predicate: Predicate{Kind: PredicateNumber, Operator: operator, NumberValue: &value},
			},
		},
	}
}

func numberRecord(entityID, definitionID ID, value string) StateRecord {
	return StateRecord{
		OwnerEntityID: entityID,
		Values: map[ID]StateValue{
			definitionID: NewSingleValue(NewNumberValue(MustDecimal(value))),
		},
	}
}
