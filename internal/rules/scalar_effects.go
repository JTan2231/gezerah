package rules

import "fmt"

func validateScalarEffectOperand(effect ConcreteEffect, definition MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if effect.InlineStatus != nil || len(effect.StatusInstanceIDs) > 0 || len(effect.StatusInstances) > 0 {
		errs = append(errs, validation("invalid_effect_operand", "", "scalar effects cannot declare status operands"))
	}
	switch effect.Operation {
	case EffectSet:
		if effect.Value == nil || effect.AdjustmentAmount != nil {
			errs = append(errs, validation("invalid_effect_operand", "", "set requires one logical input value and no adjustment amount"))
		} else {
			for _, item := range ValidateMechanicValue(definition, *effect.Value) {
				item.Path = pathForNestedValidation("value", item.Path)
				errs = append(errs, item)
			}
		}
	case EffectAdjustNumber:
		if effect.Value != nil || effect.AdjustmentAmount == nil {
			errs = append(errs, validation("invalid_effect_operand", "", "adjust-number requires one finite adjustment amount and no value"))
		}
	case EffectApplyStatus, EffectRemoveStatus:
		errs = append(errs, validation("unsupported", "operation", "unsupported scalar effect operation"))
	default:
		errs = append(errs, validation("unsupported", "operation", "unsupported effect operation"))
	}
	return errs
}

func scalarEffectOperationAllowed(operation EffectOperation, definition MechanicDefinition) bool {
	if definition.SourceKind != SourceInput {
		return false
	}
	switch operation {
	case EffectSet:
		return validValueKind(definition.ValueKind)
	case EffectAdjustNumber:
		return definition.ValueKind == ValueNumber
	case EffectApplyStatus, EffectRemoveStatus:
		return false
	default:
		return false
	}
}

func pathForNestedValidation(prefix, path string) string {
	if path == "" || path == prefix {
		return prefix
	}
	if len(path) >= len(prefix) && path[:len(prefix)] == prefix {
		return path
	}
	return prefix + "." + path
}

func applyScalarEffectToInputOverrideRecord(effect ConcreteEffect, definition MechanicDefinition, entity Entity, record InputOverrideRecord) (InputOverrideRecord, error) {
	updated := CloneInputOverrideRecord(record)
	if updated.Overrides == nil {
		updated.Overrides = make(map[ID]MechanicValue)
	}
	logical := ResolveLogicalInputValue(updated, definition)

	switch effect.Operation {
	case EffectSet:
		updated.Overrides[definition.ID] = CloneMechanicValue(*effect.Value)
	case EffectAdjustNumber:
		if logical.Value.Kind != ValueNumber || logical.Value.Number == nil {
			return InputOverrideRecord{}, effectApplicationError(effect, entity, "cannot adjust a non-number logical input value")
		}
		adjusted, err := logical.Value.Number.Add(*effect.AdjustmentAmount)
		if err != nil {
			return InputOverrideRecord{}, effectApplicationError(effect, entity, err.Error())
		}
		value := NewNumberMechanicValue(adjusted)
		if errs := ValidateMechanicValue(definition, value); len(errs) > 0 {
			return InputOverrideRecord{}, &DomainError{Kind: ErrEffectApplication, Errors: prefixValidationErrors(errs, "effects["+string(effect.ID)+"]")}
		}
		if MechanicValuesEqual(logical.Value, value) {
			return record, nil
		}
		updated.Overrides[definition.ID] = value
	case EffectApplyStatus, EffectRemoveStatus:
		return InputOverrideRecord{}, effectApplicationError(effect, entity, "unsupported scalar effect operation")
	default:
		return InputOverrideRecord{}, effectApplicationError(effect, entity, "unsupported effect operation")
	}

	updated = NormalizeInputOverrideRecord(updated, map[ID]MechanicDefinition{definition.ID: definition})
	return updated, nil
}

func storedOverrideChanged(before, after InputOverrideRecord, mechanicID ID) bool {
	beforeValue, beforeExists := before.Overrides[mechanicID]
	afterValue, afterExists := after.Overrides[mechanicID]
	if beforeExists != afterExists {
		return true
	}
	return beforeExists && !MechanicValuesEqual(beforeValue, afterValue)
}

func effectApplicationError(effect ConcreteEffect, entity Entity, message string) error {
	return domainError(ErrEffectApplication, ValidationErrors{validation(
		"effect_application_failed",
		fmt.Sprintf("effects[%s].entities[%s]", effect.ID, entity.ID),
		message,
	)})
}

func prefixValidationErrors(errs ValidationErrors, prefix string) ValidationErrors {
	result := make(ValidationErrors, len(errs))
	for i, item := range errs {
		result[i] = item
		result[i].Path = pathForNestedValidation(prefix, result[i].Path)
	}
	return result
}
