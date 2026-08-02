package rules

import (
	"fmt"
	"sort"
)

type ValuePresence string

const (
	ValueStored    ValuePresence = "stored"
	ValueDefaulted ValuePresence = "defaulted"
	ValueUnknown   ValuePresence = "unknown"
)

type LogicalValue struct {
	Presence ValuePresence
	Value    *StateValue
}

type LogicalStateRecord struct {
	OwnerEntityID          ID
	Revision               int64
	Values                 map[ID]StateValue
	DefaultedDefinitionIDs []ID
	UnknownDefinitionIDs   []ID
}

func ValidateStateRecord(record StateRecord, entity Entity, definitions map[ID]StateVariableDefinition, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	if record.OwnerEntityID != entity.ID {
		errs = append(errs, validation("owner_mismatch", "owner_entity_id", "state record does not belong to the supplied entity"))
	}
	if record.Revision < 0 {
		errs = append(errs, validation("invalid_revision", "revision", "state revision cannot be negative"))
	}
	for definitionID, value := range record.Values {
		path := "values[" + string(definitionID) + "]"
		definition, exists := definitions[definitionID]
		if !exists {
			errs = append(errs, validation("unknown_state_variable", path, "state-variable definition does not exist"))
			continue
		}
		if definition.RuleSetID != entity.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", path, "state-variable definition belongs to another ruleset"))
			continue
		}
		if !EntityImplementsAny(entity, definition.OwnerSchemaIDs) {
			errs = append(errs, validation("ineligible_state_owner", path, "entity is not eligible to own this state variable"))
			continue
		}
		errs = append(errs, ValidateStateValue(definition, value, entities)...)
		if definition.MissingKind == MissingDefault && definition.OmitDefaultWhenStored && definition.DefaultValue != nil && StateValuesEqual(value, *definition.DefaultValue) {
			errs = append(errs, validation("unnormalized_default", path, "stored values equal to an omitted default must be removed"))
		}
	}
	return errs
}

func LogicalStateValue(record StateRecord, definition StateVariableDefinition) LogicalValue {
	if value, ok := record.Values[definition.ID]; ok {
		copy := CloneStateValue(value)
		return LogicalValue{Presence: ValueStored, Value: &copy}
	}
	if definition.MissingKind == MissingDefault && definition.DefaultValue != nil {
		copy := CloneStateValue(*definition.DefaultValue)
		return LogicalValue{Presence: ValueDefaulted, Value: &copy}
	}
	return LogicalValue{Presence: ValueUnknown}
}

func MaterializeLogicalState(entity Entity, record StateRecord, definitions map[ID]StateVariableDefinition) LogicalStateRecord {
	result := LogicalStateRecord{
		OwnerEntityID:          entity.ID,
		Revision:               record.Revision,
		Values:                 make(map[ID]StateValue),
		DefaultedDefinitionIDs: []ID{},
		UnknownDefinitionIDs:   []ID{},
	}
	definitionIDs := make([]ID, 0, len(definitions))
	for id := range definitions {
		definitionIDs = append(definitionIDs, id)
	}
	sort.Slice(definitionIDs, func(i, j int) bool { return definitionIDs[i] < definitionIDs[j] })
	for _, id := range definitionIDs {
		definition := definitions[id]
		if definition.RuleSetID != entity.RuleSetID || !EntityImplementsAny(entity, definition.OwnerSchemaIDs) {
			continue
		}
		logical := LogicalStateValue(record, definition)
		if logical.Value != nil {
			result.Values[id] = CloneStateValue(*logical.Value)
		}
		switch logical.Presence {
		case ValueDefaulted:
			result.DefaultedDefinitionIDs = append(result.DefaultedDefinitionIDs, id)
		case ValueUnknown:
			result.UnknownDefinitionIDs = append(result.UnknownDefinitionIDs, id)
		}
	}
	return result
}

func NormalizeStateRecord(record StateRecord, definitions map[ID]StateVariableDefinition) StateRecord {
	result := CloneStateRecord(record)
	for id, value := range result.Values {
		definition, ok := definitions[id]
		if ok && definition.MissingKind == MissingDefault && definition.OmitDefaultWhenStored && definition.DefaultValue != nil && StateValuesEqual(value, *definition.DefaultValue) {
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

func ValidateSnapshot(snapshot StateSnapshot, entities map[ID]Entity, definitions map[ID]StateVariableDefinition) ValidationErrors {
	var errs ValidationErrors
	for entityID, record := range snapshot.Records {
		entity, exists := entities[entityID]
		if !exists {
			errs = append(errs, validation("unknown_entity", "records["+string(entityID)+"]", "snapshot entity does not exist"))
			continue
		}
		if record.OwnerEntityID != entityID {
			errs = append(errs, validation("owner_mismatch", "records["+string(entityID)+"].owner_entity_id", "map key and record owner differ"))
		}
		for _, item := range ValidateStateRecord(record, entity, definitions, entities) {
			item.Path = fmt.Sprintf("records[%s].%s", entityID, item.Path)
			errs = append(errs, item)
		}
	}
	return errs
}
