package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

const agentFacilitatorLabel = "the external agent"

func (s *Server) handleListAvailableAgentCharacters(w http.ResponseWriter, r *http.Request) {
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
	if _, err := requireAgentCharacterPicker(r.Context(), tx, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}

	result := availableAgentCharactersResponse{Characters: []availableAgentCharacterResponse{}}
	if err := tx.QueryRow(r.Context(), `
		select table_revision from worlds where id = $1`, worldID,
	).Scan(&result.TableRevision); err != nil {
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
		var item availableAgentCharacterResponse
		if err := rows.Scan(&item.ID, &item.DisplayName); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		result.Characters = append(result.Characters, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	for index := range result.Characters {
		profile, err := loadEntityProfileResponse(
			r.Context(), tx, worldID, result.Characters[index].ID, false, false,
		)
		if err != nil {
			handleAppError(w, err)
			return
		}
		result.Characters[index].ProfileSummary = summarizePublicCharacterProfile(profile)
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
	if request.ExpectedTableRevision == nil || *request.ExpectedTableRevision < 0 {
		writeError(
			w, http.StatusUnprocessableEntity, "validation_failed",
			"expected_table_revision is required",
			map[string]string{"expected_table_revision": "a non-negative expected revision is required"},
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
	var tableRevision int64
	if err := tx.QueryRow(r.Context(), `
		select status, dm_source, table_revision
		from worlds where id = $1 for update`, worldID,
	).Scan(&worldStatus, &facilitatorSource, &tableRevision); err != nil {
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
	if err := requireWaitingAgentPlayer(r.Context(), tx, member); err != nil {
		handleAppError(w, err)
		return
	}
	if tableRevision != *request.ExpectedTableRevision {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "revision_conflict",
			Message: "world table changed since it was loaded",
			Fields: map[string]string{
				"expected_table_revision": stringInt(*request.ExpectedTableRevision),
				"actual_table_revision":   stringInt(tableRevision),
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
			Status: http.StatusConflict, Code: "character_unavailable",
			Message: "character is no longer available to claim",
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
		update worlds set table_revision = table_revision + 1 where id = $1`, worldID,
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
		TableRevision: tableRevision + 1, PlayStatus: playStatus,
	})
}

func (s *Server) handleContinueAgentDM(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}
	if err := requireAgentDMReadyPlayer(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request agentDMContinueRequest
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
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "agent scene is invalid", fields)
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

func (s *Server) handleResolveAgentDMInteraction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	if err := requireAgentDMReadyPlayer(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var supplied agentDMResolveRequest
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
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "agent ruling is invalid", fields)
		return
	}
	replay, found, err := s.loadAgentDMResolutionReplay(
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
	if _, err := s.previewInteractionResolutionAs(
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

func requireAgentDMReadyPlayer(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID string,
) error {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return err
	}
	return requireAgentReadyPlayer(ctx, db, member)
}

func requireAgentCharacterPicker(
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
	if err := requireWaitingAgentPlayer(ctx, db, member); err != nil {
		return member, err
	}
	return member, nil
}

func requireWaitingAgentPlayer(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) error {
	if member.Role == "spectator" || member.Facilitator {
		return &statusError{
			Status: http.StatusForbidden, Code: "player_required",
			Message: "only a player may claim a character",
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
			Status: http.StatusConflict, Code: "character_claim_unavailable",
			Message: "a character may be claimed only while waiting for one",
			Fields:  map[string]string{"play_status": playStatus},
		}
	}
	return nil
}

func summarizePublicCharacterProfile(profile entityProfileResponse) *string {
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

func (s *Server) loadAgentDMResolutionReplay(
	ctx context.Context,
	worldID, interactionID, idempotencyKey string,
	request adjudicateInteractionRequest,
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
	if existingInteractionID != interactionID || source != agentFacilitatorSource {
		return interactionResolutionResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was already used for another ruling",
		}
	}
	matches, err := resolutionRequestMatches(ctx, s.db, worldID, interactionID, request)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	if !matches {
		return interactionResolutionResultResponse{}, false, &statusError{
			Status: http.StatusConflict, Code: "idempotency_conflict",
			Message: "idempotency key was reused with a different ruling",
		}
	}
	result, err := loadAppliedResolutionResult(ctx, s.db, worldID, interactionID)
	if err != nil {
		return interactionResolutionResultResponse{}, false, err
	}
	result.Replayed = true
	return result, true, nil
}
