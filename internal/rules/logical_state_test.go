package rules

import (
	"errors"
	"testing"
)

func TestValidateMechanicDefinitionAndMechanicValues(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.DefaultValue = NewNumberMechanicValue(MustDecimal("1.25"))
	definition.Minimum = decimalPointer(MustDecimal("1"))
	definition.Maximum = decimalPointer(MustDecimal("2"))
	definition.Step = decimalPointer(MustDecimal("0.25"))

	if errs := ValidateMechanicDefinition(definition); len(errs) != 0 {
		t.Fatalf("valid definition rejected: %v", errs)
	}
	if errs := ValidateMechanicValue(definition, NewNumberMechanicValue(MustDecimal("1.5"))); len(errs) != 0 {
		t.Fatalf("valid number rejected: %v", errs)
	}
	if errs := ValidateMechanicValue(definition, NewNumberMechanicValue(MustDecimal("1.6"))); !hasValidationCode(errs, "step_mismatch") {
		t.Fatalf("expected step_mismatch, got %v", errs)
	}
	if errs := ValidateMechanicValue(definition, NewNumberMechanicValue(MustDecimal("2.25"))); !hasValidationCode(errs, "above_maximum") {
		t.Fatalf("expected above_maximum, got %v", errs)
	}

	invalidUnion := NewNumberMechanicValue(MustDecimal("1.5"))
	unexpected := true
	invalidUnion.Boolean = &unexpected
	if errs := ValidateMechanicValue(definition, invalidUnion); !hasValidationCode(errs, "invalid_typed_value") {
		t.Fatalf("expected invalid_typed_value, got %v", errs)
	}
}

func TestMechanicDefinitionsRequireScalarDefaultsAndMatchingMetadata(t *testing.T) {
	t.Parallel()
	boolean := testBooleanDefinition()
	if errs := ValidateMechanicDefinition(boolean); len(errs) != 0 {
		t.Fatalf("valid Boolean definition rejected: %v", errs)
	}
	minimum := MustDecimal("0")
	boolean.Minimum = &minimum
	if errs := ValidateMechanicDefinition(boolean); !hasValidationCode(errs, "invalid_metadata") {
		t.Fatalf("expected invalid_metadata, got %v", errs)
	}

	missingDefault := testNumberDefinition()
	missingDefault.DefaultValue = MechanicValue{}
	if errs := ValidateMechanicDefinition(missingDefault); !hasValidationCode(errs, "value_kind_mismatch") {
		t.Fatalf("expected invalid default, got %v", errs)
	}

	invalidStep := testNumberDefinition()
	invalidStep.Step = decimalPointer(MustDecimal("0"))
	if errs := ValidateMechanicDefinition(invalidStep); !hasValidationCode(errs, "invalid_step") {
		t.Fatalf("expected invalid_step, got %v", errs)
	}
}

func TestNumberAndBooleanMechanicValues(t *testing.T) {
	t.Parallel()
	number := NewNumberMechanicValue(MustDecimal("9007199254740993.25"))
	if errs := ValidateMechanicValue(testNumberDefinition(), number); len(errs) != 0 {
		t.Fatalf("number rejected: %v", errs)
	}
	boolean := NewBooleanMechanicValue(false)
	if errs := ValidateMechanicValue(testBooleanDefinition(), boolean); len(errs) != 0 {
		t.Fatalf("Boolean rejected: %v", errs)
	}
	if MechanicValuesEqual(number, boolean) {
		t.Fatal("different value kinds compared equal")
	}
	if !MechanicValuesEqual(number, CloneMechanicValue(number)) || !MechanicValuesEqual(boolean, CloneMechanicValue(boolean)) {
		t.Fatal("cloned scalar did not preserve equality")
	}
}

func TestLogicalInputsAndSparseOverrideNormalization(t *testing.T) {
	t.Parallel()
	number := testNumberDefinition()
	number.DefaultValue = NewNumberMechanicValue(MustDecimal("3"))
	boolean := testBooleanDefinition()
	definitions := map[ID]MechanicDefinition{number.ID: number, boolean.ID: boolean}
	record := InputOverrideRecord{EntityID: "e1", Revision: 2, Overrides: map[ID]MechanicValue{}}
	logical := MaterializeLogicalState(testEntities()["e1"], record, definitions)
	if got := logical.InputValues[number.ID].Number.String(); got != "3" {
		t.Fatalf("number default = %s", got)
	}
	if got := *logical.InputValues[boolean.ID].Boolean; got {
		t.Fatal("Boolean default = true, want false")
	}
	if len(logical.AuthoredDefaultInputMechanicIDs) != 2 || logical.AuthoredDefaultInputMechanicIDs[0] != boolean.ID || logical.AuthoredDefaultInputMechanicIDs[1] != number.ID {
		t.Fatalf("authored-default input mechanic IDs = %v", logical.AuthoredDefaultInputMechanicIDs)
	}

	record.Overrides[number.ID] = CloneMechanicValue(number.DefaultValue)
	if errs := ValidateInputOverrideRecord(record, testEntities()["e1"], definitions); !hasValidationCode(errs, "redundant_input_override") {
		t.Fatalf("expected redundant_input_override, got %v", errs)
	}
	normalized := NormalizeInputOverrideRecord(record, definitions)
	if _, exists := normalized.Overrides[number.ID]; exists {
		t.Fatal("default remained persisted")
	}
	if _, exists := record.Overrides[number.ID]; !exists {
		t.Fatal("normalization mutated the caller-owned record")
	}
}

func TestInputOverrideValidationEnforcesWorldAndRecordIdentity(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	otherWorld := definition
	otherWorld.ID = "other-mechanic"
	otherWorld.WorldID = "other-world"
	record := InputOverrideRecord{
		EntityID: "wrong-entity",
		Revision: -1,
		Overrides: map[ID]MechanicValue{
			otherWorld.ID: NewNumberMechanicValue(MustDecimal("1")),
			"missing":     NewNumberMechanicValue(MustDecimal("1")),
		},
	}
	errs := ValidateInputOverrideRecord(record, testEntities()["e1"], map[ID]MechanicDefinition{otherWorld.ID: otherWorld})
	for _, code := range []string{"entity_mismatch", "invalid_revision", "cross_world_reference", "unknown_mechanic"} {
		if !hasValidationCode(errs, code) {
			t.Errorf("expected %s, got %v", code, errs)
		}
	}
}

func TestDerivedMechanicsCannotOwnDefaultsBoundsOrStoredOverrides(t *testing.T) {
	t.Parallel()
	derived := namedDerived("derived", ValueNumber, numberLiteral("2"))
	derived.DefaultValue = NewNumberMechanicValue(MustDecimal("1"))
	derived.Minimum = decimalPointer(MustDecimal("0"))
	derived.Mutable = true
	errs := ValidateMechanicDefinition(derived)
	if !hasValidationAt(errs, "invalid_source", "default_value") ||
		!hasValidationAt(errs, "invalid_source", "source_kind") ||
		!hasValidationAt(errs, "invalid_source", "mutable") {
		t.Fatalf("derived source errors = %v", errs)
	}

	derived.DefaultValue = MechanicValue{}
	derived.Minimum = nil
	derived.Mutable = false
	record := InputOverrideRecord{EntityID: "e1", Overrides: map[ID]MechanicValue{
		derived.ID: NewNumberMechanicValue(MustDecimal("2")),
	}}
	errs = ValidateInputOverrideRecord(record, testEntities()["e1"], definitionMap(derived))
	if !hasValidationAt(errs, "derived_mechanic_override", "overrides[derived]") {
		t.Fatalf("derived storage errors = %v", errs)
	}
	logical := MaterializeLogicalState(testEntities()["e1"], InputOverrideRecord{EntityID: "e1"}, definitionMap(derived))
	if len(logical.InputValues) != 0 || len(logical.AuthoredDefaultInputMechanicIDs) != 0 {
		t.Fatalf("derived mechanic leaked into logical input values: %+v", logical)
	}
}

func TestDomainErrorSupportsErrorsIs(t *testing.T) {
	t.Parallel()
	err := domainError(ErrInvalidRuntimeSnapshot, ValidationErrors{{Code: "bad", Message: "bad runtime snapshot"}})
	if !errors.Is(err, ErrInvalidRuntimeSnapshot) {
		t.Fatalf("errors.Is(%v, ErrInvalidRuntimeSnapshot) = false", err)
	}
}

func testEntities() map[ID]Entity {
	return map[ID]Entity{
		"e1":       {ID: "e1", WorldID: "world", DisplayName: "One"},
		"e2":       {ID: "e2", WorldID: "world", DisplayName: "Two"},
		"archived": {ID: "archived", WorldID: "world", DisplayName: "Archived", Archived: true},
		"other":    {ID: "other", WorldID: "other-world", DisplayName: "Other"},
	}
}

func testNumberDefinition() MechanicDefinition {
	return MechanicDefinition{
		ID:           "score",
		WorldID:      "world",
		SourceKind:   SourceInput,
		ValueKind:    ValueNumber,
		DefaultValue: NewNumberMechanicValue(MustDecimal("0")),
		Mutable:      true,
	}
}

func testBooleanDefinition() MechanicDefinition {
	return MechanicDefinition{
		ID:           "flag",
		WorldID:      "world",
		SourceKind:   SourceInput,
		ValueKind:    ValueBoolean,
		DefaultValue: NewBooleanMechanicValue(false),
		Mutable:      true,
	}
}

func numberOverrideRecord(entityID, mechanicID ID, value string) InputOverrideRecord {
	return InputOverrideRecord{
		EntityID: entityID,
		Overrides: map[ID]MechanicValue{
			mechanicID: NewNumberMechanicValue(MustDecimal(value)),
		},
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
