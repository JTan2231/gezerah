package rules

func NewNumberValue(value Decimal) StateValue {
	return StateValue{Kind: ValueNumber, Number: decimalPointer(value)}
}

func NewBooleanValue(value bool) StateValue {
	return StateValue{Kind: ValueBoolean, Boolean: &value}
}

func decimalPointer(value Decimal) *Decimal {
	copy := value
	return &copy
}

func CloneStateValue(value StateValue) StateValue {
	result := value
	if value.Number != nil {
		result.Number = decimalPointer(*value.Number)
	}
	if value.Boolean != nil {
		boolean := *value.Boolean
		result.Boolean = &boolean
	}
	return result
}

func StateValuesEqual(left, right StateValue) bool {
	if left.Kind != right.Kind {
		return false
	}
	switch left.Kind {
	case ValueNumber:
		return left.Number != nil && right.Number != nil && left.Number.Equal(*right.Number)
	case ValueBoolean:
		return left.Boolean != nil && right.Boolean != nil && *left.Boolean == *right.Boolean
	default:
		return false
	}
}

func ValidateStateValue(definition MechanicDefinition, value StateValue) ValidationErrors {
	var errs ValidationErrors
	if value.Kind != definition.ValueKind {
		return append(errs, validation("value_kind_mismatch", "kind", "state value kind does not match its mechanic"))
	}
	if !validStateValueShape(value) {
		return append(errs, validation("invalid_typed_value", "", "state value has missing or unexpected fields"))
	}
	if value.Kind == ValueNumber {
		errs = append(errs, validateDecimalAgainstBounds(*value.Number, definition.Minimum, definition.Maximum, definition.Step, "number")...)
	}
	return errs
}

func validStateValueShape(value StateValue) bool {
	switch value.Kind {
	case ValueNumber:
		return value.Number != nil && value.Boolean == nil
	case ValueBoolean:
		return value.Number == nil && value.Boolean != nil
	default:
		return false
	}
}

func validateDecimalAgainstBounds(value Decimal, minimum, maximum, step *Decimal, path string) ValidationErrors {
	var errs ValidationErrors
	if minimum != nil && value.Cmp(*minimum) < 0 {
		errs = append(errs, validation("below_minimum", path, "number is below the configured minimum"))
	}
	if maximum != nil && value.Cmp(*maximum) > 0 {
		errs = append(errs, validation("above_maximum", path, "number is above the configured maximum"))
	}
	if step != nil && step.IsPositive() {
		base := Decimal{}
		if minimum != nil {
			base = *minimum
		}
		if !value.AlignsTo(*step, base) {
			errs = append(errs, validation("step_mismatch", path, "number does not align to the configured step"))
		}
	}
	return errs
}
