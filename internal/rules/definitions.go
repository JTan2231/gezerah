package rules

import "strings"

func ValidateEntity(entity Entity) ValidationErrors {
	var errs ValidationErrors
	if !entity.ID.Valid() {
		errs = append(errs, validation("required", "id", "entity ID is required"))
	}
	if !entity.WorldID.Valid() {
		errs = append(errs, validation("required", "world_id", "world ID is required"))
	}
	if strings.TrimSpace(entity.DisplayName) == "" {
		errs = append(errs, validation("required", "display_name", "entity display name is required"))
	}
	return errs
}

func ValidateMechanicDefinition(definition MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	if !definition.ID.Valid() {
		errs = append(errs, validation("required", "id", "mechanic ID is required"))
	}
	if !definition.WorldID.Valid() {
		errs = append(errs, validation("required", "world_id", "world ID is required"))
	}
	if !validValueKind(definition.ValueKind) {
		errs = append(errs, validation("unsupported", "value_kind", "mechanic must be number or boolean"))
	}

	switch definition.ValueKind {
	case ValueNumber:
		errs = append(errs, validateBounds(definition.Minimum, definition.Maximum, definition.Step, "")...)
	case ValueBoolean:
		if definition.Minimum != nil || definition.Maximum != nil || definition.Step != nil {
			errs = append(errs, validation("invalid_metadata", "value_kind", "boolean mechanics cannot declare numeric bounds or a step"))
		}
	}

	for _, item := range ValidateStateValue(definition, definition.DefaultValue) {
		item.Path = pathForNestedValidation("default_value", item.Path)
		errs = append(errs, item)
	}
	return errs
}

func validateBounds(minimum, maximum, step *Decimal, path string) ValidationErrors {
	var errs ValidationErrors
	field := func(name string) string {
		if path == "" {
			return name
		}
		return path + "." + name
	}
	if minimum != nil && !minimum.Valid() {
		errs = append(errs, validation("invalid_number", field("minimum"), "minimum must be a finite exact decimal"))
	}
	if maximum != nil && !maximum.Valid() {
		errs = append(errs, validation("invalid_number", field("maximum"), "maximum must be a finite exact decimal"))
	}
	if minimum != nil && maximum != nil && minimum.Valid() && maximum.Valid() && minimum.Cmp(*maximum) > 0 {
		errs = append(errs, validation("invalid_bounds", field("maximum"), "maximum must be greater than or equal to minimum"))
	}
	if step != nil && (!step.Valid() || !step.IsPositive()) {
		errs = append(errs, validation("invalid_step", field("step"), "step must be a positive finite exact decimal"))
	}
	return errs
}

func validValueKind(kind ValueKind) bool {
	return kind == ValueNumber || kind == ValueBoolean
}
