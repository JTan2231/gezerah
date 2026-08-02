package app

import (
	"strings"
	"testing"

	"dnd/internal/rules"
)

func TestGeneratedWorldAndMechanicKeysAreInternalAndStable(t *testing.T) {
	t.Parallel()
	worldID := "12345678-1234-1234-1234-1234567890ab"
	if got, want := generatedWorldKey("  99 Ember Coast!  ", worldID), "world-1234567812"; got != want {
		t.Fatalf("generatedWorldKey() = %q, want %q", got, want)
	}
	mechanicID := "abcdef12-1234-1234-1234-1234567890ab"
	if got, want := generatedMechanicKey("capacity", "Heart & Fire", mechanicID), "capacity.heart-fire-abcdef12"; got != want {
		t.Fatalf("generatedMechanicKey() = %q, want %q", got, want)
	}
}

func TestWorldCharacterFieldValidationKeepsVocabularyUserAuthored(t *testing.T) {
	t.Parallel()
	revision := int64(2)
	request := replaceWorldCharacterFieldsRequest{
		ExpectedRevision: &revision,
		Fields: []saveWorldCharacterFieldRequest{
			{Label: "  Backstory  "},
			{
				ID: "12345678-1234-4234-8234-1234567890ab", Label: "Secret",
				HelpText:   pointerTo("  What no one else knows.  "),
				Visibility: "controllers-and-facilitators",
			},
		},
	}
	if fields := validateWorldCharacterFieldsRequest(&request); len(fields) > 0 {
		t.Fatalf("valid character fields rejected: %v", fields)
	}
	if request.Fields[0].Label != "Backstory" || request.Fields[1].HelpText == nil || *request.Fields[1].HelpText != "What no one else knows." {
		t.Fatalf("character field prose was not normalized: %#v", request.Fields)
	}
	if request.Fields[0].Visibility != "table" {
		t.Fatalf("default visibility = %q, want table", request.Fields[0].Visibility)
	}
}

func TestWorldCharacterFieldValidationRejectsInvalidDefinitions(t *testing.T) {
	t.Parallel()
	revision := int64(0)
	id := "12345678-1234-4234-8234-1234567890ab"
	request := replaceWorldCharacterFieldsRequest{
		ExpectedRevision: &revision,
		Fields: []saveWorldCharacterFieldRequest{
			{ID: id, Label: "", Visibility: "table"},
			{ID: id, Label: "Secret", Visibility: "engine-visible"},
		},
	}
	fields := validateWorldCharacterFieldsRequest(&request)
	for _, path := range []string{
		"fields[0].label", "fields[1].id", "fields[1].visibility",
	} {
		if _, exists := fields[path]; !exists {
			t.Errorf("missing validation error for %s: %v", path, fields)
		}
	}
}

func TestWorldCharacterFieldMatchIncludesAuthoredOrder(t *testing.T) {
	t.Parallel()
	current := []worldCharacterFieldResponse{
		{ID: "first", Label: "Past", Visibility: "table"},
		{ID: "second", Label: "Goal", Visibility: "controllers-and-facilitators"},
	}
	desired := []saveWorldCharacterFieldRequest{
		{ID: "first", Label: "Past", Visibility: "table"},
		{ID: "second", Label: "Goal", Visibility: "controllers-and-facilitators"},
	}
	if !worldCharacterFieldsMatch(current, desired) {
		t.Fatal("identical character fields were treated as changed")
	}
	desired[0], desired[1] = desired[1], desired[0]
	if worldCharacterFieldsMatch(current, desired) {
		t.Fatal("authored field order was treated as a no-op")
	}
}

func TestEntityProfileValidationAllowsPartialDrafts(t *testing.T) {
	t.Parallel()
	profileRevision, fieldsRevision := int64(2), int64(4)
	request := replaceEntityProfileRequest{
		ExpectedRevision:                &profileRevision,
		ExpectedCharacterFieldsRevision: &fieldsRevision,
		Values: []saveEntityProfileFieldValueRequest{
			{FieldID: "12345678-1234-4234-8234-1234567890ab", Value: "  Raised beside the glass sea.  "},
			{FieldID: "22345678-1234-4234-8234-1234567890ab", Value: "   "},
		},
	}
	if fields := validateEntityProfileRequest(&request); len(fields) > 0 {
		t.Fatalf("valid partial profile rejected: %v", fields)
	}
	if len(request.Values) != 1 || request.Values[0].Value != "Raised beside the glass sea." {
		t.Fatalf("profile values were not normalized: %#v", request.Values)
	}
}

func TestEntityProfileMatchIgnoresValueOrder(t *testing.T) {
	t.Parallel()
	first, second := "One", "Two"
	current := []entityProfileFieldResponse{
		{ID: "first", Value: &first},
		{ID: "second", Value: &second},
	}
	desired := []saveEntityProfileFieldValueRequest{
		{FieldID: "second", Value: "Two"},
		{FieldID: "first", Value: "One"},
	}
	if !entityProfileMatches(current, desired) {
		t.Fatal("identical profile values were treated as changed")
	}
	desired[0].Value = "Changed"
	if entityProfileMatches(current, desired) {
		t.Fatal("changed profile value was treated as a no-op")
	}
}

func pointerTo(value string) *string {
	return &value
}

func TestWorldInviteTokensAreOpaqueAndHashed(t *testing.T) {
	t.Parallel()
	token, digest, err := newWorldInviteToken()
	if err != nil {
		t.Fatalf("newWorldInviteToken(): %v", err)
	}
	if token == "" || strings.Contains(token, "=") {
		t.Fatalf("token is not raw URL-safe base64: %q", token)
	}
	if len(digest) != 64 || digest != hashWorldInviteToken(token) {
		t.Fatalf("digest = %q, want SHA-256 hash of token", digest)
	}
	if hashWorldInviteToken("") != "" || hashWorldInviteToken(strings.Repeat("x", 201)) != "" {
		t.Fatal("empty and oversized invite tokens must be rejected")
	}
}

func TestWorldMechanicsMapToUniversalTypedDefinitions(t *testing.T) {
	t.Parallel()
	request := saveWorldMechanicRequest{
		Kind: "capacity", Mode: "pool", Name: "Resolve", MutableDuringPlay: true,
	}
	definition, err := worldMechanicRequestToDefinition(request, "ruleset", "mechanic")
	if err != nil {
		t.Fatalf("worldMechanicRequestToDefinition(): %v", err)
	}
	if len(definition.OwnerSchemaIDs) != 0 {
		t.Fatalf("owner schemas = %v, want universal empty set", definition.OwnerSchemaIDs)
	}
	if definition.ValueKind != rules.ValueNumber || definition.Cardinality != rules.CardinalityOne {
		t.Fatalf("definition shape = %s/%s, want number/one", definition.ValueKind, definition.Cardinality)
	}
	if definition.DefaultValue == nil || len(definition.DefaultValue.Values) != 1 || definition.DefaultValue.Values[0].Number == nil {
		t.Fatalf("default = %#v, want numeric zero", definition.DefaultValue)
	}
	if got := definition.DefaultValue.Values[0].Number.String(); got != "0" {
		t.Fatalf("default = %s, want numeric zero", got)
	}
	wantOperations := []rules.EffectOperation{rules.EffectAdjustNumber, rules.EffectSet}
	if len(definition.AllowedEffectOperations) != len(wantOperations) {
		t.Fatalf("operations = %v, want %v", definition.AllowedEffectOperations, wantOperations)
	}
	for index, operation := range wantOperations {
		if definition.AllowedEffectOperations[index] != operation {
			t.Fatalf("operations = %v, want %v", definition.AllowedEffectOperations, wantOperations)
		}
	}

	binary, err := worldMechanicRequestToDefinition(saveWorldMechanicRequest{
		Kind: "capability", Mode: "binary", Name: "Climbing", MutableDuringPlay: false,
	}, "ruleset", "binary")
	if err != nil {
		t.Fatalf("binary worldMechanicRequestToDefinition(): %v", err)
	}
	if binary.ValueKind != rules.ValueBoolean || len(binary.AllowedEffectOperations) != 0 {
		t.Fatalf("binary definition = %#v", binary)
	}
}

func TestWorldMechanicModesStayWithinTheirAuthoredKind(t *testing.T) {
	t.Parallel()
	invalid := []saveWorldMechanicRequest{
		{Kind: "capacity", Mode: "binary", Name: "Invalid"},
		{Kind: "capability", Mode: "pool", Name: "Invalid"},
		{Kind: "built-in", Mode: "score", Name: "Invalid"},
	}
	for _, request := range invalid {
		if fields := validateWorldMechanicRequest(request); len(fields) == 0 {
			t.Fatalf("invalid request accepted: %#v", request)
		}
	}
}
