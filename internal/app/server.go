package app

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/JTan2231/wrought/web"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	db                 *pgxpool.Pool
	api                *http.ServeMux
	models             modelProvider
	worldTemplates     worldTemplateCatalog
	siteFS             fs.FS
	static             http.Handler
	staticFS           fs.FS
	publicOrigin       string
	securePublicOrigin bool
	authThrottle       *authThrottle

	worldEventWakeMu sync.Mutex
	worldEventWake   chan struct{}
}

const productMountPath = "/wrought"

func NewServer(_ context.Context, db *pgxpool.Pool, config Config) (*Server, error) {
	staticFS, err := fs.Sub(web.Static, "static")
	if err != nil {
		return nil, fmt.Errorf("load static files: %w", err)
	}
	siteFS, err := fs.Sub(web.Site, "site")
	if err != nil {
		return nil, fmt.Errorf("load site files: %w", err)
	}
	publicOrigin, securePublicOrigin, err := parsePublicOrigin(config.PublicOrigin)
	if err != nil {
		return nil, err
	}
	server := newServerWithFilesystems(db, staticFS, siteFS)
	if strings.TrimSpace(config.OpenAIAPIKey) != "" {
		provider, err := newOpenAIModelProvider(config.OpenAIAPIKey, config.OpenAIBaseURL)
		if err != nil {
			return nil, fmt.Errorf("configure model provider: %w", err)
		}
		server.models = provider
	}
	server.publicOrigin = publicOrigin
	server.securePublicOrigin = securePublicOrigin
	return server, nil
}

// NewServerWithStaticFS is the test seam for serving a synthetic frontend.
func NewServerWithStaticFS(db *pgxpool.Pool, staticFS fs.FS) *Server {
	siteFS, err := fs.Sub(web.Site, "site")
	if err != nil {
		panic(fmt.Errorf("load embedded site files: %w", err))
	}
	return newServerWithFilesystems(db, staticFS, siteFS)
}

func newServerWithFilesystems(db *pgxpool.Pool, staticFS, siteFS fs.FS) *Server {
	server := &Server{
		db:             db,
		api:            http.NewServeMux(),
		worldTemplates: embeddedWorldTemplateCatalog,
		siteFS:         siteFS,
		static:         http.FileServer(http.FS(staticFS)),
		staticFS:       staticFS,
		authThrottle:   newAuthThrottle(),
		worldEventWake: make(chan struct{}),
	}
	server.handlePublicAPIFunc("GET /api/health", server.handleHealth)
	server.registerResourceRoutes()
	server.handlePublicAPIFunc("/api", server.handleAPINotFound)
	server.handlePublicAPIFunc("/api/", server.handleAPINotFound)
	return server
}

// HandleAPI is the deny-by-default registration seam for method-aware product
// routes. Safe methods require a live session; unsafe methods additionally
// require the session's CSRF token and the exact browser origin.
func (s *Server) HandleAPI(pattern string, handler http.Handler) {
	s.validateAPIPattern(pattern)
	wrapped := s.withAuthentication(handler)
	method, _, _ := strings.Cut(pattern, " ")
	if method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions {
		wrapped = s.withAuthenticatedMutation(handler)
	}
	s.api.Handle(pattern, wrapped)
}

func (s *Server) handlePublicAPI(pattern string, handler http.Handler) {
	s.validateAPIPattern(pattern)
	s.api.Handle(pattern, handler)
}

func (s *Server) handlePublicAPIFunc(pattern string, handler http.HandlerFunc) {
	s.handlePublicAPI(pattern, handler)
}

func (s *Server) validateAPIPattern(pattern string) {
	if !strings.Contains(pattern, "/api/") && pattern != "/api" {
		panic("API route pattern must target /api")
	}
}

func (s *Server) HandleAPIFunc(pattern string, handler http.HandlerFunc) {
	s.HandleAPI(pattern, handler)
}

func (s *Server) Routes() http.Handler {
	product := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
			}
			s.api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.handleStatic(w, r)
	})
	mountedProduct := stripProductMount(product)

	root := http.NewServeMux()
	root.Handle(productMountPath, mountedProduct)
	root.Handle(productMountPath+"/", mountedProduct)
	root.HandleFunc("GET /.well-known/apple-app-site-association", s.handleAppleAppSiteAssociation)
	root.HandleFunc("/", s.handleSite)

	return s.withRequestLog(s.withRecovery(s.withSecurityHeaders(root)))
}

func (s *Server) handleSite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	requestPath := path.Clean(r.URL.Path)
	filePath := strings.TrimPrefix(requestPath, "/")
	if filePath == "" || filePath == "." {
		filePath = "index.html"
	}

	info, err := fs.Stat(s.siteFS, filePath)
	if err != nil {
		filePath += ".html"
		info, err = fs.Stat(s.siteFS, filePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	if info.IsDir() {
		if !strings.HasSuffix(r.URL.Path, "/") {
			location := (&url.URL{
				Path:     "/" + filePath + "/",
				RawQuery: r.URL.RawQuery,
			}).RequestURI()
			http.Redirect(w, r, location, http.StatusMovedPermanently)
			return
		}
		filePath = path.Join(filePath, "index.html")
		info, err = fs.Stat(s.siteFS, filePath)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
	} else if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") {
		http.NotFound(w, r)
		return
	}

	contents, err := fs.ReadFile(s.siteFS, filePath)
	if err != nil {
		http.Error(w, "site file unavailable", http.StatusInternalServerError)
		return
	}
	if contentType := siteContentType(filePath); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, path.Base(filePath), info.ModTime(), bytes.NewReader(contents))
}

func siteContentType(filePath string) string {
	switch path.Ext(filePath) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "application/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".txt":
		return "text/plain; charset=utf-8"
	default:
		return ""
	}
}

func (s *Server) handleAppleAppSiteAssociation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	http.ServeFileFS(w, r, s.siteFS, ".well-known/apple-app-site-association")
}

func stripProductMount(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isProductPath(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		request := r.Clone(r.Context())
		request.URL.Path = strings.TrimPrefix(request.URL.Path, productMountPath)
		if request.URL.Path == "" {
			request.URL.Path = "/"
		}
		if request.URL.RawPath != "" {
			request.URL.RawPath = strings.TrimPrefix(request.URL.RawPath, productMountPath)
			if request.URL.RawPath == "" {
				request.URL.RawPath = "/"
			}
		}
		next.ServeHTTP(w, request)
	})
}

func isProductPath(requestPath string) bool {
	return requestPath == productMountPath || strings.HasPrefix(requestPath, productMountPath+"/")
}

func isProductAPIPath(requestPath string) bool {
	return requestPath == productMountPath+"/api" || strings.HasPrefix(requestPath, productMountPath+"/api/")
}

func publicProductPath(internalPath string) string {
	return productMountPath + internalPath
}

func (s *Server) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := w.Header()
		if isProductPath(r.URL.Path) {
			headers.Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'")
		}
		headers.Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		headers.Set("Referrer-Policy", "no-referrer")
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("X-Frame-Options", "DENY")
		if r.TLS != nil || s.securePublicOrigin {
			headers.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleAPINotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotFound, "endpoint_not_found", "endpoint not found", nil)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.db.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "database unavailable", nil)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"timestamp": time.Now().UTC(),
	})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	cleanPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if cleanPath == "." {
		cleanPath = ""
	}

	if cleanPath != "" {
		info, err := fs.Stat(s.staticFS, cleanPath)
		if err == nil && !info.IsDir() {
			s.static.ServeHTTP(w, r)
			return
		}
		if cleanPath == "assets" || strings.HasPrefix(cleanPath, "assets/") {
			http.NotFound(w, r)
			return
		}
	}

	if _, err := fs.Stat(s.staticFS, "index.html"); err == nil {
		http.ServeFileFS(w, r, s.staticFS, "index.html")
		return
	}
	http.Error(w, "frontend has not been built", http.StatusServiceUnavailable)
}

func (s *Server) withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("request panic",
					"method", r.Method,
					"path", requestLogPath(r),
					"panic_type", fmt.Sprintf("%T", recovered),
					"stack", string(debug.Stack()),
				)
				if isProductAPIPath(r.URL.Path) {
					writeError(w, http.StatusInternalServerError, "internal_error", "internal server error", nil)
					return
				}
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		response := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(response, r)
		if successfulAPIMutation(r, response.status) {
			s.notifyWorldEventWaiters()
		}
		slog.Info("request",
			"method", r.Method,
			"path", requestLogPath(r),
			"status", response.status,
			"bytes", response.bytes,
			"duration", time.Since(started),
		)
	})
}

func successfulAPIMutation(r *http.Request, status int) bool {
	if r == nil || status < http.StatusOK || status >= http.StatusBadRequest {
		return false
	}
	if r.URL == nil || !isProductAPIPath(r.URL.Path) {
		return false
	}
	if strings.HasPrefix(r.URL.Path, productMountPath+"/api/auth/") || r.URL.Path == productMountPath+"/api/me/password" {
		return false
	}
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

// currentWorldEventWake returns a broadcast generation. Event handlers capture
// it before querying PostgreSQL: a mutation either commits before that query and
// is observed by it, or closes the captured generation afterward and wakes the
// handler. The ticker remains the cross-process and lost-wakeup fallback.
func (s *Server) currentWorldEventWake() <-chan struct{} {
	s.worldEventWakeMu.Lock()
	defer s.worldEventWakeMu.Unlock()
	return s.worldEventWake
}

func (s *Server) notifyWorldEventWaiters() {
	s.worldEventWakeMu.Lock()
	close(s.worldEventWake)
	s.worldEventWake = make(chan struct{})
	s.worldEventWakeMu.Unlock()
}

const redactedRequestPathSegment = "[REDACTED]"

// requestLogPath returns only a safe path: query parameters are never included,
// and opaque invitation bearer tokens are replaced with a stable route marker.
// Redacting the entire remainder of a frontend invitation path also protects
// encoded slashes or malformed suffixes from leaking part of a token. The
// cleaned-path check covers request paths that ServeMux will canonicalize.
func requestLogPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}

	requestPath := r.URL.Path
	if redacted, ok := redactedRequestLogPath(requestPath); ok {
		return redacted
	}
	cleanPath := path.Clean(requestPath)
	if cleanPath != requestPath {
		if redacted, ok := redactedRequestLogPath(cleanPath); ok {
			return redacted
		}
	}
	return requestPath
}

func redactedRequestLogPath(requestPath string) (string, bool) {
	for _, prefix := range []string{productMountPath + "/play/invite", productMountPath + "/build/invite"} {
		if redacted, ok := redactRequestBearerPath(requestPath, prefix, false); ok {
			return redacted, true
		}
	}
	if redacted, ok := redactRequestBearerPath(requestPath, productMountPath+"/api/world-invites", true); ok {
		return redacted, true
	}
	return "", false
}

func redactRequestBearerPath(requestPath, prefix string, preserveRedeem bool) (string, bool) {
	if !strings.HasPrefix(requestPath, prefix+"/") {
		return "", false
	}

	remainder := strings.TrimPrefix(requestPath, prefix+"/")
	if remainder == "" {
		return requestPath, false
	}
	if preserveRedeem && strings.HasSuffix(remainder, "/redeem") {
		token := strings.TrimSuffix(remainder, "/redeem")
		if token != "" {
			return prefix + "/" + redactedRequestPathSegment + "/redeem", true
		}
	}
	return prefix + "/" + redactedRequestPathSegment, true
}

type responseRecorder struct {
	http.ResponseWriter
	status      int
	bytes       int
	wroteHeader bool
}

func (w *responseRecorder) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseRecorder) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	written, err := w.ResponseWriter.Write(data)
	w.bytes += written
	return written, err
}

func (w *responseRecorder) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
