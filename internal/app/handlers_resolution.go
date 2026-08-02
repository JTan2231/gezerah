package app

import (
	"context"
	"fmt"
	"net/http"
	"sort"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

type loadedResolutionContext struct {
	Input       rules.ResolutionInput
	Definitions map[rules.ID]rules.StateVariableDefinition
	Entities    map[rules.ID]rules.Entity
}

func (s *Server) handlePreviewChoice(w http.ResponseWriter, r *http.Request) {
	s.handleChoiceOperation(w, r, true)
}

func (s *Server) handleResolveChoice(w http.ResponseWriter, r *http.Request) {
	s.handleChoiceOperation(w, r, false)
}

func (s *Server) handleChoiceOperation(w http.ResponseWriter, r *http.Request, preview bool) {
	ruleSetID, instanceID, choiceID := r.PathValue("rule_set_id"), r.PathValue("problem_instance_id"), r.PathValue("choice_id")
	if !validID(ruleSetID) || !validID(instanceID) || !validID(choiceID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request resolveChoiceRequest
	if err := decodeOptionalProblemJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedBindingRevision != nil && *request.ExpectedBindingRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_binding_revision cannot be negative", map[string]string{"expected_binding_revision": "cannot be negative"})
		return
	}
	for entityID, revision := range request.ExpectedStateRevisions {
		if !validID(entityID) || revision < 0 {
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_state_revisions is invalid", map[string]string{"expected_state_revisions[" + entityID + "]": "entity ID must be a UUID and revision cannot be negative"})
			return
		}
	}
	result, loaded, err := s.runChoiceOperation(r.Context(), ruleSetID, instanceID, choiceID, request, preview)
	if err != nil {
		handleAppError(w, domainRuntimeError(err))
		return
	}
	writeJSON(w, http.StatusOK, resolutionResultToDTO(result, preview, loaded.Entities, loaded.Definitions))
}

func (s *Server) runChoiceOperation(ctx context.Context, ruleSetID, instanceID, choiceID string, request resolveChoiceRequest, preview bool) (rules.ResolutionResult, loadedResolutionContext, error) {
	options := pgx.TxOptions{}
	if preview {
		// Preview takes no locks, so a repeatable-read snapshot keeps every
		// definition, binding, membership, and state read mutually consistent.
		// Resolve uses read committed plus explicit root locks; that avoids
		// surfacing PostgreSQL serialization failures as user-visible 500s under
		// ordinary write contention.
		options.IsoLevel = pgx.RepeatableRead
		options.AccessMode = pgx.ReadOnly
	}
	tx, err := s.db.BeginTx(ctx, options)
	if err != nil {
		return rules.ResolutionResult{}, loadedResolutionContext{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if !preview {
		if err := lockResolutionConfiguration(ctx, tx, ruleSetID, instanceID); err != nil {
			return rules.ResolutionResult{}, loadedResolutionContext{}, err
		}
		if err := lockProblemInstance(ctx, tx, ruleSetID, instanceID); err != nil {
			return rules.ResolutionResult{}, loadedResolutionContext{}, err
		}
	}
	loaded, err := loadResolutionContext(ctx, tx, ruleSetID, instanceID, choiceID, !preview)
	if err != nil {
		return rules.ResolutionResult{}, loadedResolutionContext{}, err
	}
	if err := checkResolutionRevisions(request, loaded.Input.Instance, loaded.Input.Snapshot); err != nil {
		return rules.ResolutionResult{}, loadedResolutionContext{}, err
	}
	result, err := rules.ResolveChoice(loaded.Input)
	if err != nil {
		return rules.ResolutionResult{}, loadedResolutionContext{}, err
	}
	if !preview && result.Status == rules.ResolutionApplied {
		if err := persistResolutionState(ctx, tx, ruleSetID, loaded.Input.Snapshot, &result, loaded.Definitions); err != nil {
			return rules.ResolutionResult{}, loadedResolutionContext{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return rules.ResolutionResult{}, loadedResolutionContext{}, err
	}
	return result, loaded, nil
}

func lockResolutionConfiguration(ctx context.Context, tx pgx.Tx, ruleSetID, instanceID string) error {
	var problemID string
	if err := tx.QueryRow(ctx, `
		select problem_definition_id::text from problem_instances
		where rule_set_id = $1 and entity_id = $2`, ruleSetID, instanceID).Scan(&problemID); err != nil {
		return err
	}
	before, err := conditionIDsForProblem(ctx, tx, ruleSetID, problemID)
	if err != nil {
		return err
	}
	for _, conditionID := range before {
		var locked string
		if err := tx.QueryRow(ctx, `
			select id::text from condition_sets
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, conditionID).Scan(&locked); err != nil {
			return err
		}
	}
	var lockedProblem string
	if err := tx.QueryRow(ctx, `
		select id::text from problem_definitions
		where rule_set_id = $1 and id = $2 for share`, ruleSetID, problemID).Scan(&lockedProblem); err != nil {
		return err
	}
	var currentProblemID string
	if err := tx.QueryRow(ctx, `
		select problem_definition_id::text from problem_instances
		where rule_set_id = $1 and entity_id = $2`, ruleSetID, instanceID).Scan(&currentProblemID); err != nil {
		return err
	}
	after, err := conditionIDsForProblem(ctx, tx, ruleSetID, currentProblemID)
	if err != nil {
		return err
	}
	if currentProblemID != problemID || !ruleIDSlicesEqual(before, after) {
		return &statusError{Status: http.StatusConflict, Code: "configuration_changed", Message: "problem configuration changed while resolution was starting; retry the request"}
	}
	return nil
}

func conditionIDsForProblem(ctx context.Context, db queryer, ruleSetID, problemID string) ([]rules.ID, error) {
	rows, err := db.Query(ctx, `
		select distinct condition_set_id::text from condition_invocations
		where rule_set_id = $1 and problem_definition_id = $2 order by condition_set_id::text`, ruleSetID, problemID)
	if err != nil {
		return nil, err
	}
	result := make([]rules.ID, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		result = append(result, rules.ID(id))
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	return result, nil
}

func lockProblemInstance(ctx context.Context, tx pgx.Tx, ruleSetID, instanceID string) error {
	var locked string
	if err := tx.QueryRow(ctx, `
		select entity_id::text from problem_instances
		where rule_set_id = $1 and entity_id = $2 for update`, ruleSetID, instanceID).Scan(&locked); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `
		select id::text from problem_instance_target_bindings
		where rule_set_id = $1 and problem_instance_id = $2 order by id for update`, ruleSetID, instanceID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var ignored string
		if err := rows.Scan(&ignored); err != nil {
			rows.Close()
			return err
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	return nil
}

func loadResolutionContext(ctx context.Context, tx pgx.Tx, ruleSetID, instanceID, choiceID string, lockState bool) (loadedResolutionContext, error) {
	var loaded loadedResolutionContext
	definitions, problem, err := loadProblemForInstance(ctx, tx, ruleSetID, instanceID)
	if err != nil {
		return loaded, err
	}
	conditions, err := loadConditionsDomain(ctx, tx, ruleSetID, definitions)
	if err != nil {
		return loaded, err
	}
	schemas, err := loadOwnerSchemasDomain(ctx, tx, ruleSetID)
	if err != nil {
		return loaded, err
	}
	instance, err := loadProblemInstanceDomain(ctx, tx, ruleSetID, instanceID, problem)
	if err != nil {
		return loaded, err
	}
	entityIDs := boundEntityIDs(instance.Instance.Bindings)
	if lockState {
		if err := lockEntityAndStateRoots(ctx, tx, ruleSetID, entityIDs); err != nil {
			return loaded, err
		}
	}
	// Reload memberships only after the entity/state locks. This mirrors the
	// entity editor's lock order and prevents resolution from using a schema
	// snapshot captured before a concurrent membership update committed.
	entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
	if err != nil {
		return loaded, err
	}
	snapshot := rules.StateSnapshot{Records: make(map[rules.ID]rules.StateRecord, len(entityIDs))}
	for _, entityID := range entityIDs {
		record, err := loadStateRecord(ctx, tx, ruleSetID, string(entityID))
		if err != nil {
			return loaded, err
		}
		snapshot.Records[entityID] = record
	}
	loaded.Definitions, loaded.Entities = definitions, entities
	loaded.Input = rules.ResolutionInput{
		Problem: problem, Instance: instance.Instance, ChoiceID: rules.ID(choiceID),
		OwnerSchemas: schemas, Entities: entities, Definitions: definitions, Conditions: conditions,
		Bindings: instance.Instance.Bindings, Snapshot: snapshot,
	}
	return loaded, nil
}

func boundEntityIDs(bindings rules.TargetBindings) []rules.ID {
	set := make(map[rules.ID]struct{})
	for _, entityIDs := range bindings {
		for _, entityID := range entityIDs {
			set[entityID] = struct{}{}
		}
	}
	result := make([]rules.ID, 0, len(set))
	for entityID := range set {
		result = append(result, entityID)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func checkResolutionRevisions(request resolveChoiceRequest, instance rules.ProblemInstance, snapshot rules.StateSnapshot) error {
	if request.ExpectedBindingRevision != nil && *request.ExpectedBindingRevision != instance.BindingRevision {
		return revisionConflict("binding", *request.ExpectedBindingRevision, instance.BindingRevision)
	}
	for entityID, expected := range request.ExpectedStateRevisions {
		record, exists := snapshot.Records[rules.ID(entityID)]
		if !exists {
			return &statusError{
				Status: http.StatusUnprocessableEntity, Code: "invalid_revision_guard",
				Message: "state revision guard names an entity outside the current binding context",
				Fields:  map[string]string{"expected_state_revisions[" + entityID + "]": "entity is not reachable through current target bindings"},
			}
		}
		if record.Revision != expected {
			return &statusError{
				Status: http.StatusConflict, Code: "revision_conflict", Message: "state changed since it was loaded",
				Fields: map[string]string{
					"entity_id": entityID, "expected_revision": fmt.Sprint(expected), "actual_revision": fmt.Sprint(record.Revision),
				},
			}
		}
	}
	return nil
}

func persistResolutionState(ctx context.Context, tx pgx.Tx, ruleSetID string, before rules.StateSnapshot, result *rules.ResolutionResult, definitions map[rules.ID]rules.StateVariableDefinition) error {
	entityIDs := append([]rules.ID(nil), result.ChangedRecordIDs...)
	sort.Slice(entityIDs, func(i, j int) bool { return entityIDs[i] < entityIDs[j] })
	for _, entityID := range entityIDs {
		current, currentExists := before.Records[entityID]
		updated, updatedExists := result.State.Records[entityID]
		if !currentExists || !updatedExists {
			return fmt.Errorf("resolver changed record %s outside its snapshot", entityID)
		}
		if stateMapsEqual(current.Values, updated.Values) {
			continue
		}
		if _, err := tx.Exec(ctx, `
			delete from state_values where rule_set_id = $1 and owner_entity_id = $2`, ruleSetID, entityID); err != nil {
			return err
		}
		definitionIDs := make([]rules.ID, 0, len(updated.Values))
		for definitionID := range updated.Values {
			definitionIDs = append(definitionIDs, definitionID)
		}
		sort.Slice(definitionIDs, func(i, j int) bool { return definitionIDs[i] < definitionIDs[j] })
		for _, definitionID := range definitionIDs {
			definition, exists := definitions[definitionID]
			if !exists {
				return fmt.Errorf("resolved state references missing definition %s", definitionID)
			}
			for position, scalar := range updated.Values[definitionID].Values {
				if err := insertStateScalar(ctx, tx, ruleSetID, string(entityID), definition, position, scalar); err != nil {
					return err
				}
			}
		}
		var revision int64
		var updatedAt any
		if err := tx.QueryRow(ctx, `
			update state_records set revision = revision + 1
			where rule_set_id = $1 and owner_entity_id = $2
			returning revision, updated_at`, ruleSetID, entityID).Scan(&revision, &updatedAt); err != nil {
			return err
		}
		refreshed, err := loadStateRecord(ctx, tx, ruleSetID, string(entityID))
		if err != nil {
			return err
		}
		result.State.Records[entityID] = refreshed
	}
	return nil
}

func ruleIDSlicesEqual(left, right []rules.ID) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
