package rules

import (
	"fmt"
	"sort"
)

// ValidateInlineStatus validates one user-authored Inline status against the
// Mechanic definitions it may modify.
func ValidateInlineStatus(inlineStatus InlineStatus, mechanics map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if !inlineStatus.ID.Valid() {
		errs = append(errs, validation("required", "id", "inline status source Effect ID is required"))
	}
	if !inlineStatus.WorldID.Valid() {
		errs = append(errs, validation("required", "world_id", "inline status World ID is required"))
	}
	ids := make(map[ID]struct{}, len(inlineStatus.Modifiers))
	positions := make(map[int]struct{}, len(inlineStatus.Modifiers))
	for index, modifier := range inlineStatus.Modifiers {
		path := fmt.Sprintf("modifiers[%d]", index)
		if !modifier.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "modifier ID is required"))
		}
		if _, exists := ids[modifier.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "modifier ID is repeated"))
		}
		ids[modifier.ID] = struct{}{}
		if modifier.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "modifier position cannot be negative"))
		}
		if _, exists := positions[modifier.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "modifier position is repeated"))
		}
		positions[modifier.Position] = struct{}{}

		mechanic, exists := mechanics[modifier.MechanicID]
		if !exists {
			errs = append(errs, validation("unknown_mechanic", path+".mechanic_id", "modifier mechanic does not exist"))
			continue
		}
		if mechanic.ID != modifier.MechanicID {
			errs = append(errs, validation("mechanic_id_mismatch", path+".mechanic_id", "mechanic map key and definition ID differ"))
		}
		if mechanic.WorldID != inlineStatus.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".mechanic_id", "status and modified mechanic belong to different worlds"))
		}
		if mechanic.Archived {
			errs = append(errs, validation("archived_dependency", path+".mechanic_id", "status modifiers cannot target archived Mechanics"))
		}
		for _, item := range validateStatusModifier(modifier, mechanic) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
	}
	for position := 0; position < len(inlineStatus.Modifiers); position++ {
		if _, exists := positions[position]; !exists {
			errs = append(errs, validation("incomplete_positions", "modifiers", "modifier positions must form a complete zero-based sequence"))
			break
		}
	}
	return errs
}

func ValidateInlineStatuses(inlineStatuses map[ID]InlineStatus, mechanics map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	ids := make([]ID, 0, len(inlineStatuses))
	for id := range inlineStatuses {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		inlineStatus := inlineStatuses[id]
		path := "statuses[" + string(id) + "]"
		if inlineStatus.ID != id {
			errs = append(errs, validation("status_id_mismatch", path+".id", "status map key and inline-status source Effect ID differ"))
		}
		for _, item := range ValidateInlineStatus(inlineStatus, mechanics) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
	}
	return errs
}

// ValidateStatusInstances validates the active Status instances supplied for
// one Entity. Inline-status values come from immutable instance snapshots, not
// instructions to reload current configuration.
func ValidateStatusInstances(entity Entity, inlineStatuses map[ID]InlineStatus, instances []StatusInstance) ValidationErrors {
	var errs ValidationErrors
	instanceIDs := make(map[ID]struct{}, len(instances))
	sourceEffectsOnEntity := make(map[ID]struct{}, len(instances))
	for index, status := range instances {
		path := fmt.Sprintf("active_status_instances[%d]", index)
		if !status.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "status instance ID is required"))
		}
		if _, exists := instanceIDs[status.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "status instance ID is repeated"))
		}
		instanceIDs[status.ID] = struct{}{}
		if status.EntityID != entity.ID {
			errs = append(errs, validation("entity_mismatch", path+".entity_id", "status instance does not belong to the evaluated entity"))
		}
		if status.WorldID != entity.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".world_id", "status instance and entity belong to different worlds"))
		}
		if status.AppliedOrder < 0 {
			errs = append(errs, validation("invalid_position", path+".applied_order", "status instance applied order cannot be negative"))
		}
		inlineStatus, exists := inlineStatuses[status.SourceEffectID]
		if !exists {
			errs = append(errs, validation("unknown_status", path+".source_effect_id", "status instance source Inline status does not exist"))
			continue
		}
		if inlineStatus.ID != status.SourceEffectID {
			errs = append(errs, validation("status_id_mismatch", path+".source_effect_id", "status map key and inline-status source Effect ID differ"))
		}
		if inlineStatus.WorldID != status.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".source_effect_id", "Status instance and Inline status belong to different Worlds"))
		}
		if _, exists := sourceEffectsOnEntity[status.SourceEffectID]; exists {
			errs = append(errs, validation("duplicate_status_instance", path+".source_effect_id", "only one instance from a source effect may be active on an entity"))
		}
		sourceEffectsOnEntity[status.SourceEffectID] = struct{}{}
	}
	return errs
}

func validateStatusModifier(modifier StatusModifier, mechanic MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if !validMechanicValueShape(modifier.Value) {
		return ValidationErrors{validation("invalid_typed_value", "value", "modifier requires exactly one literal number or boolean value")}
	}
	switch modifier.Operation {
	case ModifierSet:
		if modifier.Value.Kind != mechanic.ValueKind {
			errs = append(errs, validation("value_kind_mismatch", "value.kind", "set modifier value kind does not match its mechanic"))
		}
	case ModifierAddNumber, ModifierMultiplyNumber:
		if mechanic.ValueKind != ValueNumber || modifier.Value.Kind != ValueNumber {
			errs = append(errs, validation("value_kind_mismatch", "value.kind", "numeric modifier requires a numeric mechanic and operand"))
		}
	default:
		errs = append(errs, validation("unsupported", "operation", "unsupported modifier operation"))
	}
	return errs
}

func cloneStatusInstances(instances []StatusInstance) []StatusInstance {
	return append([]StatusInstance(nil), instances...)
}
