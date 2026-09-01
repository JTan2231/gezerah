package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"gezerah/internal/app"
)

func TestHTTPServerDerivesRequestsFromProcessContext(t *testing.T) {
	root, cancel := context.WithCancel(context.Background())
	server := newHTTPServer(root, app.Config{Addr: "127.0.0.1:0"}, http.NotFoundHandler())
	requestContext := server.BaseContext(nil)

	cancel()
	select {
	case <-requestContext.Done():
	case <-time.After(time.Second):
		t.Fatal("request base context was not cancelled with the process context")
	}
}

func TestRunValidatesPublicOriginBeforeDatabaseSetup(t *testing.T) {
	err := run(app.Config{
		DatabaseURL:  "this database URL must never be reached",
		PublicOrigin: "https://example.test/not-an-origin",
	})
	if err == nil {
		t.Fatal("run accepted an invalid public origin")
	}
	if !strings.Contains(err.Error(), "validate configuration: GEZERAH_PUBLIC_ORIGIN") {
		t.Fatalf("run error = %q, want configuration validation", err)
	}
	if strings.Contains(err.Error(), "database") {
		t.Fatalf("run reached database setup before validation: %v", err)
	}
}
