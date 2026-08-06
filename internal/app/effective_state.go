package app

import (
	"context"
	"errors"
	"sort"
	"time"

	"dnd/internal/rules"
)

// loadedStatusSet is the immutable status-instance view consumed by one state
// evaluation. Modifiers come from immutable consequence snapshots.
type loadedStatusSet struct {
	Revision  int64
	Active    []rules.ActiveStatus
	Snapshots map[rules.ID]rules.StatusSnapshot
	Responses []activeStatusResponse
	Names     map[rules.ID]string
}

func loadActiveStatusSet(ctx context.Context, db queryer, worldID, entityID string) (loadedStatusSet, error) {
	result := loadedStatusSet{
		Active:    []rules.ActiveStatus{},
		Snapshots: make(map[rules.ID]rules.StatusSnapshot),
		Responses: []activeStatusResponse{},
		Names:     make(map[rules.ID]string),
	}
	if err := db.QueryRow(ctx, `
		select revision from entity_status_sets where world_id = $1 and entity_id = $2`,
		worldID, entityID,
	).Scan(&result.Revision); err != nil {
		return result, err
	}

	rows, err := db.Query(ctx, `
		select instance.id::text, instance.source_effect_id::text,
			instance.status_name, instance.status_description,
			resolution.interaction_id::text, instance.source_resolution_id::text,
			instance.applied_order, instance.applied_at,
			modifier.source_modifier_id::text, modifier.mechanic_id::text,
			modifier.operation, modifier.value_kind, modifier.number_value::text,
			modifier.boolean_value, modifier.priority, modifier.position
		from entity_status_instances instance
		join interaction_resolutions resolution
			on resolution.id = instance.source_resolution_id and resolution.world_id = instance.world_id
		left join entity_status_instance_modifiers modifier
			on modifier.status_instance_id = instance.id and modifier.world_id = instance.world_id
		where instance.world_id = $1 and instance.entity_id = $2 and instance.status = 'active'
		order by instance.applied_order, instance.id, modifier.position`, worldID, entityID)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	responseIndexes := make(map[string]int)
	for rows.Next() {
		var instanceID, sourceEffectID, name, sourceInteractionID, sourceResolutionID string
		var description *string
		var appliedOrder int64
		var appliedAt time.Time
		var modifierID, mechanicID, operation, valueKind, number *string
		var boolean *bool
		var priority, position *int
		if err := rows.Scan(
			&instanceID, &sourceEffectID, &name, &description,
			&sourceInteractionID, &sourceResolutionID, &appliedOrder, &appliedAt,
			&modifierID, &mechanicID, &operation, &valueKind, &number, &boolean,
			&priority, &position,
		); err != nil {
			return result, err
		}

		index, exists := responseIndexes[instanceID]
		if !exists {
			index = len(result.Responses)
			responseIndexes[instanceID] = index
			result.Active = append(result.Active, rules.ActiveStatus{
				ID:             rules.ID(instanceID),
				WorldID:        rules.ID(worldID),
				EntityID:       rules.ID(entityID),
				SourceEffectID: rules.ID(sourceEffectID),
				AppliedOrder:   appliedOrder,
			})
			result.Snapshots[rules.ID(sourceEffectID)] = rules.StatusSnapshot{
				ID: rules.ID(sourceEffectID), WorldID: rules.ID(worldID),
				Modifiers: []rules.StatusModifier{},
			}
			result.Names[rules.ID(sourceEffectID)] = name
			result.Responses = append(result.Responses, activeStatusResponse{
				ID: instanceID, Name: name, Description: description,
				SourceInteractionID: sourceInteractionID, SourceResolutionID: sourceResolutionID,
				SourceEffectID: sourceEffectID,
				AppliedOrder:   appliedOrder, AppliedAt: appliedAt,
				Modifiers: []statusModifierResponse{},
			})
		}
		if modifierID == nil {
			continue
		}
		if mechanicID == nil || operation == nil || valueKind == nil || priority == nil || position == nil {
			return result, errors.New("active status modifier snapshot is incomplete")
		}
		value, err := databaseStateValue(*valueKind, number, boolean)
		if err != nil {
			return result, err
		}
		snapshot := result.Snapshots[rules.ID(sourceEffectID)]
		snapshot.Modifiers = append(snapshot.Modifiers, rules.StatusModifier{
			ID: rules.ID(*modifierID), Position: *position, Priority: *priority,
			MechanicID: rules.ID(*mechanicID), Operation: rules.ModifierOperation(*operation),
			Value: value,
		})
		result.Snapshots[rules.ID(sourceEffectID)] = snapshot
		result.Responses[index].Modifiers = append(result.Responses[index].Modifiers, statusModifierResponse{
			ID: *modifierID, MechanicID: *mechanicID, Operation: *operation,
			Value: stateValueDomainToDTO(value), Priority: *priority, Position: *position,
		})
	}
	return result, rows.Err()
}

func loadEntityForRules(ctx context.Context, db queryer, worldID, entityID string) (rules.Entity, error) {
	entity := rules.Entity{ID: rules.ID(entityID), WorldID: rules.ID(worldID)}
	err := db.QueryRow(ctx, `
		select display_name, archived, created_at, updated_at
		from entities where world_id = $1 and id = $2`, worldID, entityID,
	).Scan(&entity.DisplayName, &entity.Archived, &entity.CreatedAt, &entity.UpdatedAt)
	return entity, err
}

func evaluatedStateResponse(
	entity rules.Entity,
	record rules.StateRecord,
	definitions map[rules.ID]rules.MechanicDefinition,
	rulesRevision int64,
	statuses loadedStatusSet,
) (stateRecordResponse, error) {
	evaluated, err := rules.EvaluateEntityState(entity, record, definitions, statuses.Snapshots, statuses.Active)
	if err != nil {
		return stateRecordResponse{}, err
	}
	logical := rules.MaterializeLogicalState(entity, record, definitions)
	response := stateRecordResponse{
		EntityID: string(entity.ID), Revision: record.Revision,
		StatusRevision: statuses.Revision, RulesRevision: rulesRevision,
		Values:               make(map[string]stateValueDTO, len(logical.Values)),
		EffectiveValues:      make(map[string]stateValueDTO, len(evaluated.Values)),
		Evaluations:          make(map[string]evaluatedMechanicResponse, len(evaluated.Values)),
		ActiveStatuses:       statuses.Responses,
		DefaultedMechanicIDs: make([]string, len(logical.DefaultedMechanicIDs)),
		UpdatedAt:            record.UpdatedAt,
	}
	for mechanicID, value := range logical.Values {
		response.Values[string(mechanicID)] = stateValueDomainToDTO(value)
	}
	for index, mechanicID := range logical.DefaultedMechanicIDs {
		response.DefaultedMechanicIDs[index] = string(mechanicID)
	}
	for _, mechanicID := range evaluated.Order {
		value := evaluated.Values[mechanicID]
		response.EffectiveValues[string(mechanicID)] = stateValueDomainToDTO(value.Effective)
		presence := "derived"
		if value.SourceKind == rules.SourceInput {
			presence = string(value.InputPresence)
		}
		modifiers := make([]appliedModifierResponse, len(value.Modifiers))
		for index, modifier := range value.Modifiers {
			modifiers[index] = appliedModifierResponse{
				StatusInstanceID: string(modifier.StatusInstanceID),
				StatusName:       statuses.Names[modifier.SourceEffectID],
				ModifierID:       string(modifier.ModifierID), Operation: string(modifier.Operation),
				Priority: modifier.Priority, Operand: stateValueDomainToDTO(modifier.Operand),
				Before: stateValueDomainToDTO(modifier.Before), After: stateValueDomainToDTO(modifier.After),
			}
		}
		response.Evaluations[string(mechanicID)] = evaluatedMechanicResponse{
			SourceKind: string(value.SourceKind), Presence: presence,
			Intrinsic: stateValueDomainToDTO(value.Intrinsic),
			Effective: stateValueDomainToDTO(value.Effective), Modifiers: modifiers,
		}
	}
	return response, nil
}

func loadEvaluatedStateResponse(ctx context.Context, db queryer, worldID, entityID string) (stateRecordResponse, error) {
	for attempt := 0; attempt < 3; attempt++ {
		rulesRevision, err := loadRulesRevision(ctx, db, worldID)
		if err != nil {
			return stateRecordResponse{}, err
		}
		mechanics, err := loadWorldMechanics(ctx, db, worldID, "")
		if err != nil {
			return stateRecordResponse{}, err
		}
		entity, err := loadEntityForRules(ctx, db, worldID, entityID)
		if err != nil {
			return stateRecordResponse{}, err
		}
		record, err := loadStoredStateRecord(ctx, db, worldID, entityID)
		if err != nil {
			return stateRecordResponse{}, err
		}
		statuses, err := loadActiveStatusSet(ctx, db, worldID, entityID)
		if err != nil {
			return stateRecordResponse{}, err
		}
		var rulesAfter, stateAfter, statusesAfter int64
		if err := db.QueryRow(ctx, `select revision from world_rule_sets where world_id = $1`, worldID).Scan(&rulesAfter); err != nil {
			return stateRecordResponse{}, err
		}
		if err := db.QueryRow(ctx, `select revision from state_records where world_id = $1 and entity_id = $2`, worldID, entityID).Scan(&stateAfter); err != nil {
			return stateRecordResponse{}, err
		}
		if err := db.QueryRow(ctx, `select revision from entity_status_sets where world_id = $1 and entity_id = $2`, worldID, entityID).Scan(&statusesAfter); err != nil {
			return stateRecordResponse{}, err
		}
		if rulesAfter != rulesRevision || stateAfter != record.Revision || statusesAfter != statuses.Revision {
			continue
		}
		return evaluatedStateResponse(entity, record, mechanicDefinitions(mechanics), rulesRevision, statuses)
	}
	return stateRecordResponse{}, errors.New("entity state changed repeatedly while it was being evaluated")
}

func effectiveChanges(
	entityID rules.ID,
	before rules.EvaluatedState,
	after rules.EvaluatedState,
) []effectiveChangeResponse {
	mechanicIDs := make([]rules.ID, 0, len(after.Values))
	for mechanicID := range after.Values {
		mechanicIDs = append(mechanicIDs, mechanicID)
	}
	sort.Slice(mechanicIDs, func(i, j int) bool { return mechanicIDs[i] < mechanicIDs[j] })
	changes := make([]effectiveChangeResponse, 0)
	for _, mechanicID := range mechanicIDs {
		beforeValue, beforeExists := before.Values[mechanicID]
		afterValue := after.Values[mechanicID]
		if !beforeExists || rules.StateValuesEqual(beforeValue.Effective, afterValue.Effective) {
			continue
		}
		changes = append(changes, effectiveChangeResponse{
			EntityID: string(entityID), MechanicID: string(mechanicID),
			Before: stateValueDomainToDTO(beforeValue.Effective),
			After:  stateValueDomainToDTO(afterValue.Effective),
		})
	}
	return changes
}
