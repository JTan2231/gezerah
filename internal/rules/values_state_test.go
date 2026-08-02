package rules

import (
	"errors"
	"testing"
)

func TestValidateStateVariableDefinitionAndValues(t *testing.T) {
	t.Parallel()
	schemas := testSchemas()
	entities := testEntities()
	definition := testNumberDefinition()
	defaultValue := NewSingleValue(NewNumberValue(MustDecimal("1.25")))
	definition.MissingKind = MissingDefault
	definition.DefaultValue = &defaultValue
	definition.OmitDefaultWhenStored = true
	definition.NumberMinimum = decimalPointer(MustDecimal("1"))
	definition.NumberMaximum = decimalPointer(MustDecimal("2"))
	definition.NumberStep = decimalPointer(MustDecimal("0.25"))

	if errs := ValidateStateVariableDefinition(definition, schemas, entities); len(errs) != 0 {
		t.Fatalf("valid definition rejected: %v", errs)
	}
	if errs := ValidateStateValue(definition, NewSingleValue(NewNumberValue(MustDecimal("1.5"))), entities); len(errs) != 0 {
		t.Fatalf("valid number rejected: %v", errs)
	}
	if errs := ValidateStateValue(definition, NewSingleValue(NewNumberValue(MustDecimal("1.6"))), entities); !hasValidationCode(errs, "step_mismatch") {
		t.Fatalf("expected step_mismatch, got %v", errs)
	}
	if errs := ValidateStateValue(definition, NewSingleValue(NewNumberValue(MustDecimal("2.25"))), entities); !hasValidationCode(errs, "above_maximum") {
		t.Fatalf("expected above_maximum, got %v", errs)
	}

	invalidUnion := NewNumberValue(MustDecimal("1.5"))
	text := "unexpected"
	invalidUnion.Text = &text
	if errs := ValidateStateValue(definition, NewSingleValue(invalidUnion), entities); !hasValidationCode(errs, "invalid_typed_value") {
		t.Fatalf("expected invalid_typed_value, got %v", errs)
	}
}

func TestManyValuesUseNormalizedSetSemantics(t *testing.T) {
	t.Parallel()
	definition := StateVariableDefinition{
		ID:                      "tags",
		RuleSetID:               "rs",
		Key:                     "world.tags",
		Label:                   "Tags",
		OwnerSchemaIDs:          []ID{"owner"},
		ValueKind:               ValueText,
		Cardinality:             CardinalityMany,
		MissingKind:             MissingUnknown,
		AllowedEffectOperations: []EffectOperation{EffectSet, EffectClear, EffectAddValue, EffectRemoveValue},
	}
	duplicate := NewManyValue(NewTextValue("a"), NewTextValue("a"))
	if errs := ValidateStateValue(definition, duplicate, testEntities()); !hasValidationCode(errs, "duplicate_value") {
		t.Fatalf("expected duplicate_value, got %v", errs)
	}
	left := NewManyValue(NewTextValue("a"), NewTextValue("b"))
	right := NewManyValue(NewTextValue("b"), NewTextValue("a"))
	if !StateValuesEqual(left, right) {
		t.Fatal("many-valued logical equality must ignore order")
	}

	fallbackA, fallbackB := "A", "B"
	referenceDefinition := definition
	referenceDefinition.ID = "refs"
	referenceDefinition.ValueKind = ValueReference
	referenceDefinition.ReferenceTargetOwnerSchemaIDs = []ID{"owner"}
	references := NewManyValue(
		NewReferenceValue("e1", &fallbackA),
		NewReferenceValue("e1", &fallbackB),
	)
	if errs := ValidateStateValue(referenceDefinition, references, testEntities()); !hasValidationCode(errs, "duplicate_value") {
		t.Fatalf("same referenced entity must be a normalized duplicate, got %v", errs)
	}
}

func TestReferenceEligibilityAndRulesetBoundary(t *testing.T) {
	t.Parallel()
	definition := StateVariableDefinition{
		ID:                            "friend",
		RuleSetID:                     "rs",
		Key:                           "world.friend",
		Label:                         "Friend",
		OwnerSchemaIDs:                []ID{"owner"},
		ValueKind:                     ValueReference,
		Cardinality:                   CardinalityOne,
		MissingKind:                   MissingUnknown,
		ReferenceTargetOwnerSchemaIDs: []ID{"target"},
	}
	entities := testEntities()
	entities["other-ruleset"] = Entity{ID: "other-ruleset", RuleSetID: "other", DisplayName: "Other", OwnerSchemaIDs: []ID{"target"}}
	if errs := ValidateStateValue(definition, NewSingleValue(NewReferenceValue("e2", nil)), entities); len(errs) != 0 {
		t.Fatalf("eligible reference rejected: %v", errs)
	}
	if errs := ValidateStateValue(definition, NewSingleValue(NewReferenceValue("e1", nil)), entities); !hasValidationCode(errs, "ineligible_reference_entity") {
		t.Fatalf("expected ineligible reference, got %v", errs)
	}
	if errs := ValidateStateValue(definition, NewSingleValue(NewReferenceValue("other-ruleset", nil)), entities); !hasValidationCode(errs, "cross_ruleset_reference") {
		t.Fatalf("expected ruleset rejection, got %v", errs)
	}
}

func TestEveryScalarKindValidatesAgainstItsMetadata(t *testing.T) {
	t.Parallel()
	schemas := testSchemas()
	entities := testEntities()
	minimum := MustDecimal("0")
	maximum := MustDecimal("10")
	step := MustDecimal("0.5")
	definitionsAndValues := []struct {
		definition StateVariableDefinition
		value      StateValue
	}{
		{
			definition: StateVariableDefinition{ID: "text", RuleSetID: "rs", Key: "world.text", Label: "Text", OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueText, Cardinality: CardinalityOne, MissingKind: MissingUnknown},
			value:      NewSingleValue(NewTextValue("hello")),
		},
		{
			definition: StateVariableDefinition{ID: "boolean", RuleSetID: "rs", Key: "world.boolean", Label: "Boolean", OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueBoolean, Cardinality: CardinalityOne, MissingKind: MissingUnknown},
			value:      NewSingleValue(NewBooleanValue(false)),
		},
		{
			definition: StateVariableDefinition{
				ID: "choice", RuleSetID: "rs", Key: "world.choice", Label: "Choice", OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueChoice, Cardinality: CardinalityOne, MissingKind: MissingUnknown,
				ChoiceOptions: []ChoiceOption{{ID: "red", Key: "red", Label: "Red", Position: 0}},
			},
			value: NewSingleValue(NewChoiceValue("red")),
		},
		{
			definition: StateVariableDefinition{
				ID: "measurement", RuleSetID: "rs", Key: "world.measurement", Label: "Measurement", OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueMeasurement, Cardinality: CardinalityOne, MissingKind: MissingUnknown,
				MeasurementUnits: []MeasurementUnit{{ID: "meter", Unit: "m", Position: 0}}, MeasurementMinimum: &minimum, MeasurementMaximum: &maximum, MeasurementStep: &step,
			},
			value: NewSingleValue(NewMeasurementValue(MustDecimal("2.5"), "meter")),
		},
		{
			definition: StateVariableDefinition{
				ID: "reference", RuleSetID: "rs", Key: "world.reference", Label: "Reference", OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueReference, Cardinality: CardinalityOne, MissingKind: MissingUnknown,
				ReferenceTargetOwnerSchemaIDs: []ID{"target"},
			},
			value: NewSingleValue(NewReferenceValue("e2", nil)),
		},
	}
	for _, test := range definitionsAndValues {
		if errs := ValidateStateVariableDefinition(test.definition, schemas, entities); len(errs) != 0 {
			t.Errorf("%s definition rejected: %v", test.definition.ValueKind, errs)
			continue
		}
		if errs := ValidateStateValue(test.definition, test.value, entities); len(errs) != 0 {
			t.Errorf("%s value rejected: %v", test.definition.ValueKind, errs)
		}
	}
}

func TestLogicalDefaultsUnknownsAndNormalization(t *testing.T) {
	t.Parallel()
	defaultDefinition := testNumberDefinition()
	defaultValue := NewSingleValue(NewNumberValue(MustDecimal("3")))
	defaultDefinition.MissingKind = MissingDefault
	defaultDefinition.DefaultValue = &defaultValue
	defaultDefinition.OmitDefaultWhenStored = true
	unknownDefinition := StateVariableDefinition{
		ID: "flag", RuleSetID: "rs", Key: "world.flag", Label: "Flag",
		OwnerSchemaIDs: []ID{"owner"}, ValueKind: ValueBoolean, Cardinality: CardinalityOne, MissingKind: MissingUnknown,
	}
	definitions := map[ID]StateVariableDefinition{defaultDefinition.ID: defaultDefinition, unknownDefinition.ID: unknownDefinition}
	record := StateRecord{OwnerEntityID: "e1", Revision: 2, Values: map[ID]StateValue{}}
	logical := MaterializeLogicalState(testEntities()["e1"], record, definitions)
	if got := logical.Values[defaultDefinition.ID].Values[0].Number.String(); got != "3" {
		t.Fatalf("default = %s", got)
	}
	if len(logical.DefaultedDefinitionIDs) != 1 || logical.DefaultedDefinitionIDs[0] != defaultDefinition.ID {
		t.Fatalf("defaulted IDs = %v", logical.DefaultedDefinitionIDs)
	}
	if len(logical.UnknownDefinitionIDs) != 1 || logical.UnknownDefinitionIDs[0] != unknownDefinition.ID {
		t.Fatalf("unknown IDs = %v", logical.UnknownDefinitionIDs)
	}

	record.Values[defaultDefinition.ID] = CloneStateValue(defaultValue)
	if errs := ValidateStateRecord(record, testEntities()["e1"], definitions, testEntities()); !hasValidationCode(errs, "unnormalized_default") {
		t.Fatalf("expected unnormalized default, got %v", errs)
	}
	normalized := NormalizeStateRecord(record, definitions)
	if _, exists := normalized.Values[defaultDefinition.ID]; exists {
		t.Fatal("omitted default remained persisted")
	}
}

func TestDomainErrorSupportsErrorsIs(t *testing.T) {
	t.Parallel()
	err := domainError(ErrInvalidState, ValidationErrors{{Code: "bad", Message: "bad state"}})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("errors.Is(%v, ErrInvalidState) = false", err)
	}
}

func testSchemas() map[ID]OwnerSchema {
	return map[ID]OwnerSchema{
		"owner":  {ID: "owner", RuleSetID: "rs", Key: "owner", Label: "Owner"},
		"target": {ID: "target", RuleSetID: "rs", Key: "target", Label: "Target"},
	}
}

func testEntities() map[ID]Entity {
	return map[ID]Entity{
		"e1":   {ID: "e1", RuleSetID: "rs", DisplayName: "One", OwnerSchemaIDs: []ID{"owner"}},
		"e2":   {ID: "e2", RuleSetID: "rs", DisplayName: "Two", OwnerSchemaIDs: []ID{"owner", "target"}},
		"inst": {ID: "inst", RuleSetID: "rs", DisplayName: "Instance", OwnerSchemaIDs: []ID{}},
	}
}

func testNumberDefinition() StateVariableDefinition {
	return StateVariableDefinition{
		ID:                      "score",
		RuleSetID:               "rs",
		Key:                     "world.score",
		Label:                   "Score",
		OwnerSchemaIDs:          []ID{"owner"},
		ValueKind:               ValueNumber,
		Cardinality:             CardinalityOne,
		MissingKind:             MissingUnknown,
		ConditionAddressable:    true,
		AllowedEffectOperations: []EffectOperation{EffectSet, EffectClear, EffectAdjustNumber},
	}
}

func hasValidationCode(errs ValidationErrors, code string) bool {
	for _, err := range errs {
		if err.Code == code {
			return true
		}
	}
	return false
}
