package rules

import (
	"fmt"
	"math"
	"sort"
)

// ApplyRuntimeTransition atomically applies ordered scalar mutations and
// consequence-owned status lifecycle operations to a cloned runtime snapshot.
// Status instance IDs are assigned by the caller for each apply-status target.
func ApplyRuntimeTransition(
	plan TransitionPlan,
	entities map[ID]Entity,
	mechanics map[ID]MechanicDefinition,
	statusSnapshots map[ID]StatusSnapshot,
	snapshot RuntimeSnapshot,
) (RuntimeTransitionResult, error) {
	if errs := ValidateMechanicGraph(mechanics); len(errs) > 0 {
		return RuntimeTransitionResult{}, domainError(ErrInvalidDefinition, errs)
	}
	if errs := ValidateStatusSnapshots(statusSnapshots, mechanics); len(errs) > 0 {
		return RuntimeTransitionResult{}, domainError(ErrInvalidDefinition, errs)
	}
	if errs := ValidateRuntimeTransitionPlan(plan, entities, mechanics, statusSnapshots); len(errs) > 0 {
		return RuntimeTransitionResult{}, domainError(ErrInvalidTransition, errs)
	}
	if errs := ValidateSnapshot(snapshot.State, entities, mechanics); len(errs) > 0 {
		return RuntimeTransitionResult{}, domainError(ErrInvalidState, errs)
	}
	if errs := ValidateRuntimeStatusSnapshot(snapshot.ActiveStatuses, entities, statusSnapshots); len(errs) > 0 {
		return RuntimeTransitionResult{}, domainError(ErrInvalidState, errs)
	}
	for _, effect := range plan.Effects {
		for _, entityID := range effect.EntityIDs {
			if _, exists := snapshot.State.Records[entityID]; !exists {
				return RuntimeTransitionResult{}, domainError(ErrInvalidState, ValidationErrors{validation(
					"missing_state_record",
					"records["+string(entityID)+"]",
					"effect target state record is absent from the runtime snapshot",
				)})
			}
		}
	}

	workingState := CloneSnapshot(snapshot.State)
	workingStatuses := cloneActiveStatuses(snapshot.ActiveStatuses)
	appliedEffects := make([]AppliedEffect, 0)
	appliedStatuses := make([]AppliedStatusCommand, 0)
	changedRecords := make(map[ID]struct{})
	effects := append([]ConcreteEffect(nil), plan.Effects...)
	sort.SliceStable(effects, func(i, j int) bool { return effects[i].Position < effects[j].Position })
	for _, effect := range effects {
		switch effect.Operation {
		case EffectSet, EffectAdjustNumber:
			definition := mechanics[effect.MechanicID]
			for _, entityID := range effect.EntityIDs {
				record := workingState.Records[entityID]
				before := LogicalStateValue(record, definition).Value
				updated, err := applyEffectToRecord(effect, definition, entities[entityID], record)
				if err != nil {
					return RuntimeTransitionResult{}, err
				}
				after := LogicalStateValue(updated, definition).Value
				changed := storedMechanicChanged(record, updated, definition.ID)
				if changed {
					changedRecords[entityID] = struct{}{}
				}
				workingState.Records[entityID] = updated
				appliedEffects = append(appliedEffects, AppliedEffect{
					EffectID: effect.ID, EntityID: entityID, MechanicID: definition.ID,
					Before: before, After: after, Changed: changed,
				})
			}

		case EffectApplyStatus:
			for _, entityID := range effect.EntityIDs {
				instance := effect.StatusInstances[entityID]
				if instance.AppliedOrder == 0 {
					appliedOrder, err := nextAppliedOrder(workingStatuses, entityID)
					if err != nil {
						return RuntimeTransitionResult{}, effectApplicationError(effect, entities[entityID], err.Error())
					}
					instance.AppliedOrder = appliedOrder
				}
				if findActiveStatusID(workingStatuses, entityID, instance.ID) >= 0 {
					return RuntimeTransitionResult{}, effectApplicationError(effect, entities[entityID], "status instance ID is already active")
				}
				workingStatuses = append(workingStatuses, instance)
				appliedStatuses = append(appliedStatuses, AppliedStatusCommand{
					EffectID: effect.ID, EntityID: entityID, SourceEffectID: effect.ID,
					StatusInstanceID: instance.ID, Operation: effect.Operation, Changed: true,
				})
			}

		case EffectRemoveStatus:
			for _, entityID := range effect.EntityIDs {
				instanceID := effect.StatusInstanceIDs[entityID]
				index := findActiveStatusID(workingStatuses, entityID, instanceID)
				if index < 0 {
					return RuntimeTransitionResult{}, effectApplicationError(effect, entities[entityID], "status instance is not active on the target entity")
				}
				removed := workingStatuses[index]
				workingStatuses = append(workingStatuses[:index], workingStatuses[index+1:]...)
				appliedStatuses = append(appliedStatuses, AppliedStatusCommand{
					EffectID: effect.ID, EntityID: entityID, SourceEffectID: removed.SourceEffectID,
					StatusInstanceID: removed.ID, Operation: effect.Operation, Changed: true,
				})
			}
		default:
			return RuntimeTransitionResult{}, effectApplicationError(effect, Entity{}, "unsupported effect operation")
		}
	}

	changedIDs := make([]ID, 0, len(changedRecords))
	for entityID := range changedRecords {
		changedIDs = append(changedIDs, entityID)
	}
	sort.Slice(changedIDs, func(i, j int) bool { return changedIDs[i] < changedIDs[j] })
	sort.Slice(workingStatuses, func(i, j int) bool {
		if workingStatuses[i].EntityID != workingStatuses[j].EntityID {
			return workingStatuses[i].EntityID < workingStatuses[j].EntityID
		}
		if workingStatuses[i].AppliedOrder != workingStatuses[j].AppliedOrder {
			return workingStatuses[i].AppliedOrder < workingStatuses[j].AppliedOrder
		}
		return workingStatuses[i].ID < workingStatuses[j].ID
	})
	return RuntimeTransitionResult{
		AppliedEffects: appliedEffects, AppliedStatusCommands: appliedStatuses,
		State: workingState, ActiveStatuses: workingStatuses, ChangedRecordIDs: changedIDs,
	}, nil
}

// ValidateRuntimeTransitionPlan validates the generic ordered effect shape and
// all world-scoped targets. Inline apply specs are keyed by their effect ID;
// removals pair every entity with one exact active-instance ID.
func ValidateRuntimeTransitionPlan(
	plan TransitionPlan,
	entities map[ID]Entity,
	mechanics map[ID]MechanicDefinition,
	statusSnapshots map[ID]StatusSnapshot,
) ValidationErrors {
	var errs ValidationErrors
	ids := make(map[ID]struct{}, len(plan.Effects))
	positions := make(map[int]struct{}, len(plan.Effects))
	statusInstanceIDs := make(map[ID]struct{})
	removeInstanceIDs := make(map[ID]struct{})
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

		worldID, targetKnown := validateRuntimeEffectOperands(effect, path, mechanics, statusSnapshots, &errs)
		seenEntities := make(map[ID]struct{}, len(effect.EntityIDs))
		for entityIndex, entityID := range effect.EntityIDs {
			entityPath := fmt.Sprintf("%s.entity_ids[%d]", path, entityIndex)
			if _, duplicate := seenEntities[entityID]; duplicate {
				errs = append(errs, validation("duplicate", entityPath, "effect target entity is repeated"))
				continue
			}
			seenEntities[entityID] = struct{}{}
			entity, exists := entities[entityID]
			if !exists {
				errs = append(errs, validation("unknown_entity", entityPath, "effect target entity does not exist"))
				continue
			}
			if entity.ID != entityID {
				errs = append(errs, validation("entity_id_mismatch", entityPath, "entity map key and entity ID differ"))
			}
			if targetKnown && entity.WorldID != worldID {
				errs = append(errs, validation("cross_world_reference", entityPath, "effect target belongs to another world"))
			}
			if entity.Archived {
				errs = append(errs, validation("archived_entity", entityPath, "archived entities cannot be changed"))
			}
		}

		if effect.Operation == EffectApplyStatus {
			for _, entityID := range sortedStatusInstanceEntityIDs(effect.StatusInstances) {
				instance := effect.StatusInstances[entityID]
				instancePath := path + ".status_instances[" + string(entityID) + "]"
				if _, targeted := seenEntities[entityID]; !targeted {
					errs = append(errs, validation("unexpected_status_instance", instancePath, "status instance entity is not an effect target"))
				}
				if instance.ID.Valid() {
					if _, duplicate := statusInstanceIDs[instance.ID]; duplicate {
						errs = append(errs, validation("duplicate", instancePath+".id", "status instance ID is repeated across the transition"))
					}
					statusInstanceIDs[instance.ID] = struct{}{}
				}
			}
		}
		if effect.Operation == EffectRemoveStatus {
			for entityID, instanceID := range effect.StatusInstanceIDs {
				instancePath := path + ".status_instance_ids[" + string(entityID) + "]"
				if _, targeted := seenEntities[entityID]; !targeted {
					errs = append(errs, validation("unexpected_status_instance", instancePath, "status instance entity is not an effect target"))
				}
				if instanceID.Valid() {
					if _, duplicate := removeInstanceIDs[instanceID]; duplicate {
						errs = append(errs, validation("duplicate", instancePath, "status instance is removed more than once"))
					}
					removeInstanceIDs[instanceID] = struct{}{}
				}
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

func validateRuntimeEffectOperands(
	effect ConcreteEffect,
	path string,
	mechanics map[ID]MechanicDefinition,
	statusSnapshots map[ID]StatusSnapshot,
	errs *ValidationErrors,
) (ID, bool) {
	switch effect.Operation {
	case EffectSet, EffectAdjustNumber:
		if effect.Status != nil || len(effect.StatusInstances) > 0 || len(effect.StatusInstanceIDs) > 0 {
			*errs = append(*errs, validation("invalid_effect_operand", path, "scalar effects cannot declare status operands"))
		}
		definition, exists := mechanics[effect.MechanicID]
		if !exists {
			*errs = append(*errs, validation("unknown_mechanic", path+".mechanic_id", "effect mechanic does not exist"))
			return "", false
		}
		if definition.ID != effect.MechanicID {
			*errs = append(*errs, validation("mechanic_id_mismatch", path+".mechanic_id", "mechanic map key and definition ID differ"))
		}
		if definition.Archived {
			*errs = append(*errs, validation("archived_mechanic", path+".mechanic_id", "archived mechanics cannot be changed"))
		}
		if definition.SourceKind != SourceInput {
			*errs = append(*errs, validation("derived_mechanic", path+".mechanic_id", "derived mechanics cannot be directly changed"))
		}
		if !definition.Mutable {
			*errs = append(*errs, validation("mechanic_not_mutable", path+".mechanic_id", "mechanic is not mutable during play"))
		}
		if !operationAllowed(effect.Operation, definition) {
			*errs = append(*errs, validation("operation_not_allowed", path+".operation", "operation is not allowed for the mechanic"))
		}
		for _, item := range validateEffectOperand(effect, definition) {
			item.Path = pathForNestedValidation(path, item.Path)
			*errs = append(*errs, item)
		}
		return definition.WorldID, true

	case EffectApplyStatus:
		if effect.MechanicID.Valid() || effect.Value != nil || effect.AdjustmentAmount != nil || len(effect.StatusInstanceIDs) > 0 {
			*errs = append(*errs, validation("invalid_effect_operand", path, "apply-status cannot declare scalar or removal operands"))
		}
		if effect.Status == nil {
			*errs = append(*errs, validation("required", path+".status", "apply-status requires an inline status specification"))
			return "", false
		}
		snapshot := *effect.Status
		if snapshot.ID != effect.ID {
			*errs = append(*errs, validation("status_id_mismatch", path+".status.id", "inline status ID must equal its owning effect ID"))
		}
		configured, exists := statusSnapshots[effect.ID]
		if !exists || configured.ID != snapshot.ID {
			*errs = append(*errs, validation("unknown_status", path+".status", "inline status snapshot is missing from the transition configuration"))
		}
		for _, entityID := range effect.EntityIDs {
			instance, supplied := effect.StatusInstances[entityID]
			instancePath := path + ".status_instances[" + string(entityID) + "]"
			if !supplied {
				*errs = append(*errs, validation("required", instancePath, "apply-status requires a preassigned instance for every target entity"))
				continue
			}
			if !instance.ID.Valid() {
				*errs = append(*errs, validation("required", instancePath+".id", "status instance ID is required"))
			}
			if instance.EntityID != entityID {
				*errs = append(*errs, validation("entity_mismatch", instancePath+".entity_id", "status instance does not belong to its target entity"))
			}
			if instance.WorldID != snapshot.WorldID {
				*errs = append(*errs, validation("cross_world_reference", instancePath+".world_id", "status instance and inline status belong to different worlds"))
			}
			if instance.SourceEffectID != snapshot.ID {
				*errs = append(*errs, validation("status_id_mismatch", instancePath+".source_effect_id", "status instance references a different source effect"))
			}
			if instance.AppliedOrder < 0 {
				*errs = append(*errs, validation("invalid_position", instancePath+".applied_order", "status applied order cannot be negative"))
			}
		}
		return snapshot.WorldID, true

	case EffectRemoveStatus:
		if effect.MechanicID.Valid() || effect.Value != nil || effect.AdjustmentAmount != nil || effect.Status != nil || len(effect.StatusInstances) > 0 {
			*errs = append(*errs, validation("invalid_effect_operand", path, "remove-status can declare only exact status-instance targets"))
		}
		for _, entityID := range effect.EntityIDs {
			instanceID, supplied := effect.StatusInstanceIDs[entityID]
			if !supplied || !instanceID.Valid() {
				*errs = append(*errs, validation("required", path+".status_instance_ids["+string(entityID)+"]", "remove-status requires an active status instance for every target entity"))
			}
		}
		return "", false
	default:
		*errs = append(*errs, validation("unsupported", path+".operation", "unsupported effect operation"))
		return "", false
	}
}

// ValidateRuntimeStatusSnapshot validates active instances across all target
// entities. Snapshot maps are keyed by immutable source effect IDs.
func ValidateRuntimeStatusSnapshot(active []ActiveStatus, entities map[ID]Entity, statusSnapshots map[ID]StatusSnapshot) ValidationErrors {
	var errs ValidationErrors
	grouped := make(map[ID][]ActiveStatus)
	globalIDs := make(map[ID]struct{}, len(active))
	for index, status := range active {
		path := fmt.Sprintf("active_statuses[%d]", index)
		if _, duplicate := globalIDs[status.ID]; duplicate {
			errs = append(errs, validation("duplicate", path+".id", "active status ID is repeated"))
		}
		globalIDs[status.ID] = struct{}{}
		entity, exists := entities[status.EntityID]
		if !exists {
			errs = append(errs, validation("unknown_entity", path+".entity_id", "active status entity does not exist"))
			continue
		}
		grouped[entity.ID] = append(grouped[entity.ID], status)
	}
	entityIDs := make([]ID, 0, len(grouped))
	for entityID := range grouped {
		entityIDs = append(entityIDs, entityID)
	}
	sort.Slice(entityIDs, func(i, j int) bool { return entityIDs[i] < entityIDs[j] })
	for _, entityID := range entityIDs {
		for _, item := range ValidateActiveStatuses(entities[entityID], statusSnapshots, grouped[entityID]) {
			item.Path = pathForNestedValidation("entities["+string(entityID)+"]", item.Path)
			errs = append(errs, item)
		}
	}
	return errs
}

func findActiveStatusID(active []ActiveStatus, entityID, statusID ID) int {
	for index, status := range active {
		if status.EntityID == entityID && status.ID == statusID {
			return index
		}
	}
	return -1
}

func nextAppliedOrder(active []ActiveStatus, entityID ID) (int64, error) {
	var maximum int64
	for _, status := range active {
		if status.EntityID == entityID && status.AppliedOrder > maximum {
			maximum = status.AppliedOrder
		}
	}
	if maximum == math.MaxInt64 {
		return 0, fmt.Errorf("active status applied order is exhausted")
	}
	return maximum + 1, nil
}

func sortedStatusInstanceEntityIDs(instances map[ID]ActiveStatus) []ID {
	result := make([]ID, 0, len(instances))
	for entityID := range instances {
		result = append(result, entityID)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}
