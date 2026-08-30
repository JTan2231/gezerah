package rules

import (
	"fmt"
	"sort"
)

type EvaluationPresence string

const (
	EvaluationPresenceStoredOverride  EvaluationPresence = "stored-override"
	EvaluationPresenceAuthoredDefault EvaluationPresence = "authored-default"
	EvaluationPresenceDerived         EvaluationPresence = "derived"
)

type LogicalInputValue struct {
	Presence EvaluationPresence
	Value    MechanicValue
}

type LogicalState struct {
	EntityID                        ID
	Revision                        int64
	InputValues                     map[ID]MechanicValue
	AuthoredDefaultInputMechanicIDs []ID
}

func ValidateInputOverrideRecord(record InputOverrideRecord, entity Entity, definitions map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if record.EntityID != entity.ID {
		errs = append(errs, validation("entity_mismatch", "entity_id", "input override record does not belong to the supplied entity"))
	}
	if record.Revision < 0 {
		errs = append(errs, validation("invalid_revision", "revision", "logical state revision cannot be negative"))
	}
	for mechanicID, value := range record.Overrides {
		path := "overrides[" + string(mechanicID) + "]"
		definition, exists := definitions[mechanicID]
		if !exists {
			errs = append(errs, validation("unknown_mechanic", path, "mechanic definition does not exist"))
			continue
		}
		if definition.WorldID != entity.WorldID {
			errs = append(errs, validation("cross_world_reference", path, "mechanic belongs to another world"))
			continue
		}
		if definition.SourceKind == SourceDerived {
			errs = append(errs, validation("derived_mechanic_override", path, "derived mechanics cannot own stored overrides"))
			continue
		}
		for _, item := range ValidateMechanicValue(definition, value) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
		if MechanicValuesEqual(value, definition.DefaultValue) {
			errs = append(errs, validation("redundant_input_override", path, "stored overrides equal to the authored default must be removed"))
		}
	}
	return errs
}

func ResolveLogicalInputValue(record InputOverrideRecord, definition MechanicDefinition) LogicalInputValue {
	if value, ok := record.Overrides[definition.ID]; ok {
		return LogicalInputValue{Presence: EvaluationPresenceStoredOverride, Value: CloneMechanicValue(value)}
	}
	return LogicalInputValue{Presence: EvaluationPresenceAuthoredDefault, Value: CloneMechanicValue(definition.DefaultValue)}
}

func MaterializeLogicalState(entity Entity, record InputOverrideRecord, definitions map[ID]MechanicDefinition) LogicalState {
	result := LogicalState{
		EntityID:                        entity.ID,
		Revision:                        record.Revision,
		InputValues:                     make(map[ID]MechanicValue),
		AuthoredDefaultInputMechanicIDs: []ID{},
	}
	mechanicIDs := make([]ID, 0, len(definitions))
	for id := range definitions {
		mechanicIDs = append(mechanicIDs, id)
	}
	sort.Slice(mechanicIDs, func(i, j int) bool { return mechanicIDs[i] < mechanicIDs[j] })
	for _, id := range mechanicIDs {
		definition := definitions[id]
		if definition.WorldID != entity.WorldID || definition.SourceKind == SourceDerived {
			continue
		}
		logical := ResolveLogicalInputValue(record, definition)
		result.InputValues[id] = CloneMechanicValue(logical.Value)
		if logical.Presence == EvaluationPresenceAuthoredDefault {
			result.AuthoredDefaultInputMechanicIDs = append(result.AuthoredDefaultInputMechanicIDs, id)
		}
	}
	return result
}

func NormalizeInputOverrideRecord(record InputOverrideRecord, definitions map[ID]MechanicDefinition) InputOverrideRecord {
	result := CloneInputOverrideRecord(record)
	for id, value := range result.Overrides {
		definition, ok := definitions[id]
		if ok && definition.SourceKind != SourceDerived && MechanicValuesEqual(value, definition.DefaultValue) {
			delete(result.Overrides, id)
		}
	}
	return result
}

func CloneInputOverrideRecord(record InputOverrideRecord) InputOverrideRecord {
	result := record
	result.Overrides = make(map[ID]MechanicValue, len(record.Overrides))
	for id, value := range record.Overrides {
		result.Overrides[id] = CloneMechanicValue(value)
	}
	return result
}

func CloneInputOverrideSnapshot(snapshot InputOverrideSnapshot) InputOverrideSnapshot {
	result := InputOverrideSnapshot{ByEntity: make(map[ID]InputOverrideRecord, len(snapshot.ByEntity))}
	for id, record := range snapshot.ByEntity {
		result.ByEntity[id] = CloneInputOverrideRecord(record)
	}
	return result
}

func ValidateInputOverrideSnapshot(snapshot InputOverrideSnapshot, entities map[ID]Entity, definitions map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	for entityID, record := range snapshot.ByEntity {
		entity, exists := entities[entityID]
		if !exists {
			errs = append(errs, validation("unknown_entity", "by_entity["+string(entityID)+"]", "input override snapshot entity does not exist"))
			continue
		}
		if record.EntityID != entityID {
			errs = append(errs, validation("entity_mismatch", "by_entity["+string(entityID)+"].entity_id", "map key and input override record entity differ"))
		}
		for _, item := range ValidateInputOverrideRecord(record, entity, definitions) {
			item.Path = fmt.Sprintf("by_entity[%s].%s", entityID, item.Path)
			errs = append(errs, item)
		}
	}
	return errs
}
