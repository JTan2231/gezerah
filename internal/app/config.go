package app

import (
	"log/slog"
	"os"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	LogLevel    slog.Level
}

func LoadConfig() Config {
	return Config{
		Addr: firstNonEmpty(
			os.Getenv("DND_ADDR"),
			addrFromPort(os.Getenv("PORT")),
			":8080",
		),
		DatabaseURL: firstNonEmpty(
			os.Getenv("DND_DATABASE_URL"),
			os.Getenv("DATABASE_URL"),
			"postgres://localhost:5432/dnd?sslmode=disable",
		),
		LogLevel: parseLogLevel(os.Getenv("DND_LOG_LEVEL")),
	}
}

func addrFromPort(port string) string {
	if port == "" {
		return ""
	}
	return ":" + port
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func parseLogLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
