package app

import (
	"context"
	"errors"
	"sort"
	"time"

	"gezerah/internal/rules"
)

// loadedStatusInstanceSet is the immutable status-instance view consumed by one
// Entity sheet evaluation. Modifiers come from immutable consequence snapshots.
type loadedStatusInstanceSet struct {
	Revision       int64
	Instances      []rules.StatusInstance
	InlineStatuses map[rules.ID]rules.InlineStatus
	Responses      []statusInstanceResponse
	Names          map[rules.ID]string
}

func loadStatusInstanceSet(ctx context.Context, db queryer, worldID, entityID string) (loadedStatusInstanceSet, error) {
	result := loadedStatusInstanceSet{
		Instances:      []rules.StatusInstance{},
		InlineStatuses: make(map[rules.ID]rules.InlineStatus),
		Responses:      []statusInstanceResponse{},
		Names:          make(map[rules.ID]string),
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
			result.Instances = append(result.Instances, rules.StatusInstance{
				ID:             rules.ID(instanceID),
				WorldID:        rules.ID(worldID),
				EntityID:       rules.ID(entityID),
				SourceEffectID: rules.ID(sourceEffectID),
				AppliedOrder:   appliedOrder,
			})
			result.InlineStatuses[rules.ID(sourceEffectID)] = rules.InlineStatus{
				ID: rules.ID(sourceEffectID), WorldID: rules.ID(worldID),
				Modifiers: []rules.StatusModifier{},
			}
			result.Names[rules.ID(sourceEffectID)] = name
			result.Responses = append(result.Responses, statusInstanceResponse{
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
			return result, errors.New("status instance modifier snapshot is incomplete")
		}
		value, err := databaseMechanicValue(*valueKind, number, boolean)
		if err != nil {
			return result, err
		}
		inlineStatus := result.InlineStatuses[rules.ID(sourceEffectID)]
		inlineStatus.Modifiers = append(inlineStatus.Modifiers, rules.StatusModifier{
			ID: rules.ID(*modifierID), Position: *position, Priority: *priority,
			MechanicID: rules.ID(*mechanicID), Operation: rules.ModifierOperation(*operation),
			Value: value,
		})
		result.InlineStatuses[rules.ID(sourceEffectID)] = inlineStatus
		result.Responses[index].Modifiers = append(result.Responses[index].Modifiers, statusModifierResponse{
			ID: *modifierID, MechanicID: *mechanicID, Operation: *operation,
			Value: mechanicValueDomainToDTO(value), Priority: *priority, Position: *position,
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

func buildEntitySheetResponse(
	entity rules.Entity,
	record rules.InputOverrideRecord,
	definitions map[rules.ID]rules.MechanicDefinition,
	rulesRevision int64,
	statuses loadedStatusInstanceSet,
) (entitySheetResponse, error) {
	evaluated, err := rules.EvaluateEntity(entity, record, definitions, statuses.InlineStatuses, statuses.Instances)
	if err != nil {
		return entitySheetResponse{}, err
	}
	logical := rules.MaterializeLogicalState(entity, record, definitions)
	response := entitySheetResponse{
		EntityID: string(entity.ID), LogicalStateRevision: record.Revision,
		StatusSetRevision: statuses.Revision, RulesRevision: rulesRevision,
		LogicalInputValues:              make(map[string]mechanicValueDTO, len(logical.InputValues)),
		EffectiveValues:                 make(map[string]mechanicValueDTO, len(evaluated.Values)),
		Evaluations:                     make(map[string]evaluatedMechanicResponse, len(evaluated.Values)),
		ActiveStatusInstances:           statuses.Responses,
		AuthoredDefaultInputMechanicIDs: make([]string, len(logical.AuthoredDefaultInputMechanicIDs)),
	}
	for mechanicID, value := range logical.InputValues {
		response.LogicalInputValues[string(mechanicID)] = mechanicValueDomainToDTO(value)
	}
	for index, mechanicID := range logical.AuthoredDefaultInputMechanicIDs {
		response.AuthoredDefaultInputMechanicIDs[index] = string(mechanicID)
	}
	for _, mechanicID := range evaluated.Order {
		value := evaluated.Values[mechanicID]
		response.EffectiveValues[string(mechanicID)] = mechanicValueDomainToDTO(value.Effective)
		modifiers := make([]appliedModifierResponse, len(value.Modifiers))
		for index, modifier := range value.Modifiers {
			modifiers[index] = appliedModifierResponse{
				StatusInstanceID: string(modifier.StatusInstanceID),
				StatusName:       statuses.Names[modifier.SourceEffectID],
				ModifierID:       string(modifier.ModifierID), Operation: string(modifier.Operation),
				Priority: modifier.Priority, Operand: mechanicValueDomainToDTO(modifier.Operand),
				Before: mechanicValueDomainToDTO(modifier.Before), After: mechanicValueDomainToDTO(modifier.After),
			}
		}
		response.Evaluations[string(mechanicID)] = evaluatedMechanicResponse{
			SourceKind: string(value.SourceKind), Presence: string(value.Presence),
			Intrinsic: mechanicValueDomainToDTO(value.Intrinsic),
			Effective: mechanicValueDomainToDTO(value.Effective), Modifiers: modifiers,
		}
	}
	return response, nil
}

func loadGeneratedEntitySheet(ctx context.Context, db queryer, worldID, entityID string) (entitySheetResponse, error) {
	for attempt := 0; attempt < 3; attempt++ {
		rulesRevision, err := loadRulesRevision(ctx, db, worldID)
		if err != nil {
			return entitySheetResponse{}, err
		}
		mechanics, err := loadWorldMechanics(ctx, db, worldID, "")
		if err != nil {
			return entitySheetResponse{}, err
		}
		entity, err := loadEntityForRules(ctx, db, worldID, entityID)
		if err != nil {
			return entitySheetResponse{}, err
		}
		record, err := loadInputOverrideRecord(ctx, db, worldID, entityID)
		if err != nil {
			return entitySheetResponse{}, err
		}
		statuses, err := loadStatusInstanceSet(ctx, db, worldID, entityID)
		if err != nil {
			return entitySheetResponse{}, err
		}
		var rulesAfter, logicalStateAfter, statusSetAfter int64
		if err := db.QueryRow(ctx, `select revision from world_mechanic_graphs where world_id = $1`, worldID).Scan(&rulesAfter); err != nil {
			return entitySheetResponse{}, err
		}
		if err := db.QueryRow(ctx, `select revision from entity_logical_states where world_id = $1 and entity_id = $2`, worldID, entityID).Scan(&logicalStateAfter); err != nil {
			return entitySheetResponse{}, err
		}
		if err := db.QueryRow(ctx, `select revision from entity_status_sets where world_id = $1 and entity_id = $2`, worldID, entityID).Scan(&statusSetAfter); err != nil {
			return entitySheetResponse{}, err
		}
		if rulesAfter != rulesRevision || logicalStateAfter != record.Revision || statusSetAfter != statuses.Revision {
			continue
		}
		return buildEntitySheetResponse(entity, record, mechanicDefinitions(mechanics), rulesRevision, statuses)
	}
	return entitySheetResponse{}, errors.New("entity sheet inputs changed repeatedly while the sheet was being generated")
}

func effectiveChanges(
	entityID rules.ID,
	before rules.EntityEvaluation,
	after rules.EntityEvaluation,
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
		if !beforeExists || rules.MechanicValuesEqual(beforeValue.Effective, afterValue.Effective) {
			continue
		}
		changes = append(changes, effectiveChangeResponse{
			EntityID: string(entityID), MechanicID: string(mechanicID),
			Before: mechanicValueDomainToDTO(beforeValue.Effective),
			After:  mechanicValueDomainToDTO(afterValue.Effective),
		})
	}
	return changes
}
