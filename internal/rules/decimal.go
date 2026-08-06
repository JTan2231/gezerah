package rules

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"
)

// Decimal is an immutable, exact, finite base-10 number. Its zero value is
// invalid so omitted numeric union fields remain distinguishable from zero.
type Decimal struct {
	canonical string
}

const maxDecimalExponent = 10000

func ParseDecimal(input string) (Decimal, error) {
	if input == "" || strings.TrimSpace(input) != input {
		return Decimal{}, fmt.Errorf("invalid decimal %q", input)
	}

	mantissa := input
	exponent := 0
	if i := strings.IndexAny(mantissa, "eE"); i >= 0 {
		if strings.IndexAny(mantissa[i+1:], "eE") >= 0 || i == len(mantissa)-1 {
			return Decimal{}, fmt.Errorf("invalid decimal %q", input)
		}
		parsed, err := strconv.Atoi(mantissa[i+1:])
		if err != nil || parsed < -maxDecimalExponent || parsed > maxDecimalExponent {
			return Decimal{}, fmt.Errorf("invalid decimal exponent in %q", input)
		}
		exponent = parsed
		mantissa = mantissa[:i]
	}

	negative := false
	if strings.HasPrefix(mantissa, "+") || strings.HasPrefix(mantissa, "-") {
		negative = mantissa[0] == '-'
		mantissa = mantissa[1:]
	}
	if mantissa == "" {
		return Decimal{}, fmt.Errorf("invalid decimal %q", input)
	}

	if strings.Count(mantissa, ".") > 1 {
		return Decimal{}, fmt.Errorf("invalid decimal %q", input)
	}
	integer, fraction := mantissa, ""
	if dot := strings.IndexByte(mantissa, '.'); dot >= 0 {
		integer, fraction = mantissa[:dot], mantissa[dot+1:]
	}
	if integer == "" && fraction == "" {
		return Decimal{}, fmt.Errorf("invalid decimal %q", input)
	}
	if integer == "" {
		integer = "0"
	}
	if !allDigits(integer) || !allDigits(fraction) {
		return Decimal{}, fmt.Errorf("invalid decimal %q", input)
	}

	digits := strings.TrimLeft(integer+fraction, "0")
	if digits == "" {
		return Decimal{canonical: "0"}, nil
	}
	scale := len(fraction) - exponent
	if scale < 0 {
		digits += strings.Repeat("0", -scale)
		scale = 0
	}
	if scale > maxDecimalExponent {
		return Decimal{}, fmt.Errorf("decimal scale is too large")
	}
	if scale >= len(digits) {
		digits = strings.Repeat("0", scale-len(digits)+1) + digits
	}

	var canonical string
	if scale == 0 {
		canonical = digits
	} else {
		split := len(digits) - scale
		canonical = digits[:split] + "." + digits[split:]
		canonical = strings.TrimRight(canonical, "0")
		canonical = strings.TrimRight(canonical, ".")
	}
	canonical = strings.TrimLeft(canonical, "0")
	if strings.HasPrefix(canonical, ".") {
		canonical = "0" + canonical
	}
	if canonical == "" {
		canonical = "0"
	}
	if negative && canonical != "0" {
		canonical = "-" + canonical
	}
	return Decimal{canonical: canonical}, nil
}

func MustDecimal(input string) Decimal {
	d, err := ParseDecimal(input)
	if err != nil {
		panic(err)
	}
	return d
}

func allDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (d Decimal) Valid() bool { return d.canonical != "" }

func (d Decimal) String() string { return d.canonical }

func (d Decimal) rat() (*big.Rat, error) {
	if !d.Valid() {
		return nil, fmt.Errorf("invalid decimal")
	}
	r, ok := new(big.Rat).SetString(d.canonical)
	if !ok {
		return nil, fmt.Errorf("invalid decimal %q", d.canonical)
	}
	return r, nil
}

func (d Decimal) Cmp(other Decimal) int {
	left, leftErr := d.rat()
	right, rightErr := other.rat()
	if leftErr != nil || rightErr != nil {
		panic("comparison with invalid Decimal")
	}
	return left.Cmp(right)
}

func (d Decimal) Equal(other Decimal) bool {
	return d.Valid() && other.Valid() && d.Cmp(other) == 0
}

func (d Decimal) IsZero() bool { return d.Valid() && d.canonical == "0" }

func (d Decimal) IsPositive() bool {
	return d.Valid() && d.Cmp(MustDecimal("0")) > 0
}

func (d Decimal) Add(other Decimal) (Decimal, error) {
	left, err := d.rat()
	if err != nil {
		return Decimal{}, err
	}
	right, err := other.rat()
	if err != nil {
		return Decimal{}, err
	}
	scale := decimalScale(d.canonical)
	if otherScale := decimalScale(other.canonical); otherScale > scale {
		scale = otherScale
	}
	return ParseDecimal(new(big.Rat).Add(left, right).FloatString(scale))
}

func (d Decimal) Subtract(other Decimal) (Decimal, error) {
	left, err := d.rat()
	if err != nil {
		return Decimal{}, err
	}
	right, err := other.rat()
	if err != nil {
		return Decimal{}, err
	}
	scale := decimalScale(d.canonical)
	if otherScale := decimalScale(other.canonical); otherScale > scale {
		scale = otherScale
	}
	return ParseDecimal(new(big.Rat).Sub(left, right).FloatString(scale))
}

func (d Decimal) Multiply(other Decimal) (Decimal, error) {
	left, err := d.rat()
	if err != nil {
		return Decimal{}, err
	}
	right, err := other.rat()
	if err != nil {
		return Decimal{}, err
	}
	// The product of two finite base-10 decimals is finite, and the sum of
	// their scales is sufficient to render it exactly.
	scale := decimalScale(d.canonical) + decimalScale(other.canonical)
	return ParseDecimal(new(big.Rat).Mul(left, right).FloatString(scale))
}

func (d Decimal) Negate() (Decimal, error) {
	value, err := d.rat()
	if err != nil {
		return Decimal{}, err
	}
	return ParseDecimal(new(big.Rat).Neg(value).FloatString(decimalScale(d.canonical)))
}

// AlignsTo reports whether (d-base)/step is an integer. Callers conventionally
// use the declared minimum as base and zero when no minimum is declared.
func (d Decimal) AlignsTo(step, base Decimal) bool {
	valueRat, valueErr := d.rat()
	stepRat, stepErr := step.rat()
	baseRat, baseErr := base.rat()
	if valueErr != nil || stepErr != nil || baseErr != nil || stepRat.Sign() <= 0 {
		return false
	}
	delta := new(big.Rat).Sub(valueRat, baseRat)
	quotient := new(big.Rat).Quo(delta, stepRat)
	return quotient.Denom().Cmp(big.NewInt(1)) == 0
}

func decimalScale(value string) int {
	if dot := strings.IndexByte(value, '.'); dot >= 0 {
		return len(value) - dot - 1
	}
	return 0
}

func (d Decimal) MarshalText() ([]byte, error) {
	if !d.Valid() {
		return nil, fmt.Errorf("invalid decimal")
	}
	return []byte(d.canonical), nil
}

func (d *Decimal) UnmarshalText(text []byte) error {
	parsed, err := ParseDecimal(string(text))
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}

// JSON uses a string intentionally so HTTP adapters cannot silently round an
// exact PostgreSQL numeric through float64.
func (d Decimal) MarshalJSON() ([]byte, error) {
	if !d.Valid() {
		return nil, fmt.Errorf("invalid decimal")
	}
	return json.Marshal(d.canonical)
}

func (d *Decimal) UnmarshalJSON(data []byte) error {
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("decimal must be a JSON string: %w", err)
	}
	return d.UnmarshalText([]byte(value))
}
