package rules

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

func TestMechanicGraphInfersTypesAndReportsConcreteExpressionPaths(t *testing.T) {
	t.Parallel()
	strength := namedNumberInput("strength", "10")
	flag := namedBooleanInput("flag", false)
	attack := namedDerived("attack", ValueNumber, Expression{
		Operation: ExpressionAddNumber,
		Operands: []Expression{
			mechanicReference(strength.ID),
			mechanicReference(flag.ID),
		},
	})
	definitions := definitionMap(strength, flag, attack)

	kind, errs := InferExpressionType(*attack.Expression, attack, definitions)
	if kind != ValueNumber {
		t.Fatalf("inferred kind = %q, want number", kind)
	}
	if !hasValidationAt(errs, "expression_type_mismatch", "expression.operands[1]") {
		t.Fatalf("type errors = %v, want concrete second-operand path", errs)
	}
	errGraph := ValidateMechanicGraph(definitions)
	if !hasValidationAt(errGraph, "expression_type_mismatch", "mechanics[attack].expression.operands[1]") {
		t.Fatalf("graph errors = %v, want graph-qualified operand path", errGraph)
	}

	other := namedNumberInput("other", "1")
	other.WorldID = "another-world"
	attack.Expression = expressionPointer(mechanicReference(other.ID))
	definitions = definitionMap(strength, attack, other)
	errGraph = ValidateMechanicGraph(definitions)
	if !hasValidationAt(errGraph, "cross_world_reference", "mechanics[attack].expression.mechanic_id") {
		t.Fatalf("cross-world errors = %v", errGraph)
	}
}

func TestMechanicGraphRejectsSelfAndMultiNodeCyclesWithPaths(t *testing.T) {
	t.Parallel()
	self := namedDerived("self", ValueNumber, mechanicReference("self"))
	errs := ValidateMechanicGraph(definitionMap(self))
	if !hasValidationMessage(errs, "dependency_cycle", "self -> self") {
		t.Fatalf("self-cycle errors = %v", errs)
	}
	if !hasValidationAt(errs, "dependency_cycle", "mechanics[self].expression.mechanic_id") {
		t.Fatalf("self-cycle path = %v", errs)
	}

	a := namedDerived("a", ValueNumber, mechanicReference("b"))
	b := namedDerived("b", ValueNumber, mechanicReference("c"))
	c := namedDerived("c", ValueNumber, mechanicReference("a"))
	errs = ValidateMechanicGraph(definitionMap(c, a, b))
	if !hasValidationMessage(errs, "dependency_cycle", "a -> b -> c -> a") {
		t.Fatalf("multi-cycle errors = %v", errs)
	}
	if _, err := CompileMechanicGraph(definitionMap(a, b, c)); !errors.Is(err, ErrInvalidDefinition) {
		t.Fatalf("CompileMechanicGraph cycle error = %v, want ErrInvalidDefinition", err)
	}
}

func TestEvaluationDefensivelyRejectsRuntimeCycleInCompiledGraph(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("base", "1")
	a := namedDerived("a", ValueNumber, mechanicReference(base.ID))
	b := namedDerived("b", ValueNumber, mechanicReference(a.ID))
	graph, err := CompileMechanicGraph(definitionMap(base, a, b))
	if err != nil {
		t.Fatal(err)
	}
	// Simulate corrupted configuration after compilation. The normal public
	// construction path cannot do this because graph definitions are private.
	corrupted := graph.definitions[a.ID]
	corrupted.Expression = expressionPointer(mechanicReference(b.ID))
	graph.definitions[a.ID] = corrupted
	result, err := EvaluateEntityStateWithGraph(
		testEntities()["e1"],
		StateRecord{EntityID: "e1", Values: map[ID]StateValue{}},
		graph, nil, nil,
	)
	if !errors.Is(err, ErrEvaluation) || !strings.Contains(err.Error(), "a -> b -> a") {
		t.Fatalf("runtime cycle error = %v", err)
	}
	if result.Values != nil {
		t.Fatalf("runtime cycle returned partial values: %+v", result)
	}
}

func TestCompiledMechanicGraphIsDependencyFirstAndDeterministic(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("z-base", "4")
	middle := namedDerived("m-middle", ValueNumber, Expression{
		Operation: ExpressionMultiplyNumber,
		Operands:  []Expression{mechanicReference(base.ID), numberLiteral("2")},
	})
	top := namedDerived("a-top", ValueNumber, Expression{
		Operation: ExpressionMaxNumber,
		Operands: []Expression{
			mechanicReference(middle.ID),
			Expression{Operation: ExpressionNegateNumber, Operands: []Expression{numberLiteral("-10")}},
		},
	})
	graph, err := CompileMechanicGraph(definitionMap(top, base, middle))
	if err != nil {
		t.Fatal(err)
	}
	want := []ID{"z-base", "m-middle", "a-top"}
	if !equalIDs(graph.Order, want) {
		t.Fatalf("graph order = %v, want %v", graph.Order, want)
	}
	if !equalIDs(graph.Dependencies[top.ID], []ID{middle.ID}) {
		t.Fatalf("top dependencies = %v", graph.Dependencies[top.ID])
	}
	// Exported metadata is descriptive; mutating it cannot corrupt the private
	// compiled evaluation plan.
	graph.Order = []ID{top.ID}

	result, err := EvaluateEntityStateWithGraph(
		testEntities()["e1"],
		StateRecord{EntityID: "e1", Values: map[ID]StateValue{}},
		graph,
		map[ID]StatusSnapshot{},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.Values[top.ID].Effective.Number.String(); got != "10" {
		t.Fatalf("top effective = %s, want 10", got)
	}
	if !equalIDs(result.Order, want) {
		t.Fatalf("evaluation order = %v, want immutable compiled order %v", result.Order, want)
	}
}

func TestEvaluationPropagatesInputModifiersThroughDerivedMechanics(t *testing.T) {
	t.Parallel()
	strength := namedNumberInput("strength", "10")
	attack := namedDerived("attack", ValueNumber, Expression{
		Operation: ExpressionAddNumber,
		Operands:  []Expression{mechanicReference(strength.ID), numberLiteral("2")},
	})
	statuses := map[ID]StatusSnapshot{
		"weakened": {
			ID: "weakened", WorldID: "world",
			Modifiers: []StatusModifier{{
				ID: "weak-strength", Position: 0, Priority: 0, MechanicID: strength.ID,
				Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("-2")),
			}},
		},
		"blessed": {
			ID: "blessed", WorldID: "world",
			Modifiers: []StatusModifier{{
				ID: "bless-attack", Position: 0, Priority: 0, MechanicID: attack.ID,
				Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("1")),
			}},
		},
	}
	active := []ActiveStatus{
		{ID: "active-blessed", WorldID: "world", EntityID: "e1", SourceEffectID: "blessed", AppliedOrder: 2},
		{ID: "active-weakened", WorldID: "world", EntityID: "e1", SourceEffectID: "weakened", AppliedOrder: 1},
	}
	result, err := EvaluateEntityState(
		testEntities()["e1"],
		StateRecord{EntityID: "e1", Revision: 4, Values: map[ID]StateValue{}},
		definitionMap(attack, strength),
		statuses,
		active,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.Values[strength.ID].Intrinsic.Number.String(); got != "10" {
		t.Fatalf("strength intrinsic = %s", got)
	}
	if got := result.Values[strength.ID].Effective.Number.String(); got != "8" {
		t.Fatalf("strength effective = %s", got)
	}
	if got := result.Values[attack.ID].Intrinsic.Number.String(); got != "10" {
		t.Fatalf("attack intrinsic = %s, want effective strength + 2", got)
	}
	if got := result.Values[attack.ID].Effective.Number.String(); got != "11" {
		t.Fatalf("attack effective = %s", got)
	}
	trace := result.Values[attack.ID].Expression
	if trace == nil || len(trace.Operands) != 2 || trace.Operands[0].Value.Number.String() != "8" {
		t.Fatalf("attack expression trace = %+v, want effective strength reference", trace)
	}
	modifier := result.Values[attack.ID].Modifiers[0]
	if modifier.StatusInstanceID != "active-blessed" || modifier.Before.Number.String() != "10" || modifier.After.Number.String() != "11" {
		t.Fatalf("attack modifier provenance = %+v", modifier)
	}
}

func TestEvaluationOrdersLiteralModifiersByPriorityAndStableInstanceOrder(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "10")
	statuses := map[ID]StatusSnapshot{
		"multiplier": {
			ID: "multiplier", WorldID: "world",
			Modifiers: []StatusModifier{{
				ID: "times-two", Position: 0, Priority: 0, MechanicID: score.ID,
				Operation: ModifierMultiplyNumber, Value: NewNumberValue(MustDecimal("2")),
			}},
		},
		"setter": {
			ID: "setter", WorldID: "world",
			// Deliberately supplied out of slice order: authored Position remains
			// the deterministic tie-break within an active status.
			Modifiers: []StatusModifier{
				{ID: "plus-three", Position: 1, Priority: 10, MechanicID: score.ID, Operation: ModifierAddNumber, Value: NewNumberValue(MustDecimal("3"))},
				{ID: "set-five", Position: 0, Priority: 0, MechanicID: score.ID, Operation: ModifierSet, Value: NewNumberValue(MustDecimal("5"))},
			},
		},
	}
	active := []ActiveStatus{
		// Deliberately reverse slice order. Equal-priority modifiers use durable
		// application order, not input query order.
		{ID: "a-multiplier", WorldID: "world", EntityID: "e1", SourceEffectID: "multiplier", AppliedOrder: 9},
		{ID: "z-setter", WorldID: "world", EntityID: "e1", SourceEffectID: "setter", AppliedOrder: 2},
	}
	result, err := EvaluateEntityState(
		testEntities()["e1"],
		StateRecord{EntityID: "e1", Values: map[ID]StateValue{}},
		definitionMap(score), statuses, active,
	)
	if err != nil {
		t.Fatal(err)
	}
	evaluated := result.Values[score.ID]
	if got := evaluated.Effective.Number.String(); got != "13" {
		t.Fatalf("effective score = %s, want ((5 * 2) + 3) = 13", got)
	}
	wantOrder := []ID{"set-five", "times-two", "plus-three"}
	actualOrder := make([]ID, len(evaluated.Modifiers))
	for index, application := range evaluated.Modifiers {
		actualOrder[index] = application.ModifierID
	}
	if !equalIDs(actualOrder, wantOrder) {
		t.Fatalf("modifier order = %v, want %v", actualOrder, wantOrder)
	}
	if evaluated.Modifiers[0].Before.Number.String() != "10" || evaluated.Modifiers[1].Before.Number.String() != "5" || evaluated.Modifiers[2].Before.Number.String() != "10" {
		t.Fatalf("modifier breakdown = %+v", evaluated.Modifiers)
	}
}

func TestExpressionEvaluationSupportsExactArithmeticBooleanAndConditionalOperators(t *testing.T) {
	t.Parallel()
	base := namedNumberInput("base", "1.25")
	selected := namedDerived("selected", ValueNumber, Expression{
		Operation: ExpressionIf,
		Operands: []Expression{
			{Operation: ExpressionGreaterOrEqualNumber, Operands: []Expression{mechanicReference(base.ID), numberLiteral("1")}},
			{Operation: ExpressionSubtractNumber, Operands: []Expression{
				{Operation: ExpressionMultiplyNumber, Operands: []Expression{mechanicReference(base.ID), numberLiteral("0.2")}},
				numberLiteral("0.05"),
			}},
			{Operation: ExpressionMinNumber, Operands: []Expression{numberLiteral("99"), numberLiteral("100")}},
		},
	})
	truth := namedDerived("truth", ValueBoolean, Expression{
		Operation: ExpressionAnd,
		Operands: []Expression{
			{Operation: ExpressionEqual, Operands: []Expression{mechanicReference(selected.ID), numberLiteral("0.2")}},
			{Operation: ExpressionNot, Operands: []Expression{{Operation: ExpressionLiteral, Literal: stateValuePointer(NewBooleanValue(false))}}},
		},
	})
	result, err := EvaluateEntityState(
		testEntities()["e1"],
		StateRecord{EntityID: "e1", Values: map[ID]StateValue{}},
		definitionMap(truth, selected, base), nil, nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := result.Values[selected.ID].Effective.Number.String(); got != "0.2" {
		t.Fatalf("selected = %s, want exact 0.2", got)
	}
	if got := *result.Values[truth.ID].Effective.Boolean; !got {
		t.Fatal("truth = false, want true")
	}
}

func TestEvaluationFailureReturnsNoPartialValues(t *testing.T) {
	t.Parallel()
	score := namedNumberInput("score", "10")
	invalid := StatusSnapshot{
		ID: "invalid", WorldID: "world",
		Modifiers: []StatusModifier{{
			ID: "bad", Position: 0, MechanicID: score.ID,
			Operation: ModifierAddNumber, Value: NewBooleanValue(true),
		}},
	}
	result, err := EvaluateEntityState(
		testEntities()["e1"],
		StateRecord{EntityID: "e1", Values: map[ID]StateValue{}},
		definitionMap(score),
		map[ID]StatusSnapshot{invalid.ID: invalid},
		[]ActiveStatus{{ID: "active", WorldID: "world", EntityID: "e1", SourceEffectID: invalid.ID}},
	)
	if !errors.Is(err, ErrInvalidDefinition) {
		t.Fatalf("error = %v, want ErrInvalidDefinition", err)
	}
	if result.Values != nil || result.EntityID.Valid() {
		t.Fatalf("partial evaluation escaped on failure: %+v", result)
	}
}

func namedNumberInput(id ID, defaultValue string) MechanicDefinition {
	return MechanicDefinition{
		ID: id, WorldID: "world", SourceKind: SourceInput, ValueKind: ValueNumber,
		DefaultValue: NewNumberValue(MustDecimal(defaultValue)), Mutable: true,
	}
}

func namedBooleanInput(id ID, defaultValue bool) MechanicDefinition {
	return MechanicDefinition{
		ID: id, WorldID: "world", SourceKind: SourceInput, ValueKind: ValueBoolean,
		DefaultValue: NewBooleanValue(defaultValue), Mutable: true,
	}
}

func namedDerived(id ID, kind ValueKind, expression Expression) MechanicDefinition {
	return MechanicDefinition{
		ID: id, WorldID: "world", SourceKind: SourceDerived, ValueKind: kind,
		Expression: expressionPointer(expression),
	}
}

func definitionMap(definitions ...MechanicDefinition) map[ID]MechanicDefinition {
	result := make(map[ID]MechanicDefinition, len(definitions))
	for _, definition := range definitions {
		result[definition.ID] = definition
	}
	return result
}

func mechanicReference(mechanicID ID) Expression {
	return Expression{Operation: ExpressionMechanicReference, MechanicID: mechanicID}
}

func numberLiteral(value string) Expression {
	literal := NewNumberValue(MustDecimal(value))
	return Expression{Operation: ExpressionLiteral, Literal: &literal}
}

func expressionPointer(expression Expression) *Expression {
	return &expression
}

func stateValuePointer(value StateValue) *StateValue {
	return &value
}

func equalIDs(left, right []ID) bool {
	return slices.Equal(left, right)
}

func hasValidationAt(errs ValidationErrors, code, path string) bool {
	for _, item := range errs {
		if item.Code == code && item.Path == path {
			return true
		}
	}
	return false
}

func hasValidationMessage(errs ValidationErrors, code, fragment string) bool {
	for _, item := range errs {
		if item.Code == code && strings.Contains(item.Message, fragment) {
			return true
		}
	}
	return false
}
