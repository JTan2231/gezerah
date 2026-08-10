package app

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Addr          string
	DatabaseURL   string
	PublicOrigin  string
	OpenAIAPIKey  string
	OpenAIBaseURL string
	LogLevel      slog.Level
}

func ValidateConfig(config Config) error {
	_, _, err := parsePublicOrigin(config.PublicOrigin)
	return err
}

func parsePublicOrigin(value string) (string, bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false, nil
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", false, fmt.Errorf("DND_PUBLIC_ORIGIN must be a valid http(s) origin: %w", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if parsed.Host == "" || (scheme != "http" && scheme != "https") ||
		parsed.User != nil || parsed.Opaque != "" || (parsed.Path != "" && parsed.Path != "/") ||
		parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return "", false, fmt.Errorf("DND_PUBLIC_ORIGIN must be an http(s) origin without credentials, a path, query, or fragment")
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "" || strings.Contains(hostname, "%") {
		return "", false, fmt.Errorf("DND_PUBLIC_ORIGIN host is invalid")
	}
	for _, character := range hostname {
		if character > 127 {
			return "", false, fmt.Errorf("DND_PUBLIC_ORIGIN host must use ASCII or an IDNA-encoded name")
		}
	}
	if address := net.ParseIP(hostname); address != nil {
		hostname = address.String()
	}
	port := parsed.Port()
	if (scheme == "http" && port == "80") || (scheme == "https" && port == "443") {
		port = ""
	}
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host = net.JoinHostPort(hostname, port)
	}
	return scheme + "://" + host, scheme == "https", nil
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
		PublicOrigin:  strings.TrimSpace(os.Getenv("DND_PUBLIC_ORIGIN")),
		OpenAIAPIKey:  strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		OpenAIBaseURL: strings.TrimSpace(os.Getenv("DND_OPENAI_BASE_URL")),
		LogLevel:      parseLogLevel(os.Getenv("DND_LOG_LEVEL")),
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
