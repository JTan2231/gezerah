package app

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/JTan2231/wrought/internal/rules"

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
	if member.Role == "player" && !member.Facilitator && playStatus != "ready" {
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
	defer rollbackTx(r.Context(), tx)
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
	if _, err := tx.Exec(r.Context(), `insert into entity_logical_states (entity_id, world_id) values ($1, $2)`, entityID, member.WorldID); err != nil {
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
	if _, err := tx.Exec(r.Context(), `update worlds set roster_revision = roster_revision + 1 where id = $1`, member.WorldID); err != nil {
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
	w.Header().Set("Location", publicProductPath("/api/worlds/"+member.WorldID+"/entities/"+entityID))
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
	if err := requireEntitySheetReadAccess(r.Context(), s.db, member, entityID); err != nil {
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
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var archived bool
	if err := tx.QueryRow(r.Context(), `
		select archived from entities where world_id = $1 and id = $2 for update`,
		member.WorldID, entityID).Scan(&archived); err != nil {
		handleAppError(w, err)
		return
	}
	if archived {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "entity_archived",
			Message: "archived entities cannot be changed",
		})
		return
	}
	command, err := tx.Exec(r.Context(), `
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
	item, err := loadWorldEntityResponse(r.Context(), tx, member.WorldID, entityID)
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

func (s *Server) handleGetWorldEntitySheet(w http.ResponseWriter, r *http.Request) {
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
	if err := requireEntitySheetReadAccess(r.Context(), s.db, member, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadEntitySheetResponse(r.Context(), s.db, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutWorldEntityLogicalState(w http.ResponseWriter, r *http.Request) {
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
	var request replaceEntityLogicalStateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	required := map[string]string{}
	if request.ExpectedLogicalStateRevision == nil {
		required["expected_logical_state_revision"] = "is required"
	}
	if request.ExpectedRulesRevision == nil {
		required["expected_rules_revision"] = "is required"
	}
	if len(required) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "logical state is invalid", required)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
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
	logicalInputValues := make(map[rules.ID]rules.MechanicValue, len(request.LogicalInputValues))
	fields := map[string]string{}
	for mechanicID, value := range request.LogicalInputValues {
		definition, exists := definitions[rules.ID(mechanicID)]
		if !exists {
			fields["logical_input_values["+mechanicID+"]"] = "mechanic does not exist in this world"
			continue
		}
		if definition.SourceKind != rules.SourceInput {
			fields["logical_input_values["+mechanicID+"]"] = "derived mechanics are expression-evaluated and cannot own stored overrides"
			continue
		}
		converted, err := mechanicValueDTOToDomain(value)
		if err != nil {
			fields["logical_input_values["+mechanicID+"]"] = err.Error()
			continue
		}
		for _, item := range rules.ValidateMechanicValue(definition, converted) {
			fields["logical_input_values["+mechanicID+"]."+item.Path] = item.Message
		}
		logicalInputValues[rules.ID(mechanicID)] = converted
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "logical state is invalid", fields)
		return
	}
	proposed := rules.NormalizeInputOverrideRecord(rules.InputOverrideRecord{
		EntityID: rules.ID(entityID), Revision: *request.ExpectedLogicalStateRevision,
		Overrides: logicalInputValues,
	}, definitions)
	entity, err := loadEntityForRules(r.Context(), tx, member.WorldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if validation := rules.ValidateInputOverrideRecord(proposed, entity, definitions); len(validation) > 0 {
		for _, item := range validation {
			fields[item.Path] = item.Message
		}
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "logical state is invalid", fields)
		return
	}
	var actual int64
	if err := tx.QueryRow(r.Context(), `
		select revision from entity_logical_states where world_id = $1 and entity_id = $2 for update`, member.WorldID, entityID).Scan(&actual); err != nil {
		handleAppError(w, err)
		return
	}
	if actual != *request.ExpectedLogicalStateRevision {
		handleAppError(w, revisionConflict("entity logical state", *request.ExpectedLogicalStateRevision, actual))
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from entity_input_value_overrides where world_id = $1 and entity_id = $2`, member.WorldID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	mechanicIDs := make([]rules.ID, 0, len(proposed.Overrides))
	for id := range proposed.Overrides {
		mechanicIDs = append(mechanicIDs, id)
	}
	sort.Slice(mechanicIDs, func(i, j int) bool { return mechanicIDs[i] < mechanicIDs[j] })
	for _, mechanicID := range mechanicIDs {
		if err := insertInputValueOverride(r.Context(), tx, member.WorldID, entityID, mechanicID, proposed.Overrides[mechanicID]); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `update entity_logical_states set revision = revision + 1 where world_id = $1 and entity_id = $2`, member.WorldID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadEntitySheetResponse(r.Context(), s.db, member.WorldID, entityID)
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
	if request.ExpectedRosterRevision == nil {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_roster_revision is required", map[string]string{"expected_roster_revision": "is required"})
		return
	}
	ids := uniqueSorted(request.ControllerWorldMembershipIDs)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var actual int64
	if err := tx.QueryRow(r.Context(), `select roster_revision from worlds where id = $1 for update`, member.WorldID).Scan(&actual); err != nil {
		handleAppError(w, err)
		return
	}
	if actual != *request.ExpectedRosterRevision {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "revision_conflict", Message: "world roster changed since it was loaded", Fields: map[string]string{"expected_roster_revision": stringInt(*request.ExpectedRosterRevision), "actual_roster_revision": stringInt(actual)}})
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
	if _, err := tx.Exec(r.Context(), `update worlds set roster_revision = roster_revision + 1 where id = $1`, member.WorldID); err != nil {
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
	writeJSON(w, http.StatusOK, worldEntityControllersResponse{EntityID: entityID, ControllerWorldMembershipIDs: ids, RosterRevision: actual + 1})
}

func validateControllerMembershipIDs(ctx context.Context, db queryer, worldID string, ids []string) error {
	for index, id := range ids {
		if !validID(id) {
			return &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "controllers are invalid", Fields: map[string]string{"controller_world_membership_ids[" + stringInt(int64(index)) + "]": "must be a UUID"}}
		}
		var valid bool
		if err := db.QueryRow(ctx, `
			select exists(select 1 from world_memberships
				where world_id = $1 and id = $2 and role <> 'spectator' and status = 'active')`, worldID, id).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return &statusError{Status: http.StatusUnprocessableEntity, Code: "invalid_reference", Message: "controller must be an active non-spectator member of this world"}
		}
	}
	return nil
}

func requireEntitySheetReadAccess(ctx context.Context, db queryer, member authorizedWorldMember, entityID string) error {
	var exists bool
	if err := db.QueryRow(ctx, `select exists(select 1 from entities where world_id = $1 and id = $2)`, member.WorldID, entityID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return pgx.ErrNoRows
	}
	if member.Role != "player" || member.Facilitator {
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
		return &statusError{Status: http.StatusForbidden, Code: "character_setup_required", Message: "complete a controlled character before reading the full Entity sheet"}
	}
	return nil
}

func loadWorldEntityResponse(ctx context.Context, db queryer, worldID, entityID string) (worldEntityResponse, error) {
	var item worldEntityResponse
	err := db.QueryRow(ctx, `
			select entity.id::text, entity.display_name, entity.archived,
				entity.created_at, entity.updated_at
			from entities entity
			where entity.world_id = $1 and entity.id = $2`, worldID, entityID,
	).Scan(&item.ID, &item.DisplayName, &item.Archived, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return item, err
	}
	item.Sheet, err = loadEntitySheetResponse(ctx, db, worldID, entityID)
	if err != nil {
		return item, err
	}
	item.CharacterStatus, item.RequiredFieldCount, item.CompletedFieldCount, err = entityCharacterStatus(ctx, db, worldID, entityID)
	return item, err
}

func loadEntitySheetResponse(ctx context.Context, db queryer, worldID, entityID string) (entitySheetResponse, error) {
	return loadGeneratedEntitySheet(ctx, db, worldID, entityID)
}

func loadInputOverrideRecord(ctx context.Context, db queryer, worldID, entityID string) (rules.InputOverrideRecord, error) {
	result := rules.InputOverrideRecord{EntityID: rules.ID(entityID), Overrides: make(map[rules.ID]rules.MechanicValue)}
	if err := db.QueryRow(ctx, `select revision from entity_logical_states where world_id = $1 and entity_id = $2`, worldID, entityID).Scan(&result.Revision); err != nil {
		return result, err
	}
	rows, err := db.Query(ctx, `
		select mechanic_id::text, value_kind, number_value::text, boolean_value
		from entity_input_value_overrides where world_id = $1 and entity_id = $2 order by mechanic_id`, worldID, entityID)
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
			result.Overrides[rules.ID(mechanicID)] = rules.NewNumberMechanicValue(value)
		} else if kind == "boolean" && boolean != nil {
			result.Overrides[rules.ID(mechanicID)] = rules.NewBooleanMechanicValue(*boolean)
		}
	}
	return result, rows.Err()
}

func mechanicValueDTOToDomain(value mechanicValueDTO) (rules.MechanicValue, error) {
	switch value.Kind {
	case "number":
		if value.Number == nil {
			return rules.MechanicValue{}, errors.New("number value is required")
		}
		parsed, err := value.Number.Decimal()
		if err != nil {
			return rules.MechanicValue{}, errors.New("number must be a finite exact decimal")
		}
		return rules.NewNumberMechanicValue(parsed), nil
	case "boolean":
		if value.Boolean == nil {
			return rules.MechanicValue{}, errors.New("boolean value is required")
		}
		return rules.NewBooleanMechanicValue(*value.Boolean), nil
	default:
		return rules.MechanicValue{}, errors.New("value must be number or boolean")
	}
}

func mechanicValueDomainToDTO(value rules.MechanicValue) mechanicValueDTO {
	if value.Kind == rules.ValueNumber && value.Number != nil {
		number := decimalTextFromDomain(*value.Number)
		return mechanicValueDTO{Kind: "number", Number: &number}
	}
	if value.Kind == rules.ValueBoolean && value.Boolean != nil {
		boolean := *value.Boolean
		return mechanicValueDTO{Kind: "boolean", Boolean: &boolean}
	}
	return mechanicValueDTO{}
}

func insertInputValueOverride(ctx context.Context, tx pgx.Tx, worldID, entityID string, mechanicID rules.ID, value rules.MechanicValue) error {
	var number, boolean any
	if value.Kind == rules.ValueNumber && value.Number != nil {
		number = value.Number.String()
	} else if value.Kind == rules.ValueBoolean && value.Boolean != nil {
		boolean = *value.Boolean
	}
	_, err := tx.Exec(ctx, `
		insert into entity_input_value_overrides (entity_id, world_id, mechanic_id, value_kind, number_value, boolean_value)
		values ($1, $2, $3, $4, $5, $6)`, entityID, worldID, mechanicID, value.Kind, number, boolean)
	return err
}

func stringInt(value int64) string { return strconv.FormatInt(value, 10) }
