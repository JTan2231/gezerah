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
	if !validSourceKind(definition.SourceKind) {
		errs = append(errs, validation("unsupported", "source_kind", "mechanic source must be input or derived"))
	}

	switch definition.SourceKind {
	case SourceInput:
		if definition.Expression != nil {
			errs = append(errs, validation("invalid_source", "expression", "input mechanics cannot declare a derived expression"))
		}
		switch definition.ValueKind {
		case ValueNumber:
			errs = append(errs, validateBounds(definition.Minimum, definition.Maximum, definition.Step, "")...)
		case ValueBoolean:
			if definition.Minimum != nil || definition.Maximum != nil || definition.Step != nil {
				errs = append(errs, validation("invalid_metadata", "value_kind", "boolean mechanics cannot declare numeric bounds or a step"))
			}
		}
		for _, item := range ValidateMechanicValue(definition, definition.DefaultValue) {
			item.Path = pathForNestedValidation("default_value", item.Path)
			errs = append(errs, item)
		}
	case SourceDerived:
		if definition.Expression == nil {
			errs = append(errs, validation("required", "expression", "derived mechanics require an expression"))
		}
		if !mechanicValueEmpty(definition.DefaultValue) {
			errs = append(errs, validation("invalid_source", "default_value", "derived Mechanics cannot declare an authored default"))
		}
		if definition.Minimum != nil || definition.Maximum != nil || definition.Step != nil {
			errs = append(errs, validation("invalid_source", "source_kind", "derived mechanics cannot declare storage bounds or a step"))
		}
		if definition.Mutable {
			errs = append(errs, validation("invalid_source", "mutable", "derived mechanics cannot be directly mutable"))
		}
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
	if minimum != nil && maximum != nil && minimum.Cmp(*maximum) > 0 {
		errs = append(errs, validation("invalid_bounds", field("maximum"), "maximum must be greater than or equal to minimum"))
	}
	if step != nil && !step.IsPositive() {
		errs = append(errs, validation("invalid_step", field("step"), "step must be a positive finite exact decimal"))
	}
	return errs
}

func validValueKind(kind ValueKind) bool {
	return kind == ValueNumber || kind == ValueBoolean
}

func validSourceKind(kind SourceKind) bool {
	return kind == SourceInput || kind == SourceDerived
}

func mechanicValueEmpty(value MechanicValue) bool {
	return value.Kind == "" && value.Number == nil && value.Boolean == nil
}
