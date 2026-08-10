package rules

import (
	"fmt"
	"sort"
)

// ValidateStatusSnapshot validates one user-authored status snapshot against
// the mechanic definitions it may modify.
func ValidateStatusSnapshot(snapshot StatusSnapshot, mechanics map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if !snapshot.ID.Valid() {
		errs = append(errs, validation("required", "id", "status snapshot source effect ID is required"))
	}
	if !snapshot.WorldID.Valid() {
		errs = append(errs, validation("required", "world_id", "status snapshot world ID is required"))
	}
	ids := make(map[ID]struct{}, len(snapshot.Modifiers))
	positions := make(map[int]struct{}, len(snapshot.Modifiers))
	for index, modifier := range snapshot.Modifiers {
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
		if mechanic.WorldID != snapshot.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".mechanic_id", "status and modified mechanic belong to different worlds"))
		}
		if mechanic.Archived {
			errs = append(errs, validation("archived_dependency", path+".mechanic_id", "status effects cannot target archived mechanics"))
		}
		for _, item := range validateStatusModifier(modifier, mechanic) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
	}
	for position := 0; position < len(snapshot.Modifiers); position++ {
		if _, exists := positions[position]; !exists {
			errs = append(errs, validation("incomplete_positions", "modifiers", "modifier positions must form a complete zero-based sequence"))
			break
		}
	}
	return errs
}

func ValidateStatusSnapshots(snapshots map[ID]StatusSnapshot, mechanics map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	ids := make([]ID, 0, len(snapshots))
	for id := range snapshots {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		snapshot := snapshots[id]
		path := "statuses[" + string(id) + "]"
		if snapshot.ID != id {
			errs = append(errs, validation("status_id_mismatch", path+".id", "status map key and snapshot source effect ID differ"))
		}
		for _, item := range ValidateStatusSnapshot(snapshot, mechanics) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
	}
	return errs
}

// ValidateActiveStatuses validates the status-instance snapshot supplied for
// one entity. Snapshot values are immutable consequences retained by those
// instances, not instructions to reload current configuration.
func ValidateActiveStatuses(entity Entity, snapshots map[ID]StatusSnapshot, active []ActiveStatus) ValidationErrors {
	var errs ValidationErrors
	instanceIDs := make(map[ID]struct{}, len(active))
	sourceEffectsOnEntity := make(map[ID]struct{}, len(active))
	for index, status := range active {
		path := fmt.Sprintf("active_statuses[%d]", index)
		if !status.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "active status ID is required"))
		}
		if _, exists := instanceIDs[status.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "active status ID is repeated"))
		}
		instanceIDs[status.ID] = struct{}{}
		if status.EntityID != entity.ID {
			errs = append(errs, validation("entity_mismatch", path+".entity_id", "active status does not belong to the evaluated entity"))
		}
		if status.WorldID != entity.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".world_id", "active status and entity belong to different worlds"))
		}
		if status.AppliedOrder < 0 {
			errs = append(errs, validation("invalid_position", path+".applied_order", "active status applied order cannot be negative"))
		}
		snapshot, exists := snapshots[status.SourceEffectID]
		if !exists {
			errs = append(errs, validation("unknown_status", path+".source_effect_id", "active status source-effect snapshot does not exist"))
			continue
		}
		if snapshot.ID != status.SourceEffectID {
			errs = append(errs, validation("status_id_mismatch", path+".source_effect_id", "status map key and snapshot source effect ID differ"))
		}
		if snapshot.WorldID != status.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".source_effect_id", "active status and snapshot belong to different worlds"))
		}
		if _, exists := sourceEffectsOnEntity[status.SourceEffectID]; exists {
			errs = append(errs, validation("duplicate_active_status", path+".source_effect_id", "only one instance from a source effect may be active on an entity"))
		}
		sourceEffectsOnEntity[status.SourceEffectID] = struct{}{}
	}
	return errs
}

func validateStatusModifier(modifier StatusModifier, mechanic MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if !validStateValueShape(modifier.Value) {
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

func cloneActiveStatuses(active []ActiveStatus) []ActiveStatus {
	return append([]ActiveStatus(nil), active...)
}
