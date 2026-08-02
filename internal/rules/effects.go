package rules

import (
	"fmt"
	"sort"
)

func ApplyConsequence(consequence ConsequenceSet, problem ProblemDefinition, bindings TargetBindings, entities map[ID]Entity, definitions map[ID]StateVariableDefinition, snapshot StateSnapshot) (StateSnapshot, []AppliedEffect, []ID, error) {
	working := CloneSnapshot(snapshot)
	applied := make([]AppliedEffect, 0)
	changedRecords := make(map[ID]struct{})
	effects := append([]Effect(nil), consequence.Effects...)
	sort.SliceStable(effects, func(i, j int) bool { return effects[i].Position < effects[j].Position })
	for _, effect := range effects {
		if errs := ValidateEffect(effect, problem, definitions, entities, "effects["+string(effect.ID)+"]"); len(errs) > 0 {
			return StateSnapshot{}, nil, nil, domainError(ErrInvalidDefinition, errs)
		}
		entityIDs, exists := bindings[effect.TargetDefinitionID]
		if !exists {
			return StateSnapshot{}, nil, nil, domainError(ErrInvalidBindings, ValidationErrors{validation("missing_target_binding", "bindings["+string(effect.TargetDefinitionID)+"]", "effect target has no current binding")})
		}
		for _, entityID := range entityIDs {
			record, recordExists := working.Records[entityID]
			if !recordExists {
				return StateSnapshot{}, nil, nil, domainError(ErrInvalidState, ValidationErrors{validation("missing_state_record", "records["+string(entityID)+"]", "effect target state record is absent from the snapshot")})
			}
			entity, entityExists := entities[entityID]
			if !entityExists {
				return StateSnapshot{}, nil, nil, domainError(ErrInvalidBindings, ValidationErrors{validation("unknown_entity", "bindings["+string(effect.TargetDefinitionID)+"]", "effect target entity does not exist")})
			}
			definition := definitions[effect.StateVariableID]
			if !EntityImplementsAny(entity, definition.OwnerSchemaIDs) {
				return StateSnapshot{}, nil, nil, domainError(ErrEffectApplication, ValidationErrors{validation("ineligible_state_owner", "effects["+string(effect.ID)+"]", "effect target entity cannot own the state variable")})
			}

			beforeLogical := LogicalStateValue(record, definition)
			before := cloneOptionalStateValue(beforeLogical.Value)
			updated, err := applyEffectToRecord(effect, definition, entity, entities, record)
			if err != nil {
				return StateSnapshot{}, nil, nil, err
			}
			afterLogical := LogicalStateValue(updated, definition)
			after := cloneOptionalStateValue(afterLogical.Value)
			changed := storedDefinitionChanged(record, updated, definition.ID)
			if changed {
				changedRecords[entityID] = struct{}{}
			}
			working.Records[entityID] = updated
			applied = append(applied, AppliedEffect{
				EffectID:           effect.ID,
				TargetDefinitionID: effect.TargetDefinitionID,
				EntityID:           entityID,
				StateVariableID:    effect.StateVariableID,
				Before:             before,
				After:              after,
				Changed:            changed,
			})
		}
	}
	changedIDs := make([]ID, 0, len(changedRecords))
	for entityID := range changedRecords {
		changedIDs = append(changedIDs, entityID)
	}
	sort.Slice(changedIDs, func(i, j int) bool { return changedIDs[i] < changedIDs[j] })
	return working, applied, changedIDs, nil
}

func applyEffectToRecord(effect Effect, definition StateVariableDefinition, entity Entity, entities map[ID]Entity, record StateRecord) (StateRecord, error) {
	updated := CloneStateRecord(record)
	if updated.Values == nil {
		updated.Values = make(map[ID]StateValue)
	}
	logical := LogicalStateValue(updated, definition)

	switch effect.Operation {
	case EffectSet:
		updated.Values[definition.ID] = CloneStateValue(*effect.Operand)
	case EffectClear:
		delete(updated.Values, definition.ID)
	case EffectAdjustNumber:
		if logical.Value == nil || logical.Value.Cardinality != CardinalityOne || len(logical.Value.Values) != 1 || logical.Value.Values[0].Number == nil {
			return StateRecord{}, effectApplicationError(effect, entity, "cannot adjust an unknown or non-number value")
		}
		adjusted, err := logical.Value.Values[0].Number.Add(*effect.AdjustmentAmount)
		if err != nil {
			return StateRecord{}, effectApplicationError(effect, entity, err.Error())
		}
		value := NewSingleValue(NewNumberValue(adjusted))
		if errs := ValidateStateValue(definition, value, entities); len(errs) > 0 {
			return StateRecord{}, &DomainError{Kind: ErrEffectApplication, Errors: prefixValidationErrors(errs, "effects["+string(effect.ID)+"]")}
		}
		if logical.Value != nil && StateValuesEqual(*logical.Value, value) {
			return record, nil
		}
		updated.Values[definition.ID] = value
	case EffectAddValue, EffectRemoveValue:
		if logical.Value == nil || logical.Value.Cardinality != CardinalityMany {
			return StateRecord{}, effectApplicationError(effect, entity, "cannot modify an unknown or non-set value")
		}
		values := cloneScalars(logical.Value.Values)
		operand := effect.Operand.Values[0]
		index := -1
		for i, current := range values {
			if scalarValuesEqual(current, operand) {
				index = i
				break
			}
		}
		if effect.Operation == EffectAddValue && index < 0 {
			values = append(values, CloneScalarValue(operand))
		} else if effect.Operation == EffectAddValue {
			return record, nil
		}
		if effect.Operation == EffectRemoveValue && index >= 0 {
			values = append(values[:index], values[index+1:]...)
		} else if effect.Operation == EffectRemoveValue {
			return record, nil
		}
		value := StateValue{Cardinality: CardinalityMany, Values: values}
		if errs := ValidateStateValue(definition, value, entities); len(errs) > 0 {
			return StateRecord{}, &DomainError{Kind: ErrEffectApplication, Errors: prefixValidationErrors(errs, "effects["+string(effect.ID)+"]")}
		}
		updated.Values[definition.ID] = value
	default:
		return StateRecord{}, effectApplicationError(effect, entity, "unsupported effect operation")
	}

	updated = NormalizeStateRecord(updated, map[ID]StateVariableDefinition{definition.ID: definition})
	return updated, nil
}

func storedDefinitionChanged(before, after StateRecord, definitionID ID) bool {
	beforeValue, beforeExists := before.Values[definitionID]
	afterValue, afterExists := after.Values[definitionID]
	if beforeExists != afterExists {
		return true
	}
	return beforeExists && !StateValuesEqual(beforeValue, afterValue)
}

func effectApplicationError(effect Effect, entity Entity, message string) error {
	return domainError(ErrEffectApplication, ValidationErrors{validation(
		"effect_application_failed",
		fmt.Sprintf("effects[%s].entities[%s]", effect.ID, entity.ID),
		message,
	)})
}

func cloneOptionalStateValue(value *StateValue) *StateValue {
	if value == nil {
		return nil
	}
	copy := CloneStateValue(*value)
	return &copy
}

func optionalStateValuesEqual(left, right *StateValue) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return StateValuesEqual(*left, *right)
}

func prefixValidationErrors(errs ValidationErrors, prefix string) ValidationErrors {
	result := make(ValidationErrors, len(errs))
	for i, item := range errs {
		result[i] = item
		if result[i].Path == "" {
			result[i].Path = prefix
		} else {
			result[i].Path = prefix + "." + result[i].Path
		}
	}
	return result
}
