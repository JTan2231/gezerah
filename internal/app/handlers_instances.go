package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handleListProblemInstances(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	definitionFilter := r.URL.Query().Get("problem_definition_id")
	if definitionFilter != "" && !validID(definitionFilter) {
		writeError(w, http.StatusBadRequest, "invalid_id", "problem_definition_id is malformed", nil)
		return
	}
	items, err := readProblemSnapshot(r.Context(), s, func(tx pgx.Tx) ([]problemInstanceResponse, error) {
		definitions, err := loadDefinitionsDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return nil, err
		}
		loaded, err := loadProblemInstancesDomain(r.Context(), tx, ruleSetID, definitions)
		if err != nil {
			return nil, err
		}
		problemCache := make(map[rules.ID]rules.ProblemDefinition)
		items := make([]problemInstanceResponse, 0, len(loaded))
		for _, instance := range loaded {
			if definitionFilter != "" && string(instance.Instance.ProblemDefinitionID) != definitionFilter {
				continue
			}
			problem, exists := problemCache[instance.Instance.ProblemDefinitionID]
			if !exists {
				problem, err = loadProblemDomain(r.Context(), tx, ruleSetID, string(instance.Instance.ProblemDefinitionID), definitions)
				if err != nil {
					return nil, err
				}
				problemCache[problem.ID] = problem
			}
			items = append(items, instanceToResponse(instance, problem))
		}
		return items, nil
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateProblemInstance(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request createProblemInstanceRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := make(map[string]string)
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	if !validID(request.ProblemDefinitionID) {
		fields["problem_definition_id"] = "must be a UUID"
	}
	validateRequired(fields, "display_name", request.DisplayName, 200)
	if request.Key != nil && strings.TrimSpace(*request.Key) != "" && !keyPattern.MatchString(strings.TrimSpace(*request.Key)) {
		fields["key"] = "must use the configured key format"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "problem instance is invalid", fields)
		return
	}
	if request.ID == "" {
		generated, err := newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
		request.ID = generated
	}
	definitions, err := loadDefinitionsDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	problem, err := loadProblemDomain(r.Context(), s.db, ruleSetID, request.ProblemDefinitionID, definitions)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if problem.Archived {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "problem_archived", Message: "archived problem definitions cannot create instances"})
		return
	}
	bindings, err := bindingsDTOToDomain(request.Bindings, problem, rules.ID(request.ID))
	if err != nil {
		handleAppError(w, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: err.Error()})
		return
	}
	entity := rules.Entity{
		ID: rules.ID(request.ID), RuleSetID: rules.ID(ruleSetID), DisplayName: strings.TrimSpace(request.DisplayName),
		OwnerSchemaIDs: append([]rules.ID(nil), problem.InstanceOwnerSchemaIDs...),
	}
	if request.Key != nil {
		entity.Key = strings.TrimSpace(*request.Key)
	}
	entities, err := loadEntitiesDomain(r.Context(), s.db, ruleSetID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	entities[entity.ID] = entity
	instance := rules.ProblemInstance{
		ID: entity.ID, RuleSetID: entity.RuleSetID, ProblemDefinitionID: problem.ID,
		DisplayName: entity.DisplayName, Bindings: bindings,
	}
	if validation := rules.ValidateProblemInstance(problem, instance, entities); len(validation) > 0 {
		handleAppError(w, validationStatus("problem instance is invalid", validation))
		return
	}
	loaded, err := createProblemInstanceDomain(r.Context(), s, ruleSetID, problem, entity, bindings)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := loadProblemInstanceAndDefinitionSnapshot(r.Context(), s, ruleSetID, string(loaded.Instance.ID))
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/problem-instances/%s", ruleSetID, loaded.Instance.ID))
	writeJSON(w, http.StatusCreated, instanceToResponse(snapshot.Loaded, snapshot.Problem))
}

func (s *Server) handleGetProblemInstance(w http.ResponseWriter, r *http.Request) {
	ruleSetID, instanceID := r.PathValue("rule_set_id"), r.PathValue("problem_instance_id")
	if !validID(ruleSetID) || !validID(instanceID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	snapshot, err := loadProblemInstanceAndDefinitionSnapshot(r.Context(), s, ruleSetID, instanceID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, instanceToResponse(snapshot.Loaded, snapshot.Problem))
}

func (s *Server) handlePutProblemBindings(w http.ResponseWriter, r *http.Request) {
	ruleSetID, instanceID := r.PathValue("rule_set_id"), r.PathValue("problem_instance_id")
	if !validID(ruleSetID) || !validID(instanceID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request replaceProblemBindingsRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedBindingRevision == nil || *request.ExpectedBindingRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_binding_revision is required and cannot be negative", map[string]string{"expected_binding_revision": "is required and cannot be negative"})
		return
	}
	_, problem, err := loadProblemForInstance(r.Context(), s.db, ruleSetID, instanceID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	bindings, err := bindingsDTOToDomain(request.Bindings, problem, rules.ID(instanceID))
	if err != nil {
		handleAppError(w, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: err.Error()})
		return
	}
	_, err = replaceProblemBindingsDomain(r.Context(), s, ruleSetID, instanceID, *request.ExpectedBindingRevision, bindings)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := loadProblemInstanceAndDefinitionSnapshot(r.Context(), s, ruleSetID, instanceID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, instanceToResponse(snapshot.Loaded, snapshot.Problem))
}

func loadProblemForInstance(ctx context.Context, db queryer, ruleSetID, instanceID string) (map[rules.ID]rules.StateVariableDefinition, rules.ProblemDefinition, error) {
	definitions, err := loadDefinitionsDomain(ctx, db, ruleSetID)
	if err != nil {
		return nil, rules.ProblemDefinition{}, err
	}
	var problemID string
	if err := db.QueryRow(ctx, `
		select problem_definition_id::text from problem_instances
		where rule_set_id = $1 and entity_id = $2`, ruleSetID, instanceID).Scan(&problemID); err != nil {
		return nil, rules.ProblemDefinition{}, err
	}
	problem, err := loadProblemDomain(ctx, db, ruleSetID, problemID, definitions)
	return definitions, problem, err
}
