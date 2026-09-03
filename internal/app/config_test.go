package app

import (
	"log/slog"
	"testing"
)

func TestLoadConfigPrefersWROUGHTVariables(t *testing.T) {
	t.Setenv("WROUGHT_ADDR", ":9090")
	t.Setenv("PORT", "7070")
	t.Setenv("WROUGHT_DATABASE_URL", "postgres://wrought-primary")
	t.Setenv("DATABASE_URL", "postgres://hosting-fallback")
	t.Setenv("WROUGHT_PUBLIC_ORIGIN", " https://app.example ")
	t.Setenv("OPENAI_API_KEY", " test-key ")
	t.Setenv("WROUGHT_OPENAI_BASE_URL", " http://models.example/v1 ")
	t.Setenv("WROUGHT_LOG_LEVEL", "warning")

	config := LoadConfig()
	if config.Addr != ":9090" {
		t.Fatalf("Addr = %q, want :9090", config.Addr)
	}
	if config.DatabaseURL != "postgres://wrought-primary" {
		t.Fatalf("DatabaseURL = %q, want WROUGHT_DATABASE_URL", config.DatabaseURL)
	}
	if config.PublicOrigin != "https://app.example" {
		t.Fatalf("PublicOrigin = %q, want configured origin", config.PublicOrigin)
	}
	if config.OpenAIAPIKey != "test-key" {
		t.Fatalf("OpenAIAPIKey = %q, want trimmed configured key", config.OpenAIAPIKey)
	}
	if config.OpenAIBaseURL != "http://models.example/v1" {
		t.Fatalf("OpenAIBaseURL = %q, want trimmed configured URL", config.OpenAIBaseURL)
	}
	if config.LogLevel != slog.LevelWarn {
		t.Fatalf("LogLevel = %v, want warn", config.LogLevel)
	}
}

func TestLoadConfigUsesHostingAndLocalFallbacks(t *testing.T) {
	t.Setenv("WROUGHT_ADDR", "")
	t.Setenv("PORT", "7070")
	t.Setenv("WROUGHT_DATABASE_URL", "")
	t.Setenv("DATABASE_URL", "postgres://hosting-fallback")
	t.Setenv("WROUGHT_LOG_LEVEL", "not-a-level")
	t.Setenv("WROUGHT_PUBLIC_ORIGIN", "")

	config := LoadConfig()
	if config.Addr != ":7070" {
		t.Fatalf("Addr = %q, want :7070", config.Addr)
	}
	if config.DatabaseURL != "postgres://hosting-fallback" {
		t.Fatalf("DatabaseURL = %q, want hosting fallback", config.DatabaseURL)
	}
	if config.LogLevel != slog.LevelInfo {
		t.Fatalf("LogLevel = %v, want info", config.LogLevel)
	}

	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "")
	config = LoadConfig()
	if config.Addr != ":8080" {
		t.Fatalf("default Addr = %q, want :8080", config.Addr)
	}
	if config.DatabaseURL != "postgres://localhost:5432/wrought?sslmode=disable" {
		t.Fatalf("default DatabaseURL = %q", config.DatabaseURL)
	}
}

func TestParsePublicOrigin(t *testing.T) {
	t.Parallel()
	for _, value := range []string{
		"https://example.test/path",
		"https://example.test?query=yes",
		"https://user@example.test",
		"ftp://example.test",
		"example.test",
		"https://éxample.test",
		"https://[fe80::1%25en0]",
		"http://example.test",
		"http://[2001:db8::1]",
	} {
		if _, _, err := parsePublicOrigin(value); err == nil {
			t.Errorf("parsePublicOrigin(%q) accepted a non-origin value", value)
		}
	}
	for _, test := range []struct {
		value      string
		wantOrigin string
		wantSecure bool
	}{
		{value: "https://example.test/", wantOrigin: "https://example.test", wantSecure: true},
		{value: "HTTPS://EXAMPLE.TEST:443", wantOrigin: "https://example.test", wantSecure: true},
		{value: "http://LOCALHOST:80", wantOrigin: "http://localhost"},
		{value: "http://127.0.0.1:8080", wantOrigin: "http://127.0.0.1:8080"},
		{value: "https://EXAMPLE.TEST:8443", wantOrigin: "https://example.test:8443", wantSecure: true},
		{value: "http://[0:0:0:0:0:0:0:1]:80", wantOrigin: "http://[::1]"},
	} {
		origin, secure, err := parsePublicOrigin(test.value)
		if err != nil || origin != test.wantOrigin || secure != test.wantSecure {
			t.Errorf("parsePublicOrigin(%q) = %q, %t, %v; want %q, %t", test.value, origin, secure, err, test.wantOrigin, test.wantSecure)
		}
	}
}

func TestValidateConfigRejectsInvalidPublicOrigin(t *testing.T) {
	t.Parallel()
	if err := ValidateConfig(Config{PublicOrigin: "https://example.test/path"}); err == nil {
		t.Fatal("ValidateConfig accepted a public URL with a path")
	}
	if err := ValidateConfig(Config{PublicOrigin: "https://example.test"}); err != nil {
		t.Fatalf("ValidateConfig rejected a valid origin: %v", err)
	}
	if err := ValidateConfig(Config{Addr: "127.0.0.1:8080", PublicOrigin: "http://example.test"}); err == nil {
		t.Fatal("ValidateConfig accepted non-loopback plain HTTP")
	}
	if err := ValidateConfig(Config{Addr: ":8080", PublicOrigin: "http://127.0.0.1:5173"}); err == nil {
		t.Fatal("ValidateConfig accepted a wildcard listener for a loopback HTTP origin")
	}
	if err := ValidateConfig(Config{Addr: "127.0.0.1:8080", PublicOrigin: "http://127.0.0.1:5173"}); err != nil {
		t.Fatalf("ValidateConfig rejected loopback-only HTTP development: %v", err)
	}
}
