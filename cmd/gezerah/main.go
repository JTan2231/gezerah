package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JTan2231/gezerah/internal/app"
	"github.com/JTan2231/gezerah/internal/migrations"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	config := app.LoadConfig()
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: config.LogLevel})))

	if err := run(config); err != nil {
		slog.Error("Gezerah stopped", "error", err)
		os.Exit(1)
	}
}

func run(config app.Config) error {
	if err := app.ValidateConfig(config); err != nil {
		return fmt.Errorf("validate configuration: %w", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := pgxpool.New(ctx, config.DatabaseURL)
	if err != nil {
		return fmt.Errorf("configure database: %w", err)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		return fmt.Errorf("connect database: %w", err)
	}

	if err := migrations.Run(ctx, db); err != nil {
		return fmt.Errorf("run migrations: %w", err)
	}

	server, err := app.NewServer(ctx, db, config)
	if err != nil {
		return fmt.Errorf("build server: %w", err)
	}

	httpServer := newHTTPServer(ctx, config, server.Routes())
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(ctx, "tcp", config.Addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", config.Addr, err)
	}

	serveErrors := make(chan error, 1)
	go func() {
		slog.Info("Gezerah listening", "address", listener.Addr().String())
		serveErrors <- httpServer.Serve(listener)
	}()

	var serveErr error
	select {
	case <-ctx.Done():
	case err := <-serveErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr = fmt.Errorf("serve: %w", err)
			stop()
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	return serveErr
}

func newHTTPServer(ctx context.Context, config app.Config, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              config.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Terra orchestration may make one bounded Terra call followed by one bounded Luna call.
		WriteTimeout: 130 * time.Second,
		IdleTimeout:  60 * time.Second,
		BaseContext: func(net.Listener) context.Context {
			return ctx
		},
	}
}
