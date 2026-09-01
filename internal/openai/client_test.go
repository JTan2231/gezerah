package openai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type observedRequest struct {
	Method        string
	Path          string
	Authorization string
	ContentType   string
	Body          map[string]any
	Err           error
}

func TestGenerateTerraUsesPlainTextResponsesContract(t *testing.T) {
	observed := make(chan observedRequest, 1)
	server := newResponsesServer(t, observed, http.StatusOK, map[string]any{
		"id":     "resp_terra",
		"model":  TerraModel,
		"status": "completed",
		"output": []any{map[string]any{
			"type": "message",
			"content": []any{map[string]any{
				"type": "output_text",
				"text": "A bell tolls beneath the drowned city.",
			}},
		}},
	})
	defer server.Close()

	client := newTestClient(t, server)
	result, err := client.GenerateTerra(context.Background(), Prompt{
		Instructions:    "Create the next problem.",
		Input:           "World context",
		MaxOutputTokens: 800,
	})
	if err != nil {
		t.Fatalf("GenerateTerra: %v", err)
	}
	if result.ResponseID != "resp_terra" || result.Model != TerraModel {
		t.Fatalf("unexpected generation metadata: %#v", result)
	}
	if result.Text != "A bell tolls beneath the drowned city." {
		t.Fatalf("unexpected text: %q", result.Text)
	}

	request := <-observed
	assertObservedRequest(t, request)
	assertString(t, request.Body, "model", TerraModel)
	assertString(t, request.Body, "instructions", "Create the next problem.")
	assertString(t, request.Body, "input", "World context")
	if request.Body["store"] != false {
		t.Fatalf("store = %#v, want false", request.Body["store"])
	}
	if request.Body["max_output_tokens"] != float64(800) {
		t.Fatalf("max_output_tokens = %#v, want 800", request.Body["max_output_tokens"])
	}
	reasoning := objectField(t, request.Body, "reasoning")
	assertString(t, reasoning, "effort", "none")
	if _, exists := request.Body["text"]; exists {
		t.Fatal("Terra request unexpectedly declared a structured text format")
	}
}

func TestGenerateLunaUsesStrictSchemaAndDecodesOutput(t *testing.T) {
	observed := make(chan observedRequest, 1)
	server := newResponsesServer(t, observed, http.StatusOK, map[string]any{
		"id":     "resp_luna",
		"model":  LunaModel,
		"status": "completed",
		"output": []any{map[string]any{
			"type": "message",
			"content": []any{map[string]any{
				"type": "output_text",
				"text": `{"summary":"The rope snaps.","effects":["shaken"]}`,
			}},
		}},
	})
	defer server.Close()

	type consequence struct {
		Summary string   `json:"summary"`
		Effects []string `json:"effects"`
	}
	var output consequence
	schema := JSONSchema{
		Name:        "consequence",
		Description: "A structured consequence.",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"summary": map[string]any{"type": "string"},
				"effects": map[string]any{
					"type":  "array",
					"items": map[string]any{"type": "string"},
				},
			},
			"required":             []string{"summary", "effects"},
			"additionalProperties": false,
		},
	}

	client := newTestClient(t, server)
	result, err := client.GenerateLuna(
		context.Background(),
		Prompt{Instructions: "Interpret the consequence.", Input: "The rope snaps."},
		schema,
		&output,
	)
	if err != nil {
		t.Fatalf("GenerateLuna: %v", err)
	}
	if result.ResponseID != "resp_luna" || result.Model != LunaModel {
		t.Fatalf("unexpected generation metadata: %#v", result)
	}
	if output.Summary != "The rope snaps." || len(output.Effects) != 1 || output.Effects[0] != "shaken" {
		t.Fatalf("unexpected decoded output: %#v", output)
	}

	request := <-observed
	assertObservedRequest(t, request)
	assertString(t, request.Body, "model", LunaModel)
	reasoning := objectField(t, request.Body, "reasoning")
	assertString(t, reasoning, "effort", "none")
	text := objectField(t, request.Body, "text")
	format := objectField(t, text, "format")
	assertString(t, format, "type", "json_schema")
	assertString(t, format, "name", "consequence")
	assertString(t, format, "description", "A structured consequence.")
	if format["strict"] != true {
		t.Fatalf("strict = %#v, want true", format["strict"])
	}
	requestSchema := objectField(t, format, "schema")
	if requestSchema["additionalProperties"] != false {
		t.Fatalf("schema additionalProperties = %#v, want false", requestSchema["additionalProperties"])
	}
}

func TestGenerateHandlesRefusalIncompleteAndAPIErrors(t *testing.T) {
	t.Run("refusal", func(t *testing.T) {
		observed := make(chan observedRequest, 1)
		server := newResponsesServer(t, observed, http.StatusOK, map[string]any{
			"id": "resp_refusal", "model": TerraModel, "status": "completed",
			"output": []any{map[string]any{
				"type": "message",
				"content": []any{map[string]any{
					"type": "refusal", "refusal": "I cannot help with that.",
				}},
			}},
		})
		defer server.Close()

		_, err := newTestClient(t, server).GenerateTerra(context.Background(), Prompt{Input: "request"})
		var refusal *RefusalError
		if !errors.As(err, &refusal) {
			t.Fatalf("error = %v, want RefusalError", err)
		}
		if refusal.ResponseID != "resp_refusal" || refusal.Message != "I cannot help with that." {
			t.Fatalf("unexpected refusal: %#v", refusal)
		}
		<-observed
	})

	t.Run("incomplete", func(t *testing.T) {
		observed := make(chan observedRequest, 1)
		server := newResponsesServer(t, observed, http.StatusOK, map[string]any{
			"id": "resp_incomplete", "model": TerraModel, "status": "incomplete",
			"incomplete_details": map[string]any{"reason": "max_output_tokens"},
			"output":             []any{},
		})
		defer server.Close()

		_, err := newTestClient(t, server).GenerateTerra(context.Background(), Prompt{Input: "request"})
		var generation *GenerationError
		if !errors.As(err, &generation) {
			t.Fatalf("error = %v, want GenerationError", err)
		}
		if generation.Status != "incomplete" || generation.Reason != "max_output_tokens" {
			t.Fatalf("unexpected generation error: %#v", generation)
		}
		<-observed
	})

	t.Run("API error", func(t *testing.T) {
		observed := make(chan observedRequest, 1)
		server := newResponsesServer(t, observed, http.StatusTooManyRequests, map[string]any{
			"error": map[string]any{
				"message": "Rate limit reached.",
				"type":    "rate_limit_error",
				"code":    "rate_limit_exceeded",
			},
		})
		defer server.Close()

		_, err := newTestClient(t, server).GenerateTerra(context.Background(), Prompt{Input: "request"})
		var apiError *APIError
		if !errors.As(err, &apiError) {
			t.Fatalf("error = %v, want APIError", err)
		}
		if apiError.StatusCode != http.StatusTooManyRequests || apiError.Code != "rate_limit_exceeded" || apiError.Type != "rate_limit_error" {
			t.Fatalf("unexpected API error: %#v", apiError)
		}
		<-observed
	})
}

func TestGenerateLunaRejectsUnexpectedStructuredFields(t *testing.T) {
	observed := make(chan observedRequest, 1)
	server := newResponsesServer(t, observed, http.StatusOK, map[string]any{
		"id": "resp_luna", "model": LunaModel, "status": "completed",
		"output": []any{map[string]any{
			"type": "message",
			"content": []any{map[string]any{
				"type": "output_text", "text": `{"summary":"Safe","extra":true}`,
			}},
		}},
	})
	defer server.Close()

	var output struct {
		Summary string `json:"summary"`
	}
	_, err := newTestClient(t, server).GenerateLuna(
		context.Background(),
		Prompt{Input: "request"},
		JSONSchema{Name: "result", Schema: map[string]any{"type": "object"}},
		&output,
	)
	if err == nil {
		t.Fatal("GenerateLuna unexpectedly accepted an unknown field")
	}
	<-observed
}

func newResponsesServer(
	t *testing.T,
	observed chan<- observedRequest,
	status int,
	response any,
) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := observedRequest{
			Method:        r.Method,
			Path:          r.URL.Path,
			Authorization: r.Header.Get("Authorization"),
			ContentType:   r.Header.Get("Content-Type"),
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			request.Err = err
		} else {
			request.Err = json.Unmarshal(body, &request.Body)
		}
		observed <- request

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Errorf("encode response: %v", err)
		}
	}))
}

func newTestClient(t *testing.T, server *httptest.Server) *Client {
	t.Helper()
	client, err := NewClient(Config{
		APIKey:     "test-key",
		BaseURL:    server.URL + "/v1",
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return client
}

func assertObservedRequest(t *testing.T, request observedRequest) {
	t.Helper()
	if request.Err != nil {
		t.Fatalf("read request: %v", request.Err)
	}
	if request.Method != http.MethodPost {
		t.Fatalf("method = %q, want POST", request.Method)
	}
	if request.Path != "/v1/responses" {
		t.Fatalf("path = %q, want /v1/responses", request.Path)
	}
	if request.Authorization != "Bearer test-key" {
		t.Fatalf("authorization = %q", request.Authorization)
	}
	if request.ContentType != "application/json" {
		t.Fatalf("content type = %q", request.ContentType)
	}
}

func assertString(t *testing.T, object map[string]any, key, want string) {
	t.Helper()
	if object[key] != want {
		t.Fatalf("%s = %#v, want %q", key, object[key], want)
	}
}

func objectField(t *testing.T, object map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := object[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want object", key, object[key])
	}
	return value
}
