package rules

import (
	"encoding/json"
	"testing"
)

func TestParseDecimalCanonicalAndExactArithmetic(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		"0":          "0",
		"-0.000":     "0",
		"+001.2300":  "1.23",
		".0050":      "0.005",
		"1200e-2":    "12",
		"1.25e3":     "1250",
		"7.5e-3":     "0.0075",
		"-00042.010": "-42.01",
	}
	for input, expected := range tests {
		input, expected := input, expected
		t.Run(input, func(t *testing.T) {
			t.Parallel()
			actual, err := ParseDecimal(input)
			if err != nil {
				t.Fatalf("ParseDecimal(%q): %v", input, err)
			}
			if actual.String() != expected {
				t.Fatalf("ParseDecimal(%q) = %q, want %q", input, actual, expected)
			}
		})
	}

	left := MustDecimal("0.1")
	right := MustDecimal("0.2")
	sum, err := left.Add(right)
	if err != nil {
		t.Fatal(err)
	}
	if sum.String() != "0.3" {
		t.Fatalf("exact sum = %s, want 0.3", sum)
	}
	if !MustDecimal("1.15").AlignsTo(MustDecimal("0.05"), MustDecimal("1")) {
		t.Fatal("expected exact step alignment")
	}
	if MustDecimal("1.16").AlignsTo(MustDecimal("0.05"), MustDecimal("1")) {
		t.Fatal("unexpected step alignment")
	}
}

func TestParseDecimalRejectsInvalidAndJSONIsLossless(t *testing.T) {
	t.Parallel()
	for _, input := range []string{"", " 1", "1 ", ".", "1.2.3", "NaN", "Inf", "1e", "1e10001"} {
		if _, err := ParseDecimal(input); err == nil {
			t.Errorf("ParseDecimal(%q) unexpectedly succeeded", input)
		}
	}
	value := MustDecimal("9007199254740993.0000000000000001")
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `"9007199254740993.0000000000000001"` {
		t.Fatalf("JSON = %s", data)
	}
	var roundTrip Decimal
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if !roundTrip.Equal(value) {
		t.Fatalf("round trip = %s, want %s", roundTrip, value)
	}
}
