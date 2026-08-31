package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"scryer/internal/rules"

	"github.com/jackc/pgx/v5"
)

type loadedMechanic struct {
	Response   worldMechanicResponse
	Definition rules.MechanicDefinition
	Position   int
}

func (s *Server) handleListWorldMechanics(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	if kind != "" && kind != "capacity" && kind != "capability" {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "mechanic kind is invalid", map[string]string{"kind": "must be capacity or capability"})
		return
	}

	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	revision, err := loadRulesRevision(r.Context(), tx, member.WorldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	items, err := loadWorldMechanics(r.Context(), tx, member.WorldID, kind)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	responses := make([]worldMechanicResponse, len(items))
	for index := range items {
		responses[index] = items[index].Response
	}
	writeJSON(w, http.StatusOK, worldMechanicCollectionResponse{Revision: revision, Mechanics: responses})
}

func (s *Server) handleCreateWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request saveWorldMechanicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	result, err := s.saveWorldMechanic(r.Context(), member.WorldID, "", member.ID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/worlds/%s/mechanics/%s", member.WorldID, result.Mechanic.ID))
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleGetWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	mechanicID := r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}

	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	revision, err := loadRulesRevision(r.Context(), tx, member.WorldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldMechanic(r.Context(), tx, member.WorldID, mechanicID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, worldMechanicMutationResponse{Revision: revision, Mechanic: item.Response})
}

func (s *Server) handlePutWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	mechanicID := r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	var request saveWorldMechanicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != mechanicID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	result, err := s.saveWorldMechanic(r.Context(), member.WorldID, mechanicID, member.ID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleArchiveWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	mechanicID := r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	var request archiveWorldMechanicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	result, err := s.archiveWorldMechanic(r.Context(), member.WorldID, mechanicID, member.ID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) saveWorldMechanic(ctx context.Context, worldID, mechanicID, actorMembershipID string, request saveWorldMechanicRequest) (worldMechanicMutationResponse, error) {
	var zero worldMechanicMutationResponse
	creating := mechanicID == ""
	if creating {
		mechanicID = request.ID
		if mechanicID == "" {
			var err error
			mechanicID, err = newID()
			if err != nil {
				return zero, err
			}
		}
	}
	fields, proposed := validateWorldMechanicRequest(worldID, mechanicID, request)
	if len(fields) > 0 {
		return zero, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "mechanic is invalid", Fields: fields}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer rollbackTx(ctx, tx)
	actualRevision, err := lockRulesRevision(ctx, tx, worldID, request.ExpectedRulesRevision)
	if err != nil {
		return zero, err
	}
	mechanics, err := loadWorldMechanics(ctx, tx, worldID, "")
	if err != nil {
		return zero, err
	}
	definitions := mechanicDefinitions(mechanics)
	var current loadedMechanic
	if !creating {
		var exists bool
		for _, item := range mechanics {
			if item.Response.ID == mechanicID {
				current = item
				exists = true
				break
			}
		}
		if !exists {
			return zero, pgx.ErrNoRows
		}
		if current.Definition.Archived {
			return zero, &statusError{
				Status: http.StatusConflict, Code: "mechanic_archived",
				Message: "archived mechanics cannot be changed",
			}
		}
		if request.Kind != current.Response.Kind {
			return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_kind_fixed", Message: "a mechanic cannot move between capacities and capabilities"}
		}
		if proposed.ValueKind != current.Definition.ValueKind {
			used, err := mechanicValueKindInUse(ctx, tx, worldID, mechanicID)
			if err != nil {
				return zero, err
			}
			if used {
				return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_in_use", Message: "a referenced mechanic cannot change between numeric and Boolean values"}
			}
		}
		if proposed.SourceKind != current.Definition.SourceKind && proposed.SourceKind == rules.SourceDerived {
			var stored bool
			if err := tx.QueryRow(ctx, `select exists(select 1 from entity_input_value_overrides where world_id = $1 and mechanic_id = $2)`, worldID, mechanicID).Scan(&stored); err != nil {
				return zero, err
			}
			if stored {
				return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_in_use", Message: "a mechanic with stored overrides cannot become derived"}
			}
		}
	}
	definitions[proposed.ID] = proposed

	if !creating && !current.Definition.Archived && proposed.Archived && hasActiveMechanicDependents(definitions, proposed.ID) {
		return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_has_dependents", Message: "archive active derived mechanics that depend on this mechanic first"}
	}
	if !creating && !current.Definition.Archived && proposed.Archived {
		dependent, err := hasStatusInstanceMechanicDependency(ctx, tx, worldID, mechanicID)
		if err != nil {
			return zero, err
		}
		if dependent {
			return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_has_active_status_instances", Message: "remove status instances that modify this mechanic before archiving it"}
		}
	}
	if err := validateWorldMechanicGraph(definitions); err != nil {
		return zero, err
	}
	if !creating && proposed.SourceKind == rules.SourceInput {
		if err := validateAndNormalizeInputValueOverrides(ctx, tx, worldID, proposed); err != nil {
			return zero, err
		}
	}

	request.Description = cleanOptional(request.Description)
	request.Unit = cleanOptional(request.Unit)
	if creating {
		var position int
		if err := tx.QueryRow(ctx, `select coalesce(max(position), -1) + 1 from world_mechanics where world_id = $1 and kind = $2`, worldID, request.Kind).Scan(&position); err != nil {
			return zero, err
		}
		if err := insertWorldMechanic(ctx, tx, request, proposed, position); err != nil {
			return zero, err
		}
	} else {
		if _, err := tx.Exec(ctx, `delete from world_mechanic_expression_nodes where world_id = $1 and mechanic_id = $2`, worldID, mechanicID); err != nil {
			return zero, err
		}
		if err := updateWorldMechanic(ctx, tx, request, proposed); err != nil {
			return zero, err
		}
	}
	if proposed.SourceKind == rules.SourceDerived && proposed.Expression != nil {
		if err := insertMechanicExpression(ctx, tx, proposed, definitions); err != nil {
			return zero, err
		}
	}
	revision, err := advanceRulesRevision(ctx, tx, worldID, actorMembershipID, actualRevision)
	if err != nil {
		return zero, err
	}
	item, err := loadWorldMechanic(ctx, tx, worldID, mechanicID)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	return worldMechanicMutationResponse{Revision: revision, Mechanic: item.Response}, nil
}

func (s *Server) archiveWorldMechanic(ctx context.Context, worldID, mechanicID, actorMembershipID string, request archiveWorldMechanicRequest) (worldMechanicMutationResponse, error) {
	var zero worldMechanicMutationResponse
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer rollbackTx(ctx, tx)
	actualRevision, err := lockRulesRevision(ctx, tx, worldID, request.ExpectedRulesRevision)
	if err != nil {
		return zero, err
	}
	mechanics, err := loadWorldMechanics(ctx, tx, worldID, "")
	if err != nil {
		return zero, err
	}
	definitions := mechanicDefinitions(mechanics)
	current, exists := definitions[rules.ID(mechanicID)]
	if !exists {
		return zero, pgx.ErrNoRows
	}
	if current.Archived {
		item, err := loadWorldMechanic(ctx, tx, worldID, mechanicID)
		if err != nil {
			return zero, err
		}
		if err := tx.Commit(ctx); err != nil {
			return zero, err
		}
		return worldMechanicMutationResponse{Revision: actualRevision, Mechanic: item.Response}, nil
	}
	current.Archived = true
	definitions[current.ID] = current
	if hasActiveMechanicDependents(definitions, current.ID) {
		return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_has_dependents", Message: "archive active derived mechanics that depend on this mechanic first"}
	}
	dependent, err := hasStatusInstanceMechanicDependency(ctx, tx, worldID, mechanicID)
	if err != nil {
		return zero, err
	}
	if dependent {
		return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_has_active_status_instances", Message: "remove status instances that modify this mechanic before archiving it"}
	}
	if err := validateWorldMechanicGraph(definitions); err != nil {
		return zero, err
	}
	if _, err := tx.Exec(ctx, `update world_mechanics set archived = true where world_id = $1 and id = $2`, worldID, mechanicID); err != nil {
		return zero, err
	}
	revision, err := advanceRulesRevision(ctx, tx, worldID, actorMembershipID, actualRevision)
	if err != nil {
		return zero, err
	}
	item, err := loadWorldMechanic(ctx, tx, worldID, mechanicID)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	return worldMechanicMutationResponse{Revision: revision, Mechanic: item.Response}, nil
}

func validateWorldMechanicRequest(worldID, mechanicID string, request saveWorldMechanicRequest) (map[string]string, rules.MechanicDefinition) {
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "name", request.Name, 200)
	validMode := (request.Kind == "capacity" && (request.Mode == "score" || request.Mode == "pool")) ||
		(request.Kind == "capability" && (request.Mode == "binary" || request.Mode == "rating"))
	if !validMode {
		fields["mode"] = "must be a mode belonging to the selected mechanic kind"
	}
	definition := rules.MechanicDefinition{
		ID: rules.ID(mechanicID), WorldID: rules.ID(worldID), SourceKind: rules.SourceKind(request.SourceKind),
		Mutable: request.MutableDuringPlay, Archived: request.Archived,
	}
	if request.Mode == "binary" {
		definition.ValueKind = rules.ValueBoolean
		if definition.SourceKind == rules.SourceInput {
			definition.DefaultValue = rules.NewBooleanMechanicValue(false)
		}
		if request.Minimum != nil || request.Maximum != nil || request.Step != nil || request.DefaultNumber != nil || request.Unit != nil {
			fields["mode"] = "binary mechanics cannot declare numeric settings"
		}
	} else {
		definition.ValueKind = rules.ValueNumber
		if request.DefaultNumber == nil {
			if definition.SourceKind == rules.SourceInput {
				fields["default_number"] = "is required"
			}
		} else if value, err := request.DefaultNumber.Decimal(); err != nil {
			fields["default_number"] = "must be a finite exact decimal"
		} else {
			definition.DefaultValue = rules.NewNumberMechanicValue(value)
		}
		for path, source := range map[string]*decimalText{"minimum": request.Minimum, "maximum": request.Maximum, "step": request.Step} {
			if source == nil {
				continue
			}
			parsed, err := source.Decimal()
			if err != nil {
				fields[path] = "must be a finite exact decimal"
				continue
			}
			switch path {
			case "minimum":
				definition.Minimum = &parsed
			case "maximum":
				definition.Maximum = &parsed
			case "step":
				definition.Step = &parsed
			}
		}
	}
	if request.Expression != nil {
		validateExpressionReferenceIDs(*request.Expression, "expression", fields)
		expression, err := expressionDTOToDomain(*request.Expression)
		if err != nil {
			fields["expression"] = err.Error()
		} else {
			definition.Expression = &expression
		}
	}
	for _, item := range rules.ValidateMechanicDefinition(definition) {
		fields[mechanicRequestValidationPath(item.Path)] = item.Message
	}
	return fields, definition
}

func mechanicRequestValidationPath(path string) string {
	if strings.HasPrefix(path, "default_value") {
		return "default_number"
	}
	if path == "mutable" {
		return "mutable_during_play"
	}
	return path
}

func validateExpressionReferenceIDs(expression expressionDTO, path string, fields map[string]string) {
	if expression.MechanicID != "" && !validID(expression.MechanicID) {
		fields[path+".mechanic_id"] = "must be a UUID"
	}
	for index, operand := range expression.Operands {
		validateExpressionReferenceIDs(operand, fmt.Sprintf("%s.operands[%d]", path, index), fields)
	}
}

func expressionDTOToDomain(source expressionDTO) (rules.Expression, error) {
	result := rules.Expression{Operation: rules.ExpressionOperation(source.Operation), MechanicID: rules.ID(source.MechanicID)}
	if source.Value != nil {
		value, err := mechanicValueDTOToDomain(*source.Value)
		if err != nil {
			return rules.Expression{}, err
		}
		result.Literal = &value
	}
	result.Operands = make([]rules.Expression, len(source.Operands))
	for index, operand := range source.Operands {
		converted, err := expressionDTOToDomain(operand)
		if err != nil {
			return rules.Expression{}, fmt.Errorf("operand %d: %w", index, err)
		}
		result.Operands[index] = converted
	}
	return result, nil
}

func expressionDomainToDTO(source rules.Expression) expressionDTO {
	result := expressionDTO{Operation: string(source.Operation), MechanicID: string(source.MechanicID), Operands: make([]expressionDTO, len(source.Operands))}
	if source.Literal != nil {
		value := mechanicValueDomainToDTO(*source.Literal)
		result.Value = &value
	}
	for index, operand := range source.Operands {
		result.Operands[index] = expressionDomainToDTO(operand)
	}
	return result
}

func validateWorldMechanicGraph(mechanics map[rules.ID]rules.MechanicDefinition) error {
	errs := rules.ValidateMechanicGraph(mechanics)
	if len(errs) == 0 {
		return nil
	}
	fields := make(map[string]string, len(errs))
	for _, item := range errs {
		fields[item.Path] = item.Message
	}
	return &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "world mechanic graph is invalid", Fields: fields}
}

func hasActiveMechanicDependents(mechanics map[rules.ID]rules.MechanicDefinition, target rules.ID) bool {
	for id, definition := range mechanics {
		if id == target || definition.Archived || definition.Expression == nil {
			continue
		}
		if expressionReferencesMechanic(*definition.Expression, target) {
			return true
		}
	}
	return false
}

func hasStatusInstanceMechanicDependency(ctx context.Context, db queryer, worldID, mechanicID string) (bool, error) {
	var dependent bool
	err := db.QueryRow(ctx, `
		select exists(
			select 1 from entity_status_instance_modifiers modifier
			join entity_status_instances instance
				on instance.id = modifier.status_instance_id and instance.world_id = modifier.world_id
			where modifier.world_id = $1 and modifier.mechanic_id = $2 and instance.status = 'active'
		)`, worldID, mechanicID).Scan(&dependent)
	return dependent, err
}

func expressionReferencesMechanic(expression rules.Expression, target rules.ID) bool {
	if expression.Operation == rules.ExpressionMechanicReference && expression.MechanicID == target {
		return true
	}
	for _, operand := range expression.Operands {
		if expressionReferencesMechanic(operand, target) {
			return true
		}
	}
	return false
}

func mechanicValueKindInUse(ctx context.Context, db queryer, worldID, mechanicID string) (bool, error) {
	var used bool
	err := db.QueryRow(ctx, `
		select exists(select 1 from entity_input_value_overrides where world_id = $1 and mechanic_id = $2)
			or exists(select 1 from interaction_resolution_effects where world_id = $1 and mechanic_id = $2)
			or exists(select 1 from interaction_resolution_scalar_applications where world_id = $1 and mechanic_id = $2)
			or exists(select 1 from world_mechanic_expression_nodes where world_id = $1 and referenced_mechanic_id = $2)
			or exists(select 1 from interaction_resolution_inline_status_modifiers where world_id = $1 and mechanic_id = $2)
			or exists(select 1 from entity_status_instance_modifiers where world_id = $1 and mechanic_id = $2)
			or exists(select 1 from interaction_resolution_effective_changes where world_id = $1 and mechanic_id = $2)`,
		worldID, mechanicID).Scan(&used)
	return used, err
}

func validateAndNormalizeInputValueOverrides(ctx context.Context, tx pgx.Tx, worldID string, definition rules.MechanicDefinition) error {
	rows, err := tx.Query(ctx, `
		select entity_id::text, value_kind, number_value::text, boolean_value
		from entity_input_value_overrides where world_id = $1 and mechanic_id = $2
		order by entity_id`, worldID, definition.ID)
	if err != nil {
		return err
	}
	toNormalize := make([]string, 0)
	fields := map[string]string{}
	for rows.Next() {
		var entityID, valueKind string
		var numberValue *string
		var booleanValue *bool
		if err := rows.Scan(&entityID, &valueKind, &numberValue, &booleanValue); err != nil {
			rows.Close()
			return err
		}
		value, err := databaseMechanicValue(valueKind, numberValue, booleanValue)
		if err != nil {
			rows.Close()
			return err
		}
		validation := rules.ValidateMechanicValue(definition, value)
		for _, item := range validation {
			path := fmt.Sprintf("entities[%s].stored_overrides[%s]", entityID, definition.ID)
			if item.Path != "" {
				path += "." + item.Path
			}
			fields[path] = item.Message
		}
		if len(validation) == 0 && rules.MechanicValuesEqual(value, definition.DefaultValue) {
			toNormalize = append(toNormalize, entityID)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(fields) > 0 {
		return &statusError{
			Status:  http.StatusConflict,
			Code:    "mechanic_input_override_conflict",
			Message: "existing stored overrides do not satisfy the proposed mechanic definition",
			Fields:  fields,
		}
	}
	for _, entityID := range toNormalize {
		if _, err := tx.Exec(ctx, `
			delete from entity_input_value_overrides where world_id = $1 and entity_id = $2 and mechanic_id = $3`,
			worldID, entityID, definition.ID); err != nil {
			return err
		}
	}
	return nil
}

func insertWorldMechanic(ctx context.Context, tx pgx.Tx, request saveWorldMechanicRequest, definition rules.MechanicDefinition, position int) error {
	defaultNumber := mechanicDefaultNumber(definition)
	_, err := tx.Exec(ctx, `
		insert into world_mechanics
			(id, world_id, kind, mode, source_kind, value_kind, name, description, minimum, maximum,
			 step, default_number, unit, mutable_during_play, position, archived)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
		definition.ID, definition.WorldID, request.Kind, request.Mode, definition.SourceKind, definition.ValueKind,
		strings.TrimSpace(request.Name), request.Description, decimalDatabase(definition.Minimum), decimalDatabase(definition.Maximum),
		decimalDatabase(definition.Step), defaultNumber, request.Unit, definition.Mutable, position, definition.Archived)
	return err
}

func updateWorldMechanic(ctx context.Context, tx pgx.Tx, request saveWorldMechanicRequest, definition rules.MechanicDefinition) error {
	_, err := tx.Exec(ctx, `
		update world_mechanics set mode = $3, source_kind = $4, value_kind = $5, name = $6,
			description = $7, minimum = $8, maximum = $9, step = $10, default_number = $11,
			unit = $12, mutable_during_play = $13, archived = $14
		where world_id = $1 and id = $2`,
		definition.WorldID, definition.ID, request.Mode, definition.SourceKind, definition.ValueKind,
		strings.TrimSpace(request.Name), request.Description, decimalDatabase(definition.Minimum), decimalDatabase(definition.Maximum),
		decimalDatabase(definition.Step), mechanicDefaultNumber(definition), request.Unit, definition.Mutable, definition.Archived)
	return err
}

func mechanicDefaultNumber(definition rules.MechanicDefinition) any {
	if definition.SourceKind == rules.SourceInput && definition.ValueKind == rules.ValueNumber && definition.DefaultValue.Number != nil {
		return definition.DefaultValue.Number.String()
	}
	return nil
}

func insertMechanicExpression(ctx context.Context, tx pgx.Tx, owner rules.MechanicDefinition, definitions map[rules.ID]rules.MechanicDefinition) error {
	if owner.Expression == nil {
		return errors.New("derived mechanic expression is missing")
	}
	return insertMechanicExpressionNode(ctx, tx, owner, definitions, nil, 0, *owner.Expression)
}

func insertMechanicExpressionNode(ctx context.Context, tx pgx.Tx, owner rules.MechanicDefinition, definitions map[rules.ID]rules.MechanicDefinition, parentID *string, position int, expression rules.Expression) error {
	valueKind, validation := rules.InferExpressionType(expression, owner, definitions)
	if len(validation) > 0 {
		fields := make(map[string]string, len(validation))
		for _, item := range validation {
			fields[item.Path] = item.Message
		}
		return &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "mechanic expression is invalid", Fields: fields}
	}
	nodeID, err := newID()
	if err != nil {
		return err
	}
	var numberValue, booleanValue, referencedMechanicID any
	if expression.Literal != nil {
		numberValue, booleanValue = mechanicValueDatabaseColumns(*expression.Literal)
	}
	if expression.MechanicID.Valid() {
		referencedMechanicID = string(expression.MechanicID)
	}
	if _, err := tx.Exec(ctx, `
		insert into world_mechanic_expression_nodes
			(id, world_id, mechanic_id, mechanic_value_kind, mechanic_source_kind, parent_node_id,
			 position, operation, value_kind, number_value, boolean_value, referenced_mechanic_id)
		values ($1, $2, $3, $4, 'derived', $5, $6, $7, $8, $9, $10, $11)`,
		nodeID, owner.WorldID, owner.ID, owner.ValueKind, parentID, position, expression.Operation,
		valueKind, numberValue, booleanValue, referencedMechanicID); err != nil {
		return err
	}
	for index, operand := range expression.Operands {
		if err := insertMechanicExpressionNode(ctx, tx, owner, definitions, &nodeID, index, operand); err != nil {
			return err
		}
	}
	return nil
}

func advanceRulesRevision(ctx context.Context, tx pgx.Tx, worldID, actorMembershipID string, lockedRevision int64) (int64, error) {
	var revision int64
	if err := tx.QueryRow(ctx, `
		update world_mechanic_graphs set revision = revision + 1
		where world_id = $1 and revision = $2 returning revision`, worldID, lockedRevision).Scan(&revision); err != nil {
		return 0, err
	}
	if err := appendWorldEvent(ctx, tx, worldID, "rules-updated", actorMembershipID, nil, nil, nil); err != nil {
		return 0, err
	}
	return revision, nil
}

func loadWorldMechanics(ctx context.Context, db queryer, worldID, kind string) ([]loadedMechanic, error) {
	query := `select id::text, kind, mode, source_kind, value_kind, name, description,
		minimum::text, maximum::text, step::text, default_number::text, unit,
		mutable_during_play, position, archived, created_at, updated_at
		from world_mechanics where world_id = $1`
	args := []any{worldID}
	if kind != "" {
		query += ` and kind = $2`
		args = append(args, kind)
	}
	query += ` order by case kind when 'capacity' then 0 else 1 end, position, id`
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	items := make([]loadedMechanic, 0)
	for rows.Next() {
		item, err := scanWorldMechanic(rows, worldID)
		if err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for index := range items {
		if items[index].Definition.SourceKind != rules.SourceDerived {
			continue
		}
		expression, err := loadMechanicExpression(ctx, db, worldID, items[index].Response.ID)
		if err != nil {
			return nil, err
		}
		items[index].Definition.Expression = expression
		response := expressionDomainToDTO(*expression)
		items[index].Response.Expression = &response
	}
	return items, nil
}

func loadWorldMechanic(ctx context.Context, db queryer, worldID, mechanicID string) (loadedMechanic, error) {
	row := db.QueryRow(ctx, `select id::text, kind, mode, source_kind, value_kind, name, description,
		minimum::text, maximum::text, step::text, default_number::text, unit,
		mutable_during_play, position, archived, created_at, updated_at
		from world_mechanics where world_id = $1 and id = $2`, worldID, mechanicID)
	item, err := scanWorldMechanic(row, worldID)
	if err != nil {
		return item, err
	}
	if item.Definition.SourceKind == rules.SourceDerived {
		expression, err := loadMechanicExpression(ctx, db, worldID, mechanicID)
		if err != nil {
			return item, err
		}
		item.Definition.Expression = expression
		response := expressionDomainToDTO(*expression)
		item.Response.Expression = &response
	}
	return item, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanWorldMechanic(row rowScanner, worldID string) (loadedMechanic, error) {
	var item loadedMechanic
	var sourceKind, valueKind string
	var minimum, maximum, step, defaultNumber *string
	err := row.Scan(
		&item.Response.ID, &item.Response.Kind, &item.Response.Mode, &sourceKind, &valueKind,
		&item.Response.Name, &item.Response.Description, &minimum, &maximum, &step, &defaultNumber,
		&item.Response.Unit, &item.Response.MutableDuringPlay, &item.Position, &item.Response.Archived,
		&item.Response.CreatedAt, &item.Response.UpdatedAt,
	)
	if err != nil {
		return item, err
	}
	item.Response.SourceKind = sourceKind
	definition := rules.MechanicDefinition{
		ID: rules.ID(item.Response.ID), WorldID: rules.ID(worldID), SourceKind: rules.SourceKind(sourceKind), ValueKind: rules.ValueKind(valueKind),
		Mutable: item.Response.MutableDuringPlay, Archived: item.Response.Archived,
		CreatedAt: item.Response.CreatedAt, UpdatedAt: item.Response.UpdatedAt,
	}
	var parseErr error
	definition.Minimum, parseErr = parseDecimalPointer(minimum)
	if parseErr == nil {
		definition.Maximum, parseErr = parseDecimalPointer(maximum)
	}
	if parseErr == nil {
		definition.Step, parseErr = parseDecimalPointer(step)
	}
	var parsedDefault *rules.Decimal
	if parseErr == nil {
		parsedDefault, parseErr = parseDecimalPointer(defaultNumber)
	}
	if parseErr != nil {
		return item, parseErr
	}
	item.Response.Minimum = decimalTextPointer(definition.Minimum)
	item.Response.Maximum = decimalTextPointer(definition.Maximum)
	item.Response.Step = decimalTextPointer(definition.Step)
	item.Response.DefaultNumber = decimalTextPointer(parsedDefault)
	if definition.SourceKind == rules.SourceInput && definition.ValueKind == rules.ValueBoolean {
		definition.DefaultValue = rules.NewBooleanMechanicValue(false)
	} else if definition.SourceKind == rules.SourceInput && parsedDefault != nil {
		definition.DefaultValue = rules.NewNumberMechanicValue(*parsedDefault)
	}
	item.Definition = definition
	return item, nil
}

type storedExpressionNode struct {
	ID                   string
	ParentID             *string
	Position             int
	Operation            string
	ValueKind            string
	NumberValue          *string
	BooleanValue         *bool
	ReferencedMechanicID *string
}

func loadMechanicExpression(ctx context.Context, db queryer, worldID, mechanicID string) (*rules.Expression, error) {
	rows, err := db.Query(ctx, `
		select id::text, parent_node_id::text, position, operation, value_kind,
			number_value::text, boolean_value, referenced_mechanic_id::text
		from world_mechanic_expression_nodes
		where world_id = $1 and mechanic_id = $2
		order by parent_node_id nulls first, position, id`, worldID, mechanicID)
	if err != nil {
		return nil, err
	}
	nodes := make(map[string]storedExpressionNode)
	children := make(map[string][]storedExpressionNode)
	var roots []storedExpressionNode
	for rows.Next() {
		var node storedExpressionNode
		if err := rows.Scan(&node.ID, &node.ParentID, &node.Position, &node.Operation, &node.ValueKind, &node.NumberValue, &node.BooleanValue, &node.ReferencedMechanicID); err != nil {
			rows.Close()
			return nil, err
		}
		nodes[node.ID] = node
		if node.ParentID == nil {
			roots = append(roots, node)
		} else {
			children[*node.ParentID] = append(children[*node.ParentID], node)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	if len(roots) != 1 {
		return nil, fmt.Errorf("mechanic %s has %d expression roots", mechanicID, len(roots))
	}
	visiting := make(map[string]bool, len(nodes))
	visited := make(map[string]bool, len(nodes))
	expression, err := buildStoredExpression(roots[0], children, visiting, visited)
	if err != nil {
		return nil, err
	}
	if len(visited) != len(nodes) {
		return nil, fmt.Errorf("mechanic %s expression contains unreachable nodes", mechanicID)
	}
	return &expression, nil
}

func buildStoredExpression(node storedExpressionNode, children map[string][]storedExpressionNode, visiting, visited map[string]bool) (rules.Expression, error) {
	if visiting[node.ID] {
		return rules.Expression{}, fmt.Errorf("stored expression contains a node cycle at %s", node.ID)
	}
	if visited[node.ID] {
		return rules.Expression{}, fmt.Errorf("stored expression node %s is attached more than once", node.ID)
	}
	visiting[node.ID] = true
	result := rules.Expression{Operation: rules.ExpressionOperation(node.Operation)}
	if node.Operation == string(rules.ExpressionLiteral) {
		value, err := databaseMechanicValue(node.ValueKind, node.NumberValue, node.BooleanValue)
		if err != nil {
			return rules.Expression{}, err
		}
		result.Literal = &value
	}
	if node.ReferencedMechanicID != nil {
		result.MechanicID = rules.ID(*node.ReferencedMechanicID)
	}
	ordered := append([]storedExpressionNode(nil), children[node.ID]...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Position == ordered[j].Position {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].Position < ordered[j].Position
	})
	result.Operands = make([]rules.Expression, len(ordered))
	for index, child := range ordered {
		if child.Position != index {
			return rules.Expression{}, fmt.Errorf("stored expression node %s has incomplete operand positions", node.ID)
		}
		operand, err := buildStoredExpression(child, children, visiting, visited)
		if err != nil {
			return rules.Expression{}, err
		}
		result.Operands[index] = operand
	}
	delete(visiting, node.ID)
	visited[node.ID] = true
	return result, nil
}

func parseDecimalPointer(value *string) (*rules.Decimal, error) {
	if value == nil {
		return nil, nil
	}
	parsed, err := rules.ParseDecimal(*value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func decimalDatabase(value *rules.Decimal) any {
	if value == nil {
		return nil
	}
	return value.String()
}

func mechanicDefinitions(items []loadedMechanic) map[rules.ID]rules.MechanicDefinition {
	result := make(map[rules.ID]rules.MechanicDefinition, len(items))
	for _, item := range items {
		result[item.Definition.ID] = item.Definition
	}
	return result
}
