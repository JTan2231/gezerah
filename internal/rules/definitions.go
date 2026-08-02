package rules

import (
	"fmt"
	"strings"
)

func ValidateRuleSet(ruleSet RuleSet) ValidationErrors {
	var errs ValidationErrors
	if !ruleSet.ID.Valid() {
		errs = append(errs, validation("required", "id", "ruleset ID is required"))
	}
	if strings.TrimSpace(ruleSet.Key) == "" {
		errs = append(errs, validation("required", "key", "ruleset key is required"))
	}
	if strings.TrimSpace(ruleSet.Name) == "" {
		errs = append(errs, validation("required", "name", "ruleset name is required"))
	}
	return errs
}

func ValidateOwnerSchema(schema OwnerSchema) ValidationErrors {
	var errs ValidationErrors
	if !schema.ID.Valid() {
		errs = append(errs, validation("required", "id", "owner schema ID is required"))
	}
	if !schema.RuleSetID.Valid() {
		errs = append(errs, validation("required", "rule_set_id", "ruleset ID is required"))
	}
	if strings.TrimSpace(schema.Key) == "" {
		errs = append(errs, validation("required", "key", "owner schema key is required"))
	}
	if strings.TrimSpace(schema.Label) == "" {
		errs = append(errs, validation("required", "label", "owner schema label is required"))
	}
	return errs
}

func ValidateEntity(entity Entity, schemas map[ID]OwnerSchema) ValidationErrors {
	var errs ValidationErrors
	if !entity.ID.Valid() {
		errs = append(errs, validation("required", "id", "entity ID is required"))
	}
	if !entity.RuleSetID.Valid() {
		errs = append(errs, validation("required", "rule_set_id", "ruleset ID is required"))
	}
	if strings.TrimSpace(entity.DisplayName) == "" {
		errs = append(errs, validation("required", "display_name", "entity display name is required"))
	}
	for _, duplicate := range duplicateIDs(entity.OwnerSchemaIDs) {
		errs = append(errs, validation("duplicate", "owner_schema_ids", fmt.Sprintf("owner schema %q is repeated", duplicate)))
	}
	for i, id := range entity.OwnerSchemaIDs {
		schema, exists := schemas[id]
		path := fmt.Sprintf("owner_schema_ids[%d]", i)
		if !exists {
			errs = append(errs, validation("unknown_owner_schema", path, "owner schema does not exist"))
		} else if schema.RuleSetID != entity.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", path, "owner schema belongs to another ruleset"))
		}
	}
	return errs
}

func ValidateStateVariableDefinition(definition StateVariableDefinition, schemas map[ID]OwnerSchema, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	if !definition.ID.Valid() {
		errs = append(errs, validation("required", "id", "state-variable ID is required"))
	}
	if !definition.RuleSetID.Valid() {
		errs = append(errs, validation("required", "rule_set_id", "ruleset ID is required"))
	}
	if strings.TrimSpace(definition.Key) == "" {
		errs = append(errs, validation("required", "key", "state-variable key is required"))
	}
	if strings.TrimSpace(definition.Label) == "" {
		errs = append(errs, validation("required", "label", "state-variable label is required"))
	}
	if !validValueKind(definition.ValueKind) {
		errs = append(errs, validation("unsupported", "value_kind", "unsupported state-variable kind"))
	}
	if definition.Cardinality != CardinalityOne && definition.Cardinality != CardinalityMany {
		errs = append(errs, validation("unsupported", "cardinality", "cardinality must be one or many"))
	}
	if len(definition.OwnerSchemaIDs) == 0 {
		errs = append(errs, validation("required", "owner_schema_ids", "at least one owner schema is required"))
	}
	for _, duplicate := range duplicateIDs(definition.OwnerSchemaIDs) {
		errs = append(errs, validation("duplicate", "owner_schema_ids", fmt.Sprintf("owner schema %q is repeated", duplicate)))
	}
	for i, id := range definition.OwnerSchemaIDs {
		schema, exists := schemas[id]
		path := fmt.Sprintf("owner_schema_ids[%d]", i)
		if !exists {
			errs = append(errs, validation("unknown_owner_schema", path, "owner schema does not exist"))
		} else if schema.RuleSetID != definition.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", path, "owner schema belongs to another ruleset"))
		}
	}

	if definition.DisplayOrder < 0 {
		errs = append(errs, validation("invalid_position", "display_order", "display order cannot be negative"))
	}
	if definition.PresentationControl != "" && !validPresentationControl(definition.PresentationControl) {
		errs = append(errs, validation("unsupported", "presentation.control", "unsupported presentation control"))
	}

	errs = append(errs, validateDefinitionMetadata(definition, schemas)...)
	errs = append(errs, validateDefinitionMissing(definition, entities)...)
	errs = append(errs, validateAllowedOperations(definition)...)
	return errs
}

func validateDefinitionMetadata(definition StateVariableDefinition, schemas map[ID]OwnerSchema) ValidationErrors {
	var errs ValidationErrors
	if definition.ValueKind == ValueChoice {
		if len(definition.ChoiceOptions) == 0 {
			errs = append(errs, validation("required", "value_schema.options", "choice variables require at least one option"))
		}
		errs = append(errs, validateChoiceOptions(definition.ChoiceOptions)...)
	} else if len(definition.ChoiceOptions) > 0 {
		errs = append(errs, validation("invalid_metadata", "value_schema.options", "only choice variables may declare options"))
	}

	if definition.ValueKind == ValueMeasurement {
		if len(definition.MeasurementUnits) == 0 {
			errs = append(errs, validation("required", "value_schema.units", "measurement variables require at least one unit"))
		}
		errs = append(errs, validateMeasurementUnits(definition.MeasurementUnits)...)
		errs = append(errs, validateBounds(definition.MeasurementMinimum, definition.MeasurementMaximum, definition.MeasurementStep, "value_schema")...)
	} else if len(definition.MeasurementUnits) > 0 || definition.MeasurementMinimum != nil || definition.MeasurementMaximum != nil || definition.MeasurementStep != nil {
		errs = append(errs, validation("invalid_metadata", "value_schema", "measurement metadata is only valid for measurement variables"))
	}

	if definition.ValueKind == ValueNumber {
		errs = append(errs, validateBounds(definition.NumberMinimum, definition.NumberMaximum, definition.NumberStep, "value_schema")...)
	} else if definition.NumberMinimum != nil || definition.NumberMaximum != nil || definition.NumberStep != nil || definition.NumberUnit != "" {
		errs = append(errs, validation("invalid_metadata", "value_schema", "number metadata is only valid for number variables"))
	}

	if definition.ValueKind == ValueReference {
		for _, duplicate := range duplicateIDs(definition.ReferenceTargetOwnerSchemaIDs) {
			errs = append(errs, validation("duplicate", "value_schema.target_owner_schema_ids", fmt.Sprintf("owner schema %q is repeated", duplicate)))
		}
		for i, id := range definition.ReferenceTargetOwnerSchemaIDs {
			schema, exists := schemas[id]
			path := fmt.Sprintf("value_schema.target_owner_schema_ids[%d]", i)
			if !exists {
				errs = append(errs, validation("unknown_owner_schema", path, "reference target schema does not exist"))
			} else if schema.RuleSetID != definition.RuleSetID {
				errs = append(errs, validation("cross_ruleset_reference", path, "reference target schema belongs to another ruleset"))
			}
		}
	} else if len(definition.ReferenceTargetOwnerSchemaIDs) > 0 {
		errs = append(errs, validation("invalid_metadata", "value_schema.target_owner_schema_ids", "only reference variables may restrict target schemas"))
	}
	return errs
}

func validateDefinitionMissing(definition StateVariableDefinition, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	switch definition.MissingKind {
	case MissingUnknown:
		if definition.DefaultValue != nil {
			errs = append(errs, validation("invalid_default", "missing_value.value", "unknown missing semantics cannot declare a default"))
		}
		if definition.OmitDefaultWhenStored {
			errs = append(errs, validation("invalid_default", "missing_value.omit_when_stored", "omit-default is only valid with a default"))
		}
	case MissingDefault:
		if definition.DefaultValue == nil {
			errs = append(errs, validation("required", "missing_value.value", "default missing semantics require a value"))
		} else {
			errs = append(errs, ValidateStateValue(definition, *definition.DefaultValue, entities)...)
		}
	default:
		errs = append(errs, validation("unsupported", "missing_value.kind", "missing semantics must be unknown or default"))
	}
	return errs
}

func validateAllowedOperations(definition StateVariableDefinition) ValidationErrors {
	var errs ValidationErrors
	seen := make(map[EffectOperation]struct{}, len(definition.AllowedEffectOperations))
	for i, operation := range definition.AllowedEffectOperations {
		path := fmt.Sprintf("allowed_effect_operations[%d]", i)
		if _, exists := seen[operation]; exists {
			errs = append(errs, validation("duplicate", path, "effect operation is repeated"))
		}
		seen[operation] = struct{}{}
		if !operationCompatible(operation, definition) {
			errs = append(errs, validation("incompatible_operation", path, "effect operation is incompatible with the variable schema"))
		}
	}
	return errs
}

func operationCompatible(operation EffectOperation, definition StateVariableDefinition) bool {
	switch operation {
	case EffectSet, EffectClear:
		return validValueKind(definition.ValueKind)
	case EffectAdjustNumber:
		return definition.ValueKind == ValueNumber && definition.Cardinality == CardinalityOne
	case EffectAddValue, EffectRemoveValue:
		return validValueKind(definition.ValueKind) && definition.Cardinality == CardinalityMany
	default:
		return false
	}
}

func validateChoiceOptions(options []ChoiceOption) ValidationErrors {
	var errs ValidationErrors
	ids, keys, positions := map[ID]struct{}{}, map[string]struct{}{}, map[int]struct{}{}
	for i, option := range options {
		path := fmt.Sprintf("value_schema.options[%d]", i)
		if !option.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "choice option ID is required"))
		}
		if strings.TrimSpace(option.Key) == "" {
			errs = append(errs, validation("required", path+".key", "choice option key is required"))
		}
		if strings.TrimSpace(option.Label) == "" {
			errs = append(errs, validation("required", path+".label", "choice option label is required"))
		}
		if option.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "position cannot be negative"))
		}
		if _, exists := ids[option.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "choice option ID is repeated"))
		}
		if _, exists := keys[option.Key]; exists {
			errs = append(errs, validation("duplicate", path+".key", "choice option key is repeated"))
		}
		if _, exists := positions[option.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "choice option position is repeated"))
		}
		ids[option.ID], keys[option.Key], positions[option.Position] = struct{}{}, struct{}{}, struct{}{}
	}
	return errs
}

func validateMeasurementUnits(units []MeasurementUnit) ValidationErrors {
	var errs ValidationErrors
	ids, names, positions := map[ID]struct{}{}, map[string]struct{}{}, map[int]struct{}{}
	for i, unit := range units {
		path := fmt.Sprintf("value_schema.units[%d]", i)
		if !unit.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "measurement unit ID is required"))
		}
		if strings.TrimSpace(unit.Unit) == "" {
			errs = append(errs, validation("required", path+".unit", "measurement unit is required"))
		}
		if unit.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "position cannot be negative"))
		}
		if _, exists := ids[unit.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "measurement unit ID is repeated"))
		}
		if _, exists := names[unit.Unit]; exists {
			errs = append(errs, validation("duplicate", path+".unit", "measurement unit is repeated"))
		}
		if _, exists := positions[unit.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "measurement unit position is repeated"))
		}
		ids[unit.ID], names[unit.Unit], positions[unit.Position] = struct{}{}, struct{}{}, struct{}{}
	}
	return errs
}

func validateBounds(minimum, maximum, step *Decimal, path string) ValidationErrors {
	var errs ValidationErrors
	if minimum != nil && !minimum.Valid() {
		errs = append(errs, validation("invalid_number", path+".minimum", "minimum must be a finite exact decimal"))
	}
	if maximum != nil && !maximum.Valid() {
		errs = append(errs, validation("invalid_number", path+".maximum", "maximum must be a finite exact decimal"))
	}
	if minimum != nil && maximum != nil && minimum.Valid() && maximum.Valid() && minimum.Cmp(*maximum) > 0 {
		errs = append(errs, validation("invalid_bounds", path+".maximum", "maximum must be greater than or equal to minimum"))
	}
	if step != nil && (!step.Valid() || !step.IsPositive()) {
		errs = append(errs, validation("invalid_step", path+".step", "step must be a positive finite exact decimal"))
	}
	return errs
}

func validValueKind(kind ValueKind) bool {
	switch kind {
	case ValueText, ValueChoice, ValueMeasurement, ValueNumber, ValueBoolean, ValueReference:
		return true
	default:
		return false
	}
}

func validPresentationControl(control PresentationControl) bool {
	switch control {
	case ControlShortText, ControlLongText, ControlSelect, ControlMeasurement, ControlNumber, ControlCheckbox, ControlReferencePicker:
		return true
	default:
		return false
	}
}
