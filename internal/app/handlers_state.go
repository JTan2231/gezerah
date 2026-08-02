package app

import (
	"context"
	"fmt"
	"net/http"
	"sort"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleGetState(w http.ResponseWriter, r *http.Request) {
	ruleSetID, entityID := r.PathValue("rule_set_id"), r.PathValue("entity_id")
	if !validID(ruleSetID) || !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	response, err := loadLogicalStateResponse(r.Context(), s.db, ruleSetID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handlePutState(w http.ResponseWriter, r *http.Request) {
	ruleSetID, entityID := r.PathValue("rule_set_id"), r.PathValue("entity_id")
	if !validID(ruleSetID) || !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request replaceStateRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required and cannot be negative", map[string]string{"expected_revision": "is required and cannot be negative"})
		return
	}
	definitions, err := loadDefinitionsDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	entities, err := loadEntitiesDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	entity, exists := entities[rules.ID(entityID)]
	if !exists {
		handleAppError(w, pgx.ErrNoRows)
		return
	}
	proposed := rules.StateRecord{OwnerEntityID: rules.ID(entityID), Revision: *request.ExpectedRevision, Values: make(map[rules.ID]rules.StateValue)}
	fields := map[string]string{}
	for definitionID, value := range request.Values {
		if !validID(definitionID) {
			fields["values["+definitionID+"]"] = "state-variable ID must be a UUID"
			continue
		}
		definition, exists := definitions[rules.ID(definitionID)]
		if !exists {
			fields["values["+definitionID+"]"] = "state-variable definition does not exist"
			continue
		}
		converted, convertErr := stateValueDTOToDomain(value, definition)
		if convertErr != nil {
			fields["values["+definitionID+"]"] = convertErr.Error()
			continue
		}
		proposed.Values[rules.ID(definitionID)] = converted
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "state is invalid", fields)
		return
	}
	proposed = rules.NormalizeStateRecord(proposed, definitions)
	if validation := rules.ValidateStateRecord(proposed, entity, definitions, entities); len(validation) > 0 {
		handleAppError(w, validationStatus("state is invalid", validation))
		return
	}

	if err := replaceState(r.Context(), s, ruleSetID, entityID, *request.ExpectedRevision, proposed, definitions); err != nil {
		handleAppError(w, err)
		return
	}
	response, err := loadLogicalStateResponse(r.Context(), s.db, ruleSetID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func loadLogicalStateResponse(ctx context.Context, db queryer, ruleSetID, entityID string) (stateRecordResponse, error) {
	var response stateRecordResponse
	entities, err := loadEntitiesDomain(ctx, db, ruleSetID)
	if err != nil {
		return response, err
	}
	entity, exists := entities[rules.ID(entityID)]
	if !exists {
		return response, pgx.ErrNoRows
	}
	definitions, err := loadDefinitionsDomain(ctx, db, ruleSetID)
	if err != nil {
		return response, err
	}
	record, err := loadStateRecord(ctx, db, ruleSetID, entityID)
	if err != nil {
		return response, err
	}
	if validation := rules.ValidateStateRecord(record, entity, definitions, entities); len(validation) > 0 {
		return response, fmt.Errorf("stored state is invalid: %w", validation)
	}
	logical := rules.MaterializeLogicalState(entity, record, definitions)
	response = stateRecordResponse{
		OwnerEntityID:          entityID,
		Revision:               record.Revision,
		Values:                 make(map[string]stateValueDTO, len(logical.Values)),
		DefaultedDefinitionIDs: idsToStrings(logical.DefaultedDefinitionIDs),
		UnknownDefinitionIDs:   idsToStrings(logical.UnknownDefinitionIDs),
		UpdatedAt:              record.UpdatedAt,
	}
	for definitionID, value := range logical.Values {
		response.Values[string(definitionID)] = stateValueDomainToDTO(value, definitions[definitionID])
	}
	return response, nil
}

func loadStateRecord(ctx context.Context, db queryer, ruleSetID, entityID string) (rules.StateRecord, error) {
	record := rules.StateRecord{OwnerEntityID: rules.ID(entityID), Values: make(map[rules.ID]rules.StateValue)}
	if err := db.QueryRow(ctx, `
		select revision, updated_at from state_records
		where rule_set_id = $1 and owner_entity_id = $2`, ruleSetID, entityID,
	).Scan(&record.Revision, &record.UpdatedAt); err != nil {
		return record, err
	}
	rows, err := db.Query(ctx, `
		select state_variable_id::text, cardinality, value_kind, text_value, number_value::text,
			boolean_value, choice_option_id::text, measurement_amount::text,
			measurement_unit_id::text, referenced_entity_id::text, fallback_name
		from state_values where rule_set_id = $1 and owner_entity_id = $2
		order by state_variable_id, position`, ruleSetID, entityID)
	if err != nil {
		return record, err
	}
	defer rows.Close()
	for rows.Next() {
		var definitionID, cardinality, kind string
		var textValue, numberValue, choiceOptionID, measurementAmount, measurementUnitID, referencedEntityID, fallbackName *string
		var booleanValue *bool
		if err := rows.Scan(
			&definitionID, &cardinality, &kind, &textValue, &numberValue, &booleanValue,
			&choiceOptionID, &measurementAmount, &measurementUnitID, &referencedEntityID, &fallbackName,
		); err != nil {
			return record, err
		}
		scalar, err := scalarFromColumns(kind, textValue, numberValue, booleanValue, choiceOptionID, measurementAmount, measurementUnitID, referencedEntityID, fallbackName)
		if err != nil {
			return record, err
		}
		value := record.Values[rules.ID(definitionID)]
		value.Cardinality = rules.Cardinality(cardinality)
		value.Values = append(value.Values, scalar)
		record.Values[rules.ID(definitionID)] = value
	}
	return record, rows.Err()
}

func replaceState(ctx context.Context, server *Server, ruleSetID, entityID string, expectedRevision int64, proposed rules.StateRecord, definitions map[rules.ID]rules.StateVariableDefinition) error {
	tx, err := server.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	definitionIDs := make([]rules.ID, 0, len(proposed.Values))
	stateRecordIDs := map[rules.ID]struct{}{rules.ID(entityID): {}}
	for definitionID, value := range proposed.Values {
		definitionIDs = append(definitionIDs, definitionID)
		for _, scalar := range value.Values {
			if scalar.Kind == rules.ValueReference {
				stateRecordIDs[scalar.ReferencedEntityID] = struct{}{}
			}
		}
	}
	sort.Slice(definitionIDs, func(i, j int) bool { return definitionIDs[i] < definitionIDs[j] })
	for _, definitionID := range definitionIDs {
		var lockedID string
		if err := tx.QueryRow(ctx, `
			select id::text from state_variable_definitions
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, definitionID).Scan(&lockedID); err != nil {
			return err
		}
	}
	orderedRecordIDs := make([]rules.ID, 0, len(stateRecordIDs))
	for id := range stateRecordIDs {
		orderedRecordIDs = append(orderedRecordIDs, id)
	}
	sort.Slice(orderedRecordIDs, func(i, j int) bool { return orderedRecordIDs[i] < orderedRecordIDs[j] })
	for _, recordID := range orderedRecordIDs {
		var lockedID string
		if err := tx.QueryRow(ctx, `
			select owner_entity_id::text from state_records
			where rule_set_id = $1 and owner_entity_id = $2 for update`, ruleSetID, recordID).Scan(&lockedID); err != nil {
			return err
		}
	}

	currentDefinitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return err
	}
	currentEntities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
	if err != nil {
		return err
	}
	currentEntity, exists := currentEntities[rules.ID(entityID)]
	if !exists {
		return pgx.ErrNoRows
	}
	proposed = rules.NormalizeStateRecord(proposed, currentDefinitions)
	if validation := rules.ValidateStateRecord(proposed, currentEntity, currentDefinitions, currentEntities); len(validation) > 0 {
		return validationStatus("state is invalid against current configuration", validation)
	}

	current, err := loadStateRecord(ctx, tx, ruleSetID, entityID)
	if err != nil {
		return err
	}
	if current.Revision != expectedRevision {
		return &statusError{
			Status: http.StatusConflict, Code: "revision_conflict", Message: "state changed since it was loaded",
			Fields: map[string]string{"expected_revision": fmt.Sprint(expectedRevision), "actual_revision": fmt.Sprint(current.Revision)},
		}
	}
	if stateMapsEqual(current.Values, proposed.Values) {
		return tx.Commit(ctx)
	}
	if _, err := tx.Exec(ctx, `delete from state_values where rule_set_id = $1 and owner_entity_id = $2`, ruleSetID, entityID); err != nil {
		return err
	}
	for _, definitionID := range definitionIDs {
		value := proposed.Values[definitionID]
		for position, scalar := range value.Values {
			if err := insertStateScalar(ctx, tx, ruleSetID, entityID, currentDefinitions[definitionID], position, scalar); err != nil {
				return err
			}
		}
	}
	if _, err := tx.Exec(ctx, `
		update state_records set revision = revision + 1
		where rule_set_id = $1 and owner_entity_id = $2`, ruleSetID, entityID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func stateMapsEqual(left, right map[rules.ID]rules.StateValue) bool {
	if len(left) != len(right) {
		return false
	}
	for id, leftValue := range left {
		rightValue, exists := right[id]
		if !exists || !rules.StateValuesEqual(leftValue, rightValue) {
			return false
		}
	}
	return true
}

func insertStateScalar(ctx context.Context, tx pgx.Tx, ruleSetID, entityID string, definition rules.StateVariableDefinition, position int, value rules.ScalarValue) error {
	columns := scalarDatabaseColumns(value)
	_, err := tx.Exec(ctx, `
		insert into state_values (
			id, owner_entity_id, rule_set_id, state_variable_id, value_kind, cardinality, position,
			text_value, number_value, boolean_value, choice_option_id,
			measurement_amount, measurement_unit_id, referenced_entity_id, fallback_name
		) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		entityID, ruleSetID, definition.ID, value.Kind, definition.Cardinality, position,
		columns.Text, columns.Number, columns.Boolean, columns.ChoiceOptionID,
		columns.MeasurementAmount, columns.MeasurementUnitID, columns.ReferencedEntityID, columns.FallbackName,
	)
	return err
}
