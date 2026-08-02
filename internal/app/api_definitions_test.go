package app

import (
	"encoding/json"
	"reflect"
	"testing"

	"dnd/internal/rules"
)

func TestMissingValueDTOJSONPreservesTaggedUnionShape(t *testing.T) {
	t.Parallel()

	unknown, err := json.Marshal(missingValueDTO{Kind: "unknown"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(unknown), `{"kind":"unknown"}`; got != want {
		t.Fatalf("unknown JSON = %s, want %s", got, want)
	}

	value := stateValueDTO{Values: []stateScalarDTO{{Kind: "boolean", Boolean: boolPointer(false)}}}
	defaulted, err := json.Marshal(missingValueDTO{Kind: "default", Value: &value, OmitWhenStored: false})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(defaulted), `{"kind":"default","value":{"kind":"boolean","value":false},"omit_when_stored":false}`; got != want {
		t.Fatalf("default JSON = %s, want %s", got, want)
	}
}

func boolPointer(value bool) *bool { return &value }

func TestArchivedDefinitionReferenceFieldsAllowRetainedAndRejectNewReferences(t *testing.T) {
	t.Parallel()

	const (
		retainedOwner  rules.ID = "00000000-0000-4000-8000-000000000001"
		retainedTarget rules.ID = "00000000-0000-4000-8000-000000000002"
		newOwner       rules.ID = "00000000-0000-4000-8000-000000000003"
		newTarget      rules.ID = "00000000-0000-4000-8000-000000000004"
	)
	schemas := map[rules.ID]rules.OwnerSchema{
		retainedOwner:  {ID: retainedOwner, Archived: true},
		retainedTarget: {ID: retainedTarget, Archived: true},
		newOwner:       {ID: newOwner, Archived: true},
		newTarget:      {ID: newTarget, Archived: true},
	}
	current := rules.StateVariableDefinition{
		OwnerSchemaIDs:                []rules.ID{retainedOwner},
		ReferenceTargetOwnerSchemaIDs: []rules.ID{retainedTarget},
	}

	if fields := archivedDefinitionReferenceFields(current, current, schemas); len(fields) != 0 {
		t.Fatalf("retained archived references were rejected: %#v", fields)
	}

	proposed := current
	proposed.OwnerSchemaIDs = []rules.ID{retainedOwner, newOwner}
	proposed.ReferenceTargetOwnerSchemaIDs = []rules.ID{retainedTarget, newTarget}
	want := map[string]string{
		"owner_schema_ids[1]":                     "archived owner schemas cannot receive new definition references",
		"value_schema.target_owner_schema_ids[1]": "archived owner schemas cannot receive new reference-target constraints",
	}
	if got := archivedDefinitionReferenceFields(proposed, current, schemas); !reflect.DeepEqual(got, want) {
		t.Fatalf("archived fields = %#v, want %#v", got, want)
	}
}

func TestArchivedDefinitionReferenceFieldsRejectRedirectToArchivedTarget(t *testing.T) {
	t.Parallel()

	const (
		originalTarget rules.ID = "00000000-0000-4000-8000-000000000001"
		archivedTarget rules.ID = "00000000-0000-4000-8000-000000000002"
	)
	current := rules.StateVariableDefinition{ReferenceTargetOwnerSchemaIDs: []rules.ID{originalTarget}}
	proposed := rules.StateVariableDefinition{ReferenceTargetOwnerSchemaIDs: []rules.ID{archivedTarget}}
	schemas := map[rules.ID]rules.OwnerSchema{
		originalTarget: {ID: originalTarget},
		archivedTarget: {ID: archivedTarget, Archived: true},
	}
	want := map[string]string{
		"value_schema.target_owner_schema_ids[0]": "archived owner schemas cannot receive new reference-target constraints",
	}
	if got := archivedDefinitionReferenceFields(proposed, current, schemas); !reflect.DeepEqual(got, want) {
		t.Fatalf("archived fields = %#v, want %#v", got, want)
	}
}
