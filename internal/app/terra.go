package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const (
	terraFacilitatorSource = "terra"
	agentFacilitatorSource = "agent"
)

func isAutomatedFacilitatorSource(source string) bool {
	return source == terraFacilitatorSource || source == agentFacilitatorSource
}

func (s *Server) handleContinueTerra(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}
	if err := requireTerraReadyCurrentPlayerRequest(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if s.models == nil {
		handleAppError(w, modelProviderUnavailable())
		return
	}
	if err := requireEmptyTerraRequest(r); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if err := requireNoUnfinishedInteraction(r.Context(), s.db, worldID); err != nil {
		handleAppError(w, err)
		return
	}

	snapshot, err := s.loadTerraModelContextSnapshot(r.Context(), worldID, "", nil, nil)
	if err != nil {
		handleAppError(w, err)
		return
	}
	contextJSON, err := json.Marshal(snapshot)
	if err != nil {
		handleAppError(w, err)
		return
	}
	prompt, err := s.models.GenerateProblem(r.Context(), contextJSON)
	if err != nil {
		handleAppError(w, modelCallFailed(err))
		return
	}
	prompt = strings.TrimSpace(prompt)
	fields := map[string]string{}
	validateRequired(fields, "prompt", prompt, 10000)
	if len(fields) > 0 {
		handleAppError(w, invalidModelOutput("generated problem is invalid", fields))
		return
	}

	interactionID, err := s.createAndPresentTerraInteraction(r.Context(), r, worldID, prompt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadInteractionResponseSnapshot(r.Context(), worldID, interactionID, false)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/worlds/%s/interactions/%s", worldID, interactionID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleDecideTerraInteraction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	if err := requireTerraReadyCurrentPlayerRequest(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if s.models == nil {
		handleAppError(w, modelProviderUnavailable())
		return
	}
	var request terraDecideRequest
	if err := decodeModelRequest(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if fields := validateTerraDecideRequest(request); len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "Terra decision request is invalid", fields)
		return
	}

	replay, found, err := s.loadTerraResolutionReplay(
		r.Context(), worldID, interactionID, strings.TrimSpace(request.IdempotencyKey),
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if found {
		writeJSON(w, http.StatusOK, replay)
		return
	}

	adjudicatingRevision, err := s.beginTerraAdjudication(
		r.Context(), r, worldID, interactionID, *request.ExpectedRevision,
		*request.ExpectedRulesRevision,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := s.loadTerraModelContextSnapshot(
		r.Context(), worldID, interactionID, &adjudicatingRevision,
		request.ExpectedRulesRevision,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	contextJSON, err := json.Marshal(snapshot)
	if err != nil {
		handleAppError(w, err)
		return
	}
	narrative, err := s.models.GenerateConsequence(r.Context(), contextJSON)
	if err != nil {
		handleAppError(w, modelCallFailed(err))
		return
	}
	narrative = strings.TrimSpace(narrative)
	fields := map[string]string{}
	validateRequired(fields, "narrative", narrative, 20000)
	if len(fields) > 0 {
		handleAppError(w, invalidModelOutput("generated consequence is invalid", fields))
		return
	}
	structured, err := s.models.CompileConsequence(r.Context(), contextJSON, narrative)
	if err != nil {
		handleAppError(w, modelCallFailed(err))
		return
	}
	effects, selectedActionID, actionSummary, fields, err := materializeLunaConsequence(snapshot, structured)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if len(fields) > 0 {
		handleAppError(w, invalidModelOutput("compiled consequence is invalid", fields))
		return
	}
	adjudication := adjudicateInteractionRequest{
		ExpectedRevision: &adjudicatingRevision, ExpectedRulesRevision: request.ExpectedRulesRevision,
		IdempotencyKey: strings.TrimSpace(request.IdempotencyKey), SelectedActionID: selectedActionID,
		ActionSummary: actionSummary, Narrative: narrative, Effects: effects,
	}
	if fields := validateAdjudicationRequest(&adjudication, true); len(fields) > 0 {
		handleAppError(w, invalidModelOutput("compiled consequence is invalid", fields))
		return
	}
	if _, err := s.previewInteractionConsequenceAs(
		r.Context(), r, worldID, interactionID, adjudication, terraFacilitatorSource,
	); err != nil {
		handleAppError(w, err)
		return
	}
	result, err := s.resolveInteractionAs(
		r.Context(), r, worldID, interactionID, adjudication, terraFacilitatorSource,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func requireTerraReadyCurrentPlayerRequest(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID string,
) error {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return err
	}
	return requireTerraReadyCurrentPlayer(ctx, db, member)
}

func requireTerraReadyCurrentPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) error {
	return requireAutomatedReadyCurrentPlayer(ctx, db, member, terraFacilitatorSource, "Terra")
}

func requireAgentReadyCurrentPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) error {
	return requireAutomatedReadyCurrentPlayer(ctx, db, member, agentFacilitatorSource, "the agent")
}

func requireAutomatedReadyCurrentPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
	source, label string,
) error {
	if err := requireFacilitatorSource(ctx, db, member.WorldID, source, label); err != nil {
		return err
	}
	if member.Role == "spectator" || member.Facilitator {
		return &statusError{
			Status: http.StatusForbidden, Code: "player_required",
			Message: "only a ready current player may pace " + label,
		}
	}
	if err := requireInteractionPlayAccess(ctx, db, member); err != nil {
		return err
	}
	return nil
}

func requireAssignedAutomatedReadyCurrentPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) (string, error) {
	var source string
	if err := db.QueryRow(ctx, `select facilitator_source from worlds where id = $1`, member.WorldID).Scan(&source); err != nil {
		return "", err
	}
	label := "Terra"
	if source == agentFacilitatorSource {
		label = agentFacilitatorLabel
	}
	if !isAutomatedFacilitatorSource(source) {
		return "", facilitatorRequired()
	}
	if err := requireAutomatedReadyCurrentPlayer(ctx, db, member, source, label); err != nil {
		return "", err
	}
	return source, nil
}

func requireNoUnfinishedInteraction(ctx context.Context, db queryer, worldID string) error {
	var unfinished bool
	if err := db.QueryRow(ctx, `
		select exists(
			select 1 from interactions
			where world_id = $1 and status in ('draft', 'open', 'adjudicating')
		)`, worldID).Scan(&unfinished); err != nil {
		return err
	}
	if unfinished {
		return interactionLifecycleConflict("finish the current interaction before continuing")
	}
	return nil
}

func (s *Server) createAndPresentTerraInteraction(
	ctx context.Context,
	r *http.Request,
	worldID, prompt string,
) (string, error) {
	return s.createAndPresentAutomatedInteraction(
		ctx, r, worldID, nil, prompt, terraFacilitatorSource, "Terra",
	)
}

func (s *Server) createAndPresentAutomatedInteraction(
	ctx context.Context,
	r *http.Request,
	worldID string,
	title *string,
	prompt, facilitatorSource, label string,
) (string, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer rollbackTx(ctx, tx)
	// The world lock serializes concurrent Continue requests and prevents a
	// facilitator handoff between the final assignment check and commit.
	var lockedWorldID string
	if err := tx.QueryRow(ctx, `select id::text from worlds where id = $1 for update`, worldID).Scan(&lockedWorldID); err != nil {
		return "", err
	}
	member, err := lockInteractionWorldMember(ctx, tx, r, worldID)
	if err != nil {
		return "", err
	}
	if err := requireAutomatedReadyCurrentPlayer(ctx, tx, member, facilitatorSource, label); err != nil {
		return "", err
	}
	if err := requireNoUnfinishedInteraction(ctx, tx, worldID); err != nil {
		return "", err
	}

	related, err := loadAutomatedInteractionAudience(ctx, tx, worldID)
	if err != nil {
		return "", err
	}
	if len(related.ResponderIDs) == 0 {
		return "", &statusError{
			Status: http.StatusConflict, Code: "no_ready_players",
			Message: label + " needs at least one ready current player before continuing",
		}
	}
	interactionID, err := newID()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into interactions (
			id, world_id, title, prompt, status, revision, facilitator_source,
			created_by_membership_id, presented_at
		) values ($1, $2, $3, $4, 'open', 1, $5, null, now())`,
		interactionID, worldID, nullableOptionalString(title), prompt, facilitatorSource,
	); err != nil {
		return "", err
	}
	if err := replaceInteractionChildren(ctx, tx, interactionID, worldID, related); err != nil {
		return "", err
	}
	if err := appendAutomatedWorldEvent(
		ctx, tx, worldID, "interaction-created", &interactionID, false, facilitatorSource,
	); err != nil {
		return "", err
	}
	if err := appendAutomatedWorldEvent(
		ctx, tx, worldID, "interaction-presented", &interactionID, false, facilitatorSource,
	); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return interactionID, nil
}

func loadAutomatedInteractionAudience(
	ctx context.Context,
	tx pgx.Tx,
	worldID string,
) (interactionAudience, error) {
	type membership struct{ id, role string }
	rows, err := tx.Query(ctx, `
		select id::text, role from world_memberships
		where world_id = $1 and status = 'active'
		order by id for share`, worldID)
	if err != nil {
		return interactionAudience{}, err
	}
	members := make([]membership, 0)
	for rows.Next() {
		var item membership
		if err := rows.Scan(&item.id, &item.role); err != nil {
			rows.Close()
			return interactionAudience{}, err
		}
		members = append(members, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return interactionAudience{}, err
	}
	rows.Close()
	readyAudience := make(map[string]struct{}, len(members))
	readyResponders := make(map[string]struct{}, len(members))
	for _, item := range members {
		status, err := membershipPlayStatus(ctx, tx, worldID, item.id, item.role, "active")
		if err != nil {
			return interactionAudience{}, err
		}
		if status == "ready" {
			readyAudience[item.id] = struct{}{}
			if item.role != "spectator" {
				readyResponders[item.id] = struct{}{}
			}
		}
	}
	result := interactionAudience{
		AudienceIDs:      make([]string, 0, len(readyAudience)),
		ResponderIDs:     make([]string, 0, len(readyResponders)),
		ContextEntityIDs: []string{},
	}
	for membershipID := range readyAudience {
		result.AudienceIDs = append(result.AudienceIDs, membershipID)
	}
	for membershipID := range readyResponders {
		result.ResponderIDs = append(result.ResponderIDs, membershipID)
	}
	sort.Strings(result.AudienceIDs)
	sort.Strings(result.ResponderIDs)

	entityRows, err := tx.Query(ctx, `
		select distinct entity.id::text
		from entities entity
		join world_membership_entity_controls control
			on control.world_id = entity.world_id and control.entity_id = entity.id
		where entity.world_id = $1 and not entity.archived
		order by entity.id::text`, worldID)
	if err != nil {
		return interactionAudience{}, err
	}
	controlledEntityIDs := make([]string, 0)
	for entityRows.Next() {
		var entityID string
		if err := entityRows.Scan(&entityID); err != nil {
			entityRows.Close()
			return interactionAudience{}, err
		}
		controlledEntityIDs = append(controlledEntityIDs, entityID)
	}
	if err := entityRows.Err(); err != nil {
		entityRows.Close()
		return interactionAudience{}, err
	}
	entityRows.Close()
	for _, entityID := range controlledEntityIDs {
		status, _, _, err := entityCharacterStatus(ctx, tx, worldID, entityID)
		if err != nil {
			return interactionAudience{}, err
		}
		if status == "ready" {
			result.ContextEntityIDs = append(result.ContextEntityIDs, entityID)
		}
	}
	return result, nil
}

func validateTerraDecideRequest(request terraDecideRequest) map[string]string {
	fields := validateModelRevisions(request.ExpectedRevision, request.ExpectedRulesRevision)
	validateRequired(fields, "idempotency_key", request.IdempotencyKey, 200)
	return fields
}

func (s *Server) loadTerraResolutionReplay(
	ctx context.Context,
	worldID, interactionID, idempotencyKey string,
) (consequenceApplicationResultResponse, bool, error) {
	var existingInteractionID, source string
	err := s.db.QueryRow(ctx, `
		select interaction_id::text, facilitator_source
		from interaction_resolutions
		where world_id = $1 and idempotency_key = $2 and status = 'committed'`,
		worldID, idempotencyKey,
	).Scan(&existingInteractionID, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return consequenceApplicationResultResponse{}, false, nil
	}
	if err != nil {
		return consequenceApplicationResultResponse{}, false, err
	}
	if existingInteractionID != interactionID || source != terraFacilitatorSource {
		return consequenceApplicationResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was already used for another resolution",
		}
	}
	result, err := loadCommittedResolutionResult(ctx, s.db, worldID, interactionID)
	if err != nil {
		return consequenceApplicationResultResponse{}, false, err
	}
	result.Replayed = true
	return result, true, nil
}

func (s *Server) beginTerraAdjudication(
	ctx context.Context,
	r *http.Request,
	worldID, interactionID string,
	expectedRevision, expectedRulesRevision int64,
) (int64, error) {
	return s.beginAutomatedAdjudication(
		ctx, r, worldID, interactionID, expectedRevision, expectedRulesRevision,
		terraFacilitatorSource, "Terra",
	)
}

func (s *Server) beginAutomatedAdjudication(
	ctx context.Context,
	r *http.Request,
	worldID, interactionID string,
	expectedRevision, expectedRulesRevision int64,
	expectedFacilitatorSource, label string,
) (int64, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer rollbackTx(ctx, tx)
	member, err := lockInteractionWorldMember(ctx, tx, r, worldID)
	if err != nil {
		return 0, err
	}
	if err := requireAutomatedReadyCurrentPlayer(ctx, tx, member, expectedFacilitatorSource, label); err != nil {
		return 0, err
	}
	if _, err := requireRulesRevision(ctx, tx, worldID, &expectedRulesRevision); err != nil {
		return 0, err
	}
	var status, interactionFacilitatorSource string
	var revision int64
	if err := tx.QueryRow(ctx, `
		select status, revision, facilitator_source from interactions
		where world_id = $1 and id = $2 for update`, worldID, interactionID,
	).Scan(&status, &revision, &interactionFacilitatorSource); err != nil {
		return 0, err
	}
	missingResponders, err := countMissingResponders(ctx, tx, worldID, interactionID)
	if err != nil {
		return 0, err
	}
	plan, err := planAutomatedAdjudication(
		status, interactionFacilitatorSource, revision, expectedRevision, missingResponders,
		expectedFacilitatorSource, label,
	)
	if err != nil {
		return 0, err
	}
	if plan.Begin {
		if _, err := tx.Exec(ctx, `
			update interactions set status = 'adjudicating', revision = revision + 1
			where world_id = $1 and id = $2`, worldID, interactionID); err != nil {
			return 0, err
		}
		if err := appendAutomatedWorldEvent(
			ctx, tx, worldID, interactionAdjudicatingEventType, &interactionID, false,
			expectedFacilitatorSource,
		); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return plan.Revision, nil
}

type automatedAdjudicationPlan struct {
	Revision int64
	Begin    bool
}

func planTerraAdjudication(
	status, facilitatorSource string,
	revision, expectedRevision int64,
	missingResponders int,
) (automatedAdjudicationPlan, error) {
	return planAutomatedAdjudication(
		status, facilitatorSource, revision, expectedRevision, missingResponders,
		terraFacilitatorSource, "Terra",
	)
}

func planAutomatedAdjudication(
	status, facilitatorSource string,
	revision, expectedRevision int64,
	missingResponders int,
	expectedSource, label string,
) (automatedAdjudicationPlan, error) {
	if revision != expectedRevision {
		return automatedAdjudicationPlan{}, revisionConflict("interaction", expectedRevision, revision)
	}
	if status != "open" && status != "adjudicating" {
		return automatedAdjudicationPlan{}, interactionLifecycleConflict("only an open or adjudicating interaction can be decided by " + label)
	}
	if facilitatorSource != expectedSource {
		return automatedAdjudicationPlan{}, interactionLifecycleConflict(label + " can decide only an interaction it is facilitating")
	}
	if missingResponders > 0 {
		return automatedAdjudicationPlan{}, &statusError{
			Status: http.StatusConflict, Code: "responses_incomplete",
			Message: "every eligible responder must submit an action before " + label + " decides",
			Fields:  map[string]string{"missing_responses": fmt.Sprint(missingResponders)},
		}
	}
	plan := automatedAdjudicationPlan{Revision: revision}
	if status == "open" {
		plan.Begin = true
		plan.Revision++
	}
	return plan, nil
}

func countMissingResponders(
	ctx context.Context,
	db queryer,
	worldID, interactionID string,
) (int, error) {
	var missing int
	if err := db.QueryRow(ctx, `
		select count(*)::int
		from interaction_eligible_responders responder
		where responder.world_id = $1 and responder.interaction_id = $2
			and not exists (
				select 1 from interaction_actions action
				where action.world_id = responder.world_id
					and action.interaction_id = responder.interaction_id
					and action.submitted_by_membership_id = responder.membership_id
					and action.status = 'submitted'
			)`, worldID, interactionID,
	).Scan(&missing); err != nil {
		return 0, err
	}
	return missing, nil
}

func appendAutomatedWorldEvent(
	ctx context.Context,
	tx pgx.Tx,
	worldID, eventType string,
	interactionID *string,
	invalidatesInteractionAudience bool,
	facilitatorSource string,
) error {
	return appendWorldEventForSource(
		ctx, tx, worldID, eventType, facilitatorSource, nil,
		interactionID, nil, nil, invalidatesInteractionAudience,
	)
}

func (s *Server) loadTerraModelContextSnapshot(
	ctx context.Context,
	worldID, interactionID string,
	expectedInteractionRevision, expectedRulesRevision *int64,
) (modelContext, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return modelContext{}, err
	}
	defer rollbackTx(ctx, tx)
	if err := requireTerraFacilitator(ctx, tx, worldID); err != nil {
		return modelContext{}, err
	}
	result, err := loadModelContext(
		ctx, tx, worldID, interactionID, expectedInteractionRevision, expectedRulesRevision,
	)
	if err != nil {
		return modelContext{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return modelContext{}, err
	}
	return result, nil
}
