package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// stateScalarDTO is the HTTP tagged union for one scalar value. The fields are
// intentionally private so all construction and decoding passes through the
// discriminator checks below instead of a map[string]any/float64 round trip.
type stateScalarDTO struct {
	Kind         string
	Text         *string
	Number       *json.Number
	Boolean      *bool
	Choice       *string
	Amount       *json.Number
	Unit         *string
	EntityID     *string
	FallbackName *string
}

func (value stateScalarDTO) MarshalJSON() ([]byte, error) {
	switch value.Kind {
	case "text":
		if value.Text == nil {
			return nil, errors.New("text value is missing")
		}
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			Value string `json:"value"`
		}{value.Kind, *value.Text})
	case "choice":
		if value.Choice == nil {
			return nil, errors.New("choice value is missing")
		}
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			Value string `json:"value"`
		}{value.Kind, *value.Choice})
	case "number":
		if value.Number == nil {
			return nil, errors.New("number value is missing")
		}
		return json.Marshal(struct {
			Kind  string      `json:"kind"`
			Value json.Number `json:"value"`
		}{value.Kind, *value.Number})
	case "boolean":
		if value.Boolean == nil {
			return nil, errors.New("boolean value is missing")
		}
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			Value bool   `json:"value"`
		}{value.Kind, *value.Boolean})
	case "measurement":
		if value.Amount == nil || value.Unit == nil {
			return nil, errors.New("measurement amount or unit is missing")
		}
		return json.Marshal(struct {
			Kind   string      `json:"kind"`
			Amount json.Number `json:"amount"`
			Unit   string      `json:"unit"`
		}{value.Kind, *value.Amount, *value.Unit})
	case "reference":
		if value.EntityID == nil {
			return nil, errors.New("referenced entity is missing")
		}
		return json.Marshal(struct {
			Kind         string  `json:"kind"`
			EntityID     string  `json:"entity_id"`
			FallbackName *string `json:"fallback_name,omitempty"`
		}{value.Kind, *value.EntityID, value.FallbackName})
	default:
		return nil, fmt.Errorf("unsupported value kind %q", value.Kind)
	}
}

func (value *stateScalarDTO) UnmarshalJSON(data []byte) error {
	var tagged struct {
		Kind string `json:"kind"`
	}
	if err := decodeStrictBytes(data, &tagged, false); err != nil {
		// The discriminator probe necessarily sees the other union fields. Probe
		// once permissively, then perform a strict kind-specific decode below.
		var raw map[string]json.RawMessage
		if mapErr := json.Unmarshal(data, &raw); mapErr != nil {
			return mapErr
		}
		kind, exists := raw["kind"]
		if !exists || json.Unmarshal(kind, &tagged.Kind) != nil {
			return errors.New("value kind is required")
		}
	}

	*value = stateScalarDTO{Kind: tagged.Kind}
	switch tagged.Kind {
	case "text":
		var decoded struct {
			Kind  string `json:"kind"`
			Value string `json:"value"`
		}
		if err := decodeStrictBytes(data, &decoded, true); err != nil {
			return err
		}
		value.Text = &decoded.Value
	case "choice":
		var decoded struct {
			Kind  string `json:"kind"`
			Value string `json:"value"`
		}
		if err := decodeStrictBytes(data, &decoded, true); err != nil {
			return err
		}
		value.Choice = &decoded.Value
	case "number":
		var decoded struct {
			Kind  string      `json:"kind"`
			Value json.Number `json:"value"`
		}
		if err := decodeStrictBytes(data, &decoded, true); err != nil {
			return err
		}
		value.Number = &decoded.Value
	case "boolean":
		var decoded struct {
			Kind  string `json:"kind"`
			Value *bool  `json:"value"`
		}
		if err := decodeStrictBytes(data, &decoded, true); err != nil {
			return err
		}
		if decoded.Value == nil {
			return errors.New("boolean value is required")
		}
		value.Boolean = decoded.Value
	case "measurement":
		var decoded struct {
			Kind   string       `json:"kind"`
			Amount *json.Number `json:"amount"`
			Unit   *string      `json:"unit"`
		}
		if err := decodeStrictBytes(data, &decoded, true); err != nil {
			return err
		}
		if decoded.Amount == nil || decoded.Unit == nil {
			return errors.New("measurement amount and unit are required")
		}
		value.Amount, value.Unit = decoded.Amount, decoded.Unit
	case "reference":
		var decoded struct {
			Kind         string  `json:"kind"`
			EntityID     *string `json:"entity_id"`
			FallbackName *string `json:"fallback_name,omitempty"`
		}
		if err := decodeStrictBytes(data, &decoded, true); err != nil {
			return err
		}
		if decoded.EntityID == nil {
			return errors.New("referenced entity ID is required")
		}
		value.EntityID, value.FallbackName = decoded.EntityID, cleanOptional(decoded.FallbackName)
	default:
		return fmt.Errorf("unsupported value kind %q", tagged.Kind)
	}
	return nil
}

// stateValueDTO is either one scalar or an ordered array of scalar values.
// Many remains explicit even for an empty collection.
type stateValueDTO struct {
	Many   bool
	Values []stateScalarDTO
}

func (value stateValueDTO) MarshalJSON() ([]byte, error) {
	if value.Many {
		if value.Values == nil {
			return []byte("[]"), nil
		}
		return json.Marshal(value.Values)
	}
	if len(value.Values) != 1 {
		return nil, errors.New("single-valued state must contain exactly one scalar")
	}
	return json.Marshal(value.Values[0])
}

func (value *stateValueDTO) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return errors.New("state value is required")
	}
	if trimmed[0] == '[' {
		value.Many = true
		return decodeStrictBytes(trimmed, &value.Values, true)
	}
	var scalar stateScalarDTO
	if err := decodeStrictBytes(trimmed, &scalar, true); err != nil {
		return err
	}
	value.Many = false
	value.Values = []stateScalarDTO{scalar}
	return nil
}

func decodeStrictBytes(data []byte, target any, requireEOF bool) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if requireEOF {
		var trailing any
		if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
			if err == nil {
				return errors.New("value must contain one JSON value")
			}
			return err
		}
	}
	return nil
}
