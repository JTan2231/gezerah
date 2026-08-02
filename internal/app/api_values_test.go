package app

import (
	"encoding/json"
	"testing"
)

func TestStateValueDTOExactNumberRoundTrip(t *testing.T) {
	t.Parallel()
	input := []byte(`{"kind":"number","value":9007199254740993.125}`)
	var value stateValueDTO
	if err := json.Unmarshal(input, &value); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := value.Values[0].Number.String(); got != "9007199254740993.125" {
		t.Fatalf("number = %q", got)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(encoded) != string(input) {
		t.Fatalf("round trip = %s, want %s", encoded, input)
	}
}

func TestStateScalarDTORejectsWrongUnionShape(t *testing.T) {
	t.Parallel()
	inputs := []string{
		`{"kind":"number","value":1,"unit":"hp"}`,
		`{"kind":"measurement","amount":1}`,
		`{"kind":"boolean","value":null}`,
		`{"kind":"reference","entity_id":"x","extra":true}`,
	}
	for _, input := range inputs {
		var value stateScalarDTO
		if err := json.Unmarshal([]byte(input), &value); err == nil {
			t.Errorf("unexpectedly accepted %s", input)
		}
	}
}
