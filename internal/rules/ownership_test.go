package rules

import "testing"

func TestEmptyOwnerSetIsUniversal(t *testing.T) {
	t.Parallel()
	entity := Entity{ID: "generic", RuleSetID: "rs", DisplayName: "Generic"}
	if !EntityImplementsAny(entity, nil) {
		t.Fatal("an empty owner set must apply to a generic entity")
	}
	if EntityImplementsAny(entity, []ID{"authored-schema"}) {
		t.Fatal("a generic entity must not implement a specific authored schema")
	}
	if !schemaSetsIntersect(nil, []ID{"authored-schema"}) {
		t.Fatal("a universal owner set must intersect a specific owner set")
	}
	if schemaSetsIntersect([]ID{"left"}, []ID{"right"}) {
		t.Fatal("disjoint authored owner sets must not intersect")
	}
}

func TestUniversalDefinitionValidatesAndMaterializesForGenericEntity(t *testing.T) {
	t.Parallel()
	definition := testNumberDefinition()
	definition.OwnerSchemaIDs = nil
	defaultValue := NewSingleValue(NewNumberValue(MustDecimal("4")))
	definition.MissingKind = MissingDefault
	definition.DefaultValue = &defaultValue
	definition.OmitDefaultWhenStored = true

	if errs := ValidateStateVariableDefinition(definition, testSchemas(), testEntities()); len(errs) != 0 {
		t.Fatalf("universal definition rejected: %v", errs)
	}
	entity := testEntities()["inst"]
	logical := MaterializeLogicalState(entity, StateRecord{
		OwnerEntityID: entity.ID,
		Values:        map[ID]StateValue{},
	}, map[ID]StateVariableDefinition{definition.ID: definition})
	value, exists := logical.Values[definition.ID]
	if !exists || len(value.Values) != 1 || value.Values[0].Number == nil {
		t.Fatalf("universal default was not materialized: %#v", logical)
	}
	if got := value.Values[0].Number.String(); got != "4" {
		t.Fatalf("materialized value = %s, want 4", got)
	}
}
