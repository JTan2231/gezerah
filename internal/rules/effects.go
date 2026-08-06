package rules

import (
	"fmt"
	"sort"
)

// ApplyTransition validates and applies an already-concrete ordered plan to a
// working snapshot. It is pure: callers own revision checks, persistence,
// receipts, and transaction boundaries.
func ApplyTransition(plan TransitionPlan, entities map[ID]Entity, definitions map[ID]MechanicDefinition, snapshot StateSnapshot) (TransitionResult, error) {
	if errs := ValidateTransitionPlan(plan, entities, definitions); len(errs) > 0 {
		return TransitionResult{}, domainError(ErrInvalidTransition, errs)
	}
	if errs := ValidateSnapshot(snapshot, entities, definitions); len(errs) > 0 {
		return TransitionResult{}, domainError(ErrInvalidState, errs)
	}

	working := CloneSnapshot(snapshot)
	applied := make([]AppliedEffect, 0)
	changedRecords := make(map[ID]struct{})
	effects := append([]ConcreteEffect(nil), plan.Effects...)
	sort.SliceStable(effects, func(i, j int) bool { return effects[i].Position < effects[j].Position })
	for _, effect := range effects {
		definition := definitions[effect.MechanicID]
		for _, entityID := range effect.EntityIDs {
			record, recordExists := working.Records[entityID]
			if !recordExists {
				return TransitionResult{}, domainError(ErrInvalidState, ValidationErrors{validation("missing_state_record", "records["+string(entityID)+"]", "effect target state record is absent from the snapshot")})
			}
			entity := entities[entityID]
			before := LogicalStateValue(record, definition).Value
			updated, err := applyEffectToRecord(effect, definition, entity, record)
			if err != nil {
				return TransitionResult{}, err
			}
			after := LogicalStateValue(updated, definition).Value
			changed := storedMechanicChanged(record, updated, definition.ID)
			if changed {
				changedRecords[entityID] = struct{}{}
			}
			working.Records[entityID] = updated
			applied = append(applied, AppliedEffect{
				EffectID:   effect.ID,
				EntityID:   entityID,
				MechanicID: effect.MechanicID,
				Before:     before,
				After:      after,
				Changed:    changed,
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

// ValidateTransitionPlan checks the structure and world boundary of a concrete
// transition without applying it. Empty resolved target lists are valid no-ops.
func ValidateTransitionPlan(plan TransitionPlan, entities map[ID]Entity, definitions map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	ids := make(map[ID]struct{}, len(plan.Effects))
	positions := make(map[int]struct{}, len(plan.Effects))
	for index, effect := range plan.Effects {
		path := fmt.Sprintf("effects[%d]", index)
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

		definition, exists := definitions[effect.MechanicID]
		if !exists {
			errs = append(errs, validation("unknown_mechanic", path+".mechanic_id", "effect mechanic does not exist"))
			continue
		}
		if definition.ID != effect.MechanicID {
			errs = append(errs, validation("mechanic_id_mismatch", path+".mechanic_id", "mechanic map key and definition ID differ"))
		}
		for _, item := range ValidateMechanicDefinition(definition) {
			item.Path = pathForNestedValidation(path+".mechanic", item.Path)
			errs = append(errs, item)
		}
		if definition.Archived {
			errs = append(errs, validation("archived_mechanic", path+".mechanic_id", "archived mechanics cannot be changed"))
		}
		if !definition.Mutable {
			errs = append(errs, validation("mechanic_not_mutable", path+".mechanic_id", "mechanic is not mutable during play"))
		}
		if definition.SourceKind != SourceInput {
			errs = append(errs, validation("derived_mechanic", path+".mechanic_id", "derived mechanics cannot be directly changed"))
		}
		if !operationAllowed(effect.Operation, definition) {
			errs = append(errs, validation("operation_not_allowed", path+".operation", "operation is not allowed for the mechanic"))
		}
		for _, item := range validateEffectOperand(effect, definition) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}

		seenEntities := make(map[ID]struct{}, len(effect.EntityIDs))
		for entityIndex, entityID := range effect.EntityIDs {
			entityPath := fmt.Sprintf("%s.entity_ids[%d]", path, entityIndex)
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
			if entity.ID != entityID {
				errs = append(errs, validation("entity_id_mismatch", entityPath, "entity map key and entity ID differ"))
			}
			if entity.WorldID != definition.WorldID {
				errs = append(errs, validation("cross_world_reference", entityPath, "effect target and mechanic belong to different worlds"))
			}
			if entity.Archived {
				errs = append(errs, validation("archived_entity", entityPath, "archived entities cannot be changed"))
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

func validateEffectOperand(effect ConcreteEffect, definition MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if effect.Status != nil || len(effect.StatusInstanceIDs) > 0 || len(effect.StatusInstances) > 0 {
		errs = append(errs, validation("invalid_effect_operand", "", "scalar effects cannot declare status operands"))
	}
	switch effect.Operation {
	case EffectSet:
		if effect.Value == nil || effect.AdjustmentAmount != nil {
			errs = append(errs, validation("invalid_effect_operand", "", "set requires one state value and no adjustment amount"))
		} else {
			for _, item := range ValidateStateValue(definition, *effect.Value) {
				item.Path = pathForNestedValidation("value", item.Path)
				errs = append(errs, item)
			}
		}
	case EffectAdjustNumber:
		if effect.Value != nil || effect.AdjustmentAmount == nil || !effect.AdjustmentAmount.Valid() {
			errs = append(errs, validation("invalid_effect_operand", "", "adjust-number requires one finite adjustment amount and no value"))
		}
	default:
		errs = append(errs, validation("unsupported", "operation", "unsupported effect operation"))
	}
	return errs
}

func operationAllowed(operation EffectOperation, definition MechanicDefinition) bool {
	if definition.SourceKind != SourceInput {
		return false
	}
	switch operation {
	case EffectSet:
		return validValueKind(definition.ValueKind)
	case EffectAdjustNumber:
		return definition.ValueKind == ValueNumber
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

func applyEffectToRecord(effect ConcreteEffect, definition MechanicDefinition, entity Entity, record StateRecord) (StateRecord, error) {
	updated := CloneStateRecord(record)
	if updated.Values == nil {
		updated.Values = make(map[ID]StateValue)
	}
	logical := LogicalStateValue(updated, definition)

	switch effect.Operation {
	case EffectSet:
		updated.Values[definition.ID] = CloneStateValue(*effect.Value)
	case EffectAdjustNumber:
		if logical.Value.Kind != ValueNumber || logical.Value.Number == nil {
			return StateRecord{}, effectApplicationError(effect, entity, "cannot adjust a non-number value")
		}
		adjusted, err := logical.Value.Number.Add(*effect.AdjustmentAmount)
		if err != nil {
			return StateRecord{}, effectApplicationError(effect, entity, err.Error())
		}
		value := NewNumberValue(adjusted)
		if errs := ValidateStateValue(definition, value); len(errs) > 0 {
			return StateRecord{}, &DomainError{Kind: ErrEffectApplication, Errors: prefixValidationErrors(errs, "effects["+string(effect.ID)+"]")}
		}
		if StateValuesEqual(logical.Value, value) {
			return record, nil
		}
		updated.Values[definition.ID] = value
	default:
		return StateRecord{}, effectApplicationError(effect, entity, "unsupported effect operation")
	}

	updated = NormalizeStateRecord(updated, map[ID]MechanicDefinition{definition.ID: definition})
	return updated, nil
}

func storedMechanicChanged(before, after StateRecord, mechanicID ID) bool {
	beforeValue, beforeExists := before.Values[mechanicID]
	afterValue, afterExists := after.Values[mechanicID]
	if beforeExists != afterExists {
		return true
	}
	return beforeExists && !StateValuesEqual(beforeValue, afterValue)
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
