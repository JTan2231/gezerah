package app

import (
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestArgon2idPasswordHashRoundTripAndUniqueSalts(t *testing.T) {
	password := "a long password for testing"
	first, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hash first password: %v", err)
	}
	second, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hash second password: %v", err)
	}
	if first == second {
		t.Fatal("two password hashes used the same salt")
	}
	if !strings.HasPrefix(first, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("hash = %q, want current Argon2id PHC parameters", first)
	}
	if strings.Contains(first, password) {
		t.Fatal("password hash contains the plaintext password")
	}
	valid, err := verifyPassword(password, first)
	if err != nil || !valid {
		t.Fatalf("verify correct password = %t, %v", valid, err)
	}
	valid, err = verifyPassword("the wrong password", first)
	if err != nil {
		t.Fatalf("verify wrong password: %v", err)
	}
	if valid {
		t.Fatal("wrong password verified")
	}
	if passwordHashNeedsUpgrade(first) {
		t.Fatal("current password hash unexpectedly needs an upgrade")
	}
}

func TestPasswordHashParserRejectsUnboundedParameters(t *testing.T) {
	salt := base64.RawStdEncoding.EncodeToString([]byte("sixteen-byte-salt"))
	hash := base64.RawStdEncoding.EncodeToString(make([]byte, 32))
	for _, parameters := range []string{
		"m=262145,t=2,p=1",
		"m=19456,t=11,p=1",
		"m=19456,t=2,p=17",
	} {
		encoded := "$argon2id$v=19$" + parameters + "$" + salt + "$" + hash
		if _, _, _, err := decodePasswordHash(encoded); err == nil {
			t.Fatalf("decodePasswordHash accepted unsafe parameters %q", parameters)
		}
	}
}

func TestPasswordWorkHasAProcessWideConcurrencyLimit(t *testing.T) {
	for slot := 0; slot < passwordWorkConcurrency; slot++ {
		if !acquirePasswordWork() {
			t.Fatalf("could not reserve password-work slot %d", slot)
		}
	}
	t.Cleanup(func() {
		for slot := 0; slot < passwordWorkConcurrency; slot++ {
			releasePasswordWork()
		}
	})
	if _, err := hashPassword("a valid but deliberately unprocessed password"); !errors.Is(err, errPasswordWorkSaturated) {
		t.Fatalf("hashPassword saturation error = %v", err)
	}

	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://127.0.0.1/api/auth/signup", strings.NewReader(`{
		"username":"capacity-test",
		"display_name":"Capacity Test",
		"password":"a sufficiently long password"
	}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://127.0.0.1")
	request.RemoteAddr = "127.0.0.1:12345"
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") != "1" {
		t.Fatalf("saturated signup status/header = %d/%q, want 429/1", response.Code, response.Header().Get("Retry-After"))
	}
}

func TestAccountCredentialValidation(t *testing.T) {
	tests := []struct {
		username       string
		wantUsername   string
		wantNormalized string
		wantValid      bool
	}{
		{username: "Player.One", wantUsername: "Player.One", wantNormalized: "player.one", wantValid: true},
		{username: "  hero-2  ", wantUsername: "hero-2", wantNormalized: "hero-2", wantValid: true},
		{username: "ab", wantUsername: "ab", wantNormalized: "ab"},
		{username: "_player", wantUsername: "_player", wantNormalized: "_player"},
		{username: "player name", wantUsername: "player name", wantNormalized: "player name"},
		{username: "pláyer", wantUsername: "pláyer", wantNormalized: "pláyer"},
	}
	for _, test := range tests {
		t.Run(test.username, func(t *testing.T) {
			fields := map[string]string{}
			username, normalized := validateUsername(fields, test.username)
			if username != test.wantUsername || normalized != test.wantNormalized {
				t.Fatalf("values = %q, %q; want %q, %q", username, normalized, test.wantUsername, test.wantNormalized)
			}
			_, invalid := fields["username"]
			if invalid == test.wantValid {
				t.Fatalf("username validation fields = %#v, want valid %t", fields, test.wantValid)
			}
		})
	}

	fields := map[string]string{}
	validatePassword(fields, "password", strings.Repeat("🙂", passwordMinimumRunes))
	if len(fields) != 0 {
		t.Fatalf("minimum-length Unicode password rejected: %#v", fields)
	}
	validatePassword(fields, "short", strings.Repeat("a", passwordMinimumRunes-1))
	validatePassword(fields, "long", strings.Repeat("a", 129))
	if fields["short"] != "must be at least 8 characters" {
		t.Fatalf("short password result = %#v", fields)
	}
	if fields["long"] != "" {
		t.Fatalf("long password rejected: %#v", fields)
	}
}

func TestSessionTokenDigestsAndCSRFDerivation(t *testing.T) {
	const expectedKnownCSRF = "qEj0O7fTHQKYkCwXldrC5wA46TrMZmyzyf7lReZFcvY"
	if got := deriveCSRFToken("known-token"); got != expectedKnownCSRF {
		t.Fatalf("known CSRF derivation = %q, want %q", got, expectedKnownCSRF)
	}

	first, err := newSessionToken()
	if err != nil {
		t.Fatalf("new session token: %v", err)
	}
	second, err := newSessionToken()
	if err != nil {
		t.Fatalf("new second session token: %v", err)
	}
	if first == second || !validSessionToken(first) || validSessionToken(first+"x") {
		t.Fatalf("unexpected session token validity: first=%q second=%q", first, second)
	}
	if digest := hashSessionToken(first); len(digest) != 64 || strings.Contains(digest, first) {
		t.Fatalf("session digest = %q", digest)
	}
	csrf := deriveCSRFToken(first)
	if csrf == first || csrf == hashSessionToken(first) || csrf != deriveCSRFToken(first) || csrf == deriveCSRFToken(second) {
		t.Fatalf("CSRF derivation is not deterministic and domain-separated: %q", csrf)
	}
}

func TestSessionTouchUsesAFiveMinuteCoarseInterval(t *testing.T) {
	now := time.Date(2026, time.August, 8, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		lastSeenAt time.Time
		want       bool
	}{
		{name: "recent activity", lastSeenAt: now.Add(-sessionTouchInterval + time.Second)},
		{name: "interval boundary", lastSeenAt: now.Add(-sessionTouchInterval), want: true},
		{name: "older activity", lastSeenAt: now.Add(-sessionTouchInterval - time.Second), want: true},
		{name: "future database value", lastSeenAt: now.Add(time.Second)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sessionTouchDue(test.lastSeenAt, now); got != test.want {
				t.Fatalf("sessionTouchDue(%v, %v) = %t, want %t", test.lastSeenAt, now, got, test.want)
			}
		})
	}
	if sessionTouchInterval != 5*time.Minute {
		t.Fatalf("sessionTouchInterval = %v, want 5m", sessionTouchInterval)
	}
}

func TestAuthThrottleKeysDoNotRetainAttackerInput(t *testing.T) {
	large := strings.Repeat("attacker-controlled", 60_000)
	key := authThrottleKey("signin:account", large)
	if len(key) != len("signin:account:")+64 {
		t.Fatalf("throttle key length = %d, want fixed digest length", len(key))
	}
	if strings.Contains(key, "attacker-controlled") || key == authThrottleKey("signin:account", large+"x") {
		t.Fatalf("throttle key is not a one-way, input-specific digest: %q", key)
	}
}

func TestSameOriginPolicy(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://127.0.0.1/api/auth/signin", nil)
	request.Host = "127.0.0.1"
	request.RemoteAddr = "127.0.0.1:12345"
	if err := server.requireSameOrigin(request); err == nil {
		t.Fatal("missing Origin was accepted")
	}
	request.Header.Set("Origin", "https://example.test")
	if err := server.requireSameOrigin(request); err == nil {
		t.Fatal("cross-scheme Origin was accepted")
	}
	request.Header.Set("Origin", "http://127.0.0.1")
	if err := server.requireSameOrigin(request); err != nil {
		t.Fatalf("same Origin rejected: %v", err)
	}
	remoteHTTP := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://app.example/api/auth/signin", nil)
	remoteHTTP.Header.Set("Origin", "http://app.example")
	if err := server.requireSameOrigin(remoteHTTP); err == nil {
		t.Fatal("non-loopback HTTP origin was accepted without an explicit secure origin")
	}
	spoofedLoopback := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://127.0.0.1/api/auth/signin", nil)
	spoofedLoopback.Header.Set("Origin", "http://127.0.0.1")
	spoofedLoopback.RemoteAddr = "203.0.113.10:4321"
	if err := server.requireSameOrigin(spoofedLoopback); err == nil {
		t.Fatal("remote HTTP peer with a spoofed loopback Host was accepted")
	}

	server.publicOrigin = "https://app.example"
	request.Header.Set("Origin", "http://127.0.0.1")
	if err := server.requireSameOrigin(request); err == nil {
		t.Fatal("request-host Origin bypassed configured public origin")
	}
	request.Header.Set("Origin", "https://app.example")
	if err := server.requireSameOrigin(request); err != nil {
		t.Fatalf("configured public Origin rejected: %v", err)
	}
}

func TestSessionCookieSecurityAttributes(t *testing.T) {
	session := issuedSession{Token: strings.Repeat("a", 43), AbsoluteExpiresAt: time.Now().Add(time.Hour)}
	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})

	local := httptest.NewRecorder()
	localRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://127.0.0.1/api/me", nil)
	localRequest.RemoteAddr = "127.0.0.1:12345"
	server.setSessionCookie(local, localRequest, session)
	localCookies := local.Result().Cookies()
	if len(localCookies) != 1 {
		t.Fatalf("local cookies = %#v", localCookies)
	}
	if cookie := localCookies[0]; cookie.Name != localSessionCookieName || cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("local session cookie = %#v", cookie)
	}

	server.securePublicOrigin = true
	secure := httptest.NewRecorder()
	server.setSessionCookie(secure, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://internal/api/me", nil), session)
	secureCookies := secure.Result().Cookies()
	if len(secureCookies) != 1 {
		t.Fatalf("secure cookies = %#v", secureCookies)
	}
	if cookie := secureCookies[0]; cookie.Name != secureSessionCookieName || !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("secure session cookie = %#v", cookie)
	}
}

func TestSecureModeDoesNotAcceptTheDevelopmentCookie(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://127.0.0.1/api/me", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Cookie", localSessionCookieName+"=local-token; "+secureSessionCookieName+"=secure-token")
	if got := server.sessionCookieToken(request); got != "local-token" {
		t.Fatalf("HTTP session token = %q, want local cookie", got)
	}
	server.securePublicOrigin = true
	if got := server.sessionCookieToken(request); got != "secure-token" {
		t.Fatalf("HTTPS session token = %q, want __Host- cookie", got)
	}

	secureWithOnlyDevelopment := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://127.0.0.1/api/me", nil)
	secureWithOnlyDevelopment.Header.Set("Cookie", localSessionCookieName+"=development-token")
	if got := server.sessionCookieToken(secureWithOnlyDevelopment); got != "" {
		t.Fatalf("secure mode accepted development cookie %q", got)
	}
}

func TestUnconfiguredRemoteHTTPFailsClosedToSecureCookies(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://127.0.0.1/api/me", nil)
	request.RemoteAddr = "203.0.113.10:4321"
	if !server.secureCookies(request) {
		t.Fatal("remote HTTP peer with a spoofed loopback Host selected an insecure cookie")
	}
}

func TestAuthenticationRoutesRejectForgedIdentityAndEnforceOrigin(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	handler := server.Routes()

	for _, path := range []string{"/api/worlds", "/api/world-invites/not-a-real-token"} {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		request.Header.Set("X-Dnd-User-Id", "57898ef8-85cf-43f3-a666-afdcfdd8cc54")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("GET %s with forged identity status = %d, want 401", path, response.Code)
		}
		if !strings.Contains(response.Body.String(), `"code":"authentication_required"`) {
			t.Fatalf("GET %s body = %s", path, response.Body.String())
		}
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/auth/signup", strings.NewReader(`{}`)))
	if response.Code != http.StatusForbidden {
		t.Fatalf("signup without Origin status = %d, want 403", response.Code)
	}
	if cache := response.Header().Get("Cache-Control"); cache != "private, no-store" {
		t.Fatalf("auth Cache-Control = %q", cache)
	}
}

func TestAuthThrottleAllowsNormalFixtureVolumeAndExpires(t *testing.T) {
	now := time.Date(2026, time.August, 7, 12, 0, 0, 0, time.UTC)
	throttle := newAuthThrottle()
	throttle.now = func() time.Time { return now }
	for attempt := 0; attempt < 40; attempt++ {
		if !throttle.take("signup:loopback", 10*time.Minute) {
			t.Fatalf("normal fixture signup %d was throttled", attempt+1)
		}
	}
	for attempt := 40; attempt < authAttemptLimit; attempt++ {
		if !throttle.take("signup:loopback", 10*time.Minute) {
			t.Fatalf("allowed signup %d was throttled", attempt+1)
		}
	}
	if throttle.take("signup:loopback", 10*time.Minute) {
		t.Fatal("signup above the limit was accepted")
	}
	now = now.Add(11 * time.Minute)
	if !throttle.take("signup:loopback", 10*time.Minute) {
		t.Fatal("expired throttle window remained blocked")
	}
}

func TestSigninAttemptBucketLimitsSuccessfulOrFailedArgonWork(t *testing.T) {
	server := NewServerWithStaticFS(nil, fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("index")}})
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "http://127.0.0.1/api/auth/signin", strings.NewReader(`{
		"username":"attempt-limit",
		"password":"a sufficiently long password"
	}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://127.0.0.1")
	request.RemoteAddr = "127.0.0.1:12345"
	key := authThrottleKey("signin:attempt:ip", clientAddress(request))
	for attempt := 0; attempt < authAttemptLimit; attempt++ {
		if !server.authThrottle.take(key, signinAttemptWindow) {
			t.Fatalf("signin attempt %d was throttled before the documented limit", attempt+1)
		}
	}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("signin above all-attempt IP limit status = %d, want 429", response.Code)
	}
}

func TestAuthThrottleHasABoundedEntrySet(t *testing.T) {
	now := time.Date(2026, time.August, 7, 12, 0, 0, 0, time.UTC)
	throttle := newAuthThrottle()
	throttle.now = func() time.Time { return now }
	for index := 0; index < maxAuthThrottleEntries+500; index++ {
		throttle.failure("random-account-"+strings.Repeat("x", index%23)+string(rune(index)), 5*time.Minute)
		now = now.Add(time.Nanosecond)
	}
	if got := len(throttle.entries); got >= maxAuthThrottleEntries {
		t.Fatalf("throttle retained %d entries, want fewer than hard cap %d", got, maxAuthThrottleEntries)
	}
}
