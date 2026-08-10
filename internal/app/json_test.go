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
			request := httptest.NewRequest(http.MethodPost, "/api/example", strings.NewReader(test.body))
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
	request := httptest.NewRequest(http.MethodPost, "/api/example", strings.NewReader(`{"name":"valid"}`))
	var decoded requestBody
	if err := decodeJSON(request, &decoded); err != nil {
		t.Fatalf("decodeJSON: %v", err)
	}
	if decoded.Name != "valid" {
		t.Fatalf("Name = %q, want valid", decoded.Name)
	}
}

func TestUpdateWorldRequestDistinguishesOmittedAndNullDescription(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		body      string
		wantSet   bool
		wantValue *string
	}{
		{name: "omitted", body: `{"expected_revision":1}`},
		{name: "null", body: `{"description":null,"expected_revision":1}`, wantSet: true},
		{name: "string", body: `{"description":"brief","expected_revision":1}`, wantSet: true, wantValue: testString("brief")},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var request updateWorldRequest
			if err := decodeStrictBytes([]byte(test.body), &request); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if request.Description.Set != test.wantSet {
				t.Fatalf("description set = %t, want %t", request.Description.Set, test.wantSet)
			}
			if test.wantValue == nil && request.Description.Value != nil {
				t.Fatalf("description value = %q, want nil", *request.Description.Value)
			}
			if test.wantValue != nil && (request.Description.Value == nil || *request.Description.Value != *test.wantValue) {
				t.Fatalf("description value = %#v, want %q", request.Description.Value, *test.wantValue)
			}
		})
	}
}

func testString(value string) *string { return &value }

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
