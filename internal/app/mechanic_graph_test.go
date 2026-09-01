package app

import (
	"errors"
	"testing"

	"github.com/JTan2231/gezerah/internal/rules"
)

func TestExpressionDTORoundTripPreservesTypedTreeAndExactNumbers(t *testing.T) {
	t.Parallel()
	number := decimalText("9007199254740993.125")
	input := expressionDTO{
		Operation: string(rules.ExpressionAddNumber),
		Operands: []expressionDTO{
			{Operation: string(rules.ExpressionMechanicReference), MechanicID: "11111111-1111-4111-8111-111111111111"},
			{Operation: string(rules.ExpressionLiteral), Value: &mechanicValueDTO{Kind: "number", Number: &number}},
		},
	}

	domain, err := expressionDTOToDomain(input)
	if err != nil {
		t.Fatal(err)
	}
	if got := domain.Operands[1].Literal.Number.String(); got != number.String() {
		t.Fatalf("literal = %s, want %s", got, number.String())
	}
	output := expressionDomainToDTO(domain)
	if output.Operation != input.Operation || len(output.Operands) != 2 {
		t.Fatalf("round trip shape = %+v", output)
	}
	if output.Operands[0].MechanicID != input.Operands[0].MechanicID {
		t.Fatalf("reference = %q", output.Operands[0].MechanicID)
	}
	if output.Operands[1].Value == nil || output.Operands[1].Value.Number == nil || output.Operands[1].Value.Number.String() != number.String() {
		t.Fatalf("round trip literal = %+v", output.Operands[1].Value)
	}
}

func TestValidateWorldMechanicRequestEnforcesDerivedShape(t *testing.T) {
	t.Parallel()
	defaultNumber := decimalText("2")
	minimum := decimalText("0")
	request := saveWorldMechanicRequest{
		Kind: "capacity", Mode: "score", SourceKind: "derived", Name: "Derived",
		DefaultNumber: &defaultNumber, Minimum: &minimum, MutableDuringPlay: true,
		Expression: &expressionDTO{Operation: string(rules.ExpressionLiteral), Value: &mechanicValueDTO{Kind: "number", Number: &defaultNumber}},
	}
	fields, _ := validateWorldMechanicRequest(
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		request,
	)
	for _, path := range []string{"default_number", "source_kind", "mutable_during_play"} {
		if fields[path] == "" {
			t.Errorf("missing %s validation: %v", path, fields)
		}
	}
}

func TestValidateWorldMechanicGraphReturnsCycleFields(t *testing.T) {
	t.Parallel()
	worldID := rules.ID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	leftID := rules.ID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
	rightID := rules.ID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
	leftExpression := rules.Expression{Operation: rules.ExpressionMechanicReference, MechanicID: rightID}
	rightExpression := rules.Expression{Operation: rules.ExpressionMechanicReference, MechanicID: leftID}
	definitions := map[rules.ID]rules.MechanicDefinition{
		leftID:  {ID: leftID, WorldID: worldID, SourceKind: rules.SourceDerived, ValueKind: rules.ValueNumber, Expression: &leftExpression},
		rightID: {ID: rightID, WorldID: worldID, SourceKind: rules.SourceDerived, ValueKind: rules.ValueNumber, Expression: &rightExpression},
	}
	err := validateWorldMechanicGraph(definitions)
	var status *statusError
	if !errors.As(err, &status) || status.Status != 422 {
		t.Fatalf("error = %#v", err)
	}
	var found bool
	for path, message := range status.Fields {
		if message != "" && path != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("cycle fields = %v", status.Fields)
	}
}

func TestBuildStoredExpressionUsesNormalizedOperandOrder(t *testing.T) {
	t.Parallel()
	root := storedExpressionNode{ID: "root", Operation: string(rules.ExpressionSubtractNumber), ValueKind: "number"}
	one := "1"
	two := "2"
	children := map[string][]storedExpressionNode{
		"root": {
			{ID: "right", ParentID: pointerString("root"), Position: 1, Operation: string(rules.ExpressionLiteral), ValueKind: "number", NumberValue: &two},
			{ID: "left", ParentID: pointerString("root"), Position: 0, Operation: string(rules.ExpressionLiteral), ValueKind: "number", NumberValue: &one},
		},
	}
	expression, err := buildStoredExpression(root, children, map[string]bool{}, map[string]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if got := expression.Operands[0].Literal.Number.String(); got != "1" {
		t.Fatalf("first operand = %s", got)
	}
	if got := expression.Operands[1].Literal.Number.String(); got != "2" {
		t.Fatalf("second operand = %s", got)
	}
}

func pointerString(value string) *string { return &value }
