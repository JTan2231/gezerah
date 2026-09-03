package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestStaticRoutesServeAssetsAndSPAFallback(t *testing.T) {
	staticFS := fstest.MapFS{
		"index.html":           &fstest.MapFile{Data: []byte("<main>composer</main>")},
		"assets/app.js":        &fstest.MapFile{Data: []byte("console.log('Wrought')")},
		"assets/chunks/app.js": &fstest.MapFile{Data: []byte("console.log('nested')")},
	}
	server := NewServerWithStaticFS(nil, staticFS)

	tests := []struct {
		path       string
		wantStatus int
		wantBody   string
	}{
		{path: "/wrought", wantStatus: http.StatusOK, wantBody: "<main>composer</main>"},
		{path: "/wrought/assets/app.js", wantStatus: http.StatusOK, wantBody: "console.log('Wrought')"},
		{path: "/wrought/assets/chunks/app.js", wantStatus: http.StatusOK, wantBody: "console.log('nested')"},
		{path: "/wrought/build/world-id/capacities", wantStatus: http.StatusOK, wantBody: "<main>composer</main>"},
		{path: "/wrought/assets", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/wrought/assets/", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/wrought/assets/chunks", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/wrought/assets/chunks/", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/wrought/assets/missing.js", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if body := response.Body.String(); !strings.Contains(body, test.wantBody) {
				t.Fatalf("body = %q, want it to contain %q", body, test.wantBody)
			}
			if strings.HasPrefix(test.path, "/wrought/assets") && response.Header().Get("Location") != "" {
				t.Fatalf("Location = %q, want no asset redirect", response.Header().Get("Location"))
			}
		})
	}
}

func TestProductStaticRoutesRejectUnsupportedMethods(t *testing.T) {
	staticFS := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte("<main>composer</main>")},
		"assets/app.js": &fstest.MapFile{Data: []byte("console.log('Wrought')")},
	}
	handler := NewServerWithStaticFS(nil, staticFS).Routes()

	for _, method := range []string{
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodOptions,
		http.MethodTrace,
	} {
		for _, requestPath := range []string{
			"/wrought",
			"/wrought/play/world-id",
			"/wrought/assets/app.js",
		} {
			t.Run(method+" "+requestPath, func(t *testing.T) {
				response := httptest.NewRecorder()
				request := httptest.NewRequestWithContext(t.Context(), method, requestPath, nil)
				handler.ServeHTTP(response, request)
				if response.Code != http.StatusMethodNotAllowed {
					t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
				}
				if allow := response.Header().Get("Allow"); allow != "GET, HEAD" {
					t.Fatalf("Allow = %q, want GET, HEAD", allow)
				}
				if body := response.Body.String(); !strings.Contains(body, "method not allowed") || strings.Contains(body, "composer") || strings.Contains(body, "console.log") {
					t.Fatalf("body = %q, want only the method error", body)
				}
			})
		}
	}
}

func TestEmbeddedSiteOwnsRootAndAncillaryPaths(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>wrought application</main>")},
	})
	handler := server.Routes()

	tests := []struct {
		path       string
		wantStatus int
		wantBody   string
	}{
		{path: "/", wantStatus: http.StatusOK, wantBody: "Joey Tan - Software Engineer"},
		{path: "/index", wantStatus: http.StatusOK, wantBody: "Joey Tan - Software Engineer"},
		{path: "/index.html", wantStatus: http.StatusOK, wantBody: "Joey Tan - Software Engineer"},
		{path: "/privacy-policy", wantStatus: http.StatusOK, wantBody: "Privacy Policy"},
		{path: "/privacy-policy.html", wantStatus: http.StatusOK, wantBody: "Privacy Policy"},
		{path: "/annals/", wantStatus: http.StatusOK, wantBody: "annals-web-production.up.railway.app"},
		{path: "/annals/index", wantStatus: http.StatusOK, wantBody: "annals-web-production.up.railway.app"},
		{path: "/annals/index.html", wantStatus: http.StatusOK, wantBody: "annals-web-production.up.railway.app"},
		{path: "/llms.txt", wantStatus: http.StatusOK, wantBody: "Joey Tan"},
		{path: "/llms/joeytan-dev-home.md", wantStatus: http.StatusOK, wantBody: "Joey Tan"},
		{path: "/plaid/oauth", wantStatus: http.StatusOK, wantBody: "Solari"},
		{path: "/plaid/oauth.html", wantStatus: http.StatusOK, wantBody: "Solari"},
		{path: "/llms/", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/plaid/", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/.well-known/", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/api/health", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/not-a-site-page", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/wroughtly", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/CNAME", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/.nojekyll", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/.pratica-wrought-site.toml", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
		{path: "/pratica-public-association-contract.md", wantStatus: http.StatusNotFound, wantBody: "404 page not found"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, test.path, nil))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if body := response.Body.String(); !strings.Contains(body, test.wantBody) {
				t.Fatalf("body = %q, want it to contain %q", body, test.wantBody)
			}
			if strings.Contains(response.Body.String(), "wrought application") {
				t.Fatal("root site miss fell back to the Wrought SPA")
			}
		})
	}
	for _, directory := range []string{"/annals", "/llms", "/plaid", "/.well-known"} {
		for _, query := range []string{"", "?probe=1"} {
			t.Run(directory+query+" redirect", func(t *testing.T) {
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, directory+query, nil))
				if response.Code != http.StatusMovedPermanently {
					t.Fatalf("status = %d, want %d", response.Code, http.StatusMovedPermanently)
				}
				if location, want := response.Header().Get("Location"), directory+"/"+query; location != want {
					t.Fatalf("Location = %q, want %q", location, want)
				}
			})
		}
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/.well-known/apple-app-site-association", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("association status = %d, want %d", response.Code, http.StatusOK)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("association Content-Type = %q, want application/json", contentType)
	}
	if location := response.Header().Get("Location"); location != "" {
		t.Fatalf("association redirected to %q", location)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(response.Body.Bytes())); got != "789b60b536c7bf1cd98a9ac37e8a89fb78691a06a525fea67c1a8ece41cb7b96" {
		t.Fatalf("association SHA-256 = %s, bytes changed", got)
	}
}

func TestEmbeddedSiteServesEveryTrackedFileAtItsExactPath(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>wrought application</main>")},
	})
	handler := server.Routes()
	if err := fs.WalkDir(server.siteFS, ".", func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		t.Run(filePath, func(t *testing.T) {
			expected, err := fs.ReadFile(server.siteFS, filePath)
			if err != nil {
				t.Fatalf("read embedded file: %v", err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/"+filePath, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if !bytes.Equal(response.Body.Bytes(), expected) {
				t.Fatalf("served bytes differ from embedded %s", filePath)
			}
			if location := response.Header().Get("Location"); location != "" {
				t.Fatalf("tracked file redirected to %q", location)
			}
		})
		return nil
	}); err != nil {
		t.Fatalf("walk embedded site: %v", err)
	}
}

func TestEmbeddedSiteServesHTMLExtensionlessAliases(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>wrought application</main>")},
	})
	handler := server.Routes()
	aliases := map[string]string{
		"/index":          "index.html",
		"/annals/index":   "annals/index.html",
		"/plaid/oauth":    "plaid/oauth.html",
		"/privacy-policy": "privacy-policy.html",
	}
	for alias, filePath := range aliases {
		t.Run(alias, func(t *testing.T) {
			expected, err := fs.ReadFile(server.siteFS, filePath)
			if err != nil {
				t.Fatalf("read embedded file: %v", err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, alias+"?probe=1", nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if !bytes.Equal(response.Body.Bytes(), expected) {
				t.Fatalf("served bytes differ from embedded %s", filePath)
			}
			if contentType := response.Header().Get("Content-Type"); contentType != "text/html; charset=utf-8" {
				t.Fatalf("Content-Type = %q, want text/html; charset=utf-8", contentType)
			}
			if location := response.Header().Get("Location"); location != "" {
				t.Fatalf("extensionless alias redirected to %q", location)
			}
		})
	}
}

func TestEmbeddedSiteContentTypesMatchPublishedSite(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>wrought application</main>")},
	})
	handler := server.Routes()
	tests := map[string]string{
		"/index.html":                     "text/html; charset=utf-8",
		"/annals/main.js":                 "application/javascript; charset=utf-8",
		"/annals/style.css":               "text/css; charset=utf-8",
		"/bio-prompt.md":                  "text/markdown; charset=utf-8",
		"/llms.txt":                       "text/plain; charset=utf-8",
		"/llms/joeytan-dev-bio-prompt.md": "text/markdown; charset=utf-8",
	}
	for target, want := range tests {
		t.Run(target, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, target, nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
			}
			if contentType := response.Header().Get("Content-Type"); contentType != want {
				t.Fatalf("Content-Type = %q, want %q", contentType, want)
			}
		})
	}
}

func TestProductAPINotFoundIsScopedAndJSON(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>wrought application</main>")},
	})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/wrought/api/not-an-endpoint", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", contentType)
	}
	if body := response.Body.String(); !strings.Contains(body, `"code":"endpoint_not_found"`) || strings.Contains(body, "wrought application") {
		t.Fatalf("body = %q, want API error without SPA fallback", body)
	}
	if csp := response.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Fatalf("API Content-Security-Policy = %q", csp)
	}
}

func TestSecurityHeadersAndHTTPSOnlyHSTS(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index")},
	})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/wrought", nil)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	for name, want := range map[string]string{
		"Content-Security-Policy": "default-src 'self'",
		"Permissions-Policy":      "camera=()",
		"Referrer-Policy":         "no-referrer",
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
	} {
		if got := response.Header().Get(name); !strings.Contains(got, want) {
			t.Errorf("%s = %q, want it to contain %q", name, got, want)
		}
	}
	if hsts := response.Header().Get("Strict-Transport-Security"); hsts != "" {
		t.Fatalf("HTTP Strict-Transport-Security = %q, want empty", hsts)
	}

	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
	if csp := response.Header().Get("Content-Security-Policy"); csp != "" {
		t.Fatalf("root Content-Security-Policy = %q, want empty for embedded inline script", csp)
	}

	server.securePublicOrigin = true
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
	if hsts := response.Header().Get("Strict-Transport-Security"); !strings.Contains(hsts, "max-age=") {
		t.Fatalf("HTTPS Strict-Transport-Security = %q", hsts)
	}
}

func TestSuccessfulAPIMutationsBroadcastWorldEventWakeups(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<main>test</main>")},
	})
	server.handlePublicAPIFunc("POST /api/test/wake", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	})
	server.handlePublicAPIFunc("POST /api/test/reject", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusConflict, "conflict", "conflict", nil)
	})
	handler := server.Routes()

	wake := server.currentWorldEventWake()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/wrought/api/test/wake", nil))
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
	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/wrought/api/test/reject", nil))
	select {
	case <-nextWake:
		t.Fatal("rejected API mutation woke event handlers")
	default:
	}
}

func TestAuthenticationMutationsDoNotBroadcastWorldEventWakeups(t *testing.T) {
	for _, path := range []string{
		"/wrought/api/auth/signup",
		"/wrought/api/auth/signin",
		"/wrought/api/auth/logout",
		"/wrought/api/auth/logout-all",
		"/wrought/api/me/password",
	} {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, nil)
		if successfulAPIMutation(request, http.StatusNoContent) {
			t.Errorf("successfulAPIMutation(%q) woke world streams for account-only work", path)
		}
	}
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/wrought/api/worlds", nil)
	if !successfulAPIMutation(request, http.StatusCreated) {
		t.Fatal("world mutation no longer wakes world event streams")
	}
}

func TestExportedAPIRouteRegistrationIsAuthenticatedByDefault(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index")},
	})
	called := false
	server.HandleAPIFunc("GET /api/test/protected", func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/wrought/api/test/protected", nil)
	request.Header.Set("X-Wrought-User-Id", "57898ef8-85cf-43f3-a666-afdcfdd8cc54")
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if called {
		t.Fatal("deny-by-default route reached its handler without a session")
	}
}

func TestRecoveryReturnsJSONForAPIPanic(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("index")},
	})
	server.handlePublicAPIFunc("GET /api/panic-test", func(http.ResponseWriter, *http.Request) {
		panic("test panic")
	})

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/wrought/api/panic-test", nil)
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
		pathMarker  = "opaque-bearer-must-not-be-logged"
		queryMarker = "query-secret-must-not-be-logged"
	)
	tests := []struct {
		name   string
		target string
		want   string
	}{
		{
			name:   "play invitation",
			target: "/wrought/play/invite/" + pathMarker + "?token=" + queryMarker,
			want:   "/wrought/play/invite/[REDACTED]",
		},
		{
			name:   "build invitation",
			target: "/wrought/build/invite/" + pathMarker + "?invite=" + queryMarker,
			want:   "/wrought/build/invite/[REDACTED]",
		},
		{
			name:   "API invitation preview",
			target: "/wrought/api/world-invites/" + pathMarker + "?secret=" + queryMarker,
			want:   "/wrought/api/world-invites/[REDACTED]",
		},
		{
			name:   "API invitation redemption",
			target: "/wrought/api/world-invites/" + pathMarker + "/redeem?key=" + queryMarker,
			want:   "/wrought/api/world-invites/[REDACTED]/redeem",
		},
		{
			name:   "encoded slash cannot expose a bearer suffix",
			target: "/wrought/api/world-invites/opaque%2F" + pathMarker + "/redeem",
			want:   "/wrought/api/world-invites/[REDACTED]/redeem",
		},
		{
			name:   "malformed frontend suffix is entirely redacted",
			target: "/wrought/play/invite/" + pathMarker + "/unexpected/suffix",
			want:   "/wrought/play/invite/[REDACTED]",
		},
		{
			name:   "canonical redirect cannot expose a play bearer",
			target: "/other/../wrought/./play/invite/" + pathMarker,
			want:   "/wrought/play/invite/[REDACTED]",
		},
		{
			name:   "canonical redirect cannot expose an API bearer",
			target: "/wrought/api/./world-invites/" + pathMarker + "/redeem",
			want:   "/wrought/api/world-invites/[REDACTED]/redeem",
		},
		{
			name:   "normal API path",
			target: "/wrought/api/worlds/world-id/invites?token=" + queryMarker,
			want:   "/wrought/api/worlds/world-id/invites",
		},
		{
			name:   "normal frontend path",
			target: "/wrought/play/world-id?invite=" + queryMarker,
			want:   "/wrought/play/world-id",
		},
		{
			name:   "invitation prefix without bearer",
			target: "/wrought/api/world-invites?token=" + queryMarker,
			want:   "/wrought/api/world-invites",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, test.target, nil)
			if got := requestLogPath(request); got != test.want {
				t.Fatalf("requestLogPath() = %q, want %q", got, test.want)
			}
			if got := requestLogPath(request); strings.Contains(got, queryMarker) || strings.Contains(got, "?") {
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
		pathMarker  = "opaque-bearer-must-not-be-logged"
		queryMarker = "query-secret-must-not-be-logged"
	)
	tests := []struct {
		name   string
		target string
		want   string
	}{
		{
			name:   "play invitation",
			target: "/wrought/play/invite/" + pathMarker + "?token=" + queryMarker,
			want:   "/wrought/play/invite/[REDACTED]",
		},
		{
			name:   "build invitation",
			target: "/wrought/build/invite/" + pathMarker + "?token=" + queryMarker,
			want:   "/wrought/build/invite/[REDACTED]",
		},
		{
			name:   "API invitation preview",
			target: "/wrought/api/world-invites/" + pathMarker + "?token=" + queryMarker,
			want:   "/wrought/api/world-invites/[REDACTED]",
		},
		{
			name:   "API invitation redemption",
			target: "/wrought/api/world-invites/" + pathMarker + "/redeem?token=" + queryMarker,
			want:   "/wrought/api/world-invites/[REDACTED]/redeem",
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
				panic("test panic " + pathMarker)
			})))
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, test.target, nil))
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
			}

			logOutput := logs.String()
			if strings.Contains(logOutput, pathMarker) || strings.Contains(logOutput, queryMarker) {
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
