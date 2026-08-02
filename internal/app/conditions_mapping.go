package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"dnd/internal/rules"
)

func conditionRequestToDomain(request saveConditionSetRequest, ruleSetID string, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ConditionSet, error) {
	if request.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ConditionSet{}, err
		}
		request.ID = generated
	}
	set := rules.ConditionSet{
		ID: rules.ID(request.ID), RuleSetID: rules.ID(ruleSetID), Key: strings.TrimSpace(request.Key),
		Name: strings.TrimSpace(request.Name), Archived: request.Archived,
	}
	if request.Description != nil {
		set.Description = strings.TrimSpace(*request.Description)
	}
	for position, parameter := range request.Parameters {
		if parameter.ID == "" {
			generated, err := newID()
			if err != nil {
				return set, err
			}
			parameter.ID = generated
		}
		set.Parameters = append(set.Parameters, rules.ConditionParameter{
			ID: rules.ID(parameter.ID), Key: strings.TrimSpace(parameter.Key), Label: strings.TrimSpace(parameter.Label),
			Cardinality:            rules.Cardinality(parameter.Cardinality),
			RequiredOwnerSchemaIDs: stringIDs(uniqueSorted(parameter.RequiredOwnerSchemaIDs)), Position: position,
		})
	}
	root, err := expressionDTOToDomain(request.Root, definitions, 0)
	if err != nil {
		return set, err
	}
	set.Root = root
	return set, nil
}

func expressionDTOToDomain(expression conditionExpressionDTO, definitions map[rules.ID]rules.StateVariableDefinition, position int) (rules.ConditionExpression, error) {
	if expression.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ConditionExpression{}, err
		}
		expression.ID = generated
	}
	result := rules.ConditionExpression{ID: rules.ID(expression.ID), Type: rules.ExpressionType(expression.Type), Position: position}
	if expression.Count != nil && result.Type != rules.ExpressionCriterion {
		result.RequiredCount = *expression.Count
	}
	if result.Type == rules.ExpressionCriterion {
		if expression.Predicate == nil {
			return result, fmt.Errorf("root[%s].predicate is required", result.ID)
		}
		definition, exists := definitions[rules.ID(expression.StateVariableID)]
		if !exists {
			return result, fmt.Errorf("root[%s].state_variable_id does not exist", result.ID)
		}
		predicate, err := predicateDTOToDomain(*expression.Predicate, definition)
		if err != nil {
			return result, fmt.Errorf("root[%s].predicate: %w", result.ID, err)
		}
		result.Criterion = &rules.ConditionCriterion{
			ParameterID: rules.ID(expression.ParameterID), Quantifier: rules.ConditionQuantifier(expression.Quantifier),
			StateVariableID: rules.ID(expression.StateVariableID), Predicate: predicate,
		}
		if expression.Count != nil {
			result.Criterion.RequiredCount = *expression.Count
		}
		return result, nil
	}
	for childPosition, child := range expression.Children {
		converted, err := expressionDTOToDomain(child, definitions, childPosition)
		if err != nil {
			return result, err
		}
		result.Children = append(result.Children, converted)
	}
	return result, nil
}

func predicateDTOToDomain(predicate predicateDTO, definition rules.StateVariableDefinition) (rules.Predicate, error) {
	result := rules.Predicate{Kind: rules.PredicateKind(predicate.Kind), Operator: rules.PredicateOperator(predicate.Operator)}
	switch result.Kind {
	case rules.PredicateNumber:
		var number json.Number
		if len(predicate.Value) == 0 {
			return result, fmt.Errorf("value is required")
		}
		if err := decodeStrictBytes(predicate.Value, &number, true); err != nil {
			return result, fmt.Errorf("value must be a number: %w", err)
		}
		decimal, err := rules.ParseDecimal(number.String())
		if err != nil {
			return result, err
		}
		result.NumberValue = &decimal
	case rules.PredicateNumberRange:
		var err error
		if result.Minimum, err = decimalPointerFromJSON(predicate.Minimum); err != nil {
			return result, err
		}
		if result.Maximum, err = decimalPointerFromJSON(predicate.Maximum); err != nil {
			return result, err
		}
	case rules.PredicateBoolean:
		var boolean *bool
		if len(predicate.Value) == 0 {
			return result, fmt.Errorf("value is required")
		}
		if err := decodeStrictBytes(predicate.Value, &boolean, true); err != nil {
			return result, fmt.Errorf("value must be true or false")
		}
		if boolean == nil {
			return result, fmt.Errorf("value must be true or false")
		}
		result.BooleanValue = boolean
	case rules.PredicateChoice:
		var key string
		if err := decodeStrictBytes(predicate.Value, &key, true); err != nil {
			return result, fmt.Errorf("value must be a choice key")
		}
		optionID, exists := optionIDForKey(definition, key)
		if !exists {
			return result, fmt.Errorf("choice option %q is not declared", key)
		}
		result.ChoiceOptionIDs = []rules.ID{optionID}
	case rules.PredicateChoiceSet:
		for _, key := range predicate.Values {
			optionID, exists := optionIDForKey(definition, key)
			if !exists {
				return result, fmt.Errorf("choice option %q is not declared", key)
			}
			result.ChoiceOptionIDs = append(result.ChoiceOptionIDs, optionID)
		}
	default:
		return result, fmt.Errorf("unsupported predicate kind %q", predicate.Kind)
	}
	return result, nil
}

func optionIDForKey(definition rules.StateVariableDefinition, key string) (rules.ID, bool) {
	for _, option := range definition.ChoiceOptions {
		if option.Key == key {
			return option.ID, true
		}
	}
	return "", false
}

func conditionToResponse(set rules.ConditionSet, definitions map[rules.ID]rules.StateVariableDefinition) conditionSetResponse {
	response := conditionSetResponse{
		ID: string(set.ID), Key: set.Key, Name: set.Name, Archived: set.Archived,
		Parameters: make([]conditionParameterDTO, 0, len(set.Parameters)),
		Root:       expressionDomainToDTO(set.Root, definitions), CreatedAt: set.CreatedAt, UpdatedAt: set.UpdatedAt,
	}
	if set.Description != "" {
		response.Description = &set.Description
	}
	parameters := append([]rules.ConditionParameter(nil), set.Parameters...)
	sort.Slice(parameters, func(i, j int) bool { return parameters[i].Position < parameters[j].Position })
	for _, parameter := range parameters {
		response.Parameters = append(response.Parameters, conditionParameterDTO{
			ID: string(parameter.ID), Key: parameter.Key, Label: parameter.Label,
			Cardinality: string(parameter.Cardinality), RequiredOwnerSchemaIDs: idsToStrings(parameter.RequiredOwnerSchemaIDs),
		})
	}
	return response
}

func expressionDomainToDTO(expression rules.ConditionExpression, definitions map[rules.ID]rules.StateVariableDefinition) conditionExpressionDTO {
	result := conditionExpressionDTO{ID: string(expression.ID), Type: string(expression.Type)}
	if expression.Type == rules.ExpressionAtLeast {
		count := expression.RequiredCount
		result.Count = &count
	}
	if expression.Type == rules.ExpressionCriterion && expression.Criterion != nil {
		result.ParameterID = string(expression.Criterion.ParameterID)
		result.Quantifier = string(expression.Criterion.Quantifier)
		result.StateVariableID = string(expression.Criterion.StateVariableID)
		result.Predicate = predicateDomainToDTO(expression.Criterion.Predicate, definitions[expression.Criterion.StateVariableID])
		if expression.Criterion.Quantifier == rules.QuantifierAtLeast {
			count := expression.Criterion.RequiredCount
			result.Count = &count
		}
		return result
	}
	children := append([]rules.ConditionExpression(nil), expression.Children...)
	sort.Slice(children, func(i, j int) bool { return children[i].Position < children[j].Position })
	for _, child := range children {
		result.Children = append(result.Children, expressionDomainToDTO(child, definitions))
	}
	return result
}

func predicateDomainToDTO(predicate rules.Predicate, definition rules.StateVariableDefinition) *predicateDTO {
	result := &predicateDTO{Kind: string(predicate.Kind), Operator: string(predicate.Operator)}
	switch predicate.Kind {
	case rules.PredicateNumber:
		if predicate.NumberValue != nil {
			result.Value = json.RawMessage(predicate.NumberValue.String())
		}
	case rules.PredicateNumberRange:
		result.Minimum = decimalJSON(predicate.Minimum)
		result.Maximum = decimalJSON(predicate.Maximum)
	case rules.PredicateBoolean:
		if predicate.BooleanValue != nil {
			result.Value, _ = json.Marshal(*predicate.BooleanValue)
		}
	case rules.PredicateChoice:
		if len(predicate.ChoiceOptionIDs) > 0 {
			if key, exists := optionKeyForID(definition, predicate.ChoiceOptionIDs[0]); exists {
				result.Value, _ = json.Marshal(key)
			}
		}
	case rules.PredicateChoiceSet:
		for _, optionID := range predicate.ChoiceOptionIDs {
			if key, exists := optionKeyForID(definition, optionID); exists {
				result.Values = append(result.Values, key)
			}
		}
	}
	return result
}

func optionKeyForID(definition rules.StateVariableDefinition, id rules.ID) (string, bool) {
	for _, option := range definition.ChoiceOptions {
		if option.ID == id {
			return option.Key, true
		}
	}
	return "", false
}
