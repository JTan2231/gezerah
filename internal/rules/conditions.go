package rules

import (
	"fmt"
	"sort"
	"strings"
)

const (
	MaximumConditionDepth = 10
	MaximumConditionNodes = 250
)

func ValidateConditionSet(condition ConditionSet, schemas map[ID]OwnerSchema, definitions map[ID]StateVariableDefinition) ValidationErrors {
	var errs ValidationErrors
	if !condition.ID.Valid() {
		errs = append(errs, validation("required", "id", "condition-set ID is required"))
	}
	if !condition.RuleSetID.Valid() {
		errs = append(errs, validation("required", "rule_set_id", "ruleset ID is required"))
	}
	if strings.TrimSpace(condition.Key) == "" {
		errs = append(errs, validation("required", "key", "condition-set key is required"))
	}
	if strings.TrimSpace(condition.Name) == "" {
		errs = append(errs, validation("required", "name", "condition-set name is required"))
	}

	parameters := make(map[ID]ConditionParameter, len(condition.Parameters))
	keys := make(map[string]struct{}, len(condition.Parameters))
	positions := make(map[int]struct{}, len(condition.Parameters))
	for i, parameter := range condition.Parameters {
		path := fmt.Sprintf("parameters[%d]", i)
		if !parameter.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "condition parameter ID is required"))
		}
		if _, exists := parameters[parameter.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "condition parameter ID is repeated"))
		}
		parameters[parameter.ID] = parameter
		if strings.TrimSpace(parameter.Key) == "" {
			errs = append(errs, validation("required", path+".key", "condition parameter key is required"))
		}
		if _, exists := keys[parameter.Key]; exists {
			errs = append(errs, validation("duplicate", path+".key", "condition parameter key is repeated"))
		}
		keys[parameter.Key] = struct{}{}
		if strings.TrimSpace(parameter.Label) == "" {
			errs = append(errs, validation("required", path+".label", "condition parameter label is required"))
		}
		if parameter.Cardinality != CardinalityOne && parameter.Cardinality != CardinalityMany {
			errs = append(errs, validation("unsupported", path+".cardinality", "parameter cardinality must be one or many"))
		}
		if parameter.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "position cannot be negative"))
		}
		if _, exists := positions[parameter.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "parameter position is repeated"))
		}
		positions[parameter.Position] = struct{}{}
		if len(parameter.RequiredOwnerSchemaIDs) == 0 {
			errs = append(errs, validation("required", path+".required_owner_schema_ids", "condition parameters require at least one owner schema"))
		}
		for _, duplicate := range duplicateIDs(parameter.RequiredOwnerSchemaIDs) {
			errs = append(errs, validation("duplicate", path+".required_owner_schema_ids", fmt.Sprintf("owner schema %q is repeated", duplicate)))
		}
		for j, schemaID := range parameter.RequiredOwnerSchemaIDs {
			schema, exists := schemas[schemaID]
			schemaPath := fmt.Sprintf("%s.required_owner_schema_ids[%d]", path, j)
			if !exists {
				errs = append(errs, validation("unknown_owner_schema", schemaPath, "required owner schema does not exist"))
			} else if schema.RuleSetID != condition.RuleSetID {
				errs = append(errs, validation("cross_ruleset_reference", schemaPath, "required owner schema belongs to another ruleset"))
			}
		}
	}

	seenExpressions := make(map[ID]struct{})
	nodeCount := 0
	errs = append(errs, validateConditionExpression(condition.Root, "root", 1, condition, parameters, definitions, seenExpressions, &nodeCount)...)
	if nodeCount > MaximumConditionNodes {
		errs = append(errs, validation("condition_too_large", "root", fmt.Sprintf("condition tree may contain at most %d nodes", MaximumConditionNodes)))
	}
	return errs
}

func validateConditionExpression(expression ConditionExpression, path string, depth int, condition ConditionSet, parameters map[ID]ConditionParameter, definitions map[ID]StateVariableDefinition, seen map[ID]struct{}, nodeCount *int) ValidationErrors {
	var errs ValidationErrors
	(*nodeCount)++
	if depth > MaximumConditionDepth {
		errs = append(errs, validation("condition_too_deep", path, fmt.Sprintf("condition tree depth may not exceed %d", MaximumConditionDepth)))
	}
	if !expression.ID.Valid() {
		errs = append(errs, validation("required", path+".id", "expression ID is required"))
	} else if _, exists := seen[expression.ID]; exists {
		errs = append(errs, validation("duplicate", path+".id", "expression ID is repeated"))
	}
	seen[expression.ID] = struct{}{}
	if expression.Position < 0 {
		errs = append(errs, validation("invalid_position", path+".position", "expression position cannot be negative"))
	}

	switch expression.Type {
	case ExpressionAll, ExpressionAny, ExpressionAtLeast:
		if expression.Criterion != nil {
			errs = append(errs, validation("invalid_expression", path+".criterion", "group expressions cannot contain criterion data"))
		}
		if len(expression.Children) == 0 {
			errs = append(errs, validation("empty_group", path+".children", "expression groups require at least one child"))
		}
		if expression.Type == ExpressionAtLeast {
			if expression.RequiredCount < 1 || expression.RequiredCount > len(expression.Children) {
				errs = append(errs, validation("invalid_required_count", path+".count", "at-least count must be between one and the child count"))
			}
		} else if expression.RequiredCount != 0 {
			errs = append(errs, validation("unexpected_required_count", path+".count", "only at-least groups declare a count"))
		}
		positions := make(map[int]struct{}, len(expression.Children))
		for i, child := range expression.Children {
			childPath := fmt.Sprintf("%s.children[%s]", path, child.ID)
			if _, exists := positions[child.Position]; exists {
				errs = append(errs, validation("duplicate", childPath+".position", "sibling expression position is repeated"))
			}
			positions[child.Position] = struct{}{}
			errs = append(errs, validateConditionExpression(child, childPath, depth+1, condition, parameters, definitions, seen, nodeCount)...)
			_ = i
		}
	case ExpressionCriterion:
		if len(expression.Children) > 0 {
			errs = append(errs, validation("invalid_expression", path+".children", "criterion expressions cannot contain children"))
		}
		if expression.RequiredCount != 0 {
			errs = append(errs, validation("unexpected_required_count", path+".count", "criterion counts belong to their quantifier"))
		}
		if expression.Criterion == nil {
			errs = append(errs, validation("required", path+".criterion", "criterion expression requires criterion data"))
		} else {
			errs = append(errs, validateCriterion(*expression.Criterion, path+".criterion", condition, parameters, definitions)...)
		}
	default:
		errs = append(errs, validation("unsupported", path+".type", "unsupported expression type"))
	}
	return errs
}

func validateCriterion(criterion ConditionCriterion, path string, condition ConditionSet, parameters map[ID]ConditionParameter, definitions map[ID]StateVariableDefinition) ValidationErrors {
	var errs ValidationErrors
	parameter, parameterExists := parameters[criterion.ParameterID]
	if !parameterExists {
		errs = append(errs, validation("unknown_parameter", path+".parameter_id", "criterion parameter does not belong to the condition set"))
	}
	definition, definitionExists := definitions[criterion.StateVariableID]
	if !definitionExists {
		errs = append(errs, validation("unknown_state_variable", path+".state_variable_id", "state-variable definition does not exist"))
	} else {
		if definition.RuleSetID != condition.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", path+".state_variable_id", "state variable belongs to another ruleset"))
		}
		if !definition.ConditionAddressable {
			errs = append(errs, validation("not_condition_addressable", path+".state_variable_id", "state variable is not available to conditions"))
		}
		if definition.Cardinality != CardinalityOne {
			errs = append(errs, validation("unsupported_state_cardinality", path+".state_variable_id", "many-valued state predicates are not supported initially"))
		}
	}
	if parameterExists && definitionExists && !schemaSetsIntersect(parameter.RequiredOwnerSchemaIDs, definition.OwnerSchemaIDs) {
		errs = append(errs, validation("incompatible_state_variable", path+".state_variable_id", "parameter schemas do not guarantee eligibility for the state variable"))
	}

	if parameterExists {
		if parameter.Cardinality == CardinalityOne {
			if criterion.Quantifier != QuantifierSingle {
				errs = append(errs, validation("invalid_quantifier", path+".quantifier", "singular parameters require the single quantifier"))
			}
			if criterion.RequiredCount != 0 {
				errs = append(errs, validation("unexpected_required_count", path+".count", "single quantifiers do not declare a count"))
			}
		} else {
			switch criterion.Quantifier {
			case QuantifierAny, QuantifierAll:
				if criterion.RequiredCount != 0 {
					errs = append(errs, validation("unexpected_required_count", path+".count", "only at-least quantifiers declare a count"))
				}
			case QuantifierAtLeast:
				if criterion.RequiredCount < 1 {
					errs = append(errs, validation("invalid_required_count", path+".count", "at-least quantifier count must be positive"))
				}
			default:
				errs = append(errs, validation("invalid_quantifier", path+".quantifier", "plural parameters require any, all, or at-least"))
			}
		}
	}
	if definitionExists {
		errs = append(errs, validatePredicate(criterion.Predicate, definition, path+".predicate")...)
	}
	return errs
}

func validatePredicate(predicate Predicate, definition StateVariableDefinition, path string) ValidationErrors {
	var errs ValidationErrors
	switch definition.ValueKind {
	case ValueNumber:
		switch predicate.Operator {
		case OperatorEqual, OperatorGreaterThan, OperatorGreaterThanOrEqual, OperatorLessThan, OperatorLessThanOrEqual:
			if predicate.Kind != PredicateNumber || predicate.NumberValue == nil {
				errs = append(errs, validation("invalid_predicate", path, "number comparison requires one numeric operand"))
			} else {
				errs = append(errs, validateDecimalAgainstBounds(*predicate.NumberValue, definition.NumberMinimum, definition.NumberMaximum, nil, path+".value")...)
			}
			if predicate.Minimum != nil || predicate.Maximum != nil || predicate.BooleanValue != nil || len(predicate.ChoiceOptionIDs) > 0 {
				errs = append(errs, validation("invalid_predicate", path, "number comparison contains unexpected operands"))
			}
		case OperatorBetween:
			if predicate.Kind != PredicateNumberRange || predicate.Minimum == nil || predicate.Maximum == nil {
				errs = append(errs, validation("invalid_predicate", path, "between requires minimum and maximum operands"))
			} else {
				if predicate.Minimum.Valid() && predicate.Maximum.Valid() && predicate.Minimum.Cmp(*predicate.Maximum) > 0 {
					errs = append(errs, validation("invalid_bounds", path+".maximum", "range maximum must be greater than or equal to minimum"))
				}
				errs = append(errs, validateDecimalAgainstBounds(*predicate.Minimum, definition.NumberMinimum, definition.NumberMaximum, nil, path+".minimum")...)
				errs = append(errs, validateDecimalAgainstBounds(*predicate.Maximum, definition.NumberMinimum, definition.NumberMaximum, nil, path+".maximum")...)
			}
			if predicate.NumberValue != nil || predicate.BooleanValue != nil || len(predicate.ChoiceOptionIDs) > 0 {
				errs = append(errs, validation("invalid_predicate", path, "number range contains unexpected operands"))
			}
		default:
			errs = append(errs, validation("invalid_operator", path+".operator", "unsupported number predicate operator"))
		}
	case ValueBoolean:
		if predicate.Kind != PredicateBoolean || predicate.Operator != OperatorIs || predicate.BooleanValue == nil || predicate.NumberValue != nil || predicate.Minimum != nil || predicate.Maximum != nil || len(predicate.ChoiceOptionIDs) > 0 {
			errs = append(errs, validation("invalid_predicate", path, "Boolean predicate must use is with one Boolean operand"))
		}
	case ValueChoice:
		if predicate.Operator == OperatorIs {
			if predicate.Kind != PredicateChoice || len(predicate.ChoiceOptionIDs) != 1 {
				errs = append(errs, validation("invalid_predicate", path, "choice is requires exactly one option"))
			}
		} else if predicate.Operator == OperatorOneOf {
			if predicate.Kind != PredicateChoiceSet || len(predicate.ChoiceOptionIDs) == 0 {
				errs = append(errs, validation("invalid_predicate", path, "choice one-of requires one or more options"))
			}
		} else {
			errs = append(errs, validation("invalid_operator", path+".operator", "unsupported choice predicate operator"))
		}
		if predicate.NumberValue != nil || predicate.Minimum != nil || predicate.Maximum != nil || predicate.BooleanValue != nil {
			errs = append(errs, validation("invalid_predicate", path, "choice predicate contains unexpected operands"))
		}
		seen := make(map[ID]struct{}, len(predicate.ChoiceOptionIDs))
		for i, optionID := range predicate.ChoiceOptionIDs {
			if _, exists := seen[optionID]; exists {
				errs = append(errs, validation("duplicate", fmt.Sprintf("%s.values[%d]", path, i), "choice operand is repeated"))
			}
			seen[optionID] = struct{}{}
			if !containsChoiceOption(definition.ChoiceOptions, optionID) {
				errs = append(errs, validation("invalid_choice_option", fmt.Sprintf("%s.values[%d]", path, i), "choice operand does not belong to the variable"))
			}
		}
	default:
		errs = append(errs, validation("unsupported_predicate", path, "initial conditions support only single-valued number, Boolean, and choice variables"))
	}
	return errs
}

func ValidateConditionBindings(condition ConditionSet, bindings ParameterBindings, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	parameters := make(map[ID]ConditionParameter, len(condition.Parameters))
	for _, parameter := range condition.Parameters {
		parameters[parameter.ID] = parameter
		entityIDs, exists := bindings[parameter.ID]
		path := "arguments[" + string(parameter.ID) + "]"
		if !exists {
			errs = append(errs, validation("missing_argument", path, "every condition parameter must be bound exactly once"))
			continue
		}
		if parameter.Cardinality == CardinalityOne && len(entityIDs) != 1 {
			errs = append(errs, validation("invalid_binding_count", path, "singular condition parameters require exactly one entity"))
		}
		seen := make(map[ID]struct{}, len(entityIDs))
		for i, entityID := range entityIDs {
			entityPath := fmt.Sprintf("%s.entities[%d]", path, i)
			if _, duplicate := seen[entityID]; duplicate {
				errs = append(errs, validation("duplicate_binding", entityPath, "an entity may appear only once for a parameter"))
			}
			seen[entityID] = struct{}{}
			entity, entityExists := entities[entityID]
			if !entityExists {
				errs = append(errs, validation("unknown_entity", entityPath, "bound entity does not exist"))
				continue
			}
			if entity.RuleSetID != condition.RuleSetID {
				errs = append(errs, validation("cross_ruleset_reference", entityPath, "bound entity belongs to another ruleset"))
			}
			if !EntityImplementsAll(entity, parameter.RequiredOwnerSchemaIDs) {
				errs = append(errs, validation("ineligible_binding", entityPath, "bound entity does not implement every schema required by the parameter"))
			}
		}
	}
	for parameterID := range bindings {
		if _, exists := parameters[parameterID]; !exists {
			errs = append(errs, validation("unexpected_argument", "arguments["+string(parameterID)+"]", "argument does not belong to the condition set"))
		}
	}
	return errs
}

func EvaluateCondition(condition ConditionSet, bindings ParameterBindings, entities map[ID]Entity, definitions map[ID]StateVariableDefinition, snapshot StateSnapshot) (ConditionEvaluation, error) {
	if errs := ValidateConditionBindings(condition, bindings, entities); len(errs) > 0 {
		return ConditionEvaluation{}, domainError(ErrInvalidBindings, errs)
	}
	missing := make(map[StateAddress]struct{})
	node, err := evaluateExpression(condition.Root, bindings, entities, definitions, snapshot, missing)
	if err != nil {
		return ConditionEvaluation{}, err
	}
	missingValues := make([]StateAddress, 0, len(missing))
	for address := range missing {
		missingValues = append(missingValues, address)
	}
	sort.Slice(missingValues, func(i, j int) bool {
		if missingValues[i].EntityID == missingValues[j].EntityID {
			return missingValues[i].StateVariableID < missingValues[j].StateVariableID
		}
		return missingValues[i].EntityID < missingValues[j].EntityID
	})
	return ConditionEvaluation{
		ConditionSetID: condition.ID,
		Status:         node.Status,
		Root:           node,
		MissingValues:  missingValues,
	}, nil
}

func evaluateExpression(expression ConditionExpression, bindings ParameterBindings, entities map[ID]Entity, definitions map[ID]StateVariableDefinition, snapshot StateSnapshot, missing map[StateAddress]struct{}) (ConditionEvaluationNode, error) {
	if expression.Type == ExpressionCriterion {
		if expression.Criterion == nil {
			return ConditionEvaluationNode{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("missing_criterion", "expressions["+string(expression.ID)+"]", "criterion data is missing")})
		}
		return evaluateCriterion(expression.ID, *expression.Criterion, bindings, entities, definitions, snapshot, missing)
	}
	children := make([]ConditionEvaluationNode, 0, len(expression.Children))
	statuses := make([]ConditionStatus, 0, len(expression.Children))
	for _, child := range expression.Children {
		evaluated, err := evaluateExpression(child, bindings, entities, definitions, snapshot, missing)
		if err != nil {
			return ConditionEvaluationNode{}, err
		}
		children = append(children, evaluated)
		statuses = append(statuses, evaluated.Status)
	}
	status, ok := CombineConditionStatuses(expression.Type, expression.RequiredCount, statuses)
	if !ok {
		return ConditionEvaluationNode{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("invalid_expression", "expressions["+string(expression.ID)+"]", "expression group has an invalid shape")})
	}
	return ConditionEvaluationNode{
		ExpressionID:  expression.ID,
		Status:        status,
		Message:       groupMessage(expression.Type, expression.RequiredCount, status),
		Children:      children,
		EntityResults: []ConditionEntityResult{},
	}, nil
}

func evaluateCriterion(expressionID ID, criterion ConditionCriterion, bindings ParameterBindings, entities map[ID]Entity, definitions map[ID]StateVariableDefinition, snapshot StateSnapshot, missing map[StateAddress]struct{}) (ConditionEvaluationNode, error) {
	definition, exists := definitions[criterion.StateVariableID]
	if !exists {
		return ConditionEvaluationNode{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("unknown_state_variable", "expressions["+string(expressionID)+"].state_variable_id", "state-variable definition does not exist")})
	}
	entityIDs := bindings[criterion.ParameterID]
	entityResults := make([]ConditionEntityResult, 0, len(entityIDs))
	statuses := make([]ConditionStatus, 0, len(entityIDs))
	for _, entityID := range entityIDs {
		entity := entities[entityID]
		record, recordExists := snapshot.Records[entityID]
		if !recordExists {
			return ConditionEvaluationNode{}, domainError(ErrInvalidState, ValidationErrors{validation("missing_state_record", "records["+string(entityID)+"]", "required state record is absent from the snapshot")})
		}
		if errs := ValidateStateRecord(record, entity, definitions, entities); len(errs) > 0 {
			return ConditionEvaluationNode{}, domainError(ErrInvalidState, errs)
		}
		address := StateAddress{EntityID: entityID, StateVariableID: definition.ID}
		logical := LogicalStateValue(record, definition)
		result := ConditionEntityResult{EntityID: entityID, Address: address}
		if logical.Presence == ValueUnknown {
			result.Status = ConditionUnknown
			missing[address] = struct{}{}
		} else {
			actual := CloneStateValue(*logical.Value)
			result.Actual = &actual
			met, predicateErr := predicateMatches(criterion.Predicate, actual)
			if predicateErr != nil {
				return ConditionEvaluationNode{}, predicateErr
			}
			if met {
				result.Status = ConditionMet
			} else {
				result.Status = ConditionUnmet
			}
		}
		entityResults = append(entityResults, result)
		statuses = append(statuses, result.Status)
	}
	status, ok := combineQuantifiedStatuses(criterion.Quantifier, criterion.RequiredCount, statuses)
	if !ok {
		return ConditionEvaluationNode{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("invalid_quantifier", "expressions["+string(expressionID)+"].quantifier", "criterion quantifier has an invalid shape")})
	}
	return ConditionEvaluationNode{
		ExpressionID:  expressionID,
		Status:        status,
		Message:       criterionMessage(criterion, definition, entities, entityIDs, status),
		ParameterID:   criterion.ParameterID,
		EntityResults: entityResults,
		Children:      []ConditionEvaluationNode{},
	}, nil
}

func predicateMatches(predicate Predicate, value StateValue) (bool, error) {
	if value.Cardinality != CardinalityOne || len(value.Values) != 1 {
		return false, domainError(ErrInvalidState, ValidationErrors{validation("invalid_criterion_value", "value", "criteria require a known single scalar value")})
	}
	scalar := value.Values[0]
	switch predicate.Kind {
	case PredicateNumber:
		if scalar.Number == nil || predicate.NumberValue == nil {
			return false, domainError(ErrInvalidDefinition, ValidationErrors{validation("invalid_number_predicate", "predicate", "number predicate is incomplete")})
		}
		comparison := scalar.Number.Cmp(*predicate.NumberValue)
		switch predicate.Operator {
		case OperatorEqual:
			return comparison == 0, nil
		case OperatorGreaterThan:
			return comparison > 0, nil
		case OperatorGreaterThanOrEqual:
			return comparison >= 0, nil
		case OperatorLessThan:
			return comparison < 0, nil
		case OperatorLessThanOrEqual:
			return comparison <= 0, nil
		}
	case PredicateNumberRange:
		if scalar.Number == nil || predicate.Minimum == nil || predicate.Maximum == nil {
			return false, domainError(ErrInvalidDefinition, ValidationErrors{validation("invalid_number_predicate", "predicate", "number range predicate is incomplete")})
		}
		return scalar.Number.Cmp(*predicate.Minimum) >= 0 && scalar.Number.Cmp(*predicate.Maximum) <= 0, nil
	case PredicateBoolean:
		if scalar.Boolean == nil || predicate.BooleanValue == nil {
			return false, domainError(ErrInvalidDefinition, ValidationErrors{validation("invalid_boolean_predicate", "predicate", "Boolean predicate is incomplete")})
		}
		return *scalar.Boolean == *predicate.BooleanValue, nil
	case PredicateChoice, PredicateChoiceSet:
		for _, optionID := range predicate.ChoiceOptionIDs {
			if scalar.ChoiceOptionID == optionID {
				return true, nil
			}
		}
		return false, nil
	}
	return false, domainError(ErrInvalidDefinition, ValidationErrors{validation("unsupported_predicate", "predicate", "predicate cannot be evaluated")})
}

func CombineConditionStatuses(expressionType ExpressionType, requiredCount int, statuses []ConditionStatus) (ConditionStatus, bool) {
	switch expressionType {
	case ExpressionAll:
		if len(statuses) == 0 {
			return "", false
		}
		return combineAll(statuses), true
	case ExpressionAny:
		if len(statuses) == 0 {
			return "", false
		}
		return combineAny(statuses), true
	case ExpressionAtLeast:
		if requiredCount < 1 || requiredCount > len(statuses) {
			return "", false
		}
		return combineAtLeast(requiredCount, statuses), true
	default:
		return "", false
	}
}

func combineQuantifiedStatuses(quantifier ConditionQuantifier, requiredCount int, statuses []ConditionStatus) (ConditionStatus, bool) {
	switch quantifier {
	case QuantifierSingle:
		if len(statuses) != 1 {
			return "", false
		}
		return statuses[0], true
	case QuantifierAny:
		if len(statuses) == 0 {
			return ConditionUnmet, true
		}
		return combineAny(statuses), true
	case QuantifierAll:
		if len(statuses) == 0 {
			return ConditionMet, true
		}
		return combineAll(statuses), true
	case QuantifierAtLeast:
		if requiredCount < 1 {
			return "", false
		}
		return combineAtLeast(requiredCount, statuses), true
	default:
		return "", false
	}
}

func combineAll(statuses []ConditionStatus) ConditionStatus {
	hasUnknown := false
	for _, status := range statuses {
		if status == ConditionUnmet {
			return ConditionUnmet
		}
		if status == ConditionUnknown {
			hasUnknown = true
		}
	}
	if hasUnknown {
		return ConditionUnknown
	}
	return ConditionMet
}

func combineAny(statuses []ConditionStatus) ConditionStatus {
	hasUnknown := false
	for _, status := range statuses {
		if status == ConditionMet {
			return ConditionMet
		}
		if status == ConditionUnknown {
			hasUnknown = true
		}
	}
	if hasUnknown {
		return ConditionUnknown
	}
	return ConditionUnmet
}

func combineAtLeast(required int, statuses []ConditionStatus) ConditionStatus {
	met, unknown := 0, 0
	for _, status := range statuses {
		switch status {
		case ConditionMet:
			met++
		case ConditionUnknown:
			unknown++
		}
	}
	if met >= required {
		return ConditionMet
	}
	if met+unknown < required {
		return ConditionUnmet
	}
	return ConditionUnknown
}

func groupMessage(expressionType ExpressionType, requiredCount int, status ConditionStatus) string {
	subject := "All child conditions"
	switch expressionType {
	case ExpressionAny:
		subject = "Any child condition"
	case ExpressionAtLeast:
		subject = fmt.Sprintf("At least %d child conditions", requiredCount)
	}
	return fmt.Sprintf("%s: %s", subject, status)
}

func criterionMessage(criterion ConditionCriterion, definition StateVariableDefinition, entities map[ID]Entity, entityIDs []ID, status ConditionStatus) string {
	names := make([]string, 0, len(entityIDs))
	for _, id := range entityIDs {
		if entity, ok := entities[id]; ok {
			names = append(names, entity.DisplayName)
		}
	}
	subject := strings.Join(names, ", ")
	if subject == "" {
		subject = "empty binding"
	}
	return fmt.Sprintf("%s — %s %s: %s", subject, definition.Label, predicateDescription(criterion.Predicate, definition), status)
}

func predicateDescription(predicate Predicate, definition StateVariableDefinition) string {
	switch predicate.Kind {
	case PredicateNumber:
		if predicate.NumberValue != nil {
			return fmt.Sprintf("%s %s", predicate.Operator, predicate.NumberValue.String())
		}
	case PredicateNumberRange:
		if predicate.Minimum != nil && predicate.Maximum != nil {
			return fmt.Sprintf("between %s and %s", predicate.Minimum.String(), predicate.Maximum.String())
		}
	case PredicateBoolean:
		if predicate.BooleanValue != nil {
			return fmt.Sprintf("is %t", *predicate.BooleanValue)
		}
	case PredicateChoice, PredicateChoiceSet:
		labels := make([]string, 0, len(predicate.ChoiceOptionIDs))
		for _, optionID := range predicate.ChoiceOptionIDs {
			label := string(optionID)
			for _, option := range definition.ChoiceOptions {
				if option.ID == optionID {
					label = option.Label
					break
				}
			}
			labels = append(labels, label)
		}
		if predicate.Kind == PredicateChoice {
			return "is " + strings.Join(labels, ", ")
		}
		return "is one of " + strings.Join(labels, ", ")
	}
	return string(predicate.Operator)
}
