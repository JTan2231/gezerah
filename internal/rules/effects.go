package rules

import (
	"fmt"
	"sort"
)

func ApplyConsequence(consequence ConsequenceSet, problem ProblemDefinition, bindings TargetBindings, entities map[ID]Entity, definitions map[ID]StateVariableDefinition, snapshot StateSnapshot) (StateSnapshot, []AppliedEffect, []ID, error) {
	effects := append([]Effect(nil), consequence.Effects...)
	sort.SliceStable(effects, func(i, j int) bool { return effects[i].Position < effects[j].Position })
	plan := TransitionPlan{Effects: make([]ConcreteEffect, 0, len(effects))}
	for _, effect := range effects {
		if errs := ValidateEffect(effect, problem, definitions, entities, "effects["+string(effect.ID)+"]"); len(errs) > 0 {
			return StateSnapshot{}, nil, nil, domainError(ErrInvalidDefinition, errs)
		}
		entityIDs, exists := bindings[effect.TargetDefinitionID]
		if !exists {
			return StateSnapshot{}, nil, nil, domainError(ErrInvalidBindings, ValidationErrors{validation("missing_target_binding", "bindings["+string(effect.TargetDefinitionID)+"]", "effect target has no current binding")})
		}
		plan.Effects = append(plan.Effects, ConcreteEffect{
			ID:                 effect.ID,
			Position:           effect.Position,
			Operation:          effect.Operation,
			TargetDefinitionID: effect.TargetDefinitionID,
			EntityIDs:          append([]ID(nil), entityIDs...),
			StateVariableID:    effect.StateVariableID,
			Operand:            cloneOptionalStateValue(effect.Operand),
			AdjustmentAmount:   effect.AdjustmentAmount,
		})
	}
	result, err := ApplyTransition(plan, entities, definitions, snapshot)
	if err != nil {
		return StateSnapshot{}, nil, nil, err
	}
	return result.State, result.AppliedEffects, result.ChangedRecordIDs, nil
}

// ApplyTransition validates and applies an already-concrete ordered plan to a
// working snapshot. It is pure: callers own revision checks, persistence,
// receipts, and transaction boundaries.
func ApplyTransition(plan TransitionPlan, entities map[ID]Entity, definitions map[ID]StateVariableDefinition, snapshot StateSnapshot) (TransitionResult, error) {
	if errs := ValidateTransitionPlan(plan, entities, definitions); len(errs) > 0 {
		return TransitionResult{}, domainError(ErrInvalidDefinition, errs)
	}
	if errs := ValidateSnapshot(snapshot, entities, definitions); len(errs) > 0 {
		return TransitionResult{}, domainError(ErrInvalidState, errs)
	}

	working := CloneSnapshot(snapshot)
	applied := make([]AppliedEffect, 0)
	changedRecords := make(map[ID]struct{})
	effects := append([]ConcreteEffect(nil), plan.Effects...)
	sort.SliceStable(effects, func(i, j int) bool { return effects[i].Position < effects[j].Position })
	for _, concrete := range effects {
		definition := definitions[concrete.StateVariableID]
		effect := Effect{
			ID:                 concrete.ID,
			Position:           concrete.Position,
			Operation:          concrete.Operation,
			TargetDefinitionID: concrete.TargetDefinitionID,
			StateVariableID:    concrete.StateVariableID,
			Operand:            concrete.Operand,
			AdjustmentAmount:   concrete.AdjustmentAmount,
		}
		for _, entityID := range concrete.EntityIDs {
			record, recordExists := working.Records[entityID]
			if !recordExists {
				return TransitionResult{}, domainError(ErrInvalidState, ValidationErrors{validation("missing_state_record", "records["+string(entityID)+"]", "effect target state record is absent from the snapshot")})
			}
			entity, entityExists := entities[entityID]
			if !entityExists {
				return TransitionResult{}, domainError(ErrInvalidBindings, ValidationErrors{validation("unknown_entity", "effects["+string(effect.ID)+"].entity_ids", "effect target entity does not exist")})
			}

			beforeLogical := LogicalStateValue(record, definition)
			before := cloneOptionalStateValue(beforeLogical.Value)
			updated, err := applyEffectToRecord(effect, definition, entity, entities, record)
			if err != nil {
				return TransitionResult{}, err
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
				TargetDefinitionID: concrete.TargetDefinitionID,
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
	return TransitionResult{State: working, AppliedEffects: applied, ChangedRecordIDs: changedIDs}, nil
}

// ValidateTransitionPlan checks the structural and ownership invariants of a
// concrete transition without applying it.
func ValidateTransitionPlan(plan TransitionPlan, entities map[ID]Entity, definitions map[ID]StateVariableDefinition) ValidationErrors {
	var errs ValidationErrors
	ids := make(map[ID]struct{}, len(plan.Effects))
	positions := make(map[int]struct{}, len(plan.Effects))
	for _, effect := range plan.Effects {
		path := "effects[" + string(effect.ID) + "]"
		if !effect.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "effect ID is required"))
		}
		if _, exists := ids[effect.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "effect ID is repeated"))
		}
		ids[effect.ID] = struct{}{}
		if effect.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "effect position cannot be negative"))
		}
		if _, exists := positions[effect.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "effect position is repeated"))
		}
		positions[effect.Position] = struct{}{}

		definition, exists := definitions[effect.StateVariableID]
		if !exists {
			errs = append(errs, validation("unknown_state_variable", path+".state_variable_id", "effect state variable does not exist"))
			continue
		}
		if !containsEffectOperation(definition.AllowedEffectOperations, effect.Operation) {
			errs = append(errs, validation("operation_not_enabled", path+".operation", "operation is not enabled by the variable"))
		}
		if !operationCompatible(effect.Operation, definition) {
			errs = append(errs, validation("incompatible_operation", path+".operation", "operation is incompatible with the variable schema"))
		}
		// A ruleset-level reference default is only usable in a concrete game
		// when its referenced entity is present in the supplied game-scoped
		// entity map. This makes the otherwise implicit cross-game coupling fail
		// closed at the live transition boundary.
		if definition.DefaultValue != nil {
			for _, item := range ValidateStateValue(definition, *definition.DefaultValue, entities) {
				item.Path = pathForNestedValidation(path+".default_value", item.Path)
				errs = append(errs, item)
			}
		}
		domainEffect := Effect{ID: effect.ID, Operation: effect.Operation, StateVariableID: effect.StateVariableID, Operand: effect.Operand, AdjustmentAmount: effect.AdjustmentAmount}
		for _, item := range validateEffectOperand(domainEffect, definition, entities, path) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}

		seenEntities := make(map[ID]struct{}, len(effect.EntityIDs))
		for index, entityID := range effect.EntityIDs {
			entityPath := fmt.Sprintf("%s.entity_ids[%d]", path, index)
			if _, duplicate := seenEntities[entityID]; duplicate {
				errs = append(errs, validation("duplicate", entityPath, "effect target entity is repeated"))
				continue
			}
			seenEntities[entityID] = struct{}{}
			entity, entityExists := entities[entityID]
			if !entityExists {
				errs = append(errs, validation("unknown_entity", entityPath, "effect target entity does not exist"))
				continue
			}
			if entity.RuleSetID != definition.RuleSetID {
				errs = append(errs, validation("cross_ruleset_reference", entityPath, "effect target and variable belong to different rulesets"))
			} else if !EntityImplementsAny(entity, definition.OwnerSchemaIDs) {
				errs = append(errs, validation("ineligible_state_owner", entityPath, "effect target entity cannot own the state variable"))
			}
		}
	}
	for position := 0; position < len(plan.Effects); position++ {
		if _, exists := positions[position]; !exists {
			errs = append(errs, validation("incomplete_positions", "effects", "effect positions must form a complete zero-based sequence"))
			break
		}
	}
	return errs
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
