package app

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	keyPattern  = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`)
)

func (s *Server) registerResourceRoutes() {
	s.api.HandleFunc("GET /api/rule-sets", s.handleListRuleSets)
	s.api.HandleFunc("POST /api/rule-sets", s.handleCreateRuleSet)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}", s.handleGetRuleSet)
	s.api.HandleFunc("PATCH /api/rule-sets/{rule_set_id}", s.handlePatchRuleSet)

	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/owner-schemas", s.handleListOwnerSchemas)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/owner-schemas", s.handleCreateOwnerSchema)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}", s.handleGetOwnerSchema)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}", s.handlePutOwnerSchema)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/owner-schemas/{owner_schema_id}/archive", s.handleArchiveOwnerSchema)

	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/entities", s.handleListEntities)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/entities", s.handleCreateEntity)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/entities/{entity_id}", s.handleGetEntity)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/entities/{entity_id}", s.handlePutEntity)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/entities/{entity_id}/archive", s.handleArchiveEntity)

	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/state-variable-definitions", s.handleListStateVariables)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/state-variable-definitions", s.handleCreateStateVariable)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}", s.handleGetStateVariable)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}", s.handlePutStateVariable)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/state-variable-definitions/{definition_id}/archive", s.handleArchiveStateVariable)

	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/entities/{entity_id}/state", s.handleGetState)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/entities/{entity_id}/state", s.handlePutState)

	s.registerConditionRoutes()
	s.registerProblemRoutes()
	s.registerPlayFoundationRoutes()
}

func (s *Server) handleListRuleSets(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
		select id::text, key, name, description, created_at, updated_at
		from rule_sets order by lower(name), id limit 500`)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()

	items := make([]ruleSetResponse, 0)
	for rows.Next() {
		var item ruleSetResponse
		if err := rows.Scan(&item.ID, &item.Key, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt); err != nil {
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

func (s *Server) handleCreateRuleSet(w http.ResponseWriter, r *http.Request) {
	var request createRuleSetRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if fields := validateRuleSet(request.ID, request.Key, request.Name); len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "ruleset is invalid", fields)
		return
	}
	request.Description = cleanOptional(request.Description)

	var item ruleSetResponse
	err := s.db.QueryRow(r.Context(), `
		insert into rule_sets (id, key, name, description)
		values (coalesce(nullif($1, '')::uuid, gen_random_uuid()), $2, $3, $4)
		returning id::text, key, name, description, created_at, updated_at`,
		request.ID, strings.TrimSpace(request.Key), strings.TrimSpace(request.Name), request.Description,
	).Scan(&item.ID, &item.Key, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", "/api/rule-sets/"+item.ID)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetRuleSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	item, err := loadRuleSet(r.Context(), s, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePatchRuleSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request patchRuleSetRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != ruleSetID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	current, err := loadRuleSet(r.Context(), s, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if request.Key != nil {
		current.Key = strings.TrimSpace(*request.Key)
	}
	if request.Name != nil {
		current.Name = strings.TrimSpace(*request.Name)
	}
	if request.Description != nil {
		current.Description = cleanOptional(request.Description)
	}
	if fields := validateRuleSet(ruleSetID, current.Key, current.Name); len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "ruleset is invalid", fields)
		return
	}
	err = s.db.QueryRow(r.Context(), `
		update rule_sets set key = $2, name = $3, description = $4
		where id = $1
		returning id::text, key, name, description, created_at, updated_at`,
		ruleSetID, current.Key, current.Name, current.Description,
	).Scan(&current.ID, &current.Key, &current.Name, &current.Description, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, current)
}

func loadRuleSet(ctx context.Context, s *Server, id string) (ruleSetResponse, error) {
	var item ruleSetResponse
	err := s.db.QueryRow(ctx, `
		select id::text, key, name, description, created_at, updated_at
		from rule_sets where id = $1`, id,
	).Scan(&item.ID, &item.Key, &item.Name, &item.Description, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Server) handleListOwnerSchemas(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	archived := strings.TrimSpace(r.URL.Query().Get("archived"))
	query := `select id::text, key, label, description, archived, created_at, updated_at
		from state_owner_schemas where rule_set_id = $1`
	args := []any{ruleSetID}
	if archived == "false" || archived == "true" {
		query += ` and archived = $2`
		args = append(args, archived == "true")
	}
	query += ` order by archived, lower(label), id limit 1000`
	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()
	items := make([]ownerSchemaResponse, 0)
	for rows.Next() {
		var item ownerSchemaResponse
		if err := rows.Scan(&item.ID, &item.Key, &item.Label, &item.Description, &item.Archived, &item.CreatedAt, &item.UpdatedAt); err != nil {
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

func (s *Server) handleCreateOwnerSchema(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request saveOwnerSchemaRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Archived = false
	item, err := s.saveOwnerSchema(r.Context(), ruleSetID, "", request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/owner-schemas/%s", ruleSetID, item.ID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetOwnerSchema(w http.ResponseWriter, r *http.Request) {
	ruleSetID, schemaID := r.PathValue("rule_set_id"), r.PathValue("owner_schema_id")
	if !validID(ruleSetID) || !validID(schemaID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	item, err := s.loadOwnerSchema(r.Context(), ruleSetID, schemaID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutOwnerSchema(w http.ResponseWriter, r *http.Request) {
	ruleSetID, schemaID := r.PathValue("rule_set_id"), r.PathValue("owner_schema_id")
	if !validID(ruleSetID) || !validID(schemaID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request saveOwnerSchemaRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != schemaID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	item, err := s.saveOwnerSchema(r.Context(), ruleSetID, schemaID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveOwnerSchema(w http.ResponseWriter, r *http.Request) {
	ruleSetID, schemaID := r.PathValue("rule_set_id"), r.PathValue("owner_schema_id")
	if !validID(ruleSetID) || !validID(schemaID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var item ownerSchemaResponse
	err := s.db.QueryRow(r.Context(), `
		update state_owner_schemas set archived = true
		where rule_set_id = $1 and id = $2
		returning id::text, key, label, description, archived, created_at, updated_at`, ruleSetID, schemaID,
	).Scan(&item.ID, &item.Key, &item.Label, &item.Description, &item.Archived, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) saveOwnerSchema(ctx context.Context, ruleSetID, schemaID string, request saveOwnerSchemaRequest) (ownerSchemaResponse, error) {
	var item ownerSchemaResponse
	if fields := validateOwnerSchema(request.ID, request.Key, request.Label); len(fields) > 0 {
		return item, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "owner schema is invalid", Fields: fields}
	}
	request.Description = cleanOptional(request.Description)
	if schemaID == "" {
		err := s.db.QueryRow(ctx, `
			insert into state_owner_schemas (id, rule_set_id, key, label, description, archived)
			values (coalesce(nullif($1, '')::uuid, gen_random_uuid()), $2, $3, $4, $5, false)
			returning id::text, key, label, description, archived, created_at, updated_at`,
			request.ID, ruleSetID, strings.TrimSpace(request.Key), strings.TrimSpace(request.Label), request.Description,
		).Scan(&item.ID, &item.Key, &item.Label, &item.Description, &item.Archived, &item.CreatedAt, &item.UpdatedAt)
		return item, err
	}
	err := s.db.QueryRow(ctx, `
		update state_owner_schemas set key = $3, label = $4, description = $5, archived = $6
		where rule_set_id = $1 and id = $2
		returning id::text, key, label, description, archived, created_at, updated_at`,
		ruleSetID, schemaID, strings.TrimSpace(request.Key), strings.TrimSpace(request.Label), request.Description, request.Archived,
	).Scan(&item.ID, &item.Key, &item.Label, &item.Description, &item.Archived, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Server) loadOwnerSchema(ctx context.Context, ruleSetID, schemaID string) (ownerSchemaResponse, error) {
	var item ownerSchemaResponse
	err := s.db.QueryRow(ctx, `
		select id::text, key, label, description, archived, created_at, updated_at
		from state_owner_schemas where rule_set_id = $1 and id = $2`, ruleSetID, schemaID,
	).Scan(&item.ID, &item.Key, &item.Label, &item.Description, &item.Archived, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Server) handleListEntities(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	query := `
		select e.id::text, e.key, e.display_name, e.archived, sr.revision, e.created_at, e.updated_at,
			coalesce(array_agg(eos.owner_schema_id::text order by eos.owner_schema_id)
				filter (where eos.owner_schema_id is not null), '{}'::text[])
		from entities e
		join state_records sr on sr.owner_entity_id = e.id
		left join entity_owner_schemas eos on eos.entity_id = e.id
		where e.rule_set_id = $1`
	args := []any{ruleSetID}
	next := 2
	if archived := r.URL.Query().Get("archived"); archived == "true" || archived == "false" {
		query += fmt.Sprintf(" and e.archived = $%d", next)
		args = append(args, archived == "true")
		next++
	}
	if ownerSchemaID := strings.TrimSpace(r.URL.Query().Get("owner_schema_id")); ownerSchemaID != "" {
		if !validID(ownerSchemaID) {
			writeError(w, http.StatusBadRequest, "invalid_id", "owner schema ID is malformed", nil)
			return
		}
		query += fmt.Sprintf(" and exists (select 1 from entity_owner_schemas f where f.entity_id = e.id and f.owner_schema_id = $%d)", next)
		args = append(args, ownerSchemaID)
		next++
	}
	if search := strings.TrimSpace(r.URL.Query().Get("search")); search != "" {
		if len(search) > 120 {
			writeError(w, http.StatusBadRequest, "invalid_search", "search must be 120 characters or fewer", nil)
			return
		}
		query += fmt.Sprintf(" and e.display_name ilike $%d escape '\\\\'", next)
		args = append(args, "%"+escapeLike(search)+"%")
	}
	query += ` group by e.id, sr.revision order by e.archived, lower(e.display_name), e.id limit 1000`

	rows, err := s.db.Query(r.Context(), query, args...)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()
	items := make([]entityResponse, 0)
	for rows.Next() {
		var item entityResponse
		if err := rows.Scan(&item.ID, &item.Key, &item.DisplayName, &item.Archived, &item.StateRevision, &item.CreatedAt, &item.UpdatedAt, &item.OwnerSchemaIDs); err != nil {
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

func (s *Server) handleCreateEntity(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request saveEntityRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Archived = false
	item, err := s.saveEntity(r.Context(), ruleSetID, "", request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/entities/%s", ruleSetID, item.ID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetEntity(w http.ResponseWriter, r *http.Request) {
	ruleSetID, entityID := r.PathValue("rule_set_id"), r.PathValue("entity_id")
	if !validID(ruleSetID) || !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	item, err := s.loadEntity(r.Context(), ruleSetID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutEntity(w http.ResponseWriter, r *http.Request) {
	ruleSetID, entityID := r.PathValue("rule_set_id"), r.PathValue("entity_id")
	if !validID(ruleSetID) || !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request saveEntityRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != entityID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	item, err := s.saveEntity(r.Context(), ruleSetID, entityID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveEntity(w http.ResponseWriter, r *http.Request) {
	ruleSetID, entityID := r.PathValue("rule_set_id"), r.PathValue("entity_id")
	if !validID(ruleSetID) || !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	if _, err := s.db.Exec(r.Context(), `update entities set archived = true where rule_set_id = $1 and id = $2`, ruleSetID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadEntity(r.Context(), ruleSetID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) saveEntity(ctx context.Context, ruleSetID, entityID string, request saveEntityRequest) (entityResponse, error) {
	var empty entityResponse
	if fields := validateEntity(request); len(fields) > 0 {
		return empty, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "entity is invalid", Fields: fields}
	}
	request.OwnerSchemaIDs = uniqueSorted(request.OwnerSchemaIDs)
	request.Key = cleanOptional(request.Key)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	requestedSchemas := make(map[string]bool, len(request.OwnerSchemaIDs))
	for index, schemaID := range request.OwnerSchemaIDs {
		var archived bool
		err := tx.QueryRow(ctx, `
			select archived from state_owner_schemas
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, schemaID).Scan(&archived)
		if errors.Is(err, pgx.ErrNoRows) {
			return empty, &statusError{
				Status: http.StatusUnprocessableEntity, Code: "invalid_owner_schemas",
				Message: "owner schemas must belong to this ruleset",
				Fields:  map[string]string{fmt.Sprintf("owner_schema_ids[%d]", index): "owner schema does not exist in this ruleset"},
			}
		}
		if err != nil {
			return empty, err
		}
		requestedSchemas[schemaID] = archived
	}

	creating := entityID == ""
	var previousOwnerSchemaIDs []string
	if creating {
		err = tx.QueryRow(ctx, `
			insert into entities (id, rule_set_id, key, display_name, archived)
			values (coalesce(nullif($1, '')::uuid, gen_random_uuid()), $2, $3, $4, false)
			returning id::text`, request.ID, ruleSetID, request.Key, strings.TrimSpace(request.DisplayName)).Scan(&entityID)
		if err != nil {
			return empty, err
		}
		if _, err = tx.Exec(ctx, `insert into state_records (owner_entity_id, rule_set_id) values ($1, $2)`, entityID, ruleSetID); err != nil {
			return empty, err
		}
	} else {
		var exists bool
		if err = tx.QueryRow(ctx, `select true from entities where rule_set_id = $1 and id = $2 for update`, ruleSetID, entityID).Scan(&exists); err != nil {
			return empty, err
		}
		if _, err = tx.Exec(ctx, `select 1 from state_records where rule_set_id = $1 and owner_entity_id = $2 for update`, ruleSetID, entityID); err != nil {
			return empty, err
		}
		rows, queryErr := tx.Query(ctx, `
			select owner_schema_id::text from entity_owner_schemas
			where rule_set_id = $1 and entity_id = $2 order by owner_schema_id`, ruleSetID, entityID)
		if queryErr != nil {
			return empty, queryErr
		}
		for rows.Next() {
			var schemaID string
			if scanErr := rows.Scan(&schemaID); scanErr != nil {
				rows.Close()
				return empty, scanErr
			}
			previousOwnerSchemaIDs = append(previousOwnerSchemaIDs, schemaID)
		}
		if queryErr = rows.Err(); queryErr != nil {
			rows.Close()
			return empty, queryErr
		}
		rows.Close()
		if _, err = tx.Exec(ctx, `update entities set key = $3, display_name = $4, archived = $5 where rule_set_id = $1 and id = $2`, ruleSetID, entityID, request.Key, strings.TrimSpace(request.DisplayName), request.Archived); err != nil {
			return empty, err
		}
	}

	previousSchemas := make(map[string]struct{}, len(previousOwnerSchemaIDs))
	for _, schemaID := range previousOwnerSchemaIDs {
		previousSchemas[schemaID] = struct{}{}
	}
	for index, schemaID := range request.OwnerSchemaIDs {
		if requestedSchemas[schemaID] {
			if _, retained := previousSchemas[schemaID]; !retained {
				return empty, &statusError{
					Status: http.StatusUnprocessableEntity, Code: "archived_reference",
					Message: "archived owner schemas cannot receive new entity memberships",
					Fields:  map[string]string{fmt.Sprintf("owner_schema_ids[%d]", index): "archived owner schema cannot receive a new membership"},
				}
			}
		}
	}
	if _, err = tx.Exec(ctx, `delete from entity_owner_schemas where rule_set_id = $1 and entity_id = $2`, ruleSetID, entityID); err != nil {
		return empty, err
	}
	for _, schemaID := range request.OwnerSchemaIDs {
		if _, err = tx.Exec(ctx, `insert into entity_owner_schemas (entity_id, rule_set_id, owner_schema_id) values ($1, $2, $3)`, entityID, ruleSetID, schemaID); err != nil {
			return empty, err
		}
	}

	if !creating {
		var invalidState bool
		err = tx.QueryRow(ctx, `
			select exists (
				select 1 from state_values sv
				where sv.rule_set_id = $1 and sv.owner_entity_id = $2
				and not exists (
					select 1 from state_variable_owner_schemas vso
					join entity_owner_schemas eos on eos.rule_set_id = vso.rule_set_id
						and eos.owner_schema_id = vso.owner_schema_id and eos.entity_id = sv.owner_entity_id
					where vso.rule_set_id = sv.rule_set_id and vso.state_variable_id = sv.state_variable_id
				)
			)`, ruleSetID, entityID).Scan(&invalidState)
		if err != nil {
			return empty, err
		}
		if invalidState {
			return empty, &statusError{Status: http.StatusConflict, Code: "membership_in_use", Message: "membership removal would make current state ineligible"}
		}

		var invalidBinding bool
		err = tx.QueryRow(ctx, `
			select exists (
				select 1 from problem_instance_target_bindings b
				join problem_target_required_owner_schemas required on required.target_definition_id = b.target_definition_id
				where b.rule_set_id = $1 and b.entity_id = $2
				and not exists (
					select 1 from entity_owner_schemas eos where eos.rule_set_id = b.rule_set_id
						and eos.entity_id = b.entity_id and eos.owner_schema_id = required.owner_schema_id
				)
			)`, ruleSetID, entityID).Scan(&invalidBinding)
		if err != nil {
			return empty, err
		}
		if invalidBinding {
			return empty, &statusError{Status: http.StatusConflict, Code: "membership_in_use", Message: "membership removal would invalidate a problem binding"}
		}

		var invalidInstanceTemplate bool
		err = tx.QueryRow(ctx, `
			select exists (
				select 1 from problem_instances pi
				join problem_definition_instance_owner_schemas required
					on required.rule_set_id = pi.rule_set_id
					and required.problem_definition_id = pi.problem_definition_id
				where pi.rule_set_id = $1 and pi.entity_id = $2
					and not exists (
						select 1 from entity_owner_schemas eos
						where eos.rule_set_id = pi.rule_set_id and eos.entity_id = pi.entity_id
							and eos.owner_schema_id = required.owner_schema_id
					)
			)`, ruleSetID, entityID).Scan(&invalidInstanceTemplate)
		if err != nil {
			return empty, err
		}
		if invalidInstanceTemplate {
			return empty, &statusError{Status: http.StatusConflict, Code: "membership_in_use", Message: "membership removal would invalidate the problem instance schema template"}
		}

		var invalidReference bool
		err = tx.QueryRow(ctx, `
			select exists (
				select 1
				from (
					select state_variable_id, referenced_entity_id
					from state_values where rule_set_id = $1 and referenced_entity_id = $2
					union all
					select state_variable_id, referenced_entity_id
					from state_variable_default_values where rule_set_id = $1 and referenced_entity_id = $2
					union all
					select state_variable_id, referenced_entity_id
					from effect_value_operands where rule_set_id = $1 and referenced_entity_id = $2
				) referenced
				where exists (
					select 1 from state_variable_reference_target_schemas restrictions
					where restrictions.rule_set_id = $1
						and restrictions.state_variable_id = referenced.state_variable_id
				)
				and not exists (
					select 1 from state_variable_reference_target_schemas restrictions
					join entity_owner_schemas eos
						on eos.rule_set_id = restrictions.rule_set_id
						and eos.owner_schema_id = restrictions.owner_schema_id
						and eos.entity_id = referenced.referenced_entity_id
					where restrictions.rule_set_id = $1
						and restrictions.state_variable_id = referenced.state_variable_id
				)
			)`, ruleSetID, entityID).Scan(&invalidReference)
		if err != nil {
			return empty, err
		}
		if invalidReference {
			return empty, &statusError{Status: http.StatusConflict, Code: "membership_in_use", Message: "membership removal would invalidate a stored or configured reference value"}
		}
	}

	if !creating && !equalStrings(previousOwnerSchemaIDs, request.OwnerSchemaIDs) {
		if _, err = tx.Exec(ctx, `
			update state_records set revision = revision + 1
			where rule_set_id = $1 and owner_entity_id = $2`, ruleSetID, entityID); err != nil {
			return empty, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return s.loadEntity(ctx, ruleSetID, entityID)
}

func (s *Server) loadEntity(ctx context.Context, ruleSetID, entityID string) (entityResponse, error) {
	var item entityResponse
	err := s.db.QueryRow(ctx, `
		select e.id::text, e.key, e.display_name, e.archived, sr.revision, e.created_at, e.updated_at,
			coalesce(array_agg(eos.owner_schema_id::text order by eos.owner_schema_id)
				filter (where eos.owner_schema_id is not null), '{}'::text[])
		from entities e
		join state_records sr on sr.owner_entity_id = e.id
		left join entity_owner_schemas eos on eos.entity_id = e.id
		where e.rule_set_id = $1 and e.id = $2
		group by e.id, sr.revision`, ruleSetID, entityID,
	).Scan(&item.ID, &item.Key, &item.DisplayName, &item.Archived, &item.StateRevision, &item.CreatedAt, &item.UpdatedAt, &item.OwnerSchemaIDs)
	return item, err
}

func validateRuleSet(id, key, name string) map[string]string {
	fields := map[string]string{}
	if id != "" && !validID(id) {
		fields["id"] = "must be a UUID"
	}
	validateKey(fields, "key", key)
	validateRequired(fields, "name", name, 200)
	return fields
}

func validateOwnerSchema(id, key, label string) map[string]string {
	fields := map[string]string{}
	if id != "" && !validID(id) {
		fields["id"] = "must be a UUID"
	}
	validateKey(fields, "key", key)
	validateRequired(fields, "label", label, 200)
	return fields
}

func validateEntity(request saveEntityRequest) map[string]string {
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "display_name", request.DisplayName, 200)
	if request.Key != nil && strings.TrimSpace(*request.Key) != "" && !keyPattern.MatchString(strings.TrimSpace(*request.Key)) {
		fields["key"] = "must start with a letter and use lowercase letters, numbers, dots, dashes, or underscores"
	}
	seen := map[string]bool{}
	for index, id := range request.OwnerSchemaIDs {
		if !validID(id) {
			fields[fmt.Sprintf("owner_schema_ids[%d]", index)] = "must be a UUID"
		} else if seen[id] {
			fields[fmt.Sprintf("owner_schema_ids[%d]", index)] = "must not be duplicated"
		}
		seen[id] = true
	}
	return fields
}

func validateKey(fields map[string]string, path, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		fields[path] = "is required"
	} else if len(value) > 120 {
		fields[path] = "must be 120 characters or fewer"
	} else if !keyPattern.MatchString(value) {
		fields[path] = "must start with a letter and use lowercase letters, numbers, dots, dashes, or underscores"
	}
}

func validateRequired(fields map[string]string, path, value string, maximum int) {
	value = strings.TrimSpace(value)
	if value == "" {
		fields[path] = "is required"
	} else if len(value) > maximum {
		fields[path] = fmt.Sprintf("must be %d characters or fewer", maximum)
	}
}

func validID(value string) bool { return uuidPattern.MatchString(value) }

func newID() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", fmt.Errorf("generate UUID: %w", err)
	}
	data[6] = (data[6] & 0x0f) | 0x40
	data[8] = (data[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		data[0:4], data[4:6], data[6:8], data[8:10], data[10:16]), nil
}

func cleanOptional(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	return strings.ReplaceAll(value, `_`, `\_`)
}

type statusError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
}

func (e *statusError) Error() string { return e.Message }

func handleAppError(w http.ResponseWriter, err error) {
	var status *statusError
	if errors.As(err, &status) {
		writeError(w, status.Status, status.Code, status.Message, status.Fields)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found", nil)
		return
	}
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) {
		switch databaseError.Code {
		case "23505":
			writeError(w, http.StatusConflict, "duplicate_key", "a resource with that key or position already exists", nil)
		case "23503":
			writeError(w, http.StatusUnprocessableEntity, "invalid_reference", "a referenced resource does not exist in this ruleset", nil)
		case "23514", "22P02":
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", "resource violates a data constraint", nil)
		default:
			writeError(w, http.StatusInternalServerError, "database_error", "database operation failed", nil)
		}
		return
	}
	writeError(w, http.StatusInternalServerError, "internal_error", "internal server error", nil)
}
