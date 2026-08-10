// Package openai provides the narrow OpenAI Responses API surface used by the
// Auto DM pipeline. It deliberately exposes only one-shot Terra text generation
// and Luna structured generation.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"time"
)

const (
	TerraModel = "gpt-5.6-terra"
	LunaModel  = "gpt-5.6-luna"

	defaultBaseURL      = "https://api.openai.com/v1"
	defaultTimeout      = 60 * time.Second
	maximumResponseSize = 8 << 20
)

var schemaNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Config contains the transport-level settings for a Client. BaseURL and
// HTTPClient are optional and primarily make local testing possible.
type Config struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

// Client makes one-shot calls to the OpenAI Responses API.
type Client struct {
	apiKey     string
	endpoint   string
	httpClient *http.Client
}

// Prompt is the common input for Terra and Luna generation. Instructions are
// optional. Input must contain non-whitespace text.
type Prompt struct {
	Instructions    string
	Input           string
	MaxOutputTokens int64
}

// JSONSchema configures Luna's strict Structured Output response format.
type JSONSchema struct {
	Name        string
	Description string
	Schema      map[string]any
}

// Generation contains the API identity and output text for a completed model
// response. For Luna, Text is the exact JSON text also decoded into the caller's
// destination.
type Generation struct {
	ResponseID string
	Model      string
	Text       string
}

// APIError is returned when the Responses endpoint responds with a non-2xx
// status code.
type APIError struct {
	StatusCode int
	Code       string
	Type       string
	Message    string
}

func (e *APIError) Error() string {
	detail := e.Message
	if detail == "" {
		detail = http.StatusText(e.StatusCode)
	}
	if e.Code != "" {
		return fmt.Sprintf("OpenAI API error %d (%s): %s", e.StatusCode, e.Code, detail)
	}
	return fmt.Sprintf("OpenAI API error %d: %s", e.StatusCode, detail)
}

// RefusalError reports a model refusal, which is a valid Responses API output
// that does not conform to a requested JSON Schema.
type RefusalError struct {
	ResponseID string
	Message    string
}

func (e *RefusalError) Error() string {
	return "OpenAI model refused the request: " + e.Message
}

// GenerationError reports a successful HTTP response that did not contain a
// completed model generation.
type GenerationError struct {
	ResponseID string
	Status     string
	Reason     string
}

func (e *GenerationError) Error() string {
	message := "OpenAI response did not complete"
	if e.Status != "" {
		message += " (status " + e.Status + ")"
	}
	if e.Reason != "" {
		message += ": " + e.Reason
	}
	return message
}

// NewClient validates the configuration and constructs a Responses API client.
func NewClient(config Config) (*Client, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, errors.New("OpenAI API key is required")
	}

	baseURL := strings.TrimSpace(config.BaseURL)
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse OpenAI base URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("OpenAI base URL must be an absolute HTTP or HTTPS URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("OpenAI base URL cannot contain user information, a query, or a fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/responses"

	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultTimeout}
	}

	return &Client{
		apiKey:     apiKey,
		endpoint:   parsed.String(),
		httpClient: httpClient,
	}, nil
}

// GenerateTerra asks GPT-5.6 Terra for plain text with reasoning effort none.
func (c *Client) GenerateTerra(ctx context.Context, prompt Prompt) (Generation, error) {
	if err := validatePrompt(prompt); err != nil {
		return Generation{}, err
	}
	return c.generate(ctx, TerraModel, prompt, nil)
}

// GenerateLuna asks GPT-5.6 Luna for strict JSON Schema output with reasoning
// effort none. Destination must be a non-nil pointer. JSON is decoded strictly,
// rejecting unknown fields and trailing values.
func (c *Client) GenerateLuna(
	ctx context.Context,
	prompt Prompt,
	schema JSONSchema,
	destination any,
) (Generation, error) {
	if err := validatePrompt(prompt); err != nil {
		return Generation{}, err
	}
	if err := validateSchema(schema); err != nil {
		return Generation{}, err
	}
	if err := validateDestination(destination); err != nil {
		return Generation{}, err
	}

	generation, err := c.generate(ctx, LunaModel, prompt, &schema)
	if err != nil {
		return Generation{}, err
	}
	if err := decodeStrictJSON(generation.Text, destination); err != nil {
		return generation, fmt.Errorf("decode Luna structured output: %w", err)
	}
	return generation, nil
}

type responsesRequest struct {
	Model           string              `json:"model"`
	Instructions    string              `json:"instructions,omitempty"`
	Input           string              `json:"input"`
	Reasoning       reasoningConfig     `json:"reasoning"`
	Store           bool                `json:"store"`
	MaxOutputTokens int64               `json:"max_output_tokens,omitempty"`
	Text            *responseTextConfig `json:"text,omitempty"`
}

type reasoningConfig struct {
	Effort string `json:"effort"`
}

type responseTextConfig struct {
	Format responseFormat `json:"format"`
}

type responseFormat struct {
	Type        string         `json:"type"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Schema      map[string]any `json:"schema"`
	Strict      bool           `json:"strict"`
}

type responsesResponse struct {
	ID                string                `json:"id"`
	Model             string                `json:"model"`
	Status            string                `json:"status"`
	Error             *responsesFailure     `json:"error"`
	IncompleteDetails *responsesIncomplete  `json:"incomplete_details"`
	Output            []responsesOutputItem `json:"output"`
}

type responsesFailure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type responsesIncomplete struct {
	Reason string `json:"reason"`
}

type responsesOutputItem struct {
	Type    string                   `json:"type"`
	Content []responsesOutputContent `json:"content"`
}

type responsesOutputContent struct {
	Type    string `json:"type"`
	Text    string `json:"text"`
	Refusal string `json:"refusal"`
}

type errorEnvelope struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

func (c *Client) generate(
	ctx context.Context,
	model string,
	prompt Prompt,
	schema *JSONSchema,
) (Generation, error) {
	payload := responsesRequest{
		Model:           model,
		Instructions:    prompt.Instructions,
		Input:           prompt.Input,
		Reasoning:       reasoningConfig{Effort: "none"},
		Store:           false,
		MaxOutputTokens: prompt.MaxOutputTokens,
	}
	if schema != nil {
		payload.Text = &responseTextConfig{Format: responseFormat{
			Type:        "json_schema",
			Name:        schema.Name,
			Description: schema.Description,
			Schema:      schema.Schema,
			Strict:      true,
		}}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return Generation{}, fmt.Errorf("encode OpenAI Responses request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Generation{}, fmt.Errorf("create OpenAI Responses request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return Generation{}, fmt.Errorf("send OpenAI Responses request: %w", err)
	}

	responseBody, readErr := readResponseBody(response.Body)
	closeErr := response.Body.Close()
	if readErr != nil {
		if closeErr != nil {
			return Generation{}, errors.Join(readErr, fmt.Errorf("close OpenAI Responses response: %w", closeErr))
		}
		return Generation{}, readErr
	}
	if closeErr != nil {
		return Generation{}, fmt.Errorf("close OpenAI Responses response: %w", closeErr)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return Generation{}, parseAPIError(response.StatusCode, responseBody)
	}

	var decoded responsesResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return Generation{}, fmt.Errorf("decode OpenAI Responses response: %w", err)
	}
	if decoded.Status != "completed" {
		reason := ""
		if decoded.Error != nil {
			reason = decoded.Error.Message
			if reason == "" {
				reason = decoded.Error.Code
			}
		}
		if reason == "" && decoded.IncompleteDetails != nil {
			reason = decoded.IncompleteDetails.Reason
		}
		return Generation{}, &GenerationError{
			ResponseID: decoded.ID,
			Status:     decoded.Status,
			Reason:     reason,
		}
	}

	output := make([]string, 0)
	for _, item := range decoded.Output {
		if item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			switch content.Type {
			case "refusal":
				return Generation{}, &RefusalError{
					ResponseID: decoded.ID,
					Message:    content.Refusal,
				}
			case "output_text":
				output = append(output, content.Text)
			}
		}
	}
	outputText := strings.Join(output, "")
	if outputText == "" {
		return Generation{}, &GenerationError{
			ResponseID: decoded.ID,
			Status:     decoded.Status,
			Reason:     "response contained no output text",
		}
	}

	return Generation{
		ResponseID: decoded.ID,
		Model:      decoded.Model,
		Text:       outputText,
	}, nil
}

func validatePrompt(prompt Prompt) error {
	if strings.TrimSpace(prompt.Input) == "" {
		return errors.New("OpenAI prompt input is required")
	}
	if prompt.MaxOutputTokens < 0 {
		return errors.New("OpenAI max output tokens cannot be negative")
	}
	return nil
}

func validateSchema(schema JSONSchema) error {
	if schema.Name == "" || len(schema.Name) > 64 || !schemaNamePattern.MatchString(schema.Name) {
		return errors.New("OpenAI JSON Schema name must be 1-64 letters, numbers, underscores, or dashes")
	}
	if schema.Schema == nil {
		return errors.New("OpenAI JSON Schema is required")
	}
	return nil
}

func validateDestination(destination any) error {
	if destination == nil {
		return errors.New("luna structured output destination is required")
	}
	value := reflect.ValueOf(destination)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return errors.New("luna structured output destination must be a non-nil pointer")
	}
	return nil
}

func decodeStrictJSON(input string, destination any) error {
	decoder := json.NewDecoder(strings.NewReader(input))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("structured output contains more than one JSON value")
		}
		return err
	}
	return nil
}

func readResponseBody(reader io.Reader) ([]byte, error) {
	limited := &io.LimitedReader{R: reader, N: maximumResponseSize + 1}
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read OpenAI Responses response: %w", err)
	}
	if len(body) > maximumResponseSize {
		return nil, fmt.Errorf("OpenAI Responses response exceeds %d bytes", maximumResponseSize)
	}
	return body, nil
}

func parseAPIError(statusCode int, body []byte) error {
	var envelope errorEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return &APIError{StatusCode: statusCode, Message: http.StatusText(statusCode)}
	}
	return &APIError{
		StatusCode: statusCode,
		Code:       envelope.Error.Code,
		Type:       envelope.Error.Type,
		Message:    envelope.Error.Message,
	}
}
