package app

import (
	"fmt"
	"net/http"
	"strings"

	"dnd/internal/rules"
)

func (s *Server) handleListStateVariables(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	definitions, err := loadDefinitionsDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	archived := r.URL.Query().Get("archived")
	items := make([]stateVariableResponse, 0, len(definitions))
	for _, definition := range sortedDefinitionSlice(definitions) {
		if archived == "true" && !definition.Archived || archived == "false" && definition.Archived {
			continue
		}
		items = append(items, definitionToResponse(definition))
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateStateVariable(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request saveStateVariableRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Archived = false
	definition, err := s.validateDefinitionRequest(r, ruleSetID, request, "")
	if err != nil {
		handleAppError(w, err)
		return
	}
	saved, err := saveDefinitionDomain(r.Context(), s, ruleSetID, "", definition)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/state-variable-definitions/%s", ruleSetID, saved.ID))
	writeJSON(w, http.StatusCreated, definitionToResponse(saved))
}

func (s *Server) handleGetStateVariable(w http.ResponseWriter, r *http.Request) {
	ruleSetID, definitionID := r.PathValue("rule_set_id"), r.PathValue("definition_id")
	if !validID(ruleSetID) || !validID(definitionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	definition, err := loadDefinitionDomain(r.Context(), s.db, ruleSetID, definitionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, definitionToResponse(definition))
}

func (s *Server) handlePutStateVariable(w http.ResponseWriter, r *http.Request) {
	ruleSetID, definitionID := r.PathValue("rule_set_id"), r.PathValue("definition_id")
	if !validID(ruleSetID) || !validID(definitionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request saveStateVariableRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != definitionID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	request.ID = definitionID
	definition, err := s.validateDefinitionRequest(r, ruleSetID, request, definitionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	saved, err := saveDefinitionDomain(r.Context(), s, ruleSetID, definitionID, definition)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, definitionToResponse(saved))
}

func (s *Server) handleArchiveStateVariable(w http.ResponseWriter, r *http.Request) {
	ruleSetID, definitionID := r.PathValue("rule_set_id"), r.PathValue("definition_id")
	if !validID(ruleSetID) || !validID(definitionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	command, err := s.db.Exec(r.Context(), `
		update state_variable_definitions set archived = true
		where rule_set_id = $1 and id = $2`, ruleSetID, definitionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() == 0 {
		handleAppError(w, &statusError{Status: http.StatusNotFound, Code: "not_found", Message: "state variable not found"})
		return
	}
	definition, err := loadDefinitionDomain(r.Context(), s.db, ruleSetID, definitionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, definitionToResponse(definition))
}

func (s *Server) validateDefinitionRequest(r *http.Request, ruleSetID string, request saveStateVariableRequest, existingID string) (rules.StateVariableDefinition, error) {
	definition, err := definitionRequestToDomain(request, ruleSetID)
	if err != nil {
		return definition, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: err.Error()}
	}
	fields := map[string]string{}
	if !validID(string(definition.ID)) {
		fields["id"] = "must be a UUID"
	}
	validateKey(fields, "key", definition.Key)
	validateRequired(fields, "label", definition.Label, 200)
	for index, option := range definition.ChoiceOptions {
		if !validID(string(option.ID)) {
			fields[fmt.Sprintf("value_schema.options[%d].id", index)] = "must be a UUID"
		}
		validateKey(fields, fmt.Sprintf("value_schema.options[%d].key", index), option.Key)
	}
	for index, unit := range definition.MeasurementUnits {
		if !validID(string(unit.ID)) {
			fields[fmt.Sprintf("value_schema.units[%d].id", index)] = "must be a UUID"
		}
	}
	if len(fields) > 0 {
		return definition, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "state variable is invalid", Fields: fields}
	}

	schemas, err := loadOwnerSchemasDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		return definition, err
	}
	entities, err := loadEntitiesDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		return definition, err
	}
	var current rules.StateVariableDefinition
	if existingID != "" {
		current, err = loadDefinitionDomain(r.Context(), s.db, ruleSetID, existingID)
		if err != nil {
			return definition, err
		}
	}
	for path, message := range archivedDefinitionReferenceFields(definition, current, schemas) {
		fields[path] = message
	}
	if definition.ConditionAddressable && (definition.Cardinality != rules.CardinalityOne ||
		(definition.ValueKind != rules.ValueNumber && definition.ValueKind != rules.ValueBoolean && definition.ValueKind != rules.ValueChoice)) {
		fields["condition_addressable"] = "only single-valued number, boolean, and choice variables can be condition-addressable"
	}
	if control := definition.PresentationControl; control != "" && !presentationCompatible(definition.ValueKind, control) {
		fields["presentation.control"] = "control is not compatible with the selected value kind"
	}
	if len(fields) > 0 {
		return definition, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "state variable is invalid", Fields: fields}
	}
	if validation := rules.ValidateStateVariableDefinition(definition, schemas, entities); len(validation) > 0 {
		return definition, validationStatus("state variable is invalid", validation)
	}
	return definition, nil
}

func presentationCompatible(kind rules.ValueKind, control rules.PresentationControl) bool {
	switch kind {
	case rules.ValueText:
		return control == rules.ControlShortText || control == rules.ControlLongText
	case rules.ValueChoice:
		return control == rules.ControlSelect
	case rules.ValueMeasurement:
		return control == rules.ControlMeasurement
	case rules.ValueNumber:
		return control == rules.ControlNumber
	case rules.ValueBoolean:
		return control == rules.ControlCheckbox
	case rules.ValueReference:
		return control == rules.ControlReferencePicker
	default:
		return false
	}
}

func canonicalDescription(value *string) *string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	return &cleaned
}
