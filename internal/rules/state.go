package rules

import (
	"fmt"
	"sort"
)

type ValuePresence string

const (
	ValueStored    ValuePresence = "stored"
	ValueDefaulted ValuePresence = "defaulted"
)

type LogicalValue struct {
	Presence ValuePresence
	Value    StateValue
}

type LogicalStateRecord struct {
	EntityID             ID
	Revision             int64
	Values               map[ID]StateValue
	DefaultedMechanicIDs []ID
}

func ValidateStateRecord(record StateRecord, entity Entity, definitions map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if record.EntityID != entity.ID {
		errs = append(errs, validation("entity_mismatch", "entity_id", "state record does not belong to the supplied entity"))
	}
	if record.Revision < 0 {
		errs = append(errs, validation("invalid_revision", "revision", "state revision cannot be negative"))
	}
	for mechanicID, value := range record.Values {
		path := "values[" + string(mechanicID) + "]"
		definition, exists := definitions[mechanicID]
		if !exists {
			errs = append(errs, validation("unknown_mechanic", path, "mechanic definition does not exist"))
			continue
		}
		if definition.WorldID != entity.WorldID {
			errs = append(errs, validation("cross_world_reference", path, "mechanic belongs to another world"))
			continue
		}
		for _, item := range ValidateStateValue(definition, value) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
		if StateValuesEqual(value, definition.DefaultValue) {
			errs = append(errs, validation("unnormalized_default", path, "stored values equal to the mechanic default must be removed"))
		}
	}
	return errs
}

func LogicalStateValue(record StateRecord, definition MechanicDefinition) LogicalValue {
	if value, ok := record.Values[definition.ID]; ok {
		return LogicalValue{Presence: ValueStored, Value: CloneStateValue(value)}
	}
	return LogicalValue{Presence: ValueDefaulted, Value: CloneStateValue(definition.DefaultValue)}
}

func MaterializeLogicalState(entity Entity, record StateRecord, definitions map[ID]MechanicDefinition) LogicalStateRecord {
	result := LogicalStateRecord{
		EntityID:             entity.ID,
		Revision:             record.Revision,
		Values:               make(map[ID]StateValue),
		DefaultedMechanicIDs: []ID{},
	}
	mechanicIDs := make([]ID, 0, len(definitions))
	for id := range definitions {
		mechanicIDs = append(mechanicIDs, id)
	}
	sort.Slice(mechanicIDs, func(i, j int) bool { return mechanicIDs[i] < mechanicIDs[j] })
	for _, id := range mechanicIDs {
		definition := definitions[id]
		if definition.WorldID != entity.WorldID {
			continue
		}
		logical := LogicalStateValue(record, definition)
		result.Values[id] = CloneStateValue(logical.Value)
		if logical.Presence == ValueDefaulted {
			result.DefaultedMechanicIDs = append(result.DefaultedMechanicIDs, id)
		}
	}
	return result
}

func NormalizeStateRecord(record StateRecord, definitions map[ID]MechanicDefinition) StateRecord {
	result := CloneStateRecord(record)
	for id, value := range result.Values {
		definition, ok := definitions[id]
		if ok && StateValuesEqual(value, definition.DefaultValue) {
			delete(result.Values, id)
		}
	}
	return result
}

func CloneStateRecord(record StateRecord) StateRecord {
	result := record
	result.Values = make(map[ID]StateValue, len(record.Values))
	for id, value := range record.Values {
		result.Values[id] = CloneStateValue(value)
	}
	return result
}

func CloneSnapshot(snapshot StateSnapshot) StateSnapshot {
	result := StateSnapshot{Records: make(map[ID]StateRecord, len(snapshot.Records))}
	for id, record := range snapshot.Records {
		result.Records[id] = CloneStateRecord(record)
	}
	return result
}

func ValidateSnapshot(snapshot StateSnapshot, entities map[ID]Entity, definitions map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	for entityID, record := range snapshot.Records {
		entity, exists := entities[entityID]
		if !exists {
			errs = append(errs, validation("unknown_entity", "records["+string(entityID)+"]", "snapshot entity does not exist"))
			continue
		}
		if record.EntityID != entityID {
			errs = append(errs, validation("entity_mismatch", "records["+string(entityID)+"].entity_id", "map key and record entity differ"))
		}
		for _, item := range ValidateStateRecord(record, entity, definitions) {
			item.Path = fmt.Sprintf("records[%s].%s", entityID, item.Path)
			errs = append(errs, item)
		}
	}
	return errs
}
