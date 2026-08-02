package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Server) registerWorldEntityRoutes() {
	s.api.HandleFunc("GET /api/worlds/{world_id}/entities", s.handleListWorldEntities)
	s.api.HandleFunc("POST /api/worlds/{world_id}/entities", s.handleCreateWorldEntity)
	s.api.HandleFunc("GET /api/worlds/{world_id}/entities/{entity_id}", s.handleGetWorldEntity)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/entities/{entity_id}", s.handlePutWorldEntity)
	s.api.HandleFunc("POST /api/worlds/{world_id}/entities/{entity_id}/archive", s.handleArchiveWorldEntity)
	s.api.HandleFunc("GET /api/worlds/{world_id}/entities/{entity_id}/state", s.handleGetWorldEntityState)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/entities/{entity_id}/state", s.handlePutWorldEntityState)
}

func (s *Server) handleListWorldEntities(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	member, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select entity.id::text
		from game_entities assignment
		join entities entity on entity.id = assignment.entity_id
		where assignment.game_id = $1
		order by entity.archived, lower(entity.display_name), entity.id`, member.PrimaryGameID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	items := make([]worldEntityResponse, 0, len(ids))
	for _, id := range ids {
		item, err := loadWorldEntityResponse(r.Context(), s.db, worldID, member.PrimaryGameID, id)
		if err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWorldEntity(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	member, err := requireWorldEditor(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createWorldEntityRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "display_name", request.DisplayName, 200)
	request.Key = cleanOptional(request.Key)
	if request.Key != nil && !keyPattern.MatchString(*request.Key) {
		fields["key"] = "must start with a letter and use lowercase letters, numbers, dots, dashes, or underscores"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "entity is invalid", fields)
		return
	}
	entityID := request.ID
	if entityID == "" {
		entityID, err = newID()
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
	member, err = requireWorldEditor(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var gameRevision int64
	var gameStatus string
	if err := tx.QueryRow(r.Context(), `
		select revision, status from games where id = $1 for update`, member.PrimaryGameID,
	).Scan(&gameRevision, &gameStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if gameStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into entities (id, rule_set_id, key, display_name, archived)
		values ($1, $2, $3, $4, false)`, entityID, worldID, request.Key, strings.TrimSpace(request.DisplayName)); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into state_records (owner_entity_id, rule_set_id) values ($1, $2)`, entityID, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into game_entities (entity_id, game_id, rule_set_id)
		values ($1, $2, $3)`, entityID, member.PrimaryGameID, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update games set revision = $2 + 1 where id = $1`, member.PrimaryGameID, gameRevision); err != nil {
		handleAppError(w, err)
		return
	}
	var actorGameMembershipID string
	if err := tx.QueryRow(r.Context(), `
		select id::text from game_memberships where game_id = $1 and user_id = $2`, member.PrimaryGameID, member.UserID,
	).Scan(&actorGameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, member.PrimaryGameID, "entity-assigned", actorGameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, worldID, member.PrimaryGameID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/worlds/%s/entities/%s", worldID, entityID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWorldEntity(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	member, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, worldID, member.PrimaryGameID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutWorldEntity(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	member, err := requireWorldEditor(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := requireWorldGameEntity(r.Context(), s.db, member.PrimaryGameID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	var request createWorldEntityRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != entityID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	current, err := s.loadEntity(r.Context(), worldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	request.Key = cleanOptional(request.Key)
	saved, err := s.saveEntity(r.Context(), worldID, entityID, saveEntityRequest{
		ID: entityID, Key: request.Key, DisplayName: request.DisplayName,
		OwnerSchemaIDs: []string{}, Archived: current.Archived,
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	_ = saved
	item, err := loadWorldEntityResponse(r.Context(), s.db, worldID, member.PrimaryGameID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveWorldEntity(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	member, err := requireWorldEditor(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := requireWorldGameEntity(r.Context(), s.db, member.PrimaryGameID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := s.db.Exec(r.Context(), `update entities set archived = true where rule_set_id = $1 and id = $2`, worldID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, worldID, member.PrimaryGameID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleGetWorldEntityState(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	member, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	if err := requireWorldGameEntity(r.Context(), s.db, member.PrimaryGameID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	r.SetPathValue("rule_set_id", worldID)
	s.handleGetState(w, r)
}

func (s *Server) handlePutWorldEntityState(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	member, err := requireWorldEditor(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	if err := requireWorldGameEntity(r.Context(), s.db, member.PrimaryGameID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	r.SetPathValue("rule_set_id", worldID)
	s.handlePutState(w, r)
}

func loadWorldEntityResponse(ctx context.Context, db queryer, worldID, gameID, entityID string) (worldEntityResponse, error) {
	var item worldEntityResponse
	if err := requireWorldGameEntity(ctx, db, gameID, entityID); err != nil {
		return item, err
	}
	var stateRevision int64
	err := db.QueryRow(ctx, `
		select entity.id::text, entity.display_name, entity.key, entity.archived,
			state_record.revision, entity.created_at, entity.updated_at
		from entities entity
		join state_records state_record on state_record.owner_entity_id = entity.id
		where entity.rule_set_id = $1 and entity.id = $2`, worldID, entityID,
	).Scan(&item.ID, &item.DisplayName, &item.Key, &item.Archived, &stateRevision, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return item, err
	}
	state, err := loadLogicalStateResponse(ctx, db, worldID, entityID)
	if err != nil {
		return item, err
	}
	item.StateRevision = stateRevision
	item.State = state
	return item, nil
}

func requireWorldGameEntity(ctx context.Context, db queryer, gameID, entityID string) error {
	var exists bool
	err := db.QueryRow(ctx, `
		select exists(select 1 from game_entities where game_id = $1 and entity_id = $2)`, gameID, entityID,
	).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return pgx.ErrNoRows
	}
	return nil
}
