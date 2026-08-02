package app

import (
	"encoding/json"
	"testing"

	"dnd/internal/rules"
)

func TestCriterionAtLeastCountBelongsToCriterion(t *testing.T) {
	t.Parallel()
	count := 2
	variableID := rules.ID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	expression, err := expressionDTOToDomain(conditionExpressionDTO{
		ID:              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		Type:            "criterion",
		Count:           &count,
		ParameterID:     "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		Quantifier:      "at-least",
		StateVariableID: string(variableID),
		Predicate: &predicateDTO{
			Kind: "number", Operator: "gte", Value: json.RawMessage("1"),
		},
	}, map[rules.ID]rules.StateVariableDefinition{
		variableID: {ID: variableID, ValueKind: rules.ValueNumber},
	}, 0)
	if err != nil {
		t.Fatalf("map expression: %v", err)
	}
	if expression.RequiredCount != 0 {
		t.Fatalf("expression required count = %d, want 0", expression.RequiredCount)
	}
	if expression.Criterion == nil || expression.Criterion.RequiredCount != count {
		t.Fatalf("criterion required count = %#v, want %d", expression.Criterion, count)
	}
}
