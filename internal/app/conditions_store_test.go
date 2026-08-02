package app

import (
	"errors"
	"net/http"
	"reflect"
	"testing"

	"dnd/internal/rules"
)

func TestArchivedConditionReferenceFieldsAllowsRetainedStableReferences(t *testing.T) {
	t.Parallel()
	current, schemas, definitions := archivedConditionReferenceFixture()
	proposed := current
	proposed.Parameters = append([]rules.ConditionParameter(nil), current.Parameters...)
	proposed.Parameters[0].Label = "Renamed parameter"
	proposed.Root.Criterion = cloneConditionCriterion(current.Root.Criterion)
	value := mustDecimal(t, "7")
	proposed.Root.Criterion.Predicate.NumberValue = &value

	if fields := archivedConditionReferenceFields(proposed, current, schemas, definitions); len(fields) != 0 {
		t.Fatalf("retained archived references rejected: %v", fields)
	}
}

func TestArchivedConditionReferenceFieldsRejectsNewAndRedirectedReferences(t *testing.T) {
	t.Parallel()
	current, schemas, definitions := archivedConditionReferenceFixture()
	const (
		archivedSchemaID   = rules.ID("10000000-0000-4000-8000-000000000002")
		activeSchemaID     = rules.ID("10000000-0000-4000-8000-000000000003")
		archivedVariableID = rules.ID("10000000-0000-4000-8000-000000000004")
		activeVariableID   = rules.ID("10000000-0000-4000-8000-000000000005")
		newParameterID     = rules.ID("10000000-0000-4000-8000-000000000007")
		newCriterionID     = rules.ID("10000000-0000-4000-8000-000000000009")
	)

	currentWithActiveSchema := current
	currentWithActiveSchema.Parameters = append([]rules.ConditionParameter(nil), current.Parameters...)
	currentWithActiveSchema.Parameters[0].RequiredOwnerSchemaIDs = []rules.ID{activeSchemaID}
	redirectedSchema := currentWithActiveSchema
	redirectedSchema.Parameters = append([]rules.ConditionParameter(nil), currentWithActiveSchema.Parameters...)
	redirectedSchema.Parameters[0].RequiredOwnerSchemaIDs = []rules.ID{activeSchemaID, archivedSchemaID}
	fields := archivedConditionReferenceFields(redirectedSchema, currentWithActiveSchema, schemas, definitions)
	if fields["parameters[0].required_owner_schema_ids[1]"] == "" {
		t.Fatalf("redirect to archived schema was accepted: %v", fields)
	}

	newParameter := current
	newParameter.Parameters = append(append([]rules.ConditionParameter(nil), current.Parameters...), rules.ConditionParameter{
		ID: newParameterID, RequiredOwnerSchemaIDs: []rules.ID{archivedSchemaID},
	})
	fields = archivedConditionReferenceFields(newParameter, current, schemas, definitions)
	if fields["parameters[1].required_owner_schema_ids[0]"] == "" {
		t.Fatalf("new archived-schema reference was accepted: %v", fields)
	}

	redirectedCriterion := current
	redirectedCriterion.Root.Criterion = cloneConditionCriterion(current.Root.Criterion)
	redirectedCriterion.Root.Criterion.StateVariableID = archivedVariableID
	currentWithActiveVariable := current
	currentWithActiveVariable.Root.Criterion = cloneConditionCriterion(current.Root.Criterion)
	currentWithActiveVariable.Root.Criterion.StateVariableID = activeVariableID
	fields = archivedConditionReferenceFields(redirectedCriterion, currentWithActiveVariable, schemas, definitions)
	if fields["root.state_variable_id"] == "" {
		t.Fatalf("redirect to archived variable was accepted: %v", fields)
	}

	newCriterion := current
	newCriterion.Root.ID = newCriterionID
	fields = archivedConditionReferenceFields(newCriterion, current, schemas, definitions)
	if fields["root.state_variable_id"] == "" {
		t.Fatalf("new archived-variable criterion was accepted: %v", fields)
	}
}

func TestArchivedConditionReferenceFieldsRejectsDuplicateDependencies(t *testing.T) {
	t.Parallel()
	current, schemas, definitions := archivedConditionReferenceFixture()
	duplicate, err := cloneConditionSet(current)
	if err != nil {
		t.Fatalf("clone condition set: %v", err)
	}
	fields := archivedConditionReferenceFields(duplicate, rules.ConditionSet{}, schemas, definitions)
	if fields["parameters[0].required_owner_schema_ids[0]"] == "" {
		t.Fatalf("duplicate archived-schema dependency was accepted: %v", fields)
	}
	if fields["root.state_variable_id"] == "" {
		t.Fatalf("duplicate archived-variable dependency was accepted: %v", fields)
	}
}

func TestUniqueConditionOwnerSchemaIDsAreSortedAndDeduplicated(t *testing.T) {
	t.Parallel()
	const (
		a = rules.ID("10000000-0000-4000-8000-000000000001")
		b = rules.ID("20000000-0000-4000-8000-000000000001")
		c = rules.ID("30000000-0000-4000-8000-000000000001")
	)
	set := rules.ConditionSet{Parameters: []rules.ConditionParameter{
		{RequiredOwnerSchemaIDs: []rules.ID{c, a}},
		{RequiredOwnerSchemaIDs: []rules.ID{b, a}},
	}}
	if got, want := uniqueConditionOwnerSchemaIDs(set), []rules.ID{a, b, c}; !reflect.DeepEqual(got, want) {
		t.Fatalf("schema lock order = %v, want %v", got, want)
	}
}

func archivedConditionReferenceFixture() (rules.ConditionSet, map[rules.ID]rules.OwnerSchema, map[rules.ID]rules.StateVariableDefinition) {
	const (
		ruleSetID          = rules.ID("10000000-0000-4000-8000-000000000001")
		archivedSchemaID   = rules.ID("10000000-0000-4000-8000-000000000002")
		activeSchemaID     = rules.ID("10000000-0000-4000-8000-000000000003")
		archivedVariableID = rules.ID("10000000-0000-4000-8000-000000000004")
		activeVariableID   = rules.ID("10000000-0000-4000-8000-000000000005")
		parameterID        = rules.ID("10000000-0000-4000-8000-000000000006")
		criterionID        = rules.ID("10000000-0000-4000-8000-000000000008")
	)
	value, _ := rules.ParseDecimal("1")
	set := rules.ConditionSet{
		ID: rules.ID("10000000-0000-4000-8000-00000000000a"), RuleSetID: ruleSetID,
		Parameters: []rules.ConditionParameter{{
			ID: parameterID, Label: "Subject", RequiredOwnerSchemaIDs: []rules.ID{archivedSchemaID},
		}},
		Root: rules.ConditionExpression{
			ID: criterionID, Type: rules.ExpressionCriterion,
			Criterion: &rules.ConditionCriterion{
				ParameterID: parameterID, StateVariableID: archivedVariableID,
				Predicate: rules.Predicate{Kind: rules.PredicateNumber, Operator: rules.OperatorEqual, NumberValue: &value},
			},
		},
	}
	schemas := map[rules.ID]rules.OwnerSchema{
		archivedSchemaID: {ID: archivedSchemaID, RuleSetID: ruleSetID, Archived: true},
		activeSchemaID:   {ID: activeSchemaID, RuleSetID: ruleSetID},
	}
	definitions := map[rules.ID]rules.StateVariableDefinition{
		archivedVariableID: {ID: archivedVariableID, RuleSetID: ruleSetID, Archived: true},
		activeVariableID:   {ID: activeVariableID, RuleSetID: ruleSetID},
	}
	return set, schemas, definitions
}

func cloneConditionCriterion(source *rules.ConditionCriterion) *rules.ConditionCriterion {
	if source == nil {
		return nil
	}
	clone := *source
	return &clone
}

func mustDecimal(t *testing.T, value string) rules.Decimal {
	t.Helper()
	decimal, err := rules.ParseDecimal(value)
	if err != nil {
		t.Fatalf("parse decimal %q: %v", value, err)
	}
	return decimal
}

func TestValidateConditionReferences(t *testing.T) {
	const (
		ruleSetID    = rules.ID("00000000-0000-4000-8000-000000000001")
		conditionID  = rules.ID("00000000-0000-4000-8000-000000000002")
		parameterID  = rules.ID("00000000-0000-4000-8000-000000000003")
		problemID    = rules.ID("00000000-0000-4000-8000-000000000004")
		targetID     = rules.ID("00000000-0000-4000-8000-000000000005")
		invocationID = rules.ID("00000000-0000-4000-8000-000000000006")
		schemaID     = rules.ID("00000000-0000-4000-8000-000000000007")
	)
	maximum := 1
	reference := conditionReference{
		problem: rules.ProblemDefinition{
			ID: problemID, RuleSetID: ruleSetID,
			Targets: []rules.ProblemTargetDefinition{{
				ID: targetID, Cardinality: rules.CardinalityOne,
				MinimumBindings: 1, MaximumBindings: &maximum,
				RequiredOwnerSchemaIDs: []rules.ID{schemaID},
			}},
		},
		invocation: rules.ConditionInvocation{
			ID: invocationID, ConditionSetID: conditionID,
			Arguments: []rules.ConditionInvocationArgument{{
				ParameterID: parameterID, TargetDefinitionID: targetID,
			}},
		},
	}
	compatible := rules.ConditionSet{
		ID: conditionID, RuleSetID: ruleSetID,
		Parameters: []rules.ConditionParameter{{
			ID: parameterID, Cardinality: rules.CardinalityOne,
			RequiredOwnerSchemaIDs: []rules.ID{schemaID},
		}},
	}
	if err := validateConditionReferences(compatible, []conditionReference{reference}); err != nil {
		t.Fatalf("compatible reference rejected: %v", err)
	}

	incompatible := compatible
	incompatible.Parameters = append([]rules.ConditionParameter(nil), compatible.Parameters...)
	incompatible.Parameters[0].Cardinality = rules.CardinalityMany
	err := validateConditionReferences(incompatible, []conditionReference{reference})
	var status *statusError
	if !errors.As(err, &status) {
		t.Fatalf("error = %T %v, want *statusError", err, err)
	}
	if status.Status != http.StatusConflict || status.Code != "condition_in_use" {
		t.Fatalf("status = %d %q, want 409 condition_in_use", status.Status, status.Code)
	}
	path := "problem_definitions[" + string(problemID) + "].invocations[" + string(invocationID) + "].arguments[0].target_definition_id"
	if status.Fields[path] == "" {
		t.Fatalf("fields = %#v, want cardinality error at %q", status.Fields, path)
	}
}

func TestValidateConditionReferencesRejectsRemovedParameter(t *testing.T) {
	const (
		ruleSetID    = rules.ID("00000000-0000-4000-8000-000000000011")
		conditionID  = rules.ID("00000000-0000-4000-8000-000000000012")
		parameterID  = rules.ID("00000000-0000-4000-8000-000000000013")
		problemID    = rules.ID("00000000-0000-4000-8000-000000000014")
		invocationID = rules.ID("00000000-0000-4000-8000-000000000015")
	)
	reference := conditionReference{
		problem: rules.ProblemDefinition{ID: problemID, RuleSetID: ruleSetID},
		invocation: rules.ConditionInvocation{
			ID: invocationID, ConditionSetID: conditionID,
			Arguments: []rules.ConditionInvocationArgument{{ParameterID: parameterID}},
		},
	}
	err := validateConditionReferences(
		rules.ConditionSet{ID: conditionID, RuleSetID: ruleSetID},
		[]conditionReference{reference},
	)
	var status *statusError
	if !errors.As(err, &status) || status.Status != http.StatusConflict {
		t.Fatalf("error = %T %v, want conflict", err, err)
	}
	path := "problem_definitions[" + string(problemID) + "].invocations[" + string(invocationID) + "].arguments[0].parameter_id"
	if status.Fields[path] == "" {
		t.Fatalf("fields = %#v, want removed-parameter error at %q", status.Fields, path)
	}
}
