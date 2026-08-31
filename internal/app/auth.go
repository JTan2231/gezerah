package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/argon2"
)

const (
	localSessionCookieName  = "scryer_session"
	secureSessionCookieName = "__Host-scryer_session"
	csrfHeaderName          = "X-Scryer-Csrf"

	passwordMinimumRunes = 8

	argonMemory      = 19 * 1024
	argonIterations  = 2
	argonParallelism = 1
	argonSaltLength  = 16
	argonKeyLength   = 32

	sessionIdleLifetime     = 7 * 24 * time.Hour
	sessionAbsoluteLifetime = 30 * 24 * time.Hour
	sessionTouchInterval    = 5 * time.Minute
	maxAuthThrottleEntries  = 8192
	passwordWorkConcurrency = 4
	maxActiveUserSessions   = 20
	authAttemptLimit        = 120
	signinAttemptWindow     = 5 * time.Minute
)

type passwordParameters struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
	saltLength  uint32
	keyLength   uint32
}

var currentPasswordParameters = passwordParameters{
	memory:      argonMemory,
	iterations:  argonIterations,
	parallelism: argonParallelism,
	saltLength:  argonSaltLength,
	keyLength:   argonKeyLength,
}

var (
	errPasswordWorkSaturated = errors.New("password hashing capacity is saturated")
	passwordWorkSlots        = make(chan struct{}, passwordWorkConcurrency)
)

type authenticatedActor struct {
	User              userResponse
	SessionID         string
	SessionToken      string
	CSRFToken         string
	AbsoluteExpiresAt time.Time
}

type authenticatedSessionLookup struct {
	Actor       authenticatedActor
	LastSeenAt  time.Time
	DatabaseNow time.Time
}

type actorContextKey struct{}

type issuedSession struct {
	ID                string
	Token             string
	CSRFToken         string
	AbsoluteExpiresAt time.Time
}

type authThrottleEntry struct {
	count    int
	resetAt  time.Time
	lastSeen time.Time
}

type authThrottle struct {
	mu      sync.Mutex
	entries map[string]authThrottleEntry
	now     func() time.Time
}

func newAuthThrottle() *authThrottle {
	return &authThrottle{entries: make(map[string]authThrottleEntry), now: time.Now}
}

func (t *authThrottle) take(key string, window time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	entry := t.activeEntry(key, now, window)
	if entry.count >= authAttemptLimit {
		entry.lastSeen = now
		t.entries[key] = entry
		return false
	}
	entry.count++
	entry.lastSeen = now
	t.entries[key] = entry
	t.prune(now)
	return true
}

func (t *authThrottle) blocked(key string, limit int) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	entry, exists := t.entries[key]
	if !exists || !entry.resetAt.After(now) {
		return false
	}
	return entry.count >= limit
}

func (t *authThrottle) failure(key string, window time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	entry := t.activeEntry(key, now, window)
	entry.count++
	entry.lastSeen = now
	t.entries[key] = entry
	t.prune(now)
}

func (t *authThrottle) clear(key string) {
	t.mu.Lock()
	delete(t.entries, key)
	t.mu.Unlock()
}

func (t *authThrottle) activeEntry(key string, now time.Time, window time.Duration) authThrottleEntry {
	entry, exists := t.entries[key]
	if !exists || !entry.resetAt.After(now) {
		return authThrottleEntry{resetAt: now.Add(window), lastSeen: now}
	}
	return entry
}

func (t *authThrottle) prune(now time.Time) {
	if len(t.entries) < maxAuthThrottleEntries {
		return
	}
	for key, entry := range t.entries {
		if !entry.resetAt.After(now) {
			delete(t.entries, key)
		}
	}
	if len(t.entries) < maxAuthThrottleEntries {
		return
	}
	type candidate struct {
		key      string
		lastSeen time.Time
	}
	candidates := make([]candidate, 0, len(t.entries))
	for key, entry := range t.entries {
		candidates = append(candidates, candidate{key: key, lastSeen: entry.lastSeen})
	}
	sort.Slice(candidates, func(left, right int) bool {
		return candidates[left].lastSeen.Before(candidates[right].lastSeen)
	})
	target := maxAuthThrottleEntries * 3 / 4
	for index := 0; len(t.entries) > target; index++ {
		delete(t.entries, candidates[index].key)
	}
}

func hashPassword(password string) (string, error) {
	if !acquirePasswordWork() {
		return "", errPasswordWorkSaturated
	}
	defer releasePasswordWork()
	salt := make([]byte, currentPasswordParameters.saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	return encodePassword(password, salt, currentPasswordParameters), nil
}

func encodePassword(password string, salt []byte, parameters passwordParameters) string {
	hash := argon2.IDKey(
		[]byte(password), salt, parameters.iterations, parameters.memory,
		parameters.parallelism, parameters.keyLength,
	)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, parameters.memory, parameters.iterations, parameters.parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
}

func verifyPassword(password, encoded string) (bool, error) {
	parameters, salt, expected, err := decodePasswordHash(encoded)
	if err != nil {
		return false, err
	}
	if !acquirePasswordWork() {
		return false, errPasswordWorkSaturated
	}
	defer releasePasswordWork()
	actual := argon2.IDKey(
		[]byte(password), salt, parameters.iterations, parameters.memory,
		parameters.parallelism, parameters.keyLength,
	)
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

func acquirePasswordWork() bool {
	select {
	case passwordWorkSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

func releasePasswordWork() {
	<-passwordWorkSlots
}

func decodePasswordHash(encoded string) (passwordParameters, []byte, []byte, error) {
	var parameters passwordParameters
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" || parts[2] != "v="+strconv.Itoa(argon2.Version) {
		return parameters, nil, nil, errors.New("password hash is not a supported Argon2id value")
	}
	values := strings.Split(parts[3], ",")
	if len(values) != 3 {
		return parameters, nil, nil, errors.New("password hash parameters are malformed")
	}
	memory, err := parsePasswordParameter(values[0], "m=")
	if err != nil || memory < 8*1024 || memory > 256*1024 {
		return parameters, nil, nil, errors.New("password hash memory parameter is invalid")
	}
	iterations, err := parsePasswordParameter(values[1], "t=")
	if err != nil || iterations < 1 || iterations > 10 {
		return parameters, nil, nil, errors.New("password hash iteration parameter is invalid")
	}
	parallelism, err := parsePasswordParameter(values[2], "p=")
	if err != nil || parallelism < 1 || parallelism > 16 {
		return parameters, nil, nil, errors.New("password hash parallelism parameter is invalid")
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[4])
	if err != nil {
		return parameters, nil, nil, errors.New("password hash salt is invalid")
	}
	if len(salt) < 16 || len(salt) > 64 {
		return parameters, nil, nil, errors.New("password hash salt is invalid")
	}
	hash, err := base64.RawStdEncoding.Strict().DecodeString(parts[5])
	if err != nil {
		return parameters, nil, nil, errors.New("password hash output is invalid")
	}
	if len(hash) < 16 || len(hash) > 64 {
		return parameters, nil, nil, errors.New("password hash output is invalid")
	}
	parameters = passwordParameters{
		memory:      uint32(memory),
		iterations:  uint32(iterations),
		parallelism: uint8(parallelism),
		saltLength:  passwordHashComponentLength(salt),
		keyLength:   passwordHashComponentLength(hash),
	}
	return parameters, salt, hash, nil
}

func passwordHashComponentLength(value []byte) uint32 {
	// Decoded password-hash components are bounded to 64 bytes above, so this
	// count cannot overflow and avoids narrowing the platform-sized len value.
	var length uint32
	for range value {
		length++
	}
	return length
}

func parsePasswordParameter(value, prefix string) (uint64, error) {
	if !strings.HasPrefix(value, prefix) {
		return 0, errors.New("parameter prefix is missing")
	}
	return strconv.ParseUint(strings.TrimPrefix(value, prefix), 10, 32)
}

func passwordHashNeedsUpgrade(encoded string) bool {
	parameters, _, _, err := decodePasswordHash(encoded)
	return err != nil || parameters != currentPasswordParameters
}

func validateUsername(fields map[string]string, username string) (string, string) {
	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 64 {
		fields["username"] = "must be between 3 and 64 ASCII characters"
		return username, strings.ToLower(username)
	}
	for index, character := range []byte(username) {
		alphanumeric := character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9'
		if index == 0 && !alphanumeric || index > 0 && !alphanumeric && character != '.' && character != '_' && character != '-' {
			fields["username"] = "must start with a letter or number and use only ASCII letters, numbers, '.', '_', or '-'"
			break
		}
	}
	return username, strings.ToLower(username)
}

func validatePassword(fields map[string]string, path, password string) {
	length := utf8.RuneCountInString(password)
	if length < passwordMinimumRunes {
		fields[path] = fmt.Sprintf("must be at least %d characters", passwordMinimumRunes)
	}
}

func newSessionToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func validSessionToken(token string) bool {
	if len(token) != 43 {
		return false
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	return err == nil && len(raw) == 32
}

func hashSessionToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func deriveCSRFToken(token string) string {
	digest := sha256.Sum256(append([]byte("scryer.csrf.v1\x00"), []byte(token)...))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func createSession(ctx context.Context, tx pgx.Tx, userID string) (issuedSession, error) {
	token, err := newSessionToken()
	if err != nil {
		return issuedSession{}, err
	}
	var lockedUserID string
	if err := tx.QueryRow(ctx, `select id::text from users where id = $1 for update`, userID).Scan(&lockedUserID); err != nil {
		return issuedSession{}, err
	}
	var session issuedSession
	err = tx.QueryRow(ctx, `
		with cleaned as (
			delete from auth_sessions
			where user_id = $1
				and (revoked_at is not null or idle_expires_at <= now() or absolute_expires_at <= now())
		), capped as (
			delete from auth_sessions session
			where session.id in (
				select id from auth_sessions
				where user_id = $1 and revoked_at is null
					and idle_expires_at > now() and absolute_expires_at > now()
				order by last_seen_at desc, created_at desc, id desc
				offset $3
			)
		)
		insert into auth_sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
		values ($1, $2, now() + interval '7 days', now() + interval '30 days')
		returning id::text, absolute_expires_at`, userID, hashSessionToken(token), maxActiveUserSessions-1,
	).Scan(&session.ID, &session.AbsoluteExpiresAt)
	if err != nil {
		return issuedSession{}, err
	}
	session.Token = token
	session.CSRFToken = deriveCSRFToken(token)
	return session, nil
}

func (s *Server) authenticateSession(ctx context.Context, token string) (authenticatedActor, error) {
	if !validSessionToken(token) {
		return authenticatedActor{}, authenticationRequired()
	}
	lookup, err := s.loadAuthenticatedSession(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return authenticatedActor{}, authenticationRequired()
	}
	if err != nil {
		return authenticatedActor{}, err
	}
	if !sessionTouchDue(lookup.LastSeenAt, lookup.DatabaseNow) {
		return lookup.Actor, nil
	}
	touched, err := s.touchAuthenticatedSession(ctx, lookup.Actor)
	if err != nil {
		return authenticatedActor{}, err
	}
	if touched {
		return lookup.Actor, nil
	}

	// A concurrent request may have won the guarded touch. Re-read when no row
	// changed so a concurrent revocation, expiry, disablement, or session-cap
	// deletion cannot be mistaken for a harmless activity race.
	lookup, err = s.loadAuthenticatedSession(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return authenticatedActor{}, authenticationRequired()
	}
	if err != nil {
		return authenticatedActor{}, err
	}
	return lookup.Actor, nil
}

func (s *Server) loadAuthenticatedSession(ctx context.Context, token string) (authenticatedSessionLookup, error) {
	lookup := authenticatedSessionLookup{}
	lookup.Actor.SessionToken = token
	lookup.Actor.CSRFToken = deriveCSRFToken(token)
	err := s.db.QueryRow(ctx, `
		select session.id::text, session.absolute_expires_at, session.last_seen_at, now(),
			app_user.id::text, app_user.username, app_user.display_name,
			app_user.created_at, app_user.updated_at
		from auth_sessions session
		join users app_user on app_user.id = session.user_id
		where session.token_hash = $1
			and session.revoked_at is null
			and session.idle_expires_at > now()
			and session.absolute_expires_at > now()
			and app_user.status = 'active'`, hashSessionToken(token),
	).Scan(
		&lookup.Actor.SessionID, &lookup.Actor.AbsoluteExpiresAt,
		&lookup.LastSeenAt, &lookup.DatabaseNow,
		&lookup.Actor.User.ID, &lookup.Actor.User.Username, &lookup.Actor.User.DisplayName,
		&lookup.Actor.User.CreatedAt, &lookup.Actor.User.UpdatedAt,
	)
	return lookup, err
}

func sessionTouchDue(lastSeenAt, now time.Time) bool {
	return !lastSeenAt.After(now.Add(-sessionTouchInterval))
}

func (s *Server) touchAuthenticatedSession(ctx context.Context, actor authenticatedActor) (bool, error) {
	command, err := s.db.Exec(ctx, `
		update auth_sessions session
		set last_seen_at = now(),
			idle_expires_at = least(session.absolute_expires_at, now() + interval '7 days')
		from users app_user
		where session.id = $1 and session.user_id = $2 and session.user_id = app_user.id
			and session.token_hash = $3
			and session.revoked_at is null
			and session.idle_expires_at > now()
			and session.absolute_expires_at > now()
			and app_user.status = 'active'
			and session.last_seen_at <= now() - ($4::double precision * interval '1 second')`,
		actor.SessionID, actor.User.ID, hashSessionToken(actor.SessionToken), sessionTouchInterval.Seconds(),
	)
	if err != nil {
		return false, err
	}
	return command.RowsAffected() == 1, nil
}

func (s *Server) refreshAuthenticatedSession(ctx context.Context, actor authenticatedActor) (bool, error) {
	var valid bool
	err := s.db.QueryRow(ctx, `
		select exists (
			select 1
			from auth_sessions session
			join users app_user on app_user.id = session.user_id
			where session.id = $1 and session.user_id = $2
				and session.token_hash = $3
				and session.revoked_at is null
				and session.idle_expires_at > now()
				and session.absolute_expires_at > now()
				and app_user.status = 'active'
		)`, actor.SessionID, actor.User.ID, hashSessionToken(actor.SessionToken),
	).Scan(&valid)
	return valid, err
}

func actorFromRequest(r *http.Request) (authenticatedActor, bool) {
	actor, ok := r.Context().Value(actorContextKey{}).(authenticatedActor)
	return actor, ok
}

func authenticationRequired() error {
	return &statusError{
		Status: http.StatusUnauthorized, Code: "authentication_required",
		Message: "a valid signed-in session is required",
	}
}

func invalidCredentials() error {
	return &statusError{
		Status: http.StatusUnauthorized, Code: "invalid_credentials",
		Message: "username or password is incorrect",
	}
}

func (s *Server) withAuthentication(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w.Header())
		token := s.sessionCookieToken(r)
		actor, err := s.authenticateSession(r.Context(), token)
		if err != nil {
			handleAppError(w, err)
			return
		}
		ctx := context.WithValue(r.Context(), actorContextKey{}, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) withAuthenticatedMutation(next http.Handler) http.Handler {
	return s.withAuthentication(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.requireSameOrigin(r); err != nil {
			handleAppError(w, err)
			return
		}
		actor, ok := actorFromRequest(r)
		if !ok {
			handleAppError(w, authenticationRequired())
			return
		}
		provided := r.Header.Get(csrfHeaderName)
		if len(provided) != len(actor.CSRFToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(actor.CSRFToken)) != 1 {
			writeError(w, http.StatusForbidden, "csrf_invalid", "a valid CSRF token is required", nil)
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (s *Server) withPublicMutation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setPrivateNoStore(w.Header())
		if err := s.requireSameOrigin(r); err != nil {
			handleAppError(w, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireSameOrigin(r *http.Request) error {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 || strings.TrimSpace(origins[0]) == "" {
		return &statusError{Status: http.StatusForbidden, Code: "origin_required", Message: "an Origin header is required"}
	}
	expected := s.publicOrigin
	if expected == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		} else if !loopbackAuthority(r.Host) || !loopbackRemoteAddress(r.RemoteAddr) {
			return &statusError{Status: http.StatusForbidden, Code: "origin_forbidden", Message: "plain HTTP authentication is available only on a loopback origin"}
		}
		if r.Host == "" {
			return &statusError{Status: http.StatusForbidden, Code: "origin_forbidden", Message: "request origin is not allowed"}
		}
		expected = scheme + "://" + r.Host
	}
	if origins[0] != expected {
		return &statusError{Status: http.StatusForbidden, Code: "origin_forbidden", Message: "request origin is not allowed"}
	}
	return nil
}

func setPrivateNoStore(header http.Header) {
	header.Set("Cache-Control", "private, no-store")
	for _, value := range header.Values("Vary") {
		for _, field := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(field), "Cookie") {
				return
			}
		}
	}
	header.Add("Vary", "Cookie")
}

func (s *Server) sessionCookieToken(r *http.Request) string {
	name := localSessionCookieName
	if s.secureCookies(r) {
		name = secureSessionCookieName
	}
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (s *Server) secureCookies(r *http.Request) bool {
	if r.TLS != nil || s.securePublicOrigin {
		return true
	}
	// Configured HTTP origins are validated as loopback-only. With no explicit
	// origin, fail closed unless both the request authority and network peer are
	// loopback.
	return s.publicOrigin == "" && (!loopbackAuthority(r.Host) || !loopbackRemoteAddress(r.RemoteAddr))
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, session issuedSession) {
	secure := s.secureCookies(r)
	name := localSessionCookieName
	if secure {
		name = secureSessionCookieName
	}
	maxAge := int(time.Until(session.AbsoluteExpiresAt).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, newSessionCookie(name, session.Token, session.AbsoluteExpiresAt, maxAge, secure))
}

func (s *Server) clearSessionCookies(w http.ResponseWriter, r *http.Request) {
	expires := time.Unix(1, 0).UTC()
	for _, cookie := range []*http.Cookie{
		newSessionCookie(localSessionCookieName, "", expires, -1, s.secureCookies(r)),
		newSessionCookie(secureSessionCookieName, "", expires, -1, true),
	} {
		http.SetCookie(w, cookie)
	}
}

func newSessionCookie(name, value string, expires time.Time, maxAge int, secure bool) *http.Cookie {
	return &http.Cookie{ //nolint:gosec // Secure is false only for the supported local HTTP development origin; HTTPS always passes true.
		Name: name, Value: value, Path: "/", Expires: expires, MaxAge: maxAge,
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
	}
}

func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	if r.RemoteAddr == "" {
		return "unknown"
	}
	return r.RemoteAddr
}

func writeRateLimited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "300")
	writeError(w, http.StatusTooManyRequests, "rate_limited", "too many authentication attempts; try again later", nil)
}

func handlePasswordWorkError(w http.ResponseWriter, err error) bool {
	if !errors.Is(err, errPasswordWorkSaturated) {
		return false
	}
	w.Header().Set("Retry-After", "1")
	writeError(w, http.StatusTooManyRequests, "rate_limited", "password service is busy; try again", nil)
	return true
}

func (s *Server) handleSignup(w http.ResponseWriter, r *http.Request) {
	if !s.authThrottle.take(authThrottleKey("signup:ip", clientAddress(r)), 10*time.Minute) {
		writeRateLimited(w)
		return
	}
	var request signupRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	username, normalizedUsername := validateUsername(fields, request.Username)
	validateRequired(fields, "display_name", request.DisplayName, 200)
	validatePassword(fields, "password", request.Password)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "account is invalid", fields)
		return
	}
	passwordHash, err := hashPassword(request.Password)
	if err != nil {
		if handlePasswordWorkError(w, err) {
			return
		}
		handleAppError(w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var user userResponse
	err = tx.QueryRow(r.Context(), `
		insert into users (username, normalized_username, display_name, password_hash)
		values ($1, $2, $3, $4)
		returning id::text, username, display_name, created_at, updated_at`,
		username, normalizedUsername, strings.TrimSpace(request.DisplayName), passwordHash,
	).Scan(&user.ID, &user.Username, &user.DisplayName, &user.CreatedAt, &user.UpdatedAt)
	if isUniqueViolation(err, "users_normalized_username_unique") {
		writeError(w, http.StatusConflict, "username_unavailable", "username is unavailable", map[string]string{"username": "is already in use"})
		return
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	session, err := createSession(r.Context(), tx, user.ID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	s.setSessionCookie(w, r, session)
	writeJSON(w, http.StatusCreated, authResponse{User: user, CSRFToken: session.CSRFToken})
}

var dummyHash = encodePassword("not-a-real-account-password", []byte("fixed-dummy-salt"), currentPasswordParameters)

func dummyPasswordHash() string {
	return dummyHash
}

func (s *Server) handleSignin(w http.ResponseWriter, r *http.Request) {
	var request signinRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	normalizedUsername := strings.ToLower(strings.TrimSpace(request.Username))
	clientIP := clientAddress(r)
	if !s.authThrottle.take(authThrottleKey("signin:attempt:ip", clientIP), signinAttemptWindow) {
		writeRateLimited(w)
		return
	}
	ipKey := authThrottleKey("signin:ip", clientIP)
	accountKey := authThrottleKey("signin:account", normalizedUsername)
	if s.authThrottle.blocked(ipKey, 100) || s.authThrottle.blocked(accountKey, 10) {
		writeRateLimited(w)
		return
	}
	var user userResponse
	var passwordHash, status string
	err := s.db.QueryRow(r.Context(), `
		select id::text, username, display_name, password_hash, status, created_at, updated_at
		from users where normalized_username = $1`, normalizedUsername,
	).Scan(&user.ID, &user.Username, &user.DisplayName, &passwordHash, &status, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, verifyErr := verifyPassword(request.Password, dummyPasswordHash()); verifyErr != nil {
			if handlePasswordWorkError(w, verifyErr) {
				return
			}
			handleAppError(w, verifyErr)
			return
		}
		s.recordSigninFailure(ipKey, accountKey)
		handleAppError(w, invalidCredentials())
		return
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	valid, verifyErr := verifyPassword(request.Password, passwordHash)
	if verifyErr != nil {
		if handlePasswordWorkError(w, verifyErr) {
			return
		}
		handleAppError(w, verifyErr)
		return
	}
	if !valid || status != "active" {
		s.recordSigninFailure(ipKey, accountKey)
		handleAppError(w, invalidCredentials())
		return
	}
	var upgradedHash string
	if passwordHashNeedsUpgrade(passwordHash) {
		upgraded, hashErr := hashPassword(request.Password)
		if hashErr != nil {
			if handlePasswordWorkError(w, hashErr) {
				return
			}
			handleAppError(w, hashErr)
			return
		}
		upgradedHash = upgraded
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var lockedPasswordHash, lockedStatus string
	err = tx.QueryRow(r.Context(), `
		select id::text, username, display_name, password_hash, status, created_at, updated_at
		from users where id = $1 for update`, user.ID,
	).Scan(
		&user.ID, &user.Username, &user.DisplayName, &lockedPasswordHash,
		&lockedStatus, &user.CreatedAt, &user.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (lockedStatus != "active" || !constantTimeStringEqual(lockedPasswordHash, passwordHash))) {
		s.recordSigninFailure(ipKey, accountKey)
		handleAppError(w, invalidCredentials())
		return
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	if upgradedHash != "" {
		if err := tx.QueryRow(r.Context(), `
			update users set password_hash = $1 where id = $2 returning updated_at`, upgradedHash, user.ID,
		).Scan(&user.UpdatedAt); err != nil {
			handleAppError(w, err)
			return
		}
	}
	session, err := createSession(r.Context(), tx, user.ID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	s.authThrottle.clear(accountKey)
	s.setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, authResponse{User: user, CSRFToken: session.CSRFToken})
}

func (s *Server) recordSigninFailure(keys ...string) {
	for _, key := range keys {
		s.authThrottle.failure(key, 5*time.Minute)
	}
}

func authThrottleKey(scope, value string) string {
	digest := sha256.Sum256([]byte(value))
	return scope + ":" + hex.EncodeToString(digest[:])
}

func constantTimeStringEqual(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(r)
	if !ok {
		handleAppError(w, authenticationRequired())
		return
	}
	writeJSON(w, http.StatusOK, authResponse{User: actor.User, CSRFToken: actor.CSRFToken})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(r)
	if !ok {
		handleAppError(w, authenticationRequired())
		return
	}
	if _, err := s.db.Exec(r.Context(), `
		update auth_sessions set revoked_at = coalesce(revoked_at, now())
		where id = $1 and user_id = $2`, actor.SessionID, actor.User.ID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	s.clearSessionCookies(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLogoutAll(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(r)
	if !ok {
		handleAppError(w, authenticationRequired())
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var lockedUserID string
	if err := tx.QueryRow(r.Context(), `select id::text from users where id = $1 for update`, actor.User.ID).Scan(&lockedUserID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update auth_sessions set revoked_at = coalesce(revoked_at, now())
		where user_id = $1 and revoked_at is null`, actor.User.ID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	s.clearSessionCookies(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorFromRequest(r)
	if !ok {
		handleAppError(w, authenticationRequired())
		return
	}
	var request changePasswordRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.CurrentPassword == "" {
		fields["current_password"] = "is required"
	}
	validatePassword(fields, "new_password", request.NewPassword)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "password is invalid", fields)
		return
	}
	throttleKey := "password:user:" + actor.User.ID
	if s.authThrottle.blocked(throttleKey, 10) {
		writeRateLimited(w)
		return
	}
	newHash, err := hashPassword(request.NewPassword)
	if err != nil {
		if handlePasswordWorkError(w, err) {
			return
		}
		handleAppError(w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var currentHash, status string
	err = tx.QueryRow(r.Context(), `select password_hash, status from users where id = $1 for update`, actor.User.ID).Scan(&currentHash, &status)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var sessionStillValid bool
	if err := tx.QueryRow(r.Context(), `
		select exists (
			select 1 from auth_sessions
			where id = $1 and user_id = $2 and token_hash = $3
				and revoked_at is null and idle_expires_at > now() and absolute_expires_at > now()
		)`, actor.SessionID, actor.User.ID, hashSessionToken(actor.SessionToken),
	).Scan(&sessionStillValid); err != nil {
		handleAppError(w, err)
		return
	}
	if !sessionStillValid || status != "active" {
		handleAppError(w, authenticationRequired())
		return
	}
	valid, verifyErr := verifyPassword(request.CurrentPassword, currentHash)
	if verifyErr != nil {
		if handlePasswordWorkError(w, verifyErr) {
			return
		}
		handleAppError(w, verifyErr)
		return
	}
	if !valid {
		s.authThrottle.failure(throttleKey, 5*time.Minute)
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "password could not be changed", map[string]string{
			"current_password": "is incorrect",
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `update users set password_hash = $1 where id = $2`, newHash, actor.User.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update auth_sessions set revoked_at = coalesce(revoked_at, now())
		where user_id = $1 and revoked_at is null`, actor.User.ID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	session, err := createSession(r.Context(), tx, actor.User.ID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.QueryRow(r.Context(), `
		select id::text, username, display_name, created_at, updated_at
		from users where id = $1`, actor.User.ID,
	).Scan(&actor.User.ID, &actor.User.Username, &actor.User.DisplayName, &actor.User.CreatedAt, &actor.User.UpdatedAt); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	s.authThrottle.clear(throttleKey)
	s.setSessionCookie(w, r, session)
	writeJSON(w, http.StatusOK, authResponse{User: actor.User, CSRFToken: session.CSRFToken})
}

func isUniqueViolation(err error, constraint string) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23505" && databaseError.ConstraintName == constraint
}
