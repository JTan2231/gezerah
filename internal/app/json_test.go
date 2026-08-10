package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONRejectsUnknownFieldsAndTrailingValues(t *testing.T) {
	type requestBody struct {
		Name string `json:"name"`
	}

	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"name":"valid","extra":true}`},
		{name: "trailing value", body: `{"name":"valid"} {"name":"second"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/example", strings.NewReader(test.body))
			var decoded requestBody
			if err := decodeJSON(request, &decoded); err == nil {
				t.Fatal("decodeJSON returned nil error")
			}
		})
	}
}

func TestDecodeJSONAcceptsOneStrictObject(t *testing.T) {
	type requestBody struct {
		Name string `json:"name"`
	}
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/example", strings.NewReader(`{"name":"valid"}`))
	var decoded requestBody
	if err := decodeJSON(request, &decoded); err != nil {
		t.Fatalf("decodeJSON: %v", err)
	}
	if decoded.Name != "valid" {
		t.Fatalf("Name = %q, want valid", decoded.Name)
	}
}

func TestWriteJSONPreservesErrorEnvelopeWhenSerializationFails(t *testing.T) {
	t.Parallel()

	response := httptest.NewRecorder()
	writeJSON(response, http.StatusCreated, struct {
		Unsupported chan struct{} `json:"unsupported"`
	}{Unsupported: make(chan struct{})})

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}
	const expected = `{"error":{"code":"internal_error","message":"internal server error"}}` + "\n"
	if body := response.Body.String(); body != expected {
		t.Fatalf("body = %q, want %q", body, expected)
	}
}

func TestWriteErrorUsesStableEnvelope(t *testing.T) {
	response := httptest.NewRecorder()
	writeError(response, http.StatusConflict, "revision_conflict", "state changed", map[string]string{
		"expected_revision": "4",
		"actual_revision":   "5",
	})

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q", contentType)
	}
	var envelope errorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if envelope.Error.Code != "revision_conflict" || envelope.Error.Fields["actual_revision"] != "5" {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
}
