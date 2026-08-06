package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListWorldEntities(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	query := `select entity.id::text from entities entity where entity.world_id = $1`
	args := []any{member.WorldID}
	playStatus, err := membershipPlayStatus(r.Context(), s.db, member.WorldID, member.ID, member.Role, member.Status)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if member.Role == "player" && playStatus != "ready" {
		query += ` and exists (
			select 1 from world_membership_entity_controls control
			where control.world_id = entity.world_id and control.entity_id = entity.id and control.membership_id = $2)`
		args = append(args, member.ID)
	}
	query += ` order by entity.archived, lower(entity.display_name), entity.id`
	rows, err := s.db.Query(r.Context(), query, args...)
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
	for _, entityID := range ids {
		item, err := loadWorldEntityResponse(r.Context(), s.db, member.WorldID, entityID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWorldEntity(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
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
	request.ControllerWorldMembershipIDs = uniqueSorted(request.ControllerWorldMembershipIDs)
	for index, id := range request.ControllerWorldMembershipIDs {
		if !validID(id) {
			fields["controller_world_membership_ids["+strconv.Itoa(index)+"]"] = "must be a UUID"
		}
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
	if err := validateControllerMembershipIDs(r.Context(), tx, member.WorldID, request.ControllerWorldMembershipIDs); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into entities (id, world_id, display_name) values ($1, $2, $3)`,
		entityID, member.WorldID, strings.TrimSpace(request.DisplayName)); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `insert into state_records (entity_id, world_id) values ($1, $2)`, entityID, member.WorldID); err != nil {
		handleAppError(w, err)
		return
	}
	for _, membershipID := range request.ControllerWorldMembershipIDs {
		if _, err := tx.Exec(r.Context(), `
			insert into world_membership_entity_controls (world_id, membership_id, entity_id)
			values ($1, $2, $3)`, member.WorldID, membershipID, entityID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `update worlds set table_revision = table_revision + 1 where id = $1`, member.WorldID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(r.Context(), tx, member.WorldID, "entity-created", member.ID, nil, nil, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", "/api/worlds/"+member.WorldID+"/entities/"+entityID)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWorldEntity(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	entityID := r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	if err := requireEntityStateReadAccess(r.Context(), s.db, member, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutWorldEntity(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	entityID := r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	var request saveWorldEntityRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != entityID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	fields := map[string]string{}
	validateRequired(fields, "display_name", request.DisplayName, 200)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "entity is invalid", fields)
		return
	}
	command, err := s.db.Exec(r.Context(), `
		update entities set display_name = $3, archived = $4 where world_id = $1 and id = $2`,
		member.WorldID, entityID, strings.TrimSpace(request.DisplayName), request.Archived)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() == 0 {
		handleAppError(w, pgx.ErrNoRows)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveWorldEntity(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	entityID := r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	command, err := s.db.Exec(r.Context(), `update entities set archived = true where world_id = $1 and id = $2`, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() == 0 {
		handleAppError(w, pgx.ErrNoRows)
		return
	}
	item, err := loadWorldEntityResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleGetWorldEntityState(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	entityID := r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	if err := requireEntityStateReadAccess(r.Context(), s.db, member, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadLogicalStateResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutWorldEntityState(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	entityID := r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	var request replaceStateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	required := map[string]string{}
	if request.ExpectedRevision == nil {
		required["expected_revision"] = "is required"
	}
	if request.ExpectedRulesRevision == nil {
		required["expected_rules_revision"] = "is required"
	}
	if len(required) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "state is invalid", required)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	if _, err := lockRulesRevision(r.Context(), tx, member.WorldID, request.ExpectedRulesRevision); err != nil {
		handleAppError(w, err)
		return
	}
	mechanics, err := loadWorldMechanics(r.Context(), tx, member.WorldID, "")
	if err != nil {
		handleAppError(w, err)
		return
	}
	definitions := mechanicDefinitions(mechanics)
	values := make(map[rules.ID]rules.StateValue, len(request.Values))
	fields := map[string]string{}
	for mechanicID, value := range request.Values {
		definition, exists := definitions[rules.ID(mechanicID)]
		if !exists {
			fields["values["+mechanicID+"]"] = "mechanic does not exist in this world"
			continue
		}
		if definition.SourceKind != rules.SourceInput {
			fields["values["+mechanicID+"]"] = "derived mechanics are calculated and cannot be stored"
			continue
		}
		converted, err := stateValueDTOToDomain(value)
		if err != nil {
			fields["values["+mechanicID+"]"] = err.Error()
			continue
		}
		for _, item := range rules.ValidateStateValue(definition, converted) {
			fields["values["+mechanicID+"]."+item.Path] = item.Message
		}
		values[rules.ID(mechanicID)] = converted
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "state is invalid", fields)
		return
	}
	proposed := rules.NormalizeStateRecord(rules.StateRecord{EntityID: rules.ID(entityID), Revision: *request.ExpectedRevision, Values: values}, definitions)
	entity, err := loadEntityForRules(r.Context(), tx, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if validation := rules.ValidateStateRecord(proposed, entity, definitions); len(validation) > 0 {
		for _, item := range validation {
			fields[item.Path] = item.Message
		}
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "state is invalid", fields)
		return
	}
	var actual int64
	if err := tx.QueryRow(r.Context(), `
		select revision from state_records where world_id = $1 and entity_id = $2 for update`, member.WorldID, entityID).Scan(&actual); err != nil {
		handleAppError(w, err)
		return
	}
	if actual != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("entity state", *request.ExpectedRevision, actual))
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from state_values where world_id = $1 and entity_id = $2`, member.WorldID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	mechanicIDs := make([]rules.ID, 0, len(proposed.Values))
	for id := range proposed.Values {
		mechanicIDs = append(mechanicIDs, id)
	}
	sort.Slice(mechanicIDs, func(i, j int) bool { return mechanicIDs[i] < mechanicIDs[j] })
	for _, mechanicID := range mechanicIDs {
		if err := insertStateValue(r.Context(), tx, member.WorldID, entityID, mechanicID, proposed.Values[mechanicID]); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `update state_records set revision = revision + 1 where world_id = $1 and entity_id = $2`, member.WorldID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadLogicalStateResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleReplaceWorldEntityControllers(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	entityID := r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	var request replaceWorldEntityControllersRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedTableRevision == nil {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_table_revision is required", map[string]string{"expected_table_revision": "is required"})
		return
	}
	ids := uniqueSorted(request.ControllerWorldMembershipIDs)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	var actual int64
	if err := tx.QueryRow(r.Context(), `select table_revision from worlds where id = $1 for update`, member.WorldID).Scan(&actual); err != nil {
		handleAppError(w, err)
		return
	}
	if actual != *request.ExpectedTableRevision {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "revision_conflict", Message: "world table changed since it was loaded", Fields: map[string]string{"expected_table_revision": stringInt(*request.ExpectedTableRevision), "actual_table_revision": stringInt(actual)}})
		return
	}
	var exists bool
	if err := tx.QueryRow(r.Context(), `select exists(select 1 from entities where world_id = $1 and id = $2)`, member.WorldID, entityID).Scan(&exists); err != nil {
		handleAppError(w, err)
		return
	}
	if !exists {
		handleAppError(w, pgx.ErrNoRows)
		return
	}
	if err := validateControllerMembershipIDs(r.Context(), tx, member.WorldID, ids); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from world_membership_entity_controls where world_id = $1 and entity_id = $2`, member.WorldID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	for _, membershipID := range ids {
		if _, err := tx.Exec(r.Context(), `insert into world_membership_entity_controls (world_id, membership_id, entity_id) values ($1, $2, $3)`, member.WorldID, membershipID, entityID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `update worlds set table_revision = table_revision + 1 where id = $1`, member.WorldID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(r.Context(), tx, member.WorldID, "entity-control-updated", member.ID, nil, nil, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, worldEntityControllersResponse{EntityID: entityID, ControllerWorldMembershipIDs: ids, TableRevision: actual + 1})
}

func validateControllerMembershipIDs(ctx context.Context, db queryer, worldID string, ids []string) error {
	for index, id := range ids {
		if !validID(id) {
			return &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "controllers are invalid", Fields: map[string]string{"controller_world_membership_ids[" + stringInt(int64(index)) + "]": "must be a UUID"}}
		}
		var valid bool
		if err := db.QueryRow(ctx, `
			select exists(select 1 from world_memberships
			where world_id = $1 and id = $2 and role = 'player' and status = 'active')`, worldID, id).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return &statusError{Status: http.StatusUnprocessableEntity, Code: "invalid_reference", Message: "controller must be an active player in this world"}
		}
	}
	return nil
}

func requireEntityStateReadAccess(ctx context.Context, db queryer, member authorizedWorldMember, entityID string) error {
	var exists bool
	if err := db.QueryRow(ctx, `select exists(select 1 from entities where world_id = $1 and id = $2)`, member.WorldID, entityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return pgx.ErrNoRows
	}
	if member.Role != "player" {
		return nil
	}
	playStatus, err := membershipPlayStatus(ctx, db, member.WorldID, member.ID, member.Role, member.Status)
	if err != nil {
		return err
	}
	if playStatus == "ready" {
		return nil
	}
	var controlled bool
	if err := db.QueryRow(ctx, `
		select exists(select 1 from world_membership_entity_controls
		where world_id = $1 and membership_id = $2 and entity_id = $3)`, member.WorldID, member.ID, entityID,
	).Scan(&controlled); err != nil {
		return err
	}
	if !controlled {
		return &statusError{Status: http.StatusForbidden, Code: "character_setup_required", Message: "complete a controlled character before reading the full world state"}
	}
	return nil
}

func loadWorldEntityResponse(ctx context.Context, db queryer, worldID, entityID string) (worldEntityResponse, error) {
	var item worldEntityResponse
	err := db.QueryRow(ctx, `
			select entity.id::text, entity.display_name, entity.archived, state.revision, statuses.revision,
				entity.created_at, entity.updated_at
			from entities entity
			join state_records state on state.entity_id = entity.id and state.world_id = entity.world_id
			join entity_status_sets statuses on statuses.entity_id = entity.id and statuses.world_id = entity.world_id
			where entity.world_id = $1 and entity.id = $2`, worldID, entityID,
	).Scan(&item.ID, &item.DisplayName, &item.Archived, &item.StateRevision, &item.StatusRevision, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return item, err
	}
	item.State, err = loadLogicalStateResponse(ctx, db, worldID, entityID)
	if err != nil {
		return item, err
	}
	item.CharacterStatus, item.RequiredFieldCount, item.CompletedFieldCount, err = entityCharacterStatus(ctx, db, worldID, entityID)
	return item, err
}

func loadLogicalStateResponse(ctx context.Context, db queryer, worldID, entityID string) (stateRecordResponse, error) {
	return loadEvaluatedStateResponse(ctx, db, worldID, entityID)
}

func loadStoredStateRecord(ctx context.Context, db queryer, worldID, entityID string) (rules.StateRecord, error) {
	result := rules.StateRecord{EntityID: rules.ID(entityID), Values: make(map[rules.ID]rules.StateValue)}
	if err := db.QueryRow(ctx, `select revision, updated_at from state_records where world_id = $1 and entity_id = $2`, worldID, entityID).Scan(&result.Revision, &result.UpdatedAt); err != nil {
		return result, err
	}
	rows, err := db.Query(ctx, `
		select mechanic_id::text, value_kind, number_value::text, boolean_value
		from state_values where world_id = $1 and entity_id = $2 order by mechanic_id`, worldID, entityID)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var mechanicID, kind string
		var number *string
		var boolean *bool
		if err := rows.Scan(&mechanicID, &kind, &number, &boolean); err != nil {
			return result, err
		}
		if kind == "number" && number != nil {
			value, err := rules.ParseDecimal(*number)
			if err != nil {
				return result, err
			}
			result.Values[rules.ID(mechanicID)] = rules.NewNumberValue(value)
		} else if kind == "boolean" && boolean != nil {
			result.Values[rules.ID(mechanicID)] = rules.NewBooleanValue(*boolean)
		}
	}
	return result, rows.Err()
}

func stateValueDTOToDomain(value stateValueDTO) (rules.StateValue, error) {
	switch value.Kind {
	case "number":
		if value.Number == nil {
			return rules.StateValue{}, errors.New("number value is required")
		}
		parsed, err := rules.ParseDecimal(value.Number.String())
		if err != nil {
			return rules.StateValue{}, errors.New("number must be a finite exact decimal")
		}
		return rules.NewNumberValue(parsed), nil
	case "boolean":
		if value.Boolean == nil {
			return rules.StateValue{}, errors.New("boolean value is required")
		}
		return rules.NewBooleanValue(*value.Boolean), nil
	default:
		return rules.StateValue{}, errors.New("value must be number or boolean")
	}
}

func stateValueDomainToDTO(value rules.StateValue) stateValueDTO {
	if value.Kind == rules.ValueNumber && value.Number != nil {
		number := jsonNumber(value.Number.String())
		return stateValueDTO{Kind: "number", Number: &number}
	}
	if value.Kind == rules.ValueBoolean && value.Boolean != nil {
		boolean := *value.Boolean
		return stateValueDTO{Kind: "boolean", Boolean: &boolean}
	}
	return stateValueDTO{}
}

func insertStateValue(ctx context.Context, tx pgx.Tx, worldID, entityID string, mechanicID rules.ID, value rules.StateValue) error {
	var number, boolean any
	if value.Kind == rules.ValueNumber && value.Number != nil {
		number = value.Number.String()
	} else if value.Kind == rules.ValueBoolean && value.Boolean != nil {
		boolean = *value.Boolean
	}
	_, err := tx.Exec(ctx, `
		insert into state_values (entity_id, world_id, mechanic_id, value_kind, number_value, boolean_value)
		values ($1, $2, $3, $4, $5, $6)`, entityID, worldID, mechanicID, value.Kind, number, boolean)
	return err
}

func jsonNumber(value string) json.Number { return json.Number(value) }

func stringInt(value int64) string { return strconv.FormatInt(value, 10) }
