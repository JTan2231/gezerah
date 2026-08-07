package app

import (
	"bytes"
	"encoding/json"
	"log/slog"
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

func TestSuccessfulAPIMutationsBroadcastWorldEventWakeups(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>test</main>")},
	})
	server.HandleAPIFunc("POST /api/test/wake", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	})
	server.HandleAPIFunc("POST /api/test/reject", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusConflict, "conflict", "conflict", nil)
	})
	handler := server.Routes()

	wake := server.currentWorldEventWake()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/test/wake", nil))
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusCreated)
	}
	select {
	case <-wake:
	default:
		t.Fatal("successful API mutation did not wake event handlers")
	}

	nextWake := server.currentWorldEventWake()
	if nextWake == wake {
		t.Fatal("event wake generation did not rotate")
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/test/reject", nil))
	select {
	case <-nextWake:
		t.Fatal("rejected API mutation woke event handlers")
	default:
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

func TestRequestLogPathRedactsInviteBearersAndOmitsQueries(t *testing.T) {
	const (
		bearerSecret = "opaque-bearer-must-not-be-logged"
		querySecret  = "query-secret-must-not-be-logged"
	)
	tests := []struct {
		name   string
		target string
		want   string
	}{
		{
			name:   "play invitation",
			target: "/play/invite/" + bearerSecret + "?token=" + querySecret,
			want:   "/play/invite/[REDACTED]",
		},
		{
			name:   "build invitation",
			target: "/build/invite/" + bearerSecret + "?invite=" + querySecret,
			want:   "/build/invite/[REDACTED]",
		},
		{
			name:   "API invitation preview",
			target: "/api/world-invites/" + bearerSecret + "?secret=" + querySecret,
			want:   "/api/world-invites/[REDACTED]",
		},
		{
			name:   "API invitation redemption",
			target: "/api/world-invites/" + bearerSecret + "/redeem?key=" + querySecret,
			want:   "/api/world-invites/[REDACTED]/redeem",
		},
		{
			name:   "encoded slash cannot expose a bearer suffix",
			target: "/api/world-invites/opaque%2F" + bearerSecret + "/redeem",
			want:   "/api/world-invites/[REDACTED]/redeem",
		},
		{
			name:   "malformed frontend suffix is entirely redacted",
			target: "/play/invite/" + bearerSecret + "/unexpected/suffix",
			want:   "/play/invite/[REDACTED]",
		},
		{
			name:   "canonical redirect cannot expose a play bearer",
			target: "/other/../play/./invite/" + bearerSecret,
			want:   "/play/invite/[REDACTED]",
		},
		{
			name:   "canonical redirect cannot expose an API bearer",
			target: "/api/./world-invites/" + bearerSecret + "/redeem",
			want:   "/api/world-invites/[REDACTED]/redeem",
		},
		{
			name:   "normal API path",
			target: "/api/worlds/world-id/invites?token=" + querySecret,
			want:   "/api/worlds/world-id/invites",
		},
		{
			name:   "normal frontend path",
			target: "/play/world-id?invite=" + querySecret,
			want:   "/play/world-id",
		},
		{
			name:   "invitation prefix without bearer",
			target: "/api/world-invites?token=" + querySecret,
			want:   "/api/world-invites",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.target, nil)
			if got := requestLogPath(request); got != test.want {
				t.Fatalf("requestLogPath() = %q, want %q", got, test.want)
			}
			if got := requestLogPath(request); strings.Contains(got, querySecret) || strings.Contains(got, "?") {
				t.Fatalf("requestLogPath() included query data: %q", got)
			}
		})
	}

	if got := requestLogPath(nil); got != "" {
		t.Fatalf("requestLogPath(nil) = %q, want empty", got)
	}
}

func TestRequestAndRecoveryLogsRedactEveryInviteBearerPath(t *testing.T) {
	const (
		bearerSecret = "opaque-bearer-must-not-be-logged"
		querySecret  = "query-secret-must-not-be-logged"
	)
	tests := []struct {
		name   string
		target string
		want   string
	}{
		{
			name:   "play invitation",
			target: "/play/invite/" + bearerSecret + "?token=" + querySecret,
			want:   "/play/invite/[REDACTED]",
		},
		{
			name:   "build invitation",
			target: "/build/invite/" + bearerSecret + "?token=" + querySecret,
			want:   "/build/invite/[REDACTED]",
		},
		{
			name:   "API invitation preview",
			target: "/api/world-invites/" + bearerSecret + "?token=" + querySecret,
			want:   "/api/world-invites/[REDACTED]",
		},
		{
			name:   "API invitation redemption",
			target: "/api/world-invites/" + bearerSecret + "/redeem?token=" + querySecret,
			want:   "/api/world-invites/[REDACTED]/redeem",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var logs bytes.Buffer
			previousLogger := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previousLogger) })

			server := &Server{}
			handler := server.withRequestLog(server.withRecovery(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				panic("test panic " + bearerSecret)
			})))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.target, nil))
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
			}

			logOutput := logs.String()
			if strings.Contains(logOutput, bearerSecret) || strings.Contains(logOutput, querySecret) {
				t.Fatalf("logs exposed invitation secret: %s", logOutput)
			}

			var paths []string
			for _, line := range strings.Split(strings.TrimSpace(logOutput), "\n") {
				var record map[string]any
				if err := json.Unmarshal([]byte(line), &record); err != nil {
					t.Fatalf("decode log record: %v", err)
				}
				pathValue, ok := record["path"].(string)
				if !ok {
					t.Fatalf("log record path = %#v, want string", record["path"])
				}
				paths = append(paths, pathValue)
			}
			if len(paths) != 2 {
				t.Fatalf("logged paths = %#v, want panic and request records", paths)
			}
			for _, loggedPath := range paths {
				if loggedPath != test.want {
					t.Errorf("logged path = %q, want %q", loggedPath, test.want)
				}
			}
		})
	}
}
