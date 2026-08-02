package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestStaticRoutesServeAssetsAndSPAFallback(t *testing.T) {
	staticFS := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<main>composer</main>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('dnd')")},
	}
	server := NewServerWithStaticFS(nil, staticFS)

	tests := []struct {
		path       string
		wantStatus int
		wantBody   string
	}{
		{path: "/assets/app.js", wantStatus: http.StatusOK, wantBody: "console.log('dnd')"},
		{path: "/rules/one", wantStatus: http.StatusOK, wantBody: "<main>composer</main>"},
		{path: "/assets/missing.js", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if body := response.Body.String(); !strings.Contains(body, test.wantBody) {
				t.Fatalf("body = %q, want it to contain %q", body, test.wantBody)
			}
		})
	}
}

func TestRecoveryReturnsJSONForAPIPanic(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index")},
	})
	server.HandleAPIFunc("GET /api/panic-test", func(http.ResponseWriter, *http.Request) {
		panic("test panic")
	})

	request := httptest.NewRequest(http.MethodGet, "/api/panic-test", nil)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q", contentType)
	}
}
