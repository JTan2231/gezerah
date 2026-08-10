package app

import (
	"encoding/json"
	"testing"
)

func TestDecimalTextTransportPreservesExactValuesAndCanonicalizesOutput(t *testing.T) {
	t.Parallel()

	const exact = "9007199254740993.0000000000000001"
	var input stateValueDTO
	if err := json.Unmarshal([]byte(`{"kind":"number","value":"`+exact+`"}`), &input); err != nil {
		t.Fatal(err)
	}
	domain, err := stateValueDTOToDomain(input)
	if err != nil {
		t.Fatal(err)
	}
	if got := domain.Number.String(); got != exact {
		t.Fatalf("decoded decimal = %q, want %q", got, exact)
	}
	encoded, err := json.Marshal(stateValueDomainToDTO(domain))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(encoded), `{"kind":"number","value":"`+exact+`"}`; got != want {
		t.Fatalf("encoded state value = %s, want %s", got, want)
	}

	nonCanonical := decimalText("+001.2300")
	canonical, err := stateValueDTOToDomain(stateValueDTO{Kind: "number", Number: &nonCanonical})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err = json.Marshal(stateValueDomainToDTO(canonical))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(encoded), `{"kind":"number","value":"1.23"}`; got != want {
		t.Fatalf("canonical state value = %s, want %s", got, want)
	}
}

func TestDecimalTextTransportRejectsJSONNumbers(t *testing.T) {
	t.Parallel()

	for name, data := range map[string]string{
		"state value":      `{"kind":"number","value":1.25}`,
		"mechanic setting": `{"minimum":1.25}`,
		"effect amount":    `{"type":"adjust-number","amount":-2}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var target any
			switch name {
			case "state value":
				target = &stateValueDTO{}
			case "mechanic setting":
				target = &saveWorldMechanicRequest{}
			case "effect amount":
				target = &concreteEffectDTO{}
			}
			if err := json.Unmarshal([]byte(data), target); err == nil {
				t.Fatalf("json.Unmarshal(%s) unexpectedly succeeded", data)
			}
		})
	}
}
