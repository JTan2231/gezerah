package app

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"runtime/debug"
	"strings"
	"time"

	"dnd/web"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	db       *pgxpool.Pool
	api      *http.ServeMux
	static   http.Handler
	staticFS fs.FS
}

func NewServer(_ context.Context, db *pgxpool.Pool, _ Config) (*Server, error) {
	staticFS, err := fs.Sub(web.Static, "static")
	if err != nil {
		return nil, fmt.Errorf("load static files: %w", err)
	}
	return NewServerWithStaticFS(db, staticFS), nil
}

// NewServerWithStaticFS is the test seam for serving a synthetic frontend.
func NewServerWithStaticFS(db *pgxpool.Pool, staticFS fs.FS) *Server {
	server := &Server{
		db:       db,
		api:      http.NewServeMux(),
		static:   http.FileServer(http.FS(staticFS)),
		staticFS: staticFS,
	}
	server.api.HandleFunc("GET /api/health", server.handleHealth)
	server.registerResourceRoutes()
	server.api.HandleFunc("/api", server.handleAPINotFound)
	server.api.HandleFunc("/api/", server.handleAPINotFound)
	return server
}

// HandleAPI lets resource modules register method-aware /api patterns without
// coupling static-file routing or middleware to those modules.
func (s *Server) HandleAPI(pattern string, handler http.Handler) {
	if !strings.Contains(pattern, "/api/") && pattern != "/api" {
		panic("API route pattern must target /api")
	}
	s.api.Handle(pattern, handler)
}

func (s *Server) HandleAPIFunc(pattern string, handler http.HandlerFunc) {
	s.HandleAPI(pattern, handler)
}

func (s *Server) Routes() http.Handler {
	staticMux := http.NewServeMux()
	staticMux.HandleFunc("GET /", s.handleStatic)

	root := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
			}
			s.api.ServeHTTP(w, r)
			return
		}
		staticMux.ServeHTTP(w, r)
	})

	return s.withRequestLog(s.withRecovery(root))
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
		if strings.HasPrefix(cleanPath, "assets/") {
			s.static.ServeHTTP(w, r)
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
					"path", r.URL.Path,
					"panic", recovered,
					"stack", string(debug.Stack()),
				)
				if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
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
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", response.status,
			"bytes", response.bytes,
			"duration", time.Since(started),
		)
	})
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
