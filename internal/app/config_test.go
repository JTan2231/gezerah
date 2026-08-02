package app

import (
	"log/slog"
	"testing"
)

func TestLoadConfigPrefersDNDVariables(t *testing.T) {
	t.Setenv("DND_ADDR", ":9090")
	t.Setenv("PORT", "7070")
	t.Setenv("DND_DATABASE_URL", "postgres://dnd-primary")
	t.Setenv("DATABASE_URL", "postgres://hosting-fallback")
	t.Setenv("DND_LOG_LEVEL", "warning")

	config := LoadConfig()
	if config.Addr != ":9090" {
		t.Fatalf("Addr = %q, want :9090", config.Addr)
	}
	if config.DatabaseURL != "postgres://dnd-primary" {
		t.Fatalf("DatabaseURL = %q, want DND_DATABASE_URL", config.DatabaseURL)
	}
	if config.LogLevel != slog.LevelWarn {
		t.Fatalf("LogLevel = %v, want warn", config.LogLevel)
	}
}

func TestLoadConfigUsesHostingAndLocalFallbacks(t *testing.T) {
	t.Setenv("DND_ADDR", "")
	t.Setenv("PORT", "7070")
	t.Setenv("DND_DATABASE_URL", "")
	t.Setenv("DATABASE_URL", "postgres://hosting-fallback")
	t.Setenv("DND_LOG_LEVEL", "not-a-level")

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
	if config.DatabaseURL != "postgres://localhost:5432/dnd?sslmode=disable" {
		t.Fatalf("default DatabaseURL = %q", config.DatabaseURL)
	}
}
