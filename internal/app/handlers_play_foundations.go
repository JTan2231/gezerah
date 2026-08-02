package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

const playUserHeader = "X-DND-User-ID"

type authorizedGameMember struct {
	ID         string
	UserID     string
	Role       string
	Status     string
	PlayStatus string
}

func (s *Server) registerPlayFoundationRoutes() {
	s.api.HandleFunc("GET /api/users", s.handleListPlayUsers)
	s.api.HandleFunc("POST /api/users", s.handleCreatePlayUser)
	s.api.HandleFunc("GET /api/games", s.handleListGames)
	s.api.HandleFunc("POST /api/games", s.handleCreateGame)
	s.api.HandleFunc("GET /api/games/{game_id}", s.handleGetGame)
	s.api.HandleFunc("POST /api/games/{game_id}/archive", s.handleArchiveGame)
	s.api.HandleFunc("GET /api/games/{game_id}/entities", s.handleListGameEntities)
	s.api.HandleFunc("GET /api/games/{game_id}/available-entities", s.handleListAvailableGameEntities)
	s.api.HandleFunc("GET /api/games/{game_id}/state-variable-definitions", s.handleListGameStateVariables)
	s.api.HandleFunc("GET /api/play/rule-sets/{rule_set_id}/available-entities", s.handleListAvailablePlayEntities)
	s.api.HandleFunc("POST /api/games/{game_id}/memberships", s.handleCreateGameMembership)
	s.api.HandleFunc("PUT /api/games/{game_id}/memberships/{membership_id}", s.handleUpdateGameMembership)
	// PATCH matches the contained role editor while PUT remains the complete
	// public command promised by the API.
	s.api.HandleFunc("PATCH /api/games/{game_id}/memberships/{membership_id}", s.handleUpdateGameMembership)
	s.api.HandleFunc("PUT /api/games/{game_id}/entities", s.handleReplaceGameEntities)
	s.registerInteractionCoreRoutes()
	s.registerInteractionResolutionRoutes()
}

func (s *Server) handleListPlayUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		select id::text, display_name, created_at, updated_at
		from users order by lower(display_name), id limit 1000`)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()
	items := make([]playUserResponse, 0)
	for rows.Next() {
		var item playUserResponse
		if err := rows.Scan(&item.ID, &item.DisplayName, &item.CreatedAt, &item.UpdatedAt); err != nil {
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

func (s *Server) handleCreatePlayUser(w http.ResponseWriter, r *http.Request) {
	var request createPlayUserRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "display_name", request.DisplayName, 200)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "user is invalid", fields)
		return
	}
	var item playUserResponse
	err := s.db.QueryRow(r.Context(), `
		insert into users (id, display_name)
		values (coalesce(nullif($1, '')::uuid, gen_random_uuid()), $2)
		returning id::text, display_name, created_at, updated_at`,
		request.ID, strings.TrimSpace(request.DisplayName),
	).Scan(&item.ID, &item.DisplayName, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", "/api/users/"+item.ID)
	writeJSON(w, http.StatusCreated, item)
}

func playActorID(r *http.Request) (string, error) {
	userID := strings.TrimSpace(r.Header.Get(playUserHeader))
	if userID == "" {
		return "", &statusError{
			Status: http.StatusUnauthorized, Code: "authentication_required",
			Message: playUserHeader + " is required in this trusted development build",
		}
	}
	if !validID(userID) {
		return "", &statusError{
			Status: http.StatusUnauthorized, Code: "invalid_identity",
			Message: playUserHeader + " must identify a local user",
		}
	}
	return userID, nil
}

func requireKnownPlayActor(ctx context.Context, db queryer, r *http.Request) (string, error) {
	userID, err := playActorID(r)
	if err != nil {
		return "", err
	}
	var exists bool
	if err := db.QueryRow(ctx, `select exists(select 1 from users where id = $1)`, userID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", &statusError{Status: http.StatusUnauthorized, Code: "invalid_identity", Message: "local user does not exist"}
	}
	return userID, nil
}

func requireActiveGameMember(ctx context.Context, db queryer, gameID, userID string) (authorizedGameMember, error) {
	var member authorizedGameMember
	err := db.QueryRow(ctx, `
		select id::text, user_id::text, role, status
		from game_memberships where game_id = $1 and user_id = $2`, gameID, userID,
	).Scan(&member.ID, &member.UserID, &member.Role, &member.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return member, &statusError{Status: http.StatusForbidden, Code: "game_forbidden", Message: "active game membership is required"}
	}
	if err != nil {
		return member, err
	}
	if member.Status != "active" {
		return member, &statusError{Status: http.StatusForbidden, Code: "game_forbidden", Message: "active game membership is required"}
	}
	return member, nil
}

func requireGameFacilitator(ctx context.Context, db queryer, gameID, userID string) (authorizedGameMember, error) {
	member, err := requireActiveGameMember(ctx, db, gameID, userID)
	if err != nil {
		return member, err
	}
	if member.Role != "facilitator" {
		return member, &statusError{Status: http.StatusForbidden, Code: "facilitator_required", Message: "Dungeon Master authority is required"}
	}
	return member, nil
}

func loadGameResponse(ctx context.Context, db queryer, gameID string) (gameResponse, error) {
	var result gameResponse
	err := db.QueryRow(ctx, `
		select id::text, rule_set_id::text, name, status, revision,
			created_by_user_id::text, created_at, updated_at
		from games where id = $1`, gameID,
	).Scan(
		&result.ID, &result.RuleSetID, &result.Name, &result.Status, &result.Revision,
		&result.CreatedByUserID, &result.CreatedAt, &result.UpdatedAt,
	)
	if err != nil {
		return result, err
	}
	result.Memberships = make([]gameMembershipResponse, 0)
	rows, err := db.Query(ctx, `
		select membership.id::text, membership.game_id::text, membership.user_id::text,
			membership.role, membership.status, membership.revision, membership.joined_at,
			membership.created_at, membership.updated_at,
			app_user.display_name, app_user.created_at, app_user.updated_at
		from game_memberships membership
		join users app_user on app_user.id = membership.user_id
		where membership.game_id = $1
		order by membership.status, lower(app_user.display_name), membership.id`, gameID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var item gameMembershipResponse
		var userCreatedAt, userUpdatedAt time.Time
		if err := rows.Scan(
			&item.ID, &item.GameID, &item.UserID, &item.Role, &item.Status, &item.Revision, &item.JoinedAt,
			&item.CreatedAt, &item.UpdatedAt, &item.DisplayName, &userCreatedAt, &userUpdatedAt,
		); err != nil {
			rows.Close()
			return result, err
		}
		item.User = &playUserResponse{
			ID: item.UserID, DisplayName: item.DisplayName,
			CreatedAt: userCreatedAt, UpdatedAt: userUpdatedAt,
		}
		item.ControlledEntityIDs = make([]string, 0)
		result.Memberships = append(result.Memberships, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	membershipIndexes := make(map[string]int, len(result.Memberships))
	for index := range result.Memberships {
		membershipIndexes[result.Memberships[index].ID] = index
	}
	rows, err = db.Query(ctx, `
		select membership_id::text, entity_id::text
		from game_membership_entity_controls
		where game_id = $1
		order by membership_id, entity_id`, gameID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var membershipID, entityID string
		if err := rows.Scan(&membershipID, &entityID); err != nil {
			rows.Close()
			return result, err
		}
		if index, exists := membershipIndexes[membershipID]; exists {
			result.Memberships[index].ControlledEntityIDs = append(
				result.Memberships[index].ControlledEntityIDs,
				entityID,
			)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()
	for index := range result.Memberships {
		item := &result.Memberships[index]
		item.PlayStatus, err = loadGameMembershipPlayStatus(
			ctx, db, gameID, item.ID, item.Role, item.Status,
		)
		if err != nil {
			return result, err
		}
	}
	result.EntityIDs = make([]string, 0)
	rows, err = db.Query(ctx, `
		select entity_id::text from game_entities
		where game_id = $1 order by entity_id`, gameID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var entityID string
		if err := rows.Scan(&entityID); err != nil {
			return result, err
		}
		result.EntityIDs = append(result.EntityIDs, entityID)
	}
	return result, rows.Err()
}

func (s *Server) loadGameResponseSnapshot(ctx context.Context, gameID string) (gameResponse, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return gameResponse{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	item, err := loadGameResponse(ctx, tx, gameID)
	if err != nil {
		return gameResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return gameResponse{}, err
	}
	return item, nil
}

func (s *Server) handleListGames(w http.ResponseWriter, r *http.Request) {
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	userID, err := requireKnownPlayActor(r.Context(), tx, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := tx.Query(r.Context(), `
		select game.id::text
		from games game
		join game_memberships membership on membership.game_id = game.id
		where membership.user_id = $1 and membership.status = 'active'
		order by game.status, lower(game.name), game.id limit 500`, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	gameIDs := make([]string, 0)
	for rows.Next() {
		var gameID string
		if err := rows.Scan(&gameID); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		gameIDs = append(gameIDs, gameID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	items := make([]gameResponse, 0, len(gameIDs))
	for _, gameID := range gameIDs {
		member, err := requireActiveGameMember(r.Context(), tx, gameID, userID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		if member.Role == "player" {
			playStatus, err := loadGameMembershipPlayStatus(
				r.Context(), tx, gameID, member.ID, member.Role, member.Status,
			)
			if err != nil {
				handleAppError(w, err)
				return
			}
			if playStatus != playStatusReady {
				continue
			}
		}
		item, err := loadGameResponse(r.Context(), tx, gameID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateGame(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createGameRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	if !validID(request.RuleSetID) {
		fields["rule_set_id"] = "must be a UUID"
	}
	validateRequired(fields, "name", request.Name, 200)
	request.EntityIDs = uniqueSorted(request.EntityIDs)
	for index, entityID := range request.EntityIDs {
		if !validID(entityID) {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "must be a UUID"
		}
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "game is invalid", fields)
		return
	}
	gameID := request.ID
	if gameID == "" {
		gameID, err = newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
	}
	membershipID, err := newID()
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
	var ruleSetExists bool
	if err := tx.QueryRow(r.Context(), `select true from rule_sets where id = $1 for share`, request.RuleSetID).Scan(&ruleSetExists); err != nil {
		handleAppError(w, err)
		return
	}
	if err := validateAssignableGameEntities(r.Context(), tx, request.RuleSetID, "", request.EntityIDs); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into games (id, rule_set_id, name, created_by_user_id)
		values ($1, $2, $3, $4)`, gameID, request.RuleSetID, strings.TrimSpace(request.Name), userID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into game_memberships (id, game_id, user_id, role, status, joined_at)
		values ($1, $2, $3, 'facilitator', 'active', now())`, membershipID, gameID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	for _, entityID := range request.EntityIDs {
		if _, err := tx.Exec(r.Context(), `
			insert into game_entities (entity_id, game_id, rule_set_id)
			values ($1, $2, $3)`, entityID, gameID, request.RuleSetID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "game-created", membershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", "/api/games/"+item.ID)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetGame(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	userID, err := requireKnownPlayActor(r.Context(), tx, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := requirePlayReadyGameMember(r.Context(), tx, gameID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadGameResponse(r.Context(), tx, gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveGame(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request archiveGameRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "game archive command is invalid", map[string]string{
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
	actor, _, revision, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("game", *request.ExpectedRevision, revision))
		return
	}
	var unfinished bool
	if err := tx.QueryRow(r.Context(), `
		select exists(
			select 1 from interactions
			where game_id = $1 and status in ('draft', 'open', 'adjudicating')
		)`, gameID).Scan(&unfinished); err != nil {
		handleAppError(w, err)
		return
	}
	if unfinished {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "game_has_unfinished_interactions",
			Message: "resolve or cancel every active interaction before archiving the game",
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update games set status = 'archived', revision = revision + 1 where id = $1`, gameID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "game-archived", actor.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleListGameEntities(w http.ResponseWriter, r *http.Request) {
	s.handleListPlayEntities(w, r, false)
}

func (s *Server) handleListAvailableGameEntities(w http.ResponseWriter, r *http.Request) {
	s.handleListPlayEntities(w, r, true)
}

func (s *Server) handleListPlayEntities(w http.ResponseWriter, r *http.Request, includeAvailable bool) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	userID, err := requireKnownPlayActor(r.Context(), tx, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if includeAvailable {
		if _, err = requireGameFacilitator(r.Context(), tx, gameID, userID); err != nil {
			handleAppError(w, err)
			return
		}
	} else if _, err = requirePlayReadyGameMember(r.Context(), tx, gameID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	items, err := loadPlayEntityResponses(r.Context(), tx, gameID, includeAvailable)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListAvailablePlayEntities(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	if _, err := requireKnownPlayActor(r.Context(), s.db, r); err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select entity.id::text, entity.key, entity.display_name, entity.archived,
			state_record.revision, entity.created_at, entity.updated_at,
			coalesce(array_agg(owner.owner_schema_id::text order by owner.owner_schema_id)
				filter (where owner.owner_schema_id is not null), '{}'::text[])
		from entities entity
		join state_records state_record on state_record.owner_entity_id = entity.id
		left join game_entities assignment on assignment.entity_id = entity.id
		left join entity_owner_schemas owner on owner.entity_id = entity.id
		where entity.rule_set_id = $1 and not entity.archived and assignment.entity_id is null
		group by entity.id, state_record.revision
		order by lower(entity.display_name), entity.id limit 1000`, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	items, err := scanPlayEntityResponses(rows)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListGameStateVariables(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	userID, err := requireKnownPlayActor(r.Context(), tx, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if _, err = requirePlayReadyGameMember(r.Context(), tx, gameID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	var ruleSetID string
	if err = tx.QueryRow(r.Context(), `select rule_set_id::text from games where id = $1`, gameID).Scan(&ruleSetID); err != nil {
		handleAppError(w, err)
		return
	}
	entityIDs, err := loadStringColumn(r.Context(), tx, `
		select entity_id::text from game_entities where game_id = $1 order by entity_id`, gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	entities, err := loadGameEntitiesDomain(r.Context(), tx, ruleSetID, entityIDs)
	if err != nil {
		handleAppError(w, err)
		return
	}
	definitions, err := loadDefinitionsDomain(r.Context(), tx, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	items := make([]stateVariableResponse, 0)
	for _, definition := range sortedDefinitionSlice(definitions) {
		eligible := false
		for _, entity := range entities {
			if rules.EntityImplementsAny(entity, definition.OwnerSchemaIDs) {
				eligible = true
				break
			}
		}
		if eligible {
			items = append(items, definitionToResponse(definition))
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func loadPlayEntityResponses(ctx context.Context, db queryer, gameID string, includeAvailable bool) ([]entityResponse, error) {
	where := "assignment.game_id = game.id"
	if includeAvailable {
		where = "(assignment.game_id is null or assignment.game_id = game.id) and (not entity.archived or assignment.game_id = game.id)"
	}
	rows, err := db.Query(ctx, `
		select entity.id::text, entity.key, entity.display_name, entity.archived,
			state_record.revision, entity.created_at, entity.updated_at,
			coalesce(array_agg(owner.owner_schema_id::text order by owner.owner_schema_id)
				filter (where owner.owner_schema_id is not null), '{}'::text[])
		from games game
		join entities entity on entity.rule_set_id = game.rule_set_id
		join state_records state_record on state_record.owner_entity_id = entity.id
		left join game_entities assignment on assignment.entity_id = entity.id
		left join entity_owner_schemas owner on owner.entity_id = entity.id
		where game.id = $1 and `+where+`
		group by entity.id, state_record.revision
		order by entity.archived, lower(entity.display_name), entity.id limit 1000`, gameID)
	if err != nil {
		return nil, err
	}
	return scanPlayEntityResponses(rows)
}

func scanPlayEntityResponses(rows pgx.Rows) ([]entityResponse, error) {
	defer rows.Close()
	items := make([]entityResponse, 0)
	for rows.Next() {
		var item entityResponse
		if err := rows.Scan(
			&item.ID, &item.Key, &item.DisplayName, &item.Archived, &item.StateRevision,
			&item.CreatedAt, &item.UpdatedAt, &item.OwnerSchemaIDs,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func appendGameEvent(ctx context.Context, tx pgx.Tx, gameID, eventType, actorMembershipID string) error {
	_, err := tx.Exec(ctx, `
		insert into game_events (game_id, event_type, actor_membership_id)
		values ($1, $2, $3)`, gameID, eventType, actorMembershipID)
	return err
}

func validateAssignableGameEntities(ctx context.Context, tx pgx.Tx, ruleSetID, gameID string, entityIDs []string) error {
	ids := append([]string(nil), entityIDs...)
	sort.Strings(ids)
	for index, entityID := range ids {
		var archived bool
		var assignedGameID *string
		err := tx.QueryRow(ctx, `
			select entity.archived, assignment.game_id::text
			from entities entity
			left join game_entities assignment on assignment.entity_id = entity.id
			where entity.rule_set_id = $1 and entity.id = $2
			for update of entity`, ruleSetID, entityID,
		).Scan(&archived, &assignedGameID)
		if errors.Is(err, pgx.ErrNoRows) {
			return &statusError{
				Status: http.StatusUnprocessableEntity, Code: "invalid_game_entity",
				Message: "game entities must belong to the game's ruleset",
				Fields:  map[string]string{fmt.Sprintf("entity_ids[%d]", index): "entity does not exist in this ruleset"},
			}
		}
		if err != nil {
			return err
		}
		if archived && (assignedGameID == nil || *assignedGameID != gameID) {
			return &statusError{
				Status: http.StatusConflict, Code: "entity_archived", Message: "archived entities cannot be newly assigned to a game",
				Fields: map[string]string{fmt.Sprintf("entity_ids[%d]", index): "archived entity cannot be newly assigned"},
			}
		}
		if assignedGameID != nil && *assignedGameID != gameID {
			return &statusError{
				Status: http.StatusConflict, Code: "entity_in_another_game", Message: "an entity can belong to only one game",
				Fields: map[string]string{fmt.Sprintf("entity_ids[%d]", index): "entity already belongs to another game"},
			}
		}
	}
	return nil
}

func (s *Server) handleCreateGameMembership(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createGameMembershipRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	if !validID(request.UserID) {
		fields["user_id"] = "must be a UUID"
	}
	if !validGameRole(request.Role) {
		fields["role"] = "must be facilitator, player, or spectator"
	}
	if request.Status == "" {
		request.Status = "active"
	}
	if request.Status != "active" && request.Status != "invited" {
		fields["status"] = "must be active or invited when adding a membership"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "game membership is invalid", fields)
		return
	}
	membershipID := request.ID
	if membershipID == "" {
		membershipID, err = newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	actor, _, _, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var invitedUserExists bool
	if err := tx.QueryRow(r.Context(), `select exists(select 1 from users where id = $1)`, request.UserID).Scan(&invitedUserExists); err != nil {
		handleAppError(w, err)
		return
	}
	if !invitedUserExists {
		handleAppError(w, &statusError{
			Status: http.StatusUnprocessableEntity, Code: "invalid_user", Message: "membership user does not exist",
			Fields: map[string]string{"user_id": "local user does not exist"},
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into game_memberships (id, game_id, user_id, role, status, joined_at)
		values ($1, $2, $3, $4, $5,
			case when $5 = 'active' then now() else null end)`,
		membershipID, gameID, request.UserID, request.Role, request.Status); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `update games set revision = revision + 1 where id = $1`, gameID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "membership-created", actor.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateGameMembership(w http.ResponseWriter, r *http.Request) {
	gameID, membershipID := r.PathValue("game_id"), r.PathValue("membership_id")
	if !validID(gameID) || !validID(membershipID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request updateGameMembershipRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != membershipID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	fields := map[string]string{}
	if request.Role == nil && request.Status == nil {
		fields["role"] = "role or status is required"
	}
	if request.Role != nil && !validGameRole(*request.Role) {
		fields["role"] = "must be facilitator, player, or spectator"
	}
	if request.Status != nil && !validGameMembershipStatus(*request.Status) {
		fields["status"] = "must be invited, active, or left"
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "is required and cannot be negative"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "game membership is invalid", fields)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	actor, _, _, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var currentRole, currentStatus string
	var currentRevision int64
	err = tx.QueryRow(r.Context(), `
		select role, status, revision from game_memberships
		where game_id = $1 and id = $2 for update`, gameID, membershipID,
	).Scan(&currentRole, &currentStatus, &currentRevision)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if *request.ExpectedRevision != currentRevision {
		handleAppError(w, revisionConflict("game membership", *request.ExpectedRevision, currentRevision))
		return
	}
	nextRole, nextStatus := currentRole, currentStatus
	if request.Role != nil {
		nextRole = *request.Role
	}
	if request.Status != nil {
		nextStatus = *request.Status
	}
	if currentRole == nextRole && currentStatus == nextStatus {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if currentRole == "facilitator" && currentStatus == "active" && (nextRole != "facilitator" || nextStatus != "active") {
		var otherFacilitators int
		if err := tx.QueryRow(r.Context(), `
			select count(*) from game_memberships
			where game_id = $1 and id <> $2 and role = 'facilitator' and status = 'active'`,
			gameID, membershipID,
		).Scan(&otherFacilitators); err != nil {
			handleAppError(w, err)
			return
		}
		if otherFacilitators == 0 {
			handleAppError(w, &statusError{Status: http.StatusConflict, Code: "last_facilitator", Message: "a game must retain an active Dungeon Master"})
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		update game_memberships
		set role = $3, status = $4,
			joined_at = case when $4 = 'active' then coalesce(joined_at, now()) else joined_at end,
			revision = revision + 1
		where game_id = $1 and id = $2`, gameID, membershipID, nextRole, nextStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if nextRole != "player" || nextStatus != "active" {
		if _, err := tx.Exec(r.Context(), `
			delete from game_membership_entity_controls
			where game_id = $1 and membership_id = $2`, gameID, membershipID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `update games set revision = revision + 1 where id = $1`, gameID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "membership-updated", actor.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleReplaceGameEntities(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request replaceGameEntitiesRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "is required and cannot be negative"
	}
	request.EntityIDs = uniqueSorted(request.EntityIDs)
	for index, entityID := range request.EntityIDs {
		if !validID(entityID) {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "must be a UUID"
		}
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "game entities are invalid", fields)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	actor, ruleSetID, revision, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("game", *request.ExpectedRevision, revision))
		return
	}
	current, err := lockCurrentGameEntityIDs(r.Context(), tx, gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if equalStrings(current, request.EntityIDs) {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	if err := validateAssignableGameEntities(r.Context(), tx, ruleSetID, gameID, request.EntityIDs); err != nil {
		handleAppError(w, err)
		return
	}
	desired := make(map[string]struct{}, len(request.EntityIDs))
	for _, entityID := range request.EntityIDs {
		desired[entityID] = struct{}{}
	}
	currentSet := make(map[string]struct{}, len(current))
	for _, entityID := range current {
		currentSet[entityID] = struct{}{}
		if _, retained := desired[entityID]; retained {
			continue
		}
		inUse, err := gameEntityHasPlayUsage(r.Context(), tx, gameID, entityID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		if inUse {
			handleAppError(w, &statusError{
				Status: http.StatusConflict, Code: "game_entity_in_use",
				Message: "an entity used by an interaction or ruling cannot be released from its game",
				Fields:  map[string]string{"entity_ids": entityID + " is in use"},
			})
			return
		}
		if _, err := tx.Exec(r.Context(), `delete from game_entities where game_id = $1 and entity_id = $2`, gameID, entityID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	for _, entityID := range request.EntityIDs {
		if _, retained := currentSet[entityID]; retained {
			continue
		}
		if _, err := tx.Exec(r.Context(), `
			insert into game_entities (entity_id, game_id, rule_set_id)
			values ($1, $2, $3)`, entityID, gameID, ruleSetID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `update games set revision = revision + 1 where id = $1`, gameID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, gameID, "entity-assigned", actor.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadGameResponseSnapshot(r.Context(), gameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func lockGameForFacilitator(ctx context.Context, tx pgx.Tx, gameID, userID string) (authorizedGameMember, string, int64, error) {
	var ruleSetID, status string
	var revision int64
	if err := tx.QueryRow(ctx, `
		select rule_set_id::text, status, revision from games where id = $1 for update`, gameID,
	).Scan(&ruleSetID, &status, &revision); err != nil {
		return authorizedGameMember{}, "", 0, err
	}
	member, err := requireGameFacilitator(ctx, tx, gameID, userID)
	if err != nil {
		return member, "", 0, err
	}
	if status != "active" {
		return member, "", 0, &statusError{Status: http.StatusConflict, Code: "game_archived", Message: "archived games cannot be changed"}
	}
	return member, ruleSetID, revision, nil
}

func lockCurrentGameEntityIDs(ctx context.Context, tx pgx.Tx, gameID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		select entity_id::text from game_entities
		where game_id = $1 order by entity_id for update`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var entityID string
		if err := rows.Scan(&entityID); err != nil {
			return nil, err
		}
		result = append(result, entityID)
	}
	return result, rows.Err()
}

func gameEntityHasPlayUsage(ctx context.Context, db queryer, gameID, entityID string) (bool, error) {
	var inUse bool
	err := db.QueryRow(ctx, `
		select
			exists(select 1 from interaction_context_entities where game_id = $1 and entity_id = $2)
			or exists(select 1 from interaction_action_submissions where game_id = $1 and acting_entity_id = $2)
			or exists(select 1 from interaction_resolution_effect_targets where game_id = $1 and entity_id = $2)
			or exists(select 1 from interaction_resolution_effect_operands where game_id = $1 and referenced_entity_id = $2)
			or exists(select 1 from interaction_resolution_effect_applications where game_id = $1 and entity_id = $2)
			or exists(select 1 from interaction_resolution_application_values where game_id = $1 and referenced_entity_id = $2)`,
		gameID, entityID,
	).Scan(&inUse)
	return inUse, err
}

func validGameRole(value string) bool {
	return value == "facilitator" || value == "player" || value == "spectator"
}

func validGameMembershipStatus(value string) bool {
	return value == "invited" || value == "active" || value == "left"
}
