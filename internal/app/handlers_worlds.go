package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type authorizedWorldMember struct {
	ID            string
	RuleSetID     string
	PrimaryGameID string
	UserID        string
	Role          string
	Status        string
	WorldStatus   string
}

var nonKeyCharacters = regexp.MustCompile(`[^a-z0-9]+`)

func (s *Server) registerWorldRoutes() {
	s.api.HandleFunc("GET /api/worlds", s.handleListWorlds)
	s.api.HandleFunc("POST /api/worlds", s.handleCreateWorld)
	s.api.HandleFunc("GET /api/worlds/{world_id}", s.handleGetWorld)
	s.api.HandleFunc("PATCH /api/worlds/{world_id}", s.handleUpdateWorld)
	s.api.HandleFunc("POST /api/worlds/{world_id}/archive", s.handleArchiveWorld)
	s.api.HandleFunc("GET /api/worlds/{world_id}/members", s.handleListWorldMembers)
	s.api.HandleFunc("GET /api/worlds/{world_id}/invites", s.handleListWorldInvites)
	s.api.HandleFunc("POST /api/worlds/{world_id}/invites", s.handleCreateWorldInvite)
	s.api.HandleFunc("POST /api/worlds/{world_id}/invites/{invite_id}/revoke", s.handleRevokeWorldInvite)
	s.api.HandleFunc("GET /api/world-invites/{token}", s.handlePreviewWorldInvite)
	s.api.HandleFunc("POST /api/world-invites/{token}/redeem", s.handleRedeemWorldInvite)
	s.api.HandleFunc("GET /api/worlds/{world_id}/character-fields", s.handleGetWorldCharacterFields)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/character-fields", s.handlePutWorldCharacterFields)
	s.registerWorldMechanicRoutes()
	s.registerWorldEntityRoutes()
}

func requireActiveWorldMember(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	var member authorizedWorldMember
	if !validID(worldID) {
		return member, &statusError{Status: http.StatusBadRequest, Code: "invalid_id", Message: "world ID is malformed"}
	}
	userID, err := requireKnownPlayActor(ctx, db, r)
	if err != nil {
		return member, err
	}
	err = db.QueryRow(ctx, `
		select membership.id::text, membership.rule_set_id::text,
			profile.primary_game_id::text, membership.user_id::text,
			membership.role, membership.status, profile.status
		from world_memberships membership
		join world_profiles profile on profile.rule_set_id = membership.rule_set_id
		where membership.rule_set_id = $1 and membership.user_id = $2`, worldID, userID,
	).Scan(
		&member.ID, &member.RuleSetID, &member.PrimaryGameID, &member.UserID,
		&member.Role, &member.Status, &member.WorldStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_forbidden", Message: "active world membership is required"}
	}
	if err != nil {
		return member, err
	}
	if member.Status != "active" {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_forbidden", Message: "active world membership is required"}
	}
	return member, nil
}

func requireWorldEditor(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if member.Role != "owner" && member.Role != "editor" {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_editor_required", Message: "world editing permission is required"}
	}
	if member.WorldStatus != "active" {
		return member, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"}
	}
	return member, nil
}

func requireWorldOwner(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if member.Role != "owner" {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_owner_required", Message: "world owner permission is required"}
	}
	return member, nil
}

func (s *Server) handleListWorlds(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select membership.rule_set_id::text
		from world_memberships membership
		join rule_sets ruleset on ruleset.id = membership.rule_set_id
		where membership.user_id = $1 and membership.status = 'active'
		order by lower(ruleset.name), ruleset.id limit 500`, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	worldIDs := make([]string, 0)
	for rows.Next() {
		var worldID string
		if err := rows.Scan(&worldID); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		worldIDs = append(worldIDs, worldID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()

	items := make([]worldResponse, 0, len(worldIDs))
	for _, worldID := range worldIDs {
		item, err := loadWorldResponse(r.Context(), s.db, worldID, userID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWorld(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createWorldRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "name", request.Name, 200)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "world is invalid", fields)
		return
	}
	request.Description = cleanOptional(request.Description)
	worldID := request.ID
	if worldID == "" {
		worldID, err = newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
	}
	gameID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}
	worldMembershipID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}
	gameMembershipID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}

	key := generatedWorldKey(request.Name, worldID)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	if _, err := tx.Exec(r.Context(), `
		insert into rule_sets (id, key, name, description)
		values ($1, $2, $3, $4)`, worldID, key, strings.TrimSpace(request.Name), request.Description); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into games (id, rule_set_id, name, created_by_user_id)
		values ($1, $2, $3, $4)`, gameID, worldID, strings.TrimSpace(request.Name), userID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into game_memberships (id, game_id, user_id, role, status, joined_at)
		values ($1, $2, $3, 'facilitator', 'active', now())`, gameMembershipID, gameID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_profiles (rule_set_id, primary_game_id)
		values ($1, $2)`, worldID, gameID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_character_field_sets (rule_set_id) values ($1)`, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_memberships (id, rule_set_id, user_id, role, status, joined_at)
		values ($1, $2, $3, 'owner', 'active', now())`, worldMembershipID, worldID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "game-created", gameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", "/api/worlds/"+worldID)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWorld(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	member, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateWorld(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request updateWorldRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.Name == nil {
		fields["name"] = "is required"
	} else {
		validateRequired(fields, "name", *request.Name, 200)
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "is required and cannot be negative"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "world is invalid", fields)
		return
	}
	request.Description = cleanOptional(request.Description)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	member, err := requireWorldEditor(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select revision from world_profiles where rule_set_id = $1 for update`, worldID).Scan(&revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("world", *request.ExpectedRevision, revision))
		return
	}
	name := strings.TrimSpace(*request.Name)
	if _, err := tx.Exec(r.Context(), `
		update rule_sets set name = $2, description = $3 where id = $1`, worldID, name, request.Description); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `update games set name = $2 where id = $1`, member.PrimaryGameID, name); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update world_profiles set revision = revision + 1 where rule_set_id = $1`, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveWorld(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	var request archiveWorldRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "world archive command is invalid", map[string]string{
			"expected_revision": "is required and cannot be negative",
		})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	member, err := requireWorldOwner(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var revision int64
	if err := tx.QueryRow(r.Context(), `select revision from world_profiles where rule_set_id = $1 for update`, worldID).Scan(&revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("world", *request.ExpectedRevision, revision))
		return
	}
	var unfinished bool
	if err := tx.QueryRow(r.Context(), `
		select exists(select 1 from interactions
			where game_id = $1 and status in ('draft', 'open', 'adjudicating'))`, member.PrimaryGameID).Scan(&unfinished); err != nil {
		handleAppError(w, err)
		return
	}
	if unfinished {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "world_has_unfinished_interactions", Message: "resolve or cancel every active problem before archiving the world"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update world_profiles set status = 'archived', revision = revision + 1 where rule_set_id = $1`, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update games set status = 'archived', revision = revision + 1 where id = $1`, member.PrimaryGameID); err != nil {
		handleAppError(w, err)
		return
	}
	var gameMembershipID string
	if err := tx.QueryRow(r.Context(), `
		select id::text from game_memberships where game_id = $1 and user_id = $2`, member.PrimaryGameID, member.UserID).Scan(&gameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, member.PrimaryGameID, "game-archived", gameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleListWorldMembers(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	actor, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select membership.id::text, membership.user_id::text, app_user.display_name,
			membership.role, membership.status, membership.revision, membership.joined_at,
			membership.created_at, membership.updated_at
		from world_memberships membership
		join users app_user on app_user.id = membership.user_id
		where membership.rule_set_id = $1
		order by membership.status, case membership.role when 'owner' then 0 when 'editor' then 1 else 2 end,
			lower(app_user.display_name), membership.id`, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	items := make([]worldMemberResponse, 0)
	for rows.Next() {
		var item worldMemberResponse
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.DisplayName, &item.Role, &item.Status,
			&item.Revision, &item.JoinedAt, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	for index := range items {
		item := &items[index]
		item.PlayStatus, err = loadWorldMemberPlayStatus(
			r.Context(), s.db, actor.PrimaryGameID, item.UserID, item.Role, item.Status,
		)
		if err != nil {
			handleAppError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListWorldInvites(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select invite.id::text, invite.role, creator.display_name, invite.expires_at,
			invite.revoked_at, invite.use_count, invite.created_at
		from world_invites invite
		join world_memberships creator_membership on creator_membership.id = invite.created_by_membership_id
		join users creator on creator.id = creator_membership.user_id
		where invite.rule_set_id = $1
		order by invite.created_at desc, invite.id desc limit 200`, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()
	items := make([]worldInviteResponse, 0)
	for rows.Next() {
		var item worldInviteResponse
		if err := rows.Scan(
			&item.ID, &item.Role, &item.CreatedByDisplayName, &item.ExpiresAt,
			&item.RevokedAt, &item.UseCount, &item.CreatedAt,
		); err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWorldInvite(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	member, err := requireWorldEditor(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createWorldInviteRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if !validWorldInviteRole(request.Role) {
		fields["role"] = "must be editor, player, or spectator"
	}
	if request.ExpiresInDays == 0 {
		request.ExpiresInDays = 7
	}
	if request.ExpiresInDays < 1 || request.ExpiresInDays > 90 {
		fields["expires_in_days"] = "must be between 1 and 90"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "invite is invalid", fields)
		return
	}
	token, tokenHash, err := newWorldInviteToken()
	if err != nil {
		handleAppError(w, err)
		return
	}
	expiresAt := time.Now().UTC().Add(time.Duration(request.ExpiresInDays) * 24 * time.Hour)
	var item worldInviteResponse
	err = s.db.QueryRow(r.Context(), `
		insert into world_invites (rule_set_id, token_hash, role, created_by_membership_id, expires_at)
		values ($1, $2, $3, $4, $5)
		returning id::text, role, expires_at, revoked_at, use_count, created_at`,
		worldID, tokenHash, request.Role, member.ID, expiresAt,
	).Scan(&item.ID, &item.Role, &item.ExpiresAt, &item.RevokedAt, &item.UseCount, &item.CreatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := s.db.QueryRow(r.Context(), `select display_name from users where id = $1`, member.UserID).Scan(&item.CreatedByDisplayName); err != nil {
		handleAppError(w, err)
		return
	}
	joinPath := "/invite/" + token
	item.JoinPath = &joinPath
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleRevokeWorldInvite(w http.ResponseWriter, r *http.Request) {
	worldID, inviteID := r.PathValue("world_id"), r.PathValue("invite_id")
	if !validID(inviteID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "invite ID is malformed", nil)
		return
	}
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var item worldInviteResponse
	err := s.db.QueryRow(r.Context(), `
		update world_invites invite set revoked_at = coalesce(revoked_at, now())
		from world_memberships creator_membership, users creator
		where invite.rule_set_id = $1 and invite.id = $2
			and creator_membership.id = invite.created_by_membership_id
			and creator.id = creator_membership.user_id
		returning invite.id::text, invite.role, creator.display_name, invite.expires_at,
			invite.revoked_at, invite.use_count, invite.created_at`, worldID, inviteID,
	).Scan(&item.ID, &item.Role, &item.CreatedByDisplayName, &item.ExpiresAt, &item.RevokedAt, &item.UseCount, &item.CreatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePreviewWorldInvite(w http.ResponseWriter, r *http.Request) {
	tokenHash := hashWorldInviteToken(r.PathValue("token"))
	if tokenHash == "" {
		writeError(w, http.StatusNotFound, "invite_not_found", "invite link is invalid or expired", nil)
		return
	}
	var item worldInvitePreviewResponse
	err := s.db.QueryRow(r.Context(), `
		select ruleset.id::text, ruleset.name, ruleset.description, invite.role,
			creator.display_name, invite.expires_at
		from world_invites invite
		join rule_sets ruleset on ruleset.id = invite.rule_set_id
		join world_profiles profile on profile.rule_set_id = invite.rule_set_id
		join world_memberships creator_membership on creator_membership.id = invite.created_by_membership_id
		join users creator on creator.id = creator_membership.user_id
		where invite.token_hash = $1 and invite.revoked_at is null
			and invite.expires_at > now() and profile.status = 'active'`, tokenHash,
	).Scan(
		&item.WorldID, &item.WorldName, &item.WorldDescription, &item.Role,
		&item.InvitedByDisplayName, &item.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "invite_not_found", "invite link is invalid or expired", nil)
		return
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleRedeemWorldInvite(w http.ResponseWriter, r *http.Request) {
	tokenHash := hashWorldInviteToken(r.PathValue("token"))
	if tokenHash == "" {
		writeError(w, http.StatusNotFound, "invite_not_found", "invite link is invalid or expired", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	var inviteID, worldID, role, gameID string
	var revokedAt *time.Time
	var expiresAt time.Time
	err = tx.QueryRow(r.Context(), `
		select invite.id::text, invite.rule_set_id::text, invite.role,
			profile.primary_game_id::text, invite.revoked_at, invite.expires_at
		from world_invites invite
		join world_profiles profile on profile.rule_set_id = invite.rule_set_id
		where invite.token_hash = $1 and profile.status = 'active' for update of invite`, tokenHash,
	).Scan(&inviteID, &worldID, &role, &gameID, &revokedAt, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) || revokedAt != nil || !expiresAt.After(time.Now().UTC()) {
		writeError(w, http.StatusNotFound, "invite_not_found", "invite link is invalid or expired", nil)
		return
	}
	if err != nil {
		handleAppError(w, err)
		return
	}

	var existingRole, existingStatus string
	err = tx.QueryRow(r.Context(), `
		select role, status from world_memberships where rule_set_id = $1 and user_id = $2 for update`, worldID, userID,
	).Scan(&existingRole, &existingStatus)
	if err == nil && existingStatus == "active" {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		item, loadErr := loadWorldResponse(r.Context(), s.db, worldID, userID)
		if loadErr != nil {
			handleAppError(w, loadErr)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		handleAppError(w, err)
		return
	}

	worldMembershipID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}
	gameMembershipID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.QueryRow(r.Context(), `
		insert into world_memberships (id, rule_set_id, user_id, role, status, joined_at)
		values ($1, $2, $3, $4, 'active', now())
		on conflict (rule_set_id, user_id) do update set
			role = excluded.role, status = 'active', joined_at = coalesce(world_memberships.joined_at, now()),
			revision = world_memberships.revision + 1
		returning id::text`, worldMembershipID, worldID, userID, role,
	).Scan(&worldMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	gameRole := worldRoleToGameRole(role)
	if err := tx.QueryRow(r.Context(), `
		insert into game_memberships (id, game_id, user_id, role, status, joined_at)
		values ($1, $2, $3, $4, 'active', now())
		on conflict (game_id, user_id) do update set
			role = excluded.role, status = 'active', joined_at = coalesce(game_memberships.joined_at, now()),
			revision = game_memberships.revision + 1
		returning id::text`, gameMembershipID, gameID, userID, gameRole,
	).Scan(&gameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if gameRole != "player" {
		if _, err := tx.Exec(r.Context(), `
			delete from game_membership_entity_controls
			where game_id = $1 and membership_id = $2`, gameID, gameMembershipID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	command, err := tx.Exec(r.Context(), `
		insert into world_invite_redemptions (invite_id, rule_set_id, user_id, world_membership_id)
		values ($1, $2, $3, $4) on conflict (invite_id, user_id) do nothing`, inviteID, worldID, userID, worldMembershipID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() > 0 {
		if _, err := tx.Exec(r.Context(), `update world_invites set use_count = use_count + 1 where id = $1`, inviteID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "membership-created", gameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func loadWorldResponse(ctx context.Context, db queryer, worldID, userID string) (worldResponse, error) {
	var item worldResponse
	err := db.QueryRow(ctx, `
		select ruleset.id::text, ruleset.name, ruleset.description,
			profile.status, profile.revision, membership.role, membership.id::text,
			profile.primary_game_id::text,
			(select count(*)::integer from world_memberships member
				where member.rule_set_id = ruleset.id and member.status = 'active'),
			(select count(*)::integer from world_mechanics mechanic
				join state_variable_definitions definition on definition.id = mechanic.state_variable_id
				where mechanic.rule_set_id = ruleset.id and mechanic.kind = 'capacity' and not definition.archived),
			(select count(*)::integer from world_mechanics mechanic
				join state_variable_definitions definition on definition.id = mechanic.state_variable_id
				where mechanic.rule_set_id = ruleset.id and mechanic.kind = 'capability' and not definition.archived),
			(select count(*)::integer from world_character_fields field
				where field.rule_set_id = ruleset.id and not field.archived),
			ruleset.created_at, greatest(ruleset.updated_at, profile.updated_at),
			(select max(interaction.updated_at) from interactions interaction
				where interaction.game_id = profile.primary_game_id)
		from rule_sets ruleset
		join world_profiles profile on profile.rule_set_id = ruleset.id
		join world_memberships membership on membership.rule_set_id = ruleset.id
		where ruleset.id = $1 and membership.user_id = $2 and membership.status = 'active'`, worldID, userID,
	).Scan(
		&item.ID, &item.Name, &item.Description, &item.Status, &item.Revision,
		&item.Role, &item.MembershipID, &item.PrimaryGameID, &item.MemberCount,
		&item.CapacityCount, &item.CapabilityCount, &item.CharacterFieldCount,
		&item.CreatedAt, &item.UpdatedAt,
		&item.LastInteractionAt,
	)
	if err != nil {
		return item, err
	}
	item.PlayStatus, err = loadWorldMemberPlayStatus(
		ctx, db, item.PrimaryGameID, userID, item.Role, "active",
	)
	return item, err
}

func generatedWorldKey(name, id string) string {
	base := strings.ToLower(strings.TrimSpace(name))
	base = nonKeyCharacters.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" || base[0] < 'a' || base[0] > 'z' {
		base = "world"
	}
	if len(base) > 80 {
		base = strings.Trim(base[:80], "-")
	}
	suffix := strings.ReplaceAll(id, "-", "")
	if len(suffix) > 10 {
		suffix = suffix[:10]
	}
	return base + "-" + suffix
}

func validWorldInviteRole(role string) bool {
	return role == "editor" || role == "player" || role == "spectator"
}

func worldRoleToGameRole(role string) string {
	if role == "owner" || role == "editor" {
		return "facilitator"
	}
	return role
}

func newWorldInviteToken() (string, string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", "", fmt.Errorf("generate invite token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(data)
	return token, hashWorldInviteToken(token), nil
}

func hashWorldInviteToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" || len(token) > 200 {
		return ""
	}
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}
