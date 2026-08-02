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
