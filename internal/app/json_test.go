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

func TestEntitySheetResponseUsesCanonicalContract(t *testing.T) {
	t.Parallel()

	encoded, err := json.Marshal(entitySheetResponse{})
	if err != nil {
		t.Fatalf("marshal Entity sheet: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode Entity sheet: %v", err)
	}
	want := []string{
		"entity_id",
		"logical_state_revision",
		"status_set_revision",
		"rules_revision",
		"logical_input_values",
		"effective_values",
		"evaluations",
		"active_status_instances",
		"authored_default_input_mechanic_ids",
	}
	if len(fields) != len(want) {
		t.Fatalf("Entity sheet fields = %v, want exactly %v", fields, want)
	}
	for _, name := range want {
		if _, exists := fields[name]; !exists {
			t.Errorf("Entity sheet is missing %q", name)
		}
	}
}

func TestInteractionContextEntityTransportUsesCanonicalField(t *testing.T) {
	t.Parallel()

	var request saveInteractionRequest
	if err := decodeStrictBytes([]byte(`{
		"prompt":"A bridge collapses.",
		"eligible_responder_membership_ids":[],
		"context_entity_ids":["entity-one"]
	}`), &request); err != nil {
		t.Fatalf("decode Interaction request: %v", err)
	}
	if len(request.ContextEntityIDs) != 1 || request.ContextEntityIDs[0] != "entity-one" {
		t.Fatalf("Context Entity IDs = %v", request.ContextEntityIDs)
	}

	encoded, err := json.Marshal(interactionResponse{ContextEntityIDs: []string{"entity-one"}})
	if err != nil {
		t.Fatalf("marshal Interaction response: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatalf("decode Interaction response: %v", err)
	}
	if got := string(fields["context_entity_ids"]); got != `["entity-one"]` {
		t.Fatalf("context_entity_ids = %s", got)
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

func TestUpdateWorldRequestDistinguishesOmittedAndNullProseGuide(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		body      string
		wantSet   bool
		wantValue *string
	}{
		{name: "omitted", body: `{"expected_revision":1}`},
		{name: "null", body: `{"prose_guide":null,"expected_revision":1}`, wantSet: true},
		{name: "string", body: `{"prose_guide":"Stay close to ordinary details.","expected_revision":1}`, wantSet: true, wantValue: testString("Stay close to ordinary details.")},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			var request updateWorldRequest
			if err := decodeStrictBytes([]byte(test.body), &request); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if request.ProseGuide.Set != test.wantSet {
				t.Fatalf("prose guide set = %t, want %t", request.ProseGuide.Set, test.wantSet)
			}
			if test.wantValue == nil && request.ProseGuide.Value != nil {
				t.Fatalf("prose guide value = %q, want nil", *request.ProseGuide.Value)
			}
			if test.wantValue != nil && (request.ProseGuide.Value == nil || *request.ProseGuide.Value != *test.wantValue) {
				t.Fatalf("prose guide value = %#v, want %q", request.ProseGuide.Value, *test.wantValue)
			}
		})
	}
}

func testString(value string) *string { return &value }

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
	writeError(response, http.StatusConflict, "revision_conflict", "resource changed", map[string]string{
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
