package rules

import (
	"errors"
	"testing"
)

func TestValidateMechanicDefinitionAndValues(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.DefaultValue = NewNumberValue(MustDecimal("1.25"))
	definition.Minimum = decimalPointer(MustDecimal("1"))
	definition.Maximum = decimalPointer(MustDecimal("2"))
	definition.Step = decimalPointer(MustDecimal("0.25"))

	if errs := ValidateMechanicDefinition(definition); len(errs) != 0 {
		t.Fatalf("valid definition rejected: %v", errs)
	}
	if errs := ValidateStateValue(definition, NewNumberValue(MustDecimal("1.5"))); len(errs) != 0 {
		t.Fatalf("valid number rejected: %v", errs)
	}
	if errs := ValidateStateValue(definition, NewNumberValue(MustDecimal("1.6"))); !hasValidationCode(errs, "step_mismatch") {
		t.Fatalf("expected step_mismatch, got %v", errs)
	}
	if errs := ValidateStateValue(definition, NewNumberValue(MustDecimal("2.25"))); !hasValidationCode(errs, "above_maximum") {
		t.Fatalf("expected above_maximum, got %v", errs)
	}

	invalidUnion := NewNumberValue(MustDecimal("1.5"))
	unexpected := true
	invalidUnion.Boolean = &unexpected
	if errs := ValidateStateValue(definition, invalidUnion); !hasValidationCode(errs, "invalid_typed_value") {
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
	missingDefault.DefaultValue = StateValue{}
	if errs := ValidateMechanicDefinition(missingDefault); !hasValidationCode(errs, "value_kind_mismatch") {
		t.Fatalf("expected invalid default, got %v", errs)
	}

	invalidStep := testNumberDefinition()
	invalidStep.Step = decimalPointer(MustDecimal("0"))
	if errs := ValidateMechanicDefinition(invalidStep); !hasValidationCode(errs, "invalid_step") {
		t.Fatalf("expected invalid_step, got %v", errs)
	}
}

func TestNumberAndBooleanTaggedValues(t *testing.T) {
	t.Parallel()
	number := NewNumberValue(MustDecimal("9007199254740993.25"))
	if errs := ValidateStateValue(testNumberDefinition(), number); len(errs) != 0 {
		t.Fatalf("number rejected: %v", errs)
	}
	boolean := NewBooleanValue(false)
	if errs := ValidateStateValue(testBooleanDefinition(), boolean); len(errs) != 0 {
		t.Fatalf("Boolean rejected: %v", errs)
	}
	if StateValuesEqual(number, boolean) {
		t.Fatal("different value kinds compared equal")
	}
	if !StateValuesEqual(number, CloneStateValue(number)) || !StateValuesEqual(boolean, CloneStateValue(boolean)) {
		t.Fatal("cloned scalar did not preserve equality")
	}
}

func TestLogicalDefaultsAndSparseNormalization(t *testing.T) {
	t.Parallel()
	number := testNumberDefinition()
	number.DefaultValue = NewNumberValue(MustDecimal("3"))
	boolean := testBooleanDefinition()
	definitions := map[ID]MechanicDefinition{number.ID: number, boolean.ID: boolean}
	record := StateRecord{EntityID: "e1", Revision: 2, Values: map[ID]StateValue{}}
	logical := MaterializeLogicalState(testEntities()["e1"], record, definitions)
	if got := logical.Values[number.ID].Number.String(); got != "3" {
		t.Fatalf("number default = %s", got)
	}
	if got := *logical.Values[boolean.ID].Boolean; got {
		t.Fatal("Boolean default = true, want false")
	}
	if len(logical.DefaultedMechanicIDs) != 2 || logical.DefaultedMechanicIDs[0] != boolean.ID || logical.DefaultedMechanicIDs[1] != number.ID {
		t.Fatalf("defaulted IDs = %v", logical.DefaultedMechanicIDs)
	}

	record.Values[number.ID] = CloneStateValue(number.DefaultValue)
	if errs := ValidateStateRecord(record, testEntities()["e1"], definitions); !hasValidationCode(errs, "unnormalized_default") {
		t.Fatalf("expected unnormalized_default, got %v", errs)
	}
	normalized := NormalizeStateRecord(record, definitions)
	if _, exists := normalized.Values[number.ID]; exists {
		t.Fatal("default remained persisted")
	}
	if _, exists := record.Values[number.ID]; !exists {
		t.Fatal("normalization mutated the caller-owned record")
	}
}

func TestStateValidationEnforcesWorldAndRecordIdentity(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	otherWorld := definition
	otherWorld.ID = "other-mechanic"
	otherWorld.WorldID = "other-world"
	record := StateRecord{
		EntityID: "wrong-entity",
		Revision: -1,
		Values: map[ID]StateValue{
			otherWorld.ID: NewNumberValue(MustDecimal("1")),
			"missing":     NewNumberValue(MustDecimal("1")),
		},
	}
	errs := ValidateStateRecord(record, testEntities()["e1"], map[ID]MechanicDefinition{otherWorld.ID: otherWorld})
	for _, code := range []string{"entity_mismatch", "invalid_revision", "cross_world_reference", "unknown_mechanic"} {
		if !hasValidationCode(errs, code) {
			t.Errorf("expected %s, got %v", code, errs)
		}
	}
}

func TestDerivedMechanicsCannotOwnDefaultsBoundsOrStoredState(t *testing.T) {
	t.Parallel()
	derived := namedDerived("calculated", ValueNumber, numberLiteral("2"))
	derived.DefaultValue = NewNumberValue(MustDecimal("1"))
	derived.Minimum = decimalPointer(MustDecimal("0"))
	derived.Mutable = true
	errs := ValidateMechanicDefinition(derived)
	if !hasValidationAt(errs, "invalid_source", "default_value") ||
		!hasValidationAt(errs, "invalid_source", "source_kind") ||
		!hasValidationAt(errs, "invalid_source", "mutable") {
		t.Fatalf("derived source errors = %v", errs)
	}

	derived.DefaultValue = StateValue{}
	derived.Minimum = nil
	derived.Mutable = false
	record := StateRecord{EntityID: "e1", Values: map[ID]StateValue{
		derived.ID: NewNumberValue(MustDecimal("2")),
	}}
	errs = ValidateStateRecord(record, testEntities()["e1"], definitionMap(derived))
	if !hasValidationAt(errs, "derived_state_value", "values[calculated]") {
		t.Fatalf("derived storage errors = %v", errs)
	}
	logical := MaterializeLogicalState(testEntities()["e1"], StateRecord{EntityID: "e1"}, definitionMap(derived))
	if len(logical.Values) != 0 || len(logical.DefaultedMechanicIDs) != 0 {
		t.Fatalf("derived mechanic leaked into writable logical state: %+v", logical)
	}
}

func TestDomainErrorSupportsErrorsIs(t *testing.T) {
	t.Parallel()
	err := domainError(ErrInvalidState, ValidationErrors{{Code: "bad", Message: "bad state"}})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("errors.Is(%v, ErrInvalidState) = false", err)
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
		DefaultValue: NewNumberValue(MustDecimal("0")),
		Mutable:      true,
	}
}

func testBooleanDefinition() MechanicDefinition {
	return MechanicDefinition{
		ID:           "flag",
		WorldID:      "world",
		SourceKind:   SourceInput,
		ValueKind:    ValueBoolean,
		DefaultValue: NewBooleanValue(false),
		Mutable:      true,
	}
}

func numberRecord(entityID, mechanicID ID, value string) StateRecord {
	return StateRecord{
		EntityID: entityID,
		Values: map[ID]StateValue{
			mechanicID: NewNumberValue(MustDecimal(value)),
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
