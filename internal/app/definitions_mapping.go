package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"dnd/internal/rules"
)

func definitionRequestToDomain(request saveStateVariableRequest, ruleSetID string) (rules.StateVariableDefinition, error) {
	if request.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.StateVariableDefinition{}, err
		}
		request.ID = generated
	}
	definition := rules.StateVariableDefinition{
		ID:                      rules.ID(request.ID),
		RuleSetID:               rules.ID(ruleSetID),
		Key:                     strings.TrimSpace(request.Key),
		Label:                   strings.TrimSpace(request.Label),
		OwnerSchemaIDs:          stringIDs(uniqueSorted(request.OwnerSchemaIDs)),
		ValueKind:               rules.ValueKind(request.ValueSchema.Kind),
		Cardinality:             rules.Cardinality(request.Cardinality),
		MissingKind:             rules.MissingKind(request.MissingValue.Kind),
		OmitDefaultWhenStored:   request.MissingValue.OmitWhenStored,
		ConditionAddressable:    request.ConditionAddressable,
		DisplayOrder:            request.DisplayOrder,
		Archived:                request.Archived,
		AllowedEffectOperations: make([]rules.EffectOperation, 0, len(request.AllowedEffectOperations)),
	}
	if request.Description != nil {
		definition.Description = strings.TrimSpace(*request.Description)
	}
	if request.Presentation != nil {
		if request.Presentation.Group != nil {
			definition.PresentationGroup = strings.TrimSpace(*request.Presentation.Group)
		}
		if request.Presentation.Control != nil {
			definition.PresentationControl = rules.PresentationControl(strings.TrimSpace(*request.Presentation.Control))
		}
		if request.Presentation.HelpText != nil {
			definition.PresentationHelpText = strings.TrimSpace(*request.Presentation.HelpText)
		}
	}
	for _, operation := range request.AllowedEffectOperations {
		definition.AllowedEffectOperations = append(definition.AllowedEffectOperations, rules.EffectOperation(operation))
	}
	sort.Slice(definition.AllowedEffectOperations, func(i, j int) bool {
		return definition.AllowedEffectOperations[i] < definition.AllowedEffectOperations[j]
	})

	for position, option := range request.ValueSchema.Options {
		if option.ID == "" {
			generated, err := newID()
			if err != nil {
				return rules.StateVariableDefinition{}, err
			}
			option.ID = generated
		}
		definition.ChoiceOptions = append(definition.ChoiceOptions, rules.ChoiceOption{
			ID: rules.ID(option.ID), Key: strings.TrimSpace(option.Key), Label: strings.TrimSpace(option.Label), Position: position,
		})
	}
	for position, unit := range request.ValueSchema.Units {
		if unit.ID == "" {
			generated, err := newID()
			if err != nil {
				return rules.StateVariableDefinition{}, err
			}
			unit.ID = generated
		}
		definition.MeasurementUnits = append(definition.MeasurementUnits, rules.MeasurementUnit{
			ID: rules.ID(unit.ID), Unit: strings.TrimSpace(unit.Unit), Position: position,
		})
	}
	definition.ReferenceTargetOwnerSchemaIDs = stringIDs(uniqueSorted(request.ValueSchema.TargetOwnerSchemaIDs))

	var err error
	if definition.NumberMinimum, err = decimalPointerFromJSON(request.ValueSchema.Minimum); err != nil {
		return definition, fmt.Errorf("value_schema.minimum: %w", err)
	}
	if definition.NumberMaximum, err = decimalPointerFromJSON(request.ValueSchema.Maximum); err != nil {
		return definition, fmt.Errorf("value_schema.maximum: %w", err)
	}
	if definition.NumberStep, err = decimalPointerFromJSON(request.ValueSchema.Step); err != nil {
		return definition, fmt.Errorf("value_schema.step: %w", err)
	}
	if definition.ValueKind == rules.ValueMeasurement {
		definition.MeasurementMinimum, definition.NumberMinimum = definition.NumberMinimum, nil
		definition.MeasurementMaximum, definition.NumberMaximum = definition.NumberMaximum, nil
		definition.MeasurementStep, definition.NumberStep = definition.NumberStep, nil
	}
	if request.ValueSchema.Unit != nil {
		definition.NumberUnit = strings.TrimSpace(*request.ValueSchema.Unit)
	}

	if definition.MissingKind == rules.MissingDefault && request.MissingValue.Value != nil {
		value, convertErr := stateValueDTOToDomain(*request.MissingValue.Value, definition)
		if convertErr != nil {
			return definition, fmt.Errorf("missing_value.value: %w", convertErr)
		}
		definition.DefaultValue = &value
	}
	return definition, nil
}

func archivedDefinitionReferenceFields(proposed, current rules.StateVariableDefinition, schemas map[rules.ID]rules.OwnerSchema) map[string]string {
	fields := make(map[string]string)
	currentOwners := idSetForProblemMapping(current.OwnerSchemaIDs)
	for index, schemaID := range proposed.OwnerSchemaIDs {
		if schema, exists := schemas[schemaID]; exists && schema.Archived {
			if _, retained := currentOwners[schemaID]; !retained {
				fields[fmt.Sprintf("owner_schema_ids[%d]", index)] = "archived owner schemas cannot receive new definition references"
			}
		}
	}
	currentTargets := idSetForProblemMapping(current.ReferenceTargetOwnerSchemaIDs)
	for index, schemaID := range proposed.ReferenceTargetOwnerSchemaIDs {
		if schema, exists := schemas[schemaID]; exists && schema.Archived {
			if _, retained := currentTargets[schemaID]; !retained {
				fields[fmt.Sprintf("value_schema.target_owner_schema_ids[%d]", index)] = "archived owner schemas cannot receive new reference-target constraints"
			}
		}
	}
	return fields
}

func decimalPointerFromJSON(value *json.Number) (*rules.Decimal, error) {
	if value == nil {
		return nil, nil
	}
	parsed, err := rules.ParseDecimal(value.String())
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func stateValueDTOToDomain(value stateValueDTO, definition rules.StateVariableDefinition) (rules.StateValue, error) {
	cardinality := rules.CardinalityOne
	if value.Many {
		cardinality = rules.CardinalityMany
	}
	result := rules.StateValue{Cardinality: cardinality, Values: make([]rules.ScalarValue, 0, len(value.Values))}
	for _, scalar := range value.Values {
		converted, err := scalarDTOToDomain(scalar, definition)
		if err != nil {
			return result, err
		}
		result.Values = append(result.Values, converted)
	}
	return result, nil
}

func scalarDTOToDomain(value stateScalarDTO, definition rules.StateVariableDefinition) (rules.ScalarValue, error) {
	switch value.Kind {
	case "text":
		if value.Text == nil {
			return rules.ScalarValue{}, fmt.Errorf("text value is required")
		}
		return rules.NewTextValue(*value.Text), nil
	case "number":
		if value.Number == nil {
			return rules.ScalarValue{}, fmt.Errorf("number value is required")
		}
		decimal, err := rules.ParseDecimal(value.Number.String())
		if err != nil {
			return rules.ScalarValue{}, err
		}
		return rules.NewNumberValue(decimal), nil
	case "boolean":
		if value.Boolean == nil {
			return rules.ScalarValue{}, fmt.Errorf("boolean value is required")
		}
		return rules.NewBooleanValue(*value.Boolean), nil
	case "choice":
		if value.Choice == nil {
			return rules.ScalarValue{}, fmt.Errorf("choice value is required")
		}
		for _, option := range definition.ChoiceOptions {
			if option.Key == *value.Choice {
				return rules.NewChoiceValue(option.ID), nil
			}
		}
		return rules.ScalarValue{}, fmt.Errorf("choice option %q is not declared", *value.Choice)
	case "measurement":
		if value.Amount == nil || value.Unit == nil {
			return rules.ScalarValue{}, fmt.Errorf("measurement amount and unit are required")
		}
		amount, err := rules.ParseDecimal(value.Amount.String())
		if err != nil {
			return rules.ScalarValue{}, err
		}
		for _, unit := range definition.MeasurementUnits {
			if unit.Unit == *value.Unit {
				return rules.NewMeasurementValue(amount, unit.ID), nil
			}
		}
		return rules.ScalarValue{}, fmt.Errorf("measurement unit %q is not declared", *value.Unit)
	case "reference":
		if value.EntityID == nil || !validID(*value.EntityID) {
			return rules.ScalarValue{}, fmt.Errorf("referenced entity ID must be a UUID")
		}
		return rules.NewReferenceValue(rules.ID(*value.EntityID), value.FallbackName), nil
	default:
		return rules.ScalarValue{}, fmt.Errorf("unsupported value kind %q", value.Kind)
	}
}

func definitionToResponse(definition rules.StateVariableDefinition) stateVariableResponse {
	response := stateVariableResponse{
		ID:                      string(definition.ID),
		Key:                     definition.Key,
		Label:                   definition.Label,
		OwnerSchemaIDs:          idsToStrings(definition.OwnerSchemaIDs),
		Cardinality:             string(definition.Cardinality),
		ValueSchema:             valueSchemaDTO{Kind: string(definition.ValueKind)},
		MissingValue:            missingValueDTO{Kind: string(definition.MissingKind), OmitWhenStored: definition.OmitDefaultWhenStored},
		ConditionAddressable:    definition.ConditionAddressable,
		AllowedEffectOperations: make([]string, len(definition.AllowedEffectOperations)),
		DisplayOrder:            definition.DisplayOrder,
		Archived:                definition.Archived,
		CreatedAt:               definition.CreatedAt,
		UpdatedAt:               definition.UpdatedAt,
	}
	if definition.Description != "" {
		response.Description = &definition.Description
	}
	for index, operation := range definition.AllowedEffectOperations {
		response.AllowedEffectOperations[index] = string(operation)
	}
	for _, option := range definition.ChoiceOptions {
		response.ValueSchema.Options = append(response.ValueSchema.Options, choiceOptionDTO{
			ID: string(option.ID), Key: option.Key, Label: option.Label,
		})
	}
	for _, unit := range definition.MeasurementUnits {
		response.ValueSchema.Units = append(response.ValueSchema.Units, measurementUnitDTO{ID: string(unit.ID), Unit: unit.Unit})
	}
	minimum, maximum, step := definition.NumberMinimum, definition.NumberMaximum, definition.NumberStep
	if definition.ValueKind == rules.ValueMeasurement {
		minimum, maximum, step = definition.MeasurementMinimum, definition.MeasurementMaximum, definition.MeasurementStep
	}
	response.ValueSchema.Minimum = decimalJSON(minimum)
	response.ValueSchema.Maximum = decimalJSON(maximum)
	response.ValueSchema.Step = decimalJSON(step)
	if definition.NumberUnit != "" {
		response.ValueSchema.Unit = &definition.NumberUnit
	}
	response.ValueSchema.TargetOwnerSchemaIDs = idsToStrings(definition.ReferenceTargetOwnerSchemaIDs)
	if definition.DefaultValue != nil {
		value := stateValueDomainToDTO(*definition.DefaultValue, definition)
		response.MissingValue.Value = &value
	}
	if definition.PresentationGroup != "" || definition.PresentationControl != "" || definition.PresentationHelpText != "" {
		response.Presentation = &presentationDTO{}
		if definition.PresentationGroup != "" {
			response.Presentation.Group = &definition.PresentationGroup
		}
		if definition.PresentationControl != "" {
			control := string(definition.PresentationControl)
			response.Presentation.Control = &control
		}
		if definition.PresentationHelpText != "" {
			response.Presentation.HelpText = &definition.PresentationHelpText
		}
	}
	return response
}

func decimalJSON(value *rules.Decimal) *json.Number {
	if value == nil {
		return nil
	}
	number := json.Number(value.String())
	return &number
}

func stateValueDomainToDTO(value rules.StateValue, definition rules.StateVariableDefinition) stateValueDTO {
	result := stateValueDTO{Many: value.Cardinality == rules.CardinalityMany, Values: make([]stateScalarDTO, 0, len(value.Values))}
	for _, scalar := range value.Values {
		result.Values = append(result.Values, scalarDomainToDTO(scalar, definition))
	}
	return result
}

func scalarDomainToDTO(value rules.ScalarValue, definition rules.StateVariableDefinition) stateScalarDTO {
	result := stateScalarDTO{Kind: string(value.Kind)}
	switch value.Kind {
	case rules.ValueText:
		result.Text = value.Text
	case rules.ValueNumber:
		result.Number = decimalJSON(value.Number)
	case rules.ValueBoolean:
		result.Boolean = value.Boolean
	case rules.ValueChoice:
		for _, option := range definition.ChoiceOptions {
			if option.ID == value.ChoiceOptionID {
				key := option.Key
				result.Choice = &key
				break
			}
		}
	case rules.ValueMeasurement:
		result.Amount = decimalJSON(value.MeasurementAmount)
		for _, unit := range definition.MeasurementUnits {
			if unit.ID == value.MeasurementUnitID {
				name := unit.Unit
				result.Unit = &name
				break
			}
		}
	case rules.ValueReference:
		id := string(value.ReferencedEntityID)
		result.EntityID, result.FallbackName = &id, value.FallbackName
	}
	return result
}
