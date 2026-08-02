package app

import (
	"fmt"
	"net/http"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func (s *Server) registerConditionRoutes() {
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/condition-sets", s.handleListConditionSets)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/condition-sets", s.handleCreateConditionSet)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}", s.handleGetConditionSet)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}", s.handlePutConditionSet)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/duplicate", s.handleDuplicateConditionSet)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/archive", s.handleArchiveConditionSet)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/condition-sets/{condition_set_id}/evaluate", s.handleEvaluateConditionSet)
}

func (s *Server) handleListConditionSets(w http.ResponseWriter, r *http.Request) {
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
	conditions, err := loadConditionsDomain(r.Context(), s.db, ruleSetID, definitions)
	if err != nil {
		handleAppError(w, err)
		return
	}
	archived := r.URL.Query().Get("archived")
	items := make([]conditionSetResponse, 0, len(conditions))
	for _, condition := range sortedConditionSlice(conditions) {
		if archived == "true" && !condition.Archived || archived == "false" && condition.Archived {
			continue
		}
		items = append(items, conditionToResponse(condition, definitions))
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateConditionSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request saveConditionSetRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Archived = false
	set, definitions, err := s.validateConditionRequest(r, ruleSetID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	saved, err := saveConditionDomain(r.Context(), s, ruleSetID, "", set)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/condition-sets/%s", ruleSetID, saved.ID))
	writeJSON(w, http.StatusCreated, conditionToResponse(saved, definitions))
}

func (s *Server) handleGetConditionSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID, conditionID := r.PathValue("rule_set_id"), r.PathValue("condition_set_id")
	if !validID(ruleSetID) || !validID(conditionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	definitions, err := loadDefinitionsDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	set, err := loadConditionDomain(r.Context(), s.db, ruleSetID, conditionID, definitions)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conditionToResponse(set, definitions))
}

func (s *Server) handlePutConditionSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID, conditionID := r.PathValue("rule_set_id"), r.PathValue("condition_set_id")
	if !validID(ruleSetID) || !validID(conditionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request saveConditionSetRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != conditionID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	request.ID = conditionID
	set, definitions, err := s.validateConditionRequest(r, ruleSetID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	saved, err := saveConditionDomain(r.Context(), s, ruleSetID, conditionID, set)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conditionToResponse(saved, definitions))
}

func (s *Server) validateConditionRequest(r *http.Request, ruleSetID string, request saveConditionSetRequest) (rules.ConditionSet, map[rules.ID]rules.StateVariableDefinition, error) {
	definitions, err := loadDefinitionsDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		return rules.ConditionSet{}, nil, err
	}
	set, err := conditionRequestToDomain(request, ruleSetID, definitions)
	if err != nil {
		return set, definitions, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: err.Error()}
	}
	fields := map[string]string{}
	if !validID(string(set.ID)) {
		fields["id"] = "must be a UUID"
	}
	validateKey(fields, "key", set.Key)
	validateRequired(fields, "name", set.Name, 200)
	for index, parameter := range set.Parameters {
		if !validID(string(parameter.ID)) {
			fields[fmt.Sprintf("parameters[%d].id", index)] = "must be a UUID"
		}
		validateKey(fields, fmt.Sprintf("parameters[%d].key", index), parameter.Key)
	}
	validateConditionExpressionIDs(fields, set.Root)
	if len(fields) > 0 {
		return set, definitions, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "condition set is invalid", Fields: fields}
	}
	schemas, err := loadOwnerSchemasDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		return set, definitions, err
	}
	if validation := rules.ValidateConditionSet(set, schemas, definitions); len(validation) > 0 {
		return set, definitions, validationStatus("condition set is invalid", validation)
	}
	return set, definitions, nil
}

func validateConditionExpressionIDs(fields map[string]string, expression rules.ConditionExpression) {
	if !validID(string(expression.ID)) {
		fields["root.children["+string(expression.ID)+"].id"] = "must be a UUID"
	}
	for _, child := range expression.Children {
		validateConditionExpressionIDs(fields, child)
	}
}

func (s *Server) handleDuplicateConditionSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID, conditionID := r.PathValue("rule_set_id"), r.PathValue("condition_set_id")
	if !validID(ruleSetID) || !validID(conditionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	definitions, err := loadDefinitionsDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	set, err := loadConditionDomain(r.Context(), s.db, ruleSetID, conditionID, definitions)
	if err != nil {
		handleAppError(w, err)
		return
	}
	set, err = cloneConditionSet(set)
	if err != nil {
		handleAppError(w, err)
		return
	}
	set.Key, err = availableConditionKey(r, s, ruleSetID, set.Key+"-copy")
	if err != nil {
		handleAppError(w, err)
		return
	}
	set.Name += " copy"
	saved, err := saveConditionDomain(r.Context(), s, ruleSetID, "", set)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/condition-sets/%s", ruleSetID, saved.ID))
	writeJSON(w, http.StatusCreated, conditionToResponse(saved, definitions))
}

func cloneConditionSet(source rules.ConditionSet) (rules.ConditionSet, error) {
	setID, err := newID()
	if err != nil {
		return source, err
	}
	source.ID = rules.ID(setID)
	source.Archived = false
	source.CreatedAt, source.UpdatedAt = source.CreatedAt.UTC(), source.CreatedAt.UTC()
	parameterIDs := map[rules.ID]rules.ID{}
	for index := range source.Parameters {
		id, err := newID()
		if err != nil {
			return source, err
		}
		parameterIDs[source.Parameters[index].ID] = rules.ID(id)
		source.Parameters[index].ID = rules.ID(id)
	}
	var cloneExpression func(rules.ConditionExpression) (rules.ConditionExpression, error)
	cloneExpression = func(expression rules.ConditionExpression) (rules.ConditionExpression, error) {
		id, err := newID()
		if err != nil {
			return expression, err
		}
		expression.ID = rules.ID(id)
		if expression.Criterion != nil {
			expression.Criterion.ParameterID = parameterIDs[expression.Criterion.ParameterID]
		}
		for index := range expression.Children {
			expression.Children[index], err = cloneExpression(expression.Children[index])
			if err != nil {
				return expression, err
			}
		}
		return expression, nil
	}
	source.Root, err = cloneExpression(source.Root)
	return source, err
}

func availableConditionKey(r *http.Request, server *Server, ruleSetID, base string) (string, error) {
	for suffix := 1; suffix < 1000; suffix++ {
		candidate := base
		if suffix > 1 {
			candidate = fmt.Sprintf("%s-%d", base, suffix)
		}
		var exists bool
		if err := server.db.QueryRow(r.Context(), `
			select exists(select 1 from condition_sets where rule_set_id = $1 and key = $2)`, ruleSetID, candidate).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not allocate duplicate key")
}

func (s *Server) handleArchiveConditionSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID, conditionID := r.PathValue("rule_set_id"), r.PathValue("condition_set_id")
	if !validID(ruleSetID) || !validID(conditionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	command, err := s.db.Exec(r.Context(), `update condition_sets set archived = true where rule_set_id = $1 and id = $2`, ruleSetID, conditionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() == 0 {
		handleAppError(w, &statusError{Status: http.StatusNotFound, Code: "not_found", Message: "condition set not found"})
		return
	}
	s.handleGetConditionSet(w, r)
}

func (s *Server) handleEvaluateConditionSet(w http.ResponseWriter, r *http.Request) {
	ruleSetID, conditionID := r.PathValue("rule_set_id"), r.PathValue("condition_set_id")
	if !validID(ruleSetID) || !validID(conditionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request evaluateConditionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	definitions, err := loadDefinitionsDomain(r.Context(), tx, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	set, err := loadConditionDomain(r.Context(), tx, ruleSetID, conditionID, definitions)
	if err != nil {
		handleAppError(w, err)
		return
	}
	entities, err := loadEntitiesDomain(r.Context(), tx, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	bindings := make(rules.ParameterBindings, len(request.Arguments))
	fields := map[string]string{}
	entitySet := map[rules.ID]struct{}{}
	for index, argument := range request.Arguments {
		parameterID := rules.ID(argument.ParameterID)
		if !validID(argument.ParameterID) {
			fields[fmt.Sprintf("arguments[%d].parameter_id", index)] = "must be a UUID"
		}
		if _, exists := bindings[parameterID]; exists {
			fields[fmt.Sprintf("arguments[%d].parameter_id", index)] = "parameter must be supplied exactly once"
		}
		seen := map[rules.ID]bool{}
		for entityIndex, entityID := range argument.EntityIDs {
			id := rules.ID(entityID)
			if !validID(entityID) {
				fields[fmt.Sprintf("arguments[%d].entity_ids[%d]", index, entityIndex)] = "must be a UUID"
			} else if seen[id] {
				fields[fmt.Sprintf("arguments[%d].entity_ids[%d]", index, entityIndex)] = "entity must not be duplicated"
			}
			seen[id] = true
			bindings[parameterID] = append(bindings[parameterID], id)
			entitySet[id] = struct{}{}
		}
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "condition arguments are invalid", fields)
		return
	}
	snapshot := rules.StateSnapshot{Records: make(map[rules.ID]rules.StateRecord, len(entitySet))}
	for entityID := range entitySet {
		record, err := loadStateRecord(r.Context(), tx, ruleSetID, string(entityID))
		if err != nil {
			handleAppError(w, err)
			return
		}
		snapshot.Records[entityID] = record
	}
	evaluation, err := rules.EvaluateCondition(set, bindings, entities, definitions, snapshot)
	if err != nil {
		handleAppError(w, &statusError{Status: http.StatusUnprocessableEntity, Code: "evaluation_invalid", Message: err.Error()})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conditionEvaluationToDTO(evaluation, definitions))
}

func conditionEvaluationToDTO(evaluation rules.ConditionEvaluation, definitions map[rules.ID]rules.StateVariableDefinition) conditionEvaluationDTO {
	result := conditionEvaluationDTO{
		ConditionSetID: string(evaluation.ConditionSetID), Status: string(evaluation.Status),
		Root: conditionEvaluationNodeToDTO(evaluation.Root, definitions), MissingValues: make([]stateAddressDTO, 0, len(evaluation.MissingValues)),
	}
	for _, address := range evaluation.MissingValues {
		result.MissingValues = append(result.MissingValues, stateAddressDTO{EntityID: string(address.EntityID), StateVariableID: string(address.StateVariableID)})
	}
	return result
}

func conditionEvaluationNodeToDTO(node rules.ConditionEvaluationNode, definitions map[rules.ID]rules.StateVariableDefinition) conditionEvaluationNodeDTO {
	result := conditionEvaluationNodeDTO{
		ExpressionID: string(node.ExpressionID), Status: string(node.Status), Message: node.Message,
		EntityResults: make([]conditionEntityResultDTO, 0, len(node.EntityResults)), Children: make([]conditionEvaluationNodeDTO, 0, len(node.Children)),
	}
	if node.ParameterID.Valid() {
		parameterID := string(node.ParameterID)
		result.ParameterID = &parameterID
	}
	for _, entityResult := range node.EntityResults {
		item := conditionEntityResultDTO{
			EntityID: string(entityResult.EntityID), Status: string(entityResult.Status),
			Address: stateAddressDTO{EntityID: string(entityResult.Address.EntityID), StateVariableID: string(entityResult.Address.StateVariableID)},
		}
		if entityResult.Actual != nil {
			value := stateValueDomainToDTO(*entityResult.Actual, definitions[entityResult.Address.StateVariableID])
			item.Actual = &value
		}
		result.EntityResults = append(result.EntityResults, item)
	}
	for _, child := range node.Children {
		result.Children = append(result.Children, conditionEvaluationNodeToDTO(child, definitions))
	}
	return result
}
