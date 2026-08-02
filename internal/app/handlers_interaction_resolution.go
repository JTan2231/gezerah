package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func (s *Server) registerInteractionResolutionRoutes() {
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/preview", s.handlePreviewInteraction)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/resolve", s.handleResolveInteraction)
}

func (s *Server) handlePreviewInteraction(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionAdjudication(w, r, true)
}

func (s *Server) handleResolveInteraction(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionAdjudication(w, r, false)
}

func (s *Server) handleInteractionAdjudication(w http.ResponseWriter, r *http.Request, preview bool) {
	gameID, interactionID := r.PathValue("game_id"), r.PathValue("interaction_id")
	if !validID(gameID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request adjudicateInteractionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if fields := validateAdjudicationRequest(&request, !preview); len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "ruling is invalid", fields)
		return
	}
	if len(request.Effects) > 100 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "ruling is invalid", map[string]string{"effects": "must contain at most 100 effects"})
		return
	}

	result, err := s.runInteractionAdjudication(r.Context(), r, gameID, interactionID, request, preview)
	if err != nil {
		handleAppError(w, domainRuntimeError(err))
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) runInteractionAdjudication(
	ctx context.Context,
	r *http.Request,
	gameID, interactionID string,
	request adjudicateInteractionRequest,
	preview bool,
) (interactionResolutionResultResponse, error) {
	options := pgx.TxOptions{}
	if preview {
		options.IsoLevel = pgx.RepeatableRead
		options.AccessMode = pgx.ReadOnly
	}
	tx, err := s.db.BeginTx(ctx, options)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	userID, err := requireKnownPlayActor(ctx, tx, r)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	var actor authorizedGameMember
	var ruleSetID string
	if preview {
		actor, ruleSetID, err = requireActiveGameForPreview(ctx, tx, gameID, userID)
	} else {
		actor, ruleSetID, _, err = lockGameForFacilitator(ctx, tx, gameID, userID)
	}
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}

	if !preview {
		replayed, found, replayErr := loadIdempotentResolutionResult(ctx, tx, gameID, interactionID, request, ruleSetID)
		if replayErr != nil {
			return interactionResolutionResultResponse{}, replayErr
		}
		if found {
			if err := tx.Commit(ctx); err != nil {
				return interactionResolutionResultResponse{}, err
			}
			return replayed, nil
		}
	}

	status, revision, err := loadInteractionAdjudicationRoot(ctx, tx, gameID, interactionID, !preview)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	if status != "adjudicating" {
		return interactionResolutionResultResponse{}, &statusError{
			Status: http.StatusConflict, Code: "interaction_not_adjudicating",
			Message: "the interaction must be closed for adjudication before it can be previewed or resolved",
		}
	}
	if revision != *request.ExpectedRevision {
		return interactionResolutionResultResponse{}, revisionConflict("interaction", *request.ExpectedRevision, revision)
	}
	if err := validateSelectedInteractionAction(ctx, tx, gameID, interactionID, request.SelectedActionID, !preview); err != nil {
		return interactionResolutionResultResponse{}, err
	}

	var gameEntityIDs []string
	if preview {
		gameEntityIDs, err = loadStringColumn(ctx, tx, `
			select entity_id::text from game_entities where game_id = $1 order by entity_id`, gameID)
	} else {
		gameEntityIDs, err = lockCurrentGameEntityIDs(ctx, tx, gameID)
	}
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	if !preview {
		if err := lockRuleSetDefinitions(ctx, tx, ruleSetID); err != nil {
			return interactionResolutionResultResponse{}, err
		}
		if err := lockEntityAndStateRoots(ctx, tx, ruleSetID, stringIDs(gameEntityIDs)); err != nil {
			return interactionResolutionResultResponse{}, err
		}
	}

	definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	planEffects, err := concreteEffectsDTOToDomain(request.Effects, definitions)
	if err != nil {
		return interactionResolutionResultResponse{}, &statusError{
			Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "ruling effects are invalid",
			Fields: map[string]string{"effects": err.Error()},
		}
	}
	gameEntitySet := make(map[string]struct{}, len(gameEntityIDs))
	for _, entityID := range gameEntityIDs {
		gameEntitySet[entityID] = struct{}{}
	}
	for effectIndex, effect := range request.Effects {
		for entityIndex, entityID := range effect.EntityIDs {
			if _, belongsToGame := gameEntitySet[entityID]; !belongsToGame {
				continue
			}
			readiness, err := loadEntityCharacterReadiness(ctx, tx, gameID, entityID)
			if err != nil {
				return interactionResolutionResultResponse{}, err
			}
			if readiness.Status == characterStatusSetupRequired {
				return interactionResolutionResultResponse{}, &statusError{
					Status: http.StatusConflict, Code: "character_setup_required",
					Message: "ruling effects cannot target a controlled character with incomplete setup",
					Fields: map[string]string{
						fmt.Sprintf("effects[%d].entity_ids[%d]", effectIndex, entityIndex): "character setup is incomplete",
					},
				}
			}
		}
	}
	plan := rules.TransitionPlan{Effects: planEffects}
	entities, err := loadGameEntitiesDomain(ctx, tx, ruleSetID, gameEntityIDs)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	targetIDs := transitionTargetIDs(plan)
	snapshot, err := loadTransitionSnapshot(ctx, tx, ruleSetID, targetIDs)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}
	transition, err := rules.ApplyTransition(plan, entities, definitions, snapshot)
	if err != nil {
		return interactionResolutionResultResponse{}, err
	}

	interactionRevision := revision
	if !preview {
		persisted := rules.ResolutionResult{State: transition.State, ChangedRecordIDs: transition.ChangedRecordIDs}
		if err := persistResolutionState(ctx, tx, ruleSetID, snapshot, &persisted, definitions); err != nil {
			return interactionResolutionResultResponse{}, err
		}
		transition.State = persisted.State
		resolutionID, err := insertInteractionResolutionReceipt(ctx, tx, gameID, ruleSetID, interactionID, actor.ID, request, plan, transition)
		if err != nil {
			return interactionResolutionResultResponse{}, err
		}
		if err := tx.QueryRow(ctx, `
			update interactions set status = 'resolved', resolved_at = now(), revision = revision + 1
			where game_id = $1 and id = $2 and status = 'adjudicating'
			returning revision`, gameID, interactionID).Scan(&interactionRevision); err != nil {
			return interactionResolutionResultResponse{}, err
		}
		if err := appendResolutionAppliedEvent(ctx, tx, gameID, interactionID, resolutionID, actor.ID); err != nil {
			return interactionResolutionResultResponse{}, err
		}
	}

	response := transitionResultToResponse(preview, interactionID, interactionRevision, request.Narrative, transition, entities, definitions)
	if err := tx.Commit(ctx); err != nil {
		return interactionResolutionResultResponse{}, err
	}
	return response, nil
}

func requireActiveGameForPreview(ctx context.Context, db queryer, gameID, userID string) (authorizedGameMember, string, error) {
	var ruleSetID, status string
	if err := db.QueryRow(ctx, `select rule_set_id::text, status from games where id = $1`, gameID).Scan(&ruleSetID, &status); err != nil {
		return authorizedGameMember{}, "", err
	}
	member, err := requireGameFacilitator(ctx, db, gameID, userID)
	if err != nil {
		return member, "", err
	}
	if status != "active" {
		return member, "", &statusError{Status: http.StatusConflict, Code: "game_archived", Message: "archived games cannot be changed"}
	}
	return member, ruleSetID, nil
}

func loadInteractionAdjudicationRoot(ctx context.Context, db queryer, gameID, interactionID string, lock bool) (string, int64, error) {
	statement := `select status, revision from interactions where game_id = $1 and id = $2`
	if lock {
		statement += ` for update`
	}
	var status string
	var revision int64
	if err := db.QueryRow(ctx, statement, gameID, interactionID).Scan(&status, &revision); err != nil {
		return "", 0, err
	}
	return status, revision, nil
}

func validateSelectedInteractionAction(ctx context.Context, db queryer, gameID, interactionID string, actionID *string, lock bool) error {
	if actionID == nil {
		return nil
	}
	statement := `select status from interaction_action_submissions where game_id = $1 and interaction_id = $2 and id = $3`
	if lock {
		statement += ` for update`
	}
	var status string
	err := db.QueryRow(ctx, statement, gameID, interactionID, *actionID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return &statusError{Status: http.StatusUnprocessableEntity, Code: "invalid_selected_action", Message: "selected action does not belong to this interaction", Fields: map[string]string{"selected_action_id": "action does not belong to this interaction"}}
	}
	if err != nil {
		return err
	}
	if status != "submitted" {
		return &statusError{Status: http.StatusConflict, Code: "action_not_selectable", Message: "selected action is no longer submitted", Fields: map[string]string{"selected_action_id": "action is no longer selectable"}}
	}
	return nil
}

func lockRuleSetDefinitions(ctx context.Context, tx pgx.Tx, ruleSetID string) error {
	rows, err := tx.Query(ctx, `
		select id::text from state_variable_definitions
		where rule_set_id = $1 order by id for share`, ruleSetID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ignored string
		if err := rows.Scan(&ignored); err != nil {
			return err
		}
	}
	return rows.Err()
}

func loadGameEntitiesDomain(ctx context.Context, db queryer, ruleSetID string, gameEntityIDs []string) (map[rules.ID]rules.Entity, error) {
	all, err := loadEntitiesDomain(ctx, db, ruleSetID)
	if err != nil {
		return nil, err
	}
	result := make(map[rules.ID]rules.Entity, len(gameEntityIDs))
	for _, rawID := range gameEntityIDs {
		id := rules.ID(rawID)
		entity, exists := all[id]
		if !exists {
			return nil, fmt.Errorf("game entity %s is missing from ruleset %s", id, ruleSetID)
		}
		result[id] = entity
	}
	return result, nil
}

func transitionTargetIDs(plan rules.TransitionPlan) []rules.ID {
	set := make(map[rules.ID]struct{})
	for _, effect := range plan.Effects {
		for _, entityID := range effect.EntityIDs {
			set[entityID] = struct{}{}
		}
	}
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func loadTransitionSnapshot(ctx context.Context, db queryer, ruleSetID string, entityIDs []rules.ID) (rules.StateSnapshot, error) {
	result := rules.StateSnapshot{Records: make(map[rules.ID]rules.StateRecord, len(entityIDs))}
	for _, entityID := range entityIDs {
		record, err := loadStateRecord(ctx, db, ruleSetID, string(entityID))
		if err != nil {
			return rules.StateSnapshot{}, err
		}
		result.Records[entityID] = record
	}
	return result, nil
}

func transitionResultToResponse(
	preview bool,
	interactionID string,
	interactionRevision int64,
	narrative string,
	result rules.TransitionResult,
	entities map[rules.ID]rules.Entity,
	definitions map[rules.ID]rules.StateVariableDefinition,
) interactionResolutionResultResponse {
	response := interactionResolutionResultResponse{
		Preview: preview, InteractionID: interactionID, InteractionRevision: interactionRevision,
		Narrative:      strings.TrimSpace(narrative),
		AppliedEffects: make([]concreteAppliedEffectResponse, 0, len(result.AppliedEffects)),
		State:          resolutionStateDTO{Records: make(map[string]stateRecordResponse, len(result.State.Records))},
	}
	for _, applied := range result.AppliedEffects {
		item := concreteAppliedEffectResponse{
			EffectID: string(applied.EffectID), EntityID: string(applied.EntityID),
			StateVariableID: string(applied.StateVariableID), Changed: applied.Changed,
		}
		definition := definitions[applied.StateVariableID]
		if applied.Before != nil {
			before := stateValueDomainToDTO(*applied.Before, definition)
			item.Before = &before
		}
		if applied.After != nil {
			after := stateValueDomainToDTO(*applied.After, definition)
			item.After = &after
		}
		response.AppliedEffects = append(response.AppliedEffects, item)
	}
	for entityID, record := range result.State.Records {
		entity, exists := entities[entityID]
		if !exists {
			continue
		}
		logical := rules.MaterializeLogicalState(entity, record, definitions)
		state := stateRecordResponse{
			OwnerEntityID: string(entityID), Revision: record.Revision, UpdatedAt: record.UpdatedAt,
			Values:                 make(map[string]stateValueDTO, len(logical.Values)),
			DefaultedDefinitionIDs: idsToStrings(logical.DefaultedDefinitionIDs),
			UnknownDefinitionIDs:   idsToStrings(logical.UnknownDefinitionIDs),
		}
		for definitionID, value := range logical.Values {
			state.Values[string(definitionID)] = stateValueDomainToDTO(value, definitions[definitionID])
		}
		response.State.Records[string(entityID)] = state
	}
	return response
}

func appendResolutionAppliedEvent(ctx context.Context, tx pgx.Tx, gameID, interactionID, resolutionID, actorMembershipID string) error {
	_, err := tx.Exec(ctx, `
		insert into game_events (game_id, event_type, actor_membership_id, interaction_id, resolution_id)
		values ($1, 'resolution-applied', $2, $3, $4)`, gameID, actorMembershipID, interactionID, resolutionID)
	return err
}

func loadIdempotentResolutionResult(
	ctx context.Context,
	db queryer,
	gameID, interactionID string,
	request adjudicateInteractionRequest,
	ruleSetID string,
) (interactionResolutionResultResponse, bool, error) {
	var existingInteractionID string
	err := db.QueryRow(ctx, `
		select interaction_id::text from interaction_resolutions
		where game_id = $1 and idempotency_key = $2 and status = 'applied'`, gameID, request.IdempotencyKey,
	).Scan(&existingInteractionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return interactionResolutionResultResponse{}, false, nil
	}
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	if existingInteractionID != interactionID {
		return interactionResolutionResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was already used for another interaction",
		}
	}
	definitions, err := loadDefinitionsDomain(ctx, db, ruleSetID)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	receipt, err := loadInteractionResolutionResponse(ctx, db, gameID, interactionID, definitions, true)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	if receipt == nil {
		return interactionResolutionResultResponse{}, false, fmt.Errorf("applied idempotent resolution has no receipt")
	}
	if !adjudicationMatchesReceipt(request, *receipt, definitions) {
		return interactionResolutionResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was already used with a different ruling",
		}
	}
	var revision int64
	if err := db.QueryRow(ctx, `select revision from interactions where game_id = $1 and id = $2`, gameID, interactionID).Scan(&revision); err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	entitySet := make(map[rules.ID]struct{})
	for _, applied := range receipt.AppliedEffects {
		entitySet[rules.ID(applied.EntityID)] = struct{}{}
	}
	entityIDs := sortedRuleIDs(entitySet)
	gameEntityIDs, err := loadStringColumn(ctx, db, `
		select entity_id::text from game_entities where game_id = $1 order by entity_id`, gameID)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	entities, err := loadGameEntitiesDomain(ctx, db, ruleSetID, gameEntityIDs)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	snapshot, err := loadTransitionSnapshot(ctx, db, ruleSetID, entityIDs)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	response := transitionResultToResponse(false, interactionID, revision, receipt.Narrative, rules.TransitionResult{State: snapshot}, entities, definitions)
	response.Replayed = true
	response.AppliedEffects = receipt.AppliedEffects
	return response, true, nil
}

func adjudicationMatchesReceipt(request adjudicateInteractionRequest, receipt interactionResolutionResponse, definitions map[rules.ID]rules.StateVariableDefinition) bool {
	if strings.TrimSpace(request.Narrative) != receipt.Narrative ||
		!optionalStringsEqual(request.SelectedActionID, receipt.SelectedActionID) ||
		!optionalStringsEqual(cleanOptional(request.ActionSummary), receipt.ActionSummary) ||
		!optionalStringsEqual(cleanOptional(request.PrivateNotes), receipt.PrivateNotes) ||
		len(request.Effects) != len(receipt.Effects) {
		return false
	}
	comparisonDefinitions := make(map[rules.ID]rules.StateVariableDefinition, len(definitions))
	for id, definition := range definitions {
		definition.Archived = false
		comparisonDefinitions[id] = definition
	}
	for position := range request.Effects {
		requested := request.Effects[position]
		stored := receipt.Effects[position]
		left, err := concreteEffectDTOToDomain(requested, position, comparisonDefinitions)
		if err != nil {
			return false
		}
		right, err := concreteEffectDTOToDomain(stored, position, comparisonDefinitions)
		if err != nil {
			return false
		}
		if requested.ID != "" && left.ID != right.ID {
			return false
		}
		if left.Position != right.Position || left.Operation != right.Operation ||
			left.StateVariableID != right.StateVariableID || !ruleIDSlicesEqual(left.EntityIDs, right.EntityIDs) ||
			!optionalStateValuesEquivalent(left.Operand, right.Operand) ||
			!optionalDecimalsEqual(left.AdjustmentAmount, right.AdjustmentAmount) {
			return false
		}
	}
	return true
}

func optionalStringsEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func optionalStateValuesEquivalent(left, right *rules.StateValue) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return rules.StateValuesEqual(*left, *right)
}

func optionalDecimalsEqual(left, right *rules.Decimal) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Equal(*right)
}
