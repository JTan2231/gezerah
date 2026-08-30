package app

import "testing"

func TestCharacterFieldVisibilityUsesWorldAndRestricted(t *testing.T) {
	t.Parallel()

	revision := int64(2)
	request := replaceWorldCharacterFieldsRequest{
		ExpectedRevision: &revision,
		Fields: []saveWorldCharacterFieldRequest{
			{Label: "Public detail"},
			{Label: "Private detail", Visibility: "restricted"},
		},
	}
	if fields := validateWorldCharacterFieldsRequest(&request); len(fields) != 0 {
		t.Fatalf("canonical visibility values were rejected: %v", fields)
	}
	if request.Fields[0].Visibility != "world" {
		t.Fatalf("empty visibility defaulted to %q, want world", request.Fields[0].Visibility)
	}

	request.Fields[0].Visibility = "public"
	if fields := validateWorldCharacterFieldsRequest(&request); fields["fields[0].visibility"] == "" {
		t.Fatalf("unsupported visibility was accepted: %v", fields)
	}
}
