package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

const agentFacilitatorLabel = "the agent"

func (s *Server) handleListAvailableEntities(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}

	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{
		IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	if _, err := requireAgentEntityPicker(r.Context(), tx, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}

	result := availableEntitiesResponse{Entities: []availableEntityResponse{}}
	if err := tx.QueryRow(r.Context(), `
		select roster_revision from worlds where id = $1`, worldID,
	).Scan(&result.RosterRevision); err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := tx.Query(r.Context(), `
		select entity.id::text, entity.display_name
		from entities entity
		where entity.world_id = $1 and not entity.archived
			and not exists (
				select 1
				from world_membership_entity_controls control
				join world_memberships membership
					on membership.id = control.membership_id
					and membership.world_id = control.world_id
				where control.world_id = entity.world_id
					and control.entity_id = entity.id
					and membership.status = 'active'
					and membership.role <> 'spectator'
			)
		order by lower(entity.display_name), entity.id`, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	for rows.Next() {
		var item availableEntityResponse
		if err := rows.Scan(&item.ID, &item.DisplayName); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		result.Entities = append(result.Entities, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	for index := range result.Entities {
		profile, err := loadEntityProfileResponse(
			r.Context(), tx, worldID, result.Entities[index].ID, false, false,
		)
		if err != nil {
			handleAppError(w, err)
			return
		}
		result.Entities[index].ProfileSummary = summarizePublicEntityProfile(profile)
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleClaimWorldEntity(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(worldID) || !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request claimWorldEntityRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRosterRevision == nil || *request.ExpectedRosterRevision < 0 {
		writeError(
			w, http.StatusUnprocessableEntity, "validation_failed",
			"expected_roster_revision is required",
			map[string]string{"expected_roster_revision": "a non-negative expected revision is required"},
		)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	if _, err := requireActiveWorldMember(r.Context(), tx, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var worldStatus, facilitatorSource string
	var rosterRevision int64
	if err := tx.QueryRow(r.Context(), `
		select status, facilitator_source, roster_revision
		from worlds where id = $1 for update`, worldID,
	).Scan(&worldStatus, &facilitatorSource, &rosterRevision); err != nil {
		handleAppError(w, err)
		return
	}
	if worldStatus != "active" {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "world_archived",
			Message: "archived worlds cannot be changed",
		})
		return
	}
	if facilitatorSource != agentFacilitatorSource {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "facilitator_required",
			Message: agentFacilitatorLabel + " is not the current facilitator",
		})
		return
	}
	member, err := lockInteractionWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := requireWaitingAgentCurrentPlayer(r.Context(), tx, member); err != nil {
		handleAppError(w, err)
		return
	}
	if rosterRevision != *request.ExpectedRosterRevision {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "revision_conflict",
			Message: "world roster changed since it was loaded",
			Fields: map[string]string{
				"expected_roster_revision": stringInt(*request.ExpectedRosterRevision),
				"actual_roster_revision":   stringInt(rosterRevision),
			},
		})
		return
	}

	var archived bool
	if err := tx.QueryRow(r.Context(), `
		select archived from entities
		where world_id = $1 and id = $2 for update`, worldID, entityID,
	).Scan(&archived); errors.Is(err, pgx.ErrNoRows) {
		handleAppError(w, pgx.ErrNoRows)
		return
	} else if err != nil {
		handleAppError(w, err)
		return
	}
	var controlled bool
	if err := tx.QueryRow(r.Context(), `
		select exists (
			select 1
			from world_membership_entity_controls control
			join world_memberships membership
				on membership.id = control.membership_id
				and membership.world_id = control.world_id
			where control.world_id = $1 and control.entity_id = $2
				and membership.status = 'active' and membership.role <> 'spectator'
		)`, worldID, entityID,
	).Scan(&controlled); err != nil {
		handleAppError(w, err)
		return
	}
	if archived || controlled {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "entity_unavailable",
			Message: "Entity is no longer available to claim",
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_membership_entity_controls (world_id, membership_id, entity_id)
		values ($1, $2, $3)`, worldID, member.ID, entityID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update worlds set roster_revision = roster_revision + 1 where id = $1`, worldID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(
		r.Context(), tx, worldID, "entity-control-updated", member.ID, nil, nil, nil,
	); err != nil {
		handleAppError(w, err)
		return
	}
	playStatus, err := membershipPlayStatus(
		r.Context(), tx, worldID, member.ID, member.Role, member.Status,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, claimedWorldEntityResponse{
		EntityID: entityID, ControllerWorldMembershipIDs: []string{member.ID},
		RosterRevision: rosterRevision + 1, PlayStatus: playStatus,
	})
}

func (s *Server) handleContinueAgent(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}
	if err := requireAgentReadyCurrentPlayerRequest(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request agentContinueRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Title = cleanOptional(request.Title)
	request.Prompt = strings.TrimSpace(request.Prompt)
	fields := map[string]string{}
	validateRequired(fields, "prompt", request.Prompt, 10000)
	if request.Title != nil && len([]rune(*request.Title)) > 200 {
		fields["title"] = "must be 200 characters or fewer"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "agent problem is invalid", fields)
		return
	}
	interactionID, err := s.createAndPresentAutomatedInteraction(
		r.Context(), r, worldID, request.Title, request.Prompt,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
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

func (s *Server) handleResolveAgentInteraction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	if err := requireAgentReadyCurrentPlayerRequest(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var supplied agentResolveRequest
	if err := decodeJSON(r, &supplied); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request := adjudicateInteractionRequest{
		ExpectedRevision:      supplied.ExpectedRevision,
		ExpectedRulesRevision: supplied.ExpectedRulesRevision,
		IdempotencyKey:        supplied.IdempotencyKey,
		SelectedActionID:      supplied.SelectedActionID,
		ActionSummary:         supplied.ActionSummary,
		Narrative:             supplied.Narrative,
		Effects:               supplied.Effects,
	}
	if fields := validateAdjudicationRequest(&request, true); len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "agent consequence is invalid", fields)
		return
	}
	replay, found, err := s.loadAgentResolutionReplay(
		r.Context(), worldID, interactionID, strings.TrimSpace(request.IdempotencyKey), request,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if found {
		writeJSON(w, http.StatusOK, replay)
		return
	}
	adjudicatingRevision, err := s.beginAutomatedAdjudication(
		r.Context(), r, worldID, interactionID,
		*request.ExpectedRevision, *request.ExpectedRulesRevision,
		agentFacilitatorSource, agentFacilitatorLabel,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	request.ExpectedRevision = &adjudicatingRevision
	if _, err := s.previewInteractionConsequenceAs(
		r.Context(), r, worldID, interactionID, request, agentFacilitatorSource,
	); err != nil {
		handleAppError(w, err)
		return
	}
	result, err := s.resolveInteractionAs(
		r.Context(), r, worldID, interactionID, request, agentFacilitatorSource,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func requireAgentReadyCurrentPlayerRequest(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID string,
) error {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return err
	}
	return requireAgentReadyCurrentPlayer(ctx, db, member)
}

func requireAgentEntityPicker(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID string,
) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if err := requireAgentFacilitator(ctx, db, worldID); err != nil {
		return member, err
	}
	if err := requireWaitingAgentCurrentPlayer(ctx, db, member); err != nil {
		return member, err
	}
	return member, nil
}

func requireWaitingAgentCurrentPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) error {
	if member.Role == "spectator" || member.Facilitator {
		return &statusError{
			Status: http.StatusForbidden, Code: "player_required",
			Message: "only a current player may claim an Entity",
		}
	}
	playStatus, err := membershipPlayStatus(
		ctx, db, member.WorldID, member.ID, member.Role, member.Status,
	)
	if err != nil {
		return err
	}
	if playStatus != "waiting-for-character" {
		return &statusError{
			Status: http.StatusConflict, Code: "entity_claim_unavailable",
			Message: "a current player may claim an Entity only while waiting for one",
			Fields:  map[string]string{"play_status": playStatus},
		}
	}
	return nil
}

func summarizePublicEntityProfile(profile entityProfileResponse) *string {
	parts := make([]string, 0, len(profile.Fields))
	for _, field := range profile.Fields {
		if field.Value == nil || strings.TrimSpace(*field.Value) == "" {
			continue
		}
		parts = append(parts, field.Label+": "+strings.TrimSpace(*field.Value))
	}
	if len(parts) == 0 {
		return nil
	}
	summary := strings.Join(parts, "\n")
	return &summary
}

func (s *Server) loadAgentResolutionReplay(
	ctx context.Context,
	worldID, interactionID, idempotencyKey string,
	request adjudicateInteractionRequest,
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
	if existingInteractionID != interactionID || source != agentFacilitatorSource {
		return consequenceApplicationResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was already used for another resolution",
		}
	}
	matches, err := resolutionRequestMatches(ctx, s.db, worldID, interactionID, request)
	if err != nil {
		return consequenceApplicationResultResponse{}, false, err
	}
	if !matches {
		return consequenceApplicationResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was reused with a different consequence",
		}
	}
	result, err := loadCommittedResolutionResult(ctx, s.db, worldID, interactionID)
	if err != nil {
		return consequenceApplicationResultResponse{}, false, err
	}
	result.Replayed = true
	return result, true, nil
}
