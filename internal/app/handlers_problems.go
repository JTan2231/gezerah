package app

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

// registerProblemRoutes is intentionally separate from the shared route file
// so the server bootstrap can opt into the complete problem/runtime module in
// one call.
func (s *Server) registerProblemRoutes() {
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/problem-definitions", s.handleListProblems)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/problem-definitions", s.handleCreateProblem)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}", s.handleGetProblem)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}", s.handlePutProblem)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}/duplicate", s.handleDuplicateProblem)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/problem-definitions/{problem_definition_id}/archive", s.handleArchiveProblem)

	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/problem-instances", s.handleListProblemInstances)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/problem-instances", s.handleCreateProblemInstance)
	s.api.HandleFunc("GET /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}", s.handleGetProblemInstance)
	s.api.HandleFunc("PUT /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/bindings", s.handlePutProblemBindings)

	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/preview", s.handlePreviewChoice)
	s.api.HandleFunc("POST /api/rule-sets/{rule_set_id}/problem-instances/{problem_instance_id}/choices/{choice_id}/resolve", s.handleResolveChoice)
}

func (s *Server) handleListProblems(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	type listSnapshot struct {
		definitions map[rules.ID]rules.StateVariableDefinition
		problems    map[rules.ID]rules.ProblemDefinition
	}
	snapshot, err := readProblemSnapshot(r.Context(), s, func(tx pgx.Tx) (listSnapshot, error) {
		definitions, err := loadDefinitionsDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return listSnapshot{}, err
		}
		problems, err := loadProblemsDomain(r.Context(), tx, ruleSetID, definitions)
		if err != nil {
			return listSnapshot{}, err
		}
		schemas, err := loadOwnerSchemasDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return listSnapshot{}, err
		}
		entities, err := loadEntitiesDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return listSnapshot{}, err
		}
		conditions, err := loadConditionsDomain(r.Context(), tx, ruleSetID, definitions)
		if err != nil {
			return listSnapshot{}, err
		}
		for id, problem := range problems {
			if validation := rules.ValidateProblemDefinition(problem, schemas, definitions, conditions, entities); len(validation) > 0 {
				return listSnapshot{}, fmt.Errorf("stored problem %s is invalid: %w", id, validation)
			}
		}
		return listSnapshot{definitions: definitions, problems: problems}, nil
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	archived := r.URL.Query().Get("archived")
	items := make([]problemDefinitionResponse, 0, len(snapshot.problems))
	for _, problem := range sortedProblemSlice(snapshot.problems) {
		if archived == "true" && !problem.Archived || archived == "false" && problem.Archived {
			continue
		}
		items = append(items, problemToResponse(problem, snapshot.definitions))
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateProblem(w http.ResponseWriter, r *http.Request) {
	ruleSetID := r.PathValue("rule_set_id")
	if !validID(ruleSetID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "ruleset ID is malformed", nil)
		return
	}
	var request saveProblemDefinitionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Archived = false
	problem, _, err := s.validateProblemRequest(r, ruleSetID, "", request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	saved, err := saveProblemDomain(r.Context(), s, ruleSetID, "", problem)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := loadOneProblemSnapshot(r.Context(), s, ruleSetID, string(saved.ID))
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/problem-definitions/%s", ruleSetID, saved.ID))
	writeJSON(w, http.StatusCreated, problemToResponse(snapshot.Problem, snapshot.Definitions))
}

func (s *Server) handleGetProblem(w http.ResponseWriter, r *http.Request) {
	ruleSetID, problemID := r.PathValue("rule_set_id"), r.PathValue("problem_definition_id")
	if !validID(ruleSetID) || !validID(problemID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	snapshot, err := loadOneProblemSnapshot(r.Context(), s, ruleSetID, problemID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, problemToResponse(snapshot.Problem, snapshot.Definitions))
}

func (s *Server) handlePutProblem(w http.ResponseWriter, r *http.Request) {
	ruleSetID, problemID := r.PathValue("rule_set_id"), r.PathValue("problem_definition_id")
	if !validID(ruleSetID) || !validID(problemID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request saveProblemDefinitionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != problemID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	request.ID = problemID
	problem, _, err := s.validateProblemRequest(r, ruleSetID, problemID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	saved, err := saveProblemDomain(r.Context(), s, ruleSetID, problemID, problem)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := loadOneProblemSnapshot(r.Context(), s, ruleSetID, string(saved.ID))
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, problemToResponse(snapshot.Problem, snapshot.Definitions))
}

func (s *Server) handleDuplicateProblem(w http.ResponseWriter, r *http.Request) {
	ruleSetID, problemID := r.PathValue("rule_set_id"), r.PathValue("problem_definition_id")
	if !validID(ruleSetID) || !validID(problemID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request duplicateProblemRequest
	if err := decodeOptionalProblemJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	type duplicateSnapshot struct {
		problem     rules.ProblemDefinition
		definitions map[rules.ID]rules.StateVariableDefinition
		schemas     map[rules.ID]rules.OwnerSchema
		entities    map[rules.ID]rules.Entity
		conditions  map[rules.ID]rules.ConditionSet
	}
	loaded, err := readProblemSnapshot(r.Context(), s, func(tx pgx.Tx) (duplicateSnapshot, error) {
		definitions, err := loadDefinitionsDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return duplicateSnapshot{}, err
		}
		original, err := loadProblemDomain(r.Context(), tx, ruleSetID, problemID, definitions)
		if err != nil {
			return duplicateSnapshot{}, err
		}
		schemas, err := loadOwnerSchemasDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return duplicateSnapshot{}, err
		}
		entities, err := loadEntitiesDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return duplicateSnapshot{}, err
		}
		conditions, err := loadConditionsDomain(r.Context(), tx, ruleSetID, definitions)
		return duplicateSnapshot{problem: original, definitions: definitions, schemas: schemas, entities: entities, conditions: conditions}, err
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	original, definitions := loaded.problem, loaded.definitions
	key, name := "", ""
	if request.Key != nil {
		key = strings.TrimSpace(*request.Key)
	}
	if request.Name != nil {
		name = strings.TrimSpace(*request.Name)
	}
	if key == "" {
		suffix, generateErr := newID()
		if generateErr != nil {
			handleAppError(w, generateErr)
			return
		}
		key = original.Key + "-copy-" + suffix[:8]
	}
	if name == "" {
		name = original.Name + " copy"
	}
	duplicate, err := duplicateProblemDomain(original, key, name)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if fields := validateProblemUUIDs(duplicate); len(fields) > 0 {
		handleAppError(w, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "problem duplicate is invalid", Fields: fields})
		return
	}
	if validation := rules.ValidateProblemDefinition(duplicate, loaded.schemas, definitions, loaded.conditions, loaded.entities); len(validation) > 0 {
		handleAppError(w, validationStatus("problem duplicate is invalid", validation))
		return
	}
	if fields := archivedProblemReferenceFields(duplicate, rules.ProblemDefinition{}, loaded.schemas, definitions, loaded.conditions); len(fields) > 0 {
		handleAppError(w, &statusError{
			Status: http.StatusUnprocessableEntity, Code: "archived_reference",
			Message: "archived resources cannot receive new problem references", Fields: fields,
		})
		return
	}
	saved, err := saveProblemDomain(r.Context(), s, ruleSetID, "", duplicate)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := loadOneProblemSnapshot(r.Context(), s, ruleSetID, string(saved.ID))
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/rule-sets/%s/problem-definitions/%s", ruleSetID, saved.ID))
	writeJSON(w, http.StatusCreated, problemToResponse(snapshot.Problem, snapshot.Definitions))
}

func (s *Server) handleArchiveProblem(w http.ResponseWriter, r *http.Request) {
	ruleSetID, problemID := r.PathValue("rule_set_id"), r.PathValue("problem_definition_id")
	if !validID(ruleSetID) || !validID(problemID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	command, err := s.db.Exec(r.Context(), `
		update problem_definitions set archived = true
		where rule_set_id = $1 and id = $2`, ruleSetID, problemID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() == 0 {
		handleAppError(w, &statusError{Status: http.StatusNotFound, Code: "not_found", Message: "problem definition not found"})
		return
	}
	snapshot, err := loadOneProblemSnapshot(r.Context(), s, ruleSetID, problemID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, problemToResponse(snapshot.Problem, snapshot.Definitions))
}

func (s *Server) validateProblemRequest(r *http.Request, ruleSetID, existingID string, request saveProblemDefinitionRequest) (rules.ProblemDefinition, map[rules.ID]rules.StateVariableDefinition, error) {
	type validationSnapshot struct {
		problem     rules.ProblemDefinition
		definitions map[rules.ID]rules.StateVariableDefinition
	}
	loaded, err := readProblemSnapshot(r.Context(), s, func(tx pgx.Tx) (validationSnapshot, error) {
		definitions, err := loadDefinitionsDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return validationSnapshot{}, err
		}
		problem, err := problemRequestToDomain(request, ruleSetID, definitions)
		if err != nil {
			return validationSnapshot{}, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: err.Error()}
		}
		fields := validateProblemUUIDs(problem)
		validateKey(fields, "key", problem.Key)
		validateRequired(fields, "name", problem.Name, 200)
		if len(fields) > 0 {
			return validationSnapshot{}, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "problem definition is invalid", Fields: fields}
		}
		schemas, err := loadOwnerSchemasDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return validationSnapshot{}, err
		}
		entities, err := loadEntitiesDomain(r.Context(), tx, ruleSetID)
		if err != nil {
			return validationSnapshot{}, err
		}
		conditions, err := loadConditionsDomain(r.Context(), tx, ruleSetID, definitions)
		if err != nil {
			return validationSnapshot{}, err
		}
		if validation := rules.ValidateProblemDefinition(problem, schemas, definitions, conditions, entities); len(validation) > 0 {
			return validationSnapshot{}, validationStatus("problem definition is invalid", validation)
		}
		var current rules.ProblemDefinition
		if existingID != "" {
			current, err = loadProblemDomain(r.Context(), tx, ruleSetID, existingID, definitions)
			if err != nil {
				return validationSnapshot{}, err
			}
		}
		if fields := archivedProblemReferenceFields(problem, current, schemas, definitions, conditions); len(fields) > 0 {
			return validationSnapshot{}, &statusError{
				Status: http.StatusUnprocessableEntity, Code: "archived_reference",
				Message: "archived resources cannot receive new problem references", Fields: fields,
			}
		}
		return validationSnapshot{problem: problem, definitions: definitions}, nil
	})
	return loaded.problem, loaded.definitions, err
}

func decodeOptionalProblemJSON(r *http.Request, value any) error {
	if r.Body == nil {
		return nil
	}
	data, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(data)) == "" {
		return nil
	}
	return decodeStrictBytes(data, value, true)
}
