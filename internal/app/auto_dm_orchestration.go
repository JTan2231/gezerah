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

const terraFacilitatorSource = "terra"

func (s *Server) handleContinueAutoDM(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}
	if err := requireAutoDMReadyPlayer(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if s.autoDM == nil {
		handleAppError(w, autoDMUnavailable())
		return
	}
	if err := requireEmptyAutoDMRequest(r); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if err := requireNoUnfinishedInteraction(r.Context(), s.db, worldID); err != nil {
		handleAppError(w, err)
		return
	}

	snapshot, err := s.loadTerraAutoDMContextSnapshot(r.Context(), worldID, "", nil, nil)
	if err != nil {
		handleAppError(w, err)
		return
	}
	contextJSON, err := json.Marshal(snapshot)
	if err != nil {
		handleAppError(w, err)
		return
	}
	prompt, err := s.autoDM.GenerateProblem(r.Context(), contextJSON)
	if err != nil {
		handleAppError(w, autoDMCallFailed(err))
		return
	}
	prompt = strings.TrimSpace(prompt)
	fields := map[string]string{}
	validateRequired(fields, "prompt", prompt, 10000)
	if len(fields) > 0 {
		handleAppError(w, invalidAutoDMOutput("generated problem is invalid", fields))
		return
	}

	interactionID, err := s.createAndPresentAutoDMInteraction(r.Context(), r, worldID, prompt)
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

func (s *Server) handleDecideAutoDMInteraction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	if err := requireAutoDMReadyPlayer(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if s.autoDM == nil {
		handleAppError(w, autoDMUnavailable())
		return
	}
	var request autoDMDecideRequest
	if err := decodeAutoDMRequest(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if fields := validateAutoDMDecideRequest(request); len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "Auto DM decision request is invalid", fields)
		return
	}

	replay, found, err := s.loadAutoDMDecisionReplay(
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

	adjudicatingRevision, err := s.beginAutoDMAdjudication(
		r.Context(), r, worldID, interactionID, *request.ExpectedRevision,
		*request.ExpectedRulesRevision,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	snapshot, err := s.loadTerraAutoDMContextSnapshot(
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
	narrative, err := s.autoDM.GenerateConsequence(r.Context(), contextJSON)
	if err != nil {
		handleAppError(w, autoDMCallFailed(err))
		return
	}
	narrative = strings.TrimSpace(narrative)
	fields := map[string]string{}
	validateRequired(fields, "narrative", narrative, 20000)
	if len(fields) > 0 {
		handleAppError(w, invalidAutoDMOutput("generated consequence is invalid", fields))
		return
	}
	structured, err := s.autoDM.CompileConsequence(r.Context(), contextJSON, narrative)
	if err != nil {
		handleAppError(w, autoDMCallFailed(err))
		return
	}
	effects, selectedActionID, actionSummary, fields, err := materializeAutoDMConsequence(snapshot, structured)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if len(fields) > 0 {
		handleAppError(w, invalidAutoDMOutput("compiled consequence is invalid", fields))
		return
	}
	adjudication := adjudicateInteractionRequest{
		ExpectedRevision: &adjudicatingRevision, ExpectedRulesRevision: request.ExpectedRulesRevision,
		IdempotencyKey: strings.TrimSpace(request.IdempotencyKey), SelectedActionID: selectedActionID,
		ActionSummary: actionSummary, Narrative: narrative, Effects: effects,
	}
	if fields := validateAdjudicationRequest(&adjudication, true); len(fields) > 0 {
		handleAppError(w, invalidAutoDMOutput("compiled consequence is invalid", fields))
		return
	}
	if _, err := s.previewInteractionResolutionAs(
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

func requireAutoDMReadyPlayer(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID string,
) error {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return err
	}
	return requireTerraReadyPlayer(ctx, db, member)
}

func requireTerraReadyPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) error {
	if err := requireTerraFacilitator(ctx, db, member.WorldID); err != nil {
		return err
	}
	if member.Role == "spectator" || member.Facilitator {
		return &statusError{
			Status: http.StatusForbidden, Code: "player_required",
			Message: "only a ready player may pace Terra",
		}
	}
	if err := requireInteractionMemberReadiness(ctx, db, member); err != nil {
		return err
	}
	return nil
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
		return interactionLifecycleConflict("finish the current interaction before asking Terra to continue")
	}
	return nil
}

func (s *Server) createAndPresentAutoDMInteraction(
	ctx context.Context,
	r *http.Request,
	worldID, prompt string,
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
	if err := requireTerraFacilitator(ctx, tx, worldID); err != nil {
		return "", err
	}
	if member.Role == "spectator" || member.Facilitator {
		return "", &statusError{Status: http.StatusForbidden, Code: "player_required", Message: "only a ready player may pace Terra"}
	}
	if err := requireInteractionMemberReadiness(ctx, tx, member); err != nil {
		return "", err
	}
	if err := requireNoUnfinishedInteraction(ctx, tx, worldID); err != nil {
		return "", err
	}

	related, err := loadAutoDMInteractionAudience(ctx, tx, worldID)
	if err != nil {
		return "", err
	}
	if len(related.ResponderIDs) == 0 {
		return "", &statusError{
			Status: http.StatusConflict, Code: "no_ready_players",
			Message: "Terra needs at least one ready player before continuing",
		}
	}
	interactionID, err := newID()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into interactions (
			id, world_id, prompt, status, revision, facilitator_source,
			created_by_membership_id, presented_at
		) values ($1, $2, $3, 'open', 1, 'terra', null, now())`,
		interactionID, worldID, prompt,
	); err != nil {
		return "", err
	}
	if err := replaceInteractionChildren(ctx, tx, interactionID, worldID, related); err != nil {
		return "", err
	}
	if err := appendAutoDMWorldEvent(ctx, tx, worldID, "interaction-created", &interactionID, false); err != nil {
		return "", err
	}
	if err := appendAutoDMWorldEvent(ctx, tx, worldID, "interaction-presented", &interactionID, false); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return interactionID, nil
}

func loadAutoDMInteractionAudience(
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
		AudienceIDs:  make([]string, 0, len(readyAudience)),
		ResponderIDs: make([]string, 0, len(readyResponders)),
		EntityIDs:    []string{},
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
			result.EntityIDs = append(result.EntityIDs, entityID)
		}
	}
	return result, nil
}

func validateAutoDMDecideRequest(request autoDMDecideRequest) map[string]string {
	fields := validateAutoDMRevisions(request.ExpectedRevision, request.ExpectedRulesRevision)
	validateRequired(fields, "idempotency_key", request.IdempotencyKey, 200)
	return fields
}

func (s *Server) loadAutoDMDecisionReplay(
	ctx context.Context,
	worldID, interactionID, idempotencyKey string,
) (interactionResolutionResultResponse, bool, error) {
	var existingInteractionID, source string
	err := s.db.QueryRow(ctx, `
		select interaction_id::text, facilitator_source
		from interaction_resolutions
		where world_id = $1 and idempotency_key = $2 and status = 'applied'`,
		worldID, idempotencyKey,
	).Scan(&existingInteractionID, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return interactionResolutionResultResponse{}, false, nil
	}
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	if existingInteractionID != interactionID || source != terraFacilitatorSource {
		return interactionResolutionResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was already used for another ruling",
		}
	}
	result, err := loadAppliedResolutionResult(ctx, s.db, worldID, interactionID)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	result.Replayed = true
	return result, true, nil
}

func (s *Server) beginAutoDMAdjudication(
	ctx context.Context,
	r *http.Request,
	worldID, interactionID string,
	expectedRevision, expectedRulesRevision int64,
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
	if err := requireTerraFacilitator(ctx, tx, worldID); err != nil {
		return 0, err
	}
	if member.Role == "spectator" || member.Facilitator {
		return 0, &statusError{Status: http.StatusForbidden, Code: "player_required", Message: "only a ready player may pace Terra"}
	}
	if err := requireInteractionMemberReadiness(ctx, tx, member); err != nil {
		return 0, err
	}
	if _, err := requireRulesRevision(ctx, tx, worldID, &expectedRulesRevision); err != nil {
		return 0, err
	}
	var status, facilitatorSource string
	var revision int64
	if err := tx.QueryRow(ctx, `
		select status, revision, facilitator_source from interactions
		where world_id = $1 and id = $2 for update`, worldID, interactionID,
	).Scan(&status, &revision, &facilitatorSource); err != nil {
		return 0, err
	}
	missingResponders, err := countMissingResponders(ctx, tx, worldID, interactionID)
	if err != nil {
		return 0, err
	}
	plan, err := planAutoDMAdjudication(
		status, facilitatorSource, revision, expectedRevision, missingResponders,
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
		if err := appendAutoDMWorldEvent(
			ctx, tx, worldID, interactionAdjudicatingEventType, &interactionID, false,
		); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return plan.Revision, nil
}

type autoDMAdjudicationPlan struct {
	Revision int64
	Begin    bool
}

func planAutoDMAdjudication(
	status, facilitatorSource string,
	revision, expectedRevision int64,
	missingResponders int,
) (autoDMAdjudicationPlan, error) {
	if revision != expectedRevision {
		return autoDMAdjudicationPlan{}, revisionConflict("interaction", expectedRevision, revision)
	}
	if status != "open" && status != "adjudicating" {
		return autoDMAdjudicationPlan{}, interactionLifecycleConflict("only an open or adjudicating interaction can be decided by Terra")
	}
	if facilitatorSource != terraFacilitatorSource {
		return autoDMAdjudicationPlan{}, interactionLifecycleConflict("Terra can decide only an interaction it is facilitating")
	}
	if missingResponders > 0 {
		return autoDMAdjudicationPlan{}, &statusError{
			Status: http.StatusConflict, Code: "responses_incomplete",
			Message: "every eligible responder must submit an action before Terra decides",
			Fields:  map[string]string{"missing_responses": fmt.Sprint(missingResponders)},
		}
	}
	plan := autoDMAdjudicationPlan{Revision: revision}
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
				select 1 from interaction_action_submissions action
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

func appendAutoDMWorldEvent(
	ctx context.Context,
	tx pgx.Tx,
	worldID, eventType string,
	interactionID *string,
	invalidatesInteractionAudience bool,
) error {
	_, err := tx.Exec(ctx, `
		insert into world_events (
			world_id, event_type, actor_membership_id, actor_source, interaction_id,
			invalidates_interaction_audience
		) values ($1, $2, null, 'terra', $3, $4)`,
		worldID, eventType, interactionID, invalidatesInteractionAudience,
	)
	return err
}

func (s *Server) loadTerraAutoDMContextSnapshot(
	ctx context.Context,
	worldID, interactionID string,
	expectedInteractionRevision, expectedRulesRevision *int64,
) (autoDMContext, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return autoDMContext{}, err
	}
	defer rollbackTx(ctx, tx)
	if err := requireTerraFacilitator(ctx, tx, worldID); err != nil {
		return autoDMContext{}, err
	}
	result, err := loadAutoDMContext(
		ctx, tx, worldID, interactionID, expectedInteractionRevision, expectedRulesRevision,
	)
	if err != nil {
		return autoDMContext{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return autoDMContext{}, err
	}
	return result, nil
}
