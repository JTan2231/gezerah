package rules

import (
	"fmt"
	"sort"
	"strings"
)

// ScalarValue is a checked tagged union. Exactly the fields selected by Kind
// may be populated; use the constructors below for ordinary creation.
type ScalarValue struct {
	Kind               ValueKind
	Text               *string
	Number             *Decimal
	Boolean            *bool
	ChoiceOptionID     ID
	MeasurementAmount  *Decimal
	MeasurementUnitID  ID
	ReferencedEntityID ID
	FallbackName       *string
}

// StateValue carries the definition cardinality explicitly so malformed stored
// or transported values cannot be interpreted using ambient metadata.
type StateValue struct {
	Cardinality Cardinality
	Values      []ScalarValue
}

func NewTextValue(value string) ScalarValue {
	return ScalarValue{Kind: ValueText, Text: &value}
}

func NewNumberValue(value Decimal) ScalarValue {
	return ScalarValue{Kind: ValueNumber, Number: decimalPointer(value)}
}

func NewBooleanValue(value bool) ScalarValue {
	return ScalarValue{Kind: ValueBoolean, Boolean: &value}
}

func NewChoiceValue(optionID ID) ScalarValue {
	return ScalarValue{Kind: ValueChoice, ChoiceOptionID: optionID}
}

func NewMeasurementValue(amount Decimal, unitID ID) ScalarValue {
	return ScalarValue{
		Kind:              ValueMeasurement,
		MeasurementAmount: decimalPointer(amount),
		MeasurementUnitID: unitID,
	}
}

func NewReferenceValue(entityID ID, fallbackName *string) ScalarValue {
	var fallback *string
	if fallbackName != nil {
		copy := *fallbackName
		fallback = &copy
	}
	return ScalarValue{
		Kind:               ValueReference,
		ReferencedEntityID: entityID,
		FallbackName:       fallback,
	}
}

func NewSingleValue(value ScalarValue) StateValue {
	return StateValue{Cardinality: CardinalityOne, Values: []ScalarValue{value}}
}

func NewManyValue(values ...ScalarValue) StateValue {
	return StateValue{Cardinality: CardinalityMany, Values: cloneScalars(values)}
}

func decimalPointer(value Decimal) *Decimal {
	copy := value
	return &copy
}

func cloneScalars(values []ScalarValue) []ScalarValue {
	if values == nil {
		return []ScalarValue{}
	}
	result := make([]ScalarValue, len(values))
	for i, value := range values {
		result[i] = CloneScalarValue(value)
	}
	return result
}

func CloneScalarValue(value ScalarValue) ScalarValue {
	result := value
	if value.Text != nil {
		text := *value.Text
		result.Text = &text
	}
	if value.Number != nil {
		result.Number = decimalPointer(*value.Number)
	}
	if value.Boolean != nil {
		boolean := *value.Boolean
		result.Boolean = &boolean
	}
	if value.MeasurementAmount != nil {
		result.MeasurementAmount = decimalPointer(*value.MeasurementAmount)
	}
	if value.FallbackName != nil {
		fallback := *value.FallbackName
		result.FallbackName = &fallback
	}
	return result
}

func CloneStateValue(value StateValue) StateValue {
	return StateValue{Cardinality: value.Cardinality, Values: cloneScalars(value.Values)}
}

func StateValuesEqual(left, right StateValue) bool {
	if left.Cardinality != right.Cardinality || len(left.Values) != len(right.Values) {
		return false
	}
	if left.Cardinality == CardinalityOne {
		return len(left.Values) == 1 && scalarValuesEqual(left.Values[0], right.Values[0])
	}
	leftKeys := make([]string, len(left.Values))
	rightKeys := make([]string, len(right.Values))
	for i := range left.Values {
		leftKeys[i] = scalarKey(left.Values[i])
		rightKeys[i] = scalarKey(right.Values[i])
	}
	sort.Strings(leftKeys)
	sort.Strings(rightKeys)
	for i := range leftKeys {
		if leftKeys[i] != rightKeys[i] {
			return false
		}
	}
	return true
}

func scalarValuesEqual(left, right ScalarValue) bool {
	return scalarKey(left) == scalarKey(right)
}

func scalarKey(value ScalarValue) string {
	switch value.Kind {
	case ValueText:
		if value.Text != nil {
			return "text\x00" + *value.Text
		}
	case ValueNumber:
		if value.Number != nil {
			return "number\x00" + value.Number.String()
		}
	case ValueBoolean:
		if value.Boolean != nil {
			return fmt.Sprintf("boolean\x00%t", *value.Boolean)
		}
	case ValueChoice:
		return "choice\x00" + string(value.ChoiceOptionID)
	case ValueMeasurement:
		if value.MeasurementAmount != nil {
			return "measurement\x00" + value.MeasurementAmount.String() + "\x00" + string(value.MeasurementUnitID)
		}
	case ValueReference:
		// Fallback metadata is part of the authored scalar and therefore part of
		// normalized equality.
		fallback := ""
		if value.FallbackName != nil {
			fallback = *value.FallbackName
		}
		return "reference\x00" + string(value.ReferencedEntityID) + "\x00" + fallback
	}
	return "invalid"
}

func ValidateStateValue(definition StateVariableDefinition, value StateValue, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	path := "values[" + string(definition.ID) + "]"
	if value.Cardinality != definition.Cardinality {
		errs = append(errs, validation("cardinality_mismatch", path+".cardinality", "value cardinality does not match its definition"))
		return errs
	}
	if value.Cardinality == CardinalityOne && len(value.Values) != 1 {
		errs = append(errs, validation("invalid_value_count", path, "a single-valued variable requires exactly one scalar value"))
	}
	seen := make(map[string]struct{}, len(value.Values))
	for i, scalar := range value.Values {
		scalarPath := fmt.Sprintf("%s.values[%d]", path, i)
		errs = append(errs, validateScalarValue(definition, scalar, entities, scalarPath)...)
		key := scalarDuplicateKey(scalar)
		if _, exists := seen[key]; value.Cardinality == CardinalityMany && exists {
			errs = append(errs, validation("duplicate_value", scalarPath, "many-valued state uses set semantics and cannot contain duplicates"))
		}
		seen[key] = struct{}{}
	}
	return errs
}

func scalarDuplicateKey(value ScalarValue) string {
	if value.Kind == ValueReference {
		return "reference\x00" + string(value.ReferencedEntityID)
	}
	return scalarKey(value)
}

func validateScalarValue(definition StateVariableDefinition, value ScalarValue, entities map[ID]Entity, path string) ValidationErrors {
	var errs ValidationErrors
	if value.Kind != definition.ValueKind {
		return append(errs, validation("value_kind_mismatch", path+".kind", "scalar kind does not match its definition"))
	}
	if !validUnionShape(value) {
		errs = append(errs, validation("invalid_typed_value", path, "typed scalar has missing or unexpected fields"))
		return errs
	}

	switch value.Kind {
	case ValueNumber:
		errs = append(errs, validateDecimalAgainstBounds(*value.Number, definition.NumberMinimum, definition.NumberMaximum, definition.NumberStep, path+".value")...)
	case ValueMeasurement:
		if !containsMeasurementUnit(definition.MeasurementUnits, value.MeasurementUnitID) {
			errs = append(errs, validation("invalid_measurement_unit", path+".unit", "measurement unit does not belong to the variable"))
		}
		errs = append(errs, validateDecimalAgainstBounds(*value.MeasurementAmount, definition.MeasurementMinimum, definition.MeasurementMaximum, definition.MeasurementStep, path+".amount")...)
	case ValueChoice:
		if !containsChoiceOption(definition.ChoiceOptions, value.ChoiceOptionID) {
			errs = append(errs, validation("invalid_choice_option", path+".value", "choice option does not belong to the variable"))
		}
	case ValueReference:
		entity, exists := entities[value.ReferencedEntityID]
		if !exists {
			errs = append(errs, validation("unknown_reference_entity", path+".entity_id", "referenced entity does not exist"))
			break
		}
		if entity.RuleSetID != definition.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", path+".entity_id", "referenced entity belongs to a different ruleset"))
		}
		if len(definition.ReferenceTargetOwnerSchemaIDs) > 0 && !EntityImplementsAny(entity, definition.ReferenceTargetOwnerSchemaIDs) {
			errs = append(errs, validation("ineligible_reference_entity", path+".entity_id", "referenced entity does not implement an allowed target schema"))
		}
	}
	return errs
}

func validUnionShape(value ScalarValue) bool {
	noText := value.Text == nil
	noNumber := value.Number == nil
	noBoolean := value.Boolean == nil
	noChoice := !value.ChoiceOptionID.Valid()
	noMeasurement := value.MeasurementAmount == nil && !value.MeasurementUnitID.Valid()
	noReference := !value.ReferencedEntityID.Valid() && value.FallbackName == nil
	switch value.Kind {
	case ValueText:
		return value.Text != nil && noNumber && noBoolean && noChoice && noMeasurement && noReference
	case ValueNumber:
		return noText && value.Number != nil && noBoolean && noChoice && noMeasurement && noReference
	case ValueBoolean:
		return noText && noNumber && value.Boolean != nil && noChoice && noMeasurement && noReference
	case ValueChoice:
		return noText && noNumber && noBoolean && value.ChoiceOptionID.Valid() && noMeasurement && noReference
	case ValueMeasurement:
		return noText && noNumber && noBoolean && noChoice && value.MeasurementAmount != nil && value.MeasurementUnitID.Valid() && noReference
	case ValueReference:
		return noText && noNumber && noBoolean && noChoice && noMeasurement && value.ReferencedEntityID.Valid()
	default:
		return false
	}
}

func validateDecimalAgainstBounds(value Decimal, minimum, maximum, step *Decimal, path string) ValidationErrors {
	var errs ValidationErrors
	if !value.Valid() {
		return append(errs, validation("invalid_number", path, "number must be a finite exact decimal"))
	}
	if minimum != nil && value.Cmp(*minimum) < 0 {
		errs = append(errs, validation("below_minimum", path, "number is below the configured minimum"))
	}
	if maximum != nil && value.Cmp(*maximum) > 0 {
		errs = append(errs, validation("above_maximum", path, "number is above the configured maximum"))
	}
	if step != nil {
		base := MustDecimal("0")
		if minimum != nil {
			base = *minimum
		}
		if !value.AlignsTo(*step, base) {
			errs = append(errs, validation("step_mismatch", path, "number does not align to the configured step"))
		}
	}
	return errs
}

func containsChoiceOption(options []ChoiceOption, id ID) bool {
	for _, option := range options {
		if option.ID == id {
			return true
		}
	}
	return false
}

func containsMeasurementUnit(units []MeasurementUnit, id ID) bool {
	for _, unit := range units {
		if unit.ID == id {
			return true
		}
	}
	return false
}

func ScalarValueString(value ScalarValue, definitions map[ID]StateVariableDefinition, definitionID ID, entities map[ID]Entity) string {
	definition := definitions[definitionID]
	switch value.Kind {
	case ValueText:
		if value.Text != nil {
			return *value.Text
		}
	case ValueNumber:
		if value.Number != nil {
			return value.Number.String() + optionalUnit(definition.NumberUnit)
		}
	case ValueBoolean:
		if value.Boolean != nil {
			if *value.Boolean {
				return "true"
			}
			return "false"
		}
	case ValueChoice:
		for _, option := range definition.ChoiceOptions {
			if option.ID == value.ChoiceOptionID {
				return option.Label
			}
		}
	case ValueMeasurement:
		if value.MeasurementAmount != nil {
			for _, unit := range definition.MeasurementUnits {
				if unit.ID == value.MeasurementUnitID {
					return value.MeasurementAmount.String() + " " + unit.Unit
				}
			}
		}
	case ValueReference:
		if entity, ok := entities[value.ReferencedEntityID]; ok {
			return entity.DisplayName
		}
		if value.FallbackName != nil {
			return *value.FallbackName
		}
	}
	return "invalid value"
}

func optionalUnit(unit string) string {
	if strings.TrimSpace(unit) == "" {
		return ""
	}
	return " " + unit
}
