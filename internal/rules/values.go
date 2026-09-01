package rules

func NewNumberMechanicValue(value Decimal) MechanicValue {
	return MechanicValue{Kind: ValueNumber, Number: decimalPointer(value)}
}

func NewBooleanMechanicValue(value bool) MechanicValue {
	return MechanicValue{Kind: ValueBoolean, Boolean: &value}
}

func decimalPointer(value Decimal) *Decimal {
	copy := value
	return &copy
}

func CloneMechanicValue(value MechanicValue) MechanicValue {
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

func MechanicValuesEqual(left, right MechanicValue) bool {
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

func ValidateMechanicValue(definition MechanicDefinition, value MechanicValue) ValidationErrors {
	var errs ValidationErrors
	if value.Kind != definition.ValueKind {
		return append(errs, validation("value_kind_mismatch", "kind", "mechanic value kind does not match its definition"))
	}
	if !validMechanicValueShape(value) {
		return append(errs, validation("invalid_typed_value", "", "mechanic value has missing or unexpected fields"))
	}
	if value.Kind == ValueNumber {
		errs = append(errs, validateDecimalAgainstBounds(*value.Number, definition.Minimum, definition.Maximum, definition.Step, "number")...)
	}
	return errs
}

func validMechanicValueShape(value MechanicValue) bool {
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
