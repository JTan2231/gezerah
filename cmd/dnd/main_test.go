package main

import (
	"strings"
	"testing"

	"dnd/internal/app"
)

func TestRunValidatesPublicOriginBeforeDatabaseSetup(t *testing.T) {
	err := run(app.Config{
		DatabaseURL:  "this database URL must never be reached",
		PublicOrigin: "https://example.test/not-an-origin",
	})
	if err == nil {
		t.Fatal("run accepted an invalid public origin")
	}
	if !strings.Contains(err.Error(), "validate configuration: DND_PUBLIC_ORIGIN") {
		t.Fatalf("run error = %q, want configuration validation", err)
	}
	if strings.Contains(err.Error(), "database") {
		t.Fatalf("run reached database setup before validation: %v", err)
	}
}
