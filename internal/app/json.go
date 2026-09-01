package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

const maxRequestBodyBytes = 1 << 20

type APIError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

type errorEnvelope struct {
	Error APIError `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	payload, err := json.Marshal(value)
	if err != nil {
		slog.Error("encode JSON response", "error", err)
		status = http.StatusInternalServerError
		payload = []byte(`{"error":{"code":"internal_error","message":"internal server error"}}`)
	}
	payload = append(payload, '\n')
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if _, err := w.Write(payload); err != nil {
		slog.Error("write JSON response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string, fields map[string]string) {
	writeJSON(w, status, errorEnvelope{Error: APIError{Code: code, Message: message, Fields: fields}})
}

func decodeJSON(r *http.Request, value any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(value); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return fmt.Errorf("request body must be at most %d bytes", maxBytesError.Limit)
		}
		return err
	}

	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain a single JSON value")
		}
		return err
	}
	return nil
}
