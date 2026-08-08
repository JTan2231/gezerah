package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	worldEventWaitInterval = 1500 * time.Millisecond
	worldEventWriteTimeout = 5 * time.Second
	worldEventBatchLimit   = 100
)

const (
	interactionAdjudicatingEventType    = "interaction-adjudicating"
	interactionFeedInvalidatedEventType = "interaction-feed-invalidated"

	// A transition away from an audience-visible state still needs a safe
	// invalidation so an open prompt disappears without a reconnect.
	visibleWorldEventsAudiencePolicyQuery = `
				exists (
					select 1
					from interaction_audience_members audience
					where audience.interaction_id = event.interaction_id
						and audience.world_id = event.world_id
						and audience.membership_id = $4
				)
				and (
					interaction.status in ('open', 'resolved')
					or event.invalidates_interaction_audience
				)`
)

type interactionAudience struct {
	AudienceIDs  []string
	ResponderIDs []string
	EntityIDs    []string
}

func (s *Server) handleListInteractions(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}

	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	member, err := requirePlayReadyWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	facilitator := interactionFacilitator(member.Role)
	rows, err := tx.Query(r.Context(), `
		select interaction.id::text
		from interactions interaction
		where interaction.world_id = $1
			and (
				$2
				or (
					interaction.status in ('open', 'resolved')
					and exists (
						select 1
						from interaction_audience_members audience
						where audience.interaction_id = interaction.id
							and audience.world_id = interaction.world_id
							and audience.membership_id = $3
					)
				)
			)
		order by interaction.created_at desc, interaction.id desc
		limit 500`, worldID, facilitator, member.ID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()

	items := make([]interactionResponse, 0, len(ids))
	for _, id := range ids {
		item, err := loadInteractionResponse(r.Context(), tx, worldID, id, facilitator)
		if err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleGetInteraction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}

	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	member, err := requirePlayReadyWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := requireInteractionVisibility(r.Context(), tx, worldID, interactionID, member); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadInteractionResponse(
		r.Context(), tx, worldID, interactionID, interactionFacilitator(member.Role),
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleCreateInteraction(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}
	var request saveInteractionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	interactionID := request.ID
	var err error
	if interactionID == "" {
		interactionID, err = newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
		request.ID = interactionID
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	actor, err := lockInteractionWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if !interactionFacilitator(actor.Role) {
		handleAppError(w, facilitatorRequired())
		return
	}
	related, fields, err := validateInteractionRequest(r.Context(), tx, worldID, &request, false, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "interaction is invalid", fields)
		return
	}

	status := "draft"
	revision := int64(0)
	var presentedAt *time.Time
	if request.Present {
		status = "open"
		revision = 1
		now := time.Now().UTC()
		presentedAt = &now
	}
	if _, err := tx.Exec(r.Context(), `
		insert into interactions (
			id, world_id, title, prompt, private_notes, status, revision,
			created_by_membership_id, presented_at
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		interactionID, worldID, nullableOptionalString(request.Title), request.Prompt,
		nullableOptionalString(request.PrivateNotes), status, revision, actor.ID, presentedAt,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := replaceInteractionChildren(r.Context(), tx, interactionID, worldID, related); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(
		r.Context(), tx, worldID, "interaction-created", actor.ID, &interactionID, nil, nil,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if request.Present {
		if err := appendWorldEvent(
			r.Context(), tx, worldID, "interaction-presented", actor.ID, &interactionID, nil, nil,
		); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := s.loadInteractionResponseSnapshot(r.Context(), worldID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/worlds/%s/interactions/%s", worldID, interactionID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handlePutInteraction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request saveInteractionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != interactionID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	request.ID = interactionID

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	actor, err := lockInteractionWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if !interactionFacilitator(actor.Role) {
		handleAppError(w, facilitatorRequired())
		return
	}
	var status string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision
		from interactions
		where world_id = $1 and id = $2
		for update`, worldID, interactionID).Scan(&status, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if status != "draft" {
		handleAppError(w, &statusError{
			Status:  http.StatusConflict,
			Code:    "interaction_not_editable",
			Message: "only draft interactions can be edited",
		})
		return
	}
	related, fields, err := validateInteractionRequest(r.Context(), tx, worldID, &request, true, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "interaction is invalid", fields)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, interactionConflict(*request.ExpectedRevision, revision))
		return
	}

	current, err := loadInteractionResponse(r.Context(), tx, worldID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if interactionDraftMatches(current, request, related) {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, current)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interactions
		set title = $3, prompt = $4, private_notes = $5, revision = revision + 1
		where world_id = $1 and id = $2`,
		worldID, interactionID, nullableOptionalString(request.Title), request.Prompt,
		nullableOptionalString(request.PrivateNotes),
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := replaceInteractionChildren(r.Context(), tx, interactionID, worldID, related); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(
		r.Context(), tx, worldID, "interaction-updated", actor.ID, &interactionID, nil, nil,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := s.loadInteractionResponseSnapshot(r.Context(), worldID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePresentInteraction(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionLifecycle(w, r, "present")
}

func (s *Server) handleBeginInteractionAdjudication(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionLifecycle(w, r, "adjudicate")
}

func (s *Server) handleCancelInteraction(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionLifecycle(w, r, "cancel")
}

func (s *Server) handleInteractionLifecycle(w http.ResponseWriter, r *http.Request, command string) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request interactionLifecycleRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(
			w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required",
			map[string]string{"expected_revision": "a non-negative expected revision is required"},
		)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	actor, err := lockInteractionWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if !interactionFacilitator(actor.Role) {
		handleAppError(w, facilitatorRequired())
		return
	}

	var status string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision
		from interactions
		where world_id = $1 and id = $2
		for update`, worldID, interactionID).Scan(&status, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, interactionConflict(*request.ExpectedRevision, revision))
		return
	}

	var eventType string
	switch command {
	case "present":
		if status != "draft" {
			handleAppError(w, interactionLifecycleConflict("only a draft interaction can be presented"))
			return
		}
		fields, err := validateStoredInteractionForPresentation(
			r.Context(), tx, worldID, interactionID,
		)
		if err != nil {
			handleAppError(w, err)
			return
		}
		if len(fields) > 0 {
			writeError(
				w, http.StatusUnprocessableEntity, "validation_failed",
				"interaction cannot be presented", fields,
			)
			return
		}
		_, err = tx.Exec(r.Context(), `
			update interactions
			set status = 'open', presented_at = now(), revision = revision + 1
			where world_id = $1 and id = $2`, worldID, interactionID)
		eventType = "interaction-presented"
	case "adjudicate":
		if status != "open" {
			handleAppError(w, interactionLifecycleConflict("only an open interaction can begin adjudication"))
			return
		}
		_, err = tx.Exec(r.Context(), `
			update interactions
			set status = 'adjudicating', revision = revision + 1
			where world_id = $1 and id = $2`, worldID, interactionID)
		eventType = interactionAdjudicatingEventType
	case "cancel":
		if status == "resolved" || status == "cancelled" {
			handleAppError(w, interactionLifecycleConflict("final interactions cannot be cancelled"))
			return
		}
		_, err = tx.Exec(r.Context(), `
			update interactions
			set status = 'cancelled', cancelled_at = now(), revision = revision + 1
			where world_id = $1 and id = $2`, worldID, interactionID)
		eventType = "interaction-cancelled"
	default:
		err = fmt.Errorf("unsupported interaction lifecycle command %q", command)
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEventWithAudienceInvalidation(
		r.Context(), tx, worldID, eventType, actor.ID, &interactionID, nil, nil,
		interactionLifecycleInvalidatesAudience(command, status),
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := s.loadInteractionResponseSnapshot(r.Context(), worldID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func interactionLifecycleInvalidatesAudience(command, priorStatus string) bool {
	return priorStatus == "open" && (command == "adjudicate" || command == "cancel")
}

func (s *Server) handleCreateInteractionAction(w http.ResponseWriter, r *http.Request) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(worldID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request createInteractionActionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Text = strings.TrimSpace(request.Text)
	request.ActingEntityID = cleanOptional(request.ActingEntityID)
	fields := make(map[string]string)
	validateRequired(fields, "text", request.Text, 10000)
	if request.ActingEntityID != nil && !validID(*request.ActingEntityID) {
		fields["acting_entity_id"] = "must be a UUID"
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "a non-negative expected revision is required"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "action is invalid", fields)
		return
	}

	actionID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	member, err := lockInteractionWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if member.Role != "player" {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "player_required",
			Message: "only players may submit actions",
		})
		return
	}
	if err := requireInteractionMemberReadiness(r.Context(), tx, member); err != nil {
		handleAppError(w, err)
		return
	}

	var status string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision
		from interactions
		where world_id = $1 and id = $2
		for update`, worldID, interactionID).Scan(&status, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, interactionConflict(*request.ExpectedRevision, revision))
		return
	}
	if status != "open" {
		handleAppError(w, interactionLifecycleConflict(
			"actions may be submitted only while the interaction is open",
		))
		return
	}
	var eligible bool
	if err := tx.QueryRow(r.Context(), `
		select exists(
			select 1
			from interaction_eligible_responders
			where interaction_id = $1 and world_id = $2 and membership_id = $3
		)`, interactionID, worldID, member.ID).Scan(&eligible); err != nil {
		handleAppError(w, err)
		return
	}
	if !eligible {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "responder_required",
			Message: "this player is not eligible to respond to the interaction",
		})
		return
	}

	var actingEntityName *string
	if request.ActingEntityID != nil {
		var name string
		var archived bool
		err := tx.QueryRow(r.Context(), `
			select entity.display_name, entity.archived
			from world_membership_entity_controls control
			join entities entity
				on entity.id = control.entity_id and entity.world_id = control.world_id
			where control.world_id = $1
				and control.membership_id = $2
				and control.entity_id = $3
			for share of entity`, worldID, member.ID, *request.ActingEntityID,
		).Scan(&name, &archived)
		if errors.Is(err, pgx.ErrNoRows) {
			handleAppError(w, &statusError{
				Status: http.StatusForbidden, Code: "entity_control_required",
				Message: "the acting entity must be controlled by the submitting player",
				Fields: map[string]string{
					"acting_entity_id": "player does not control this entity",
				},
			})
			return
		}
		if err != nil {
			handleAppError(w, err)
			return
		}
		if archived {
			handleAppError(w, &statusError{
				Status: http.StatusConflict, Code: "entity_archived",
				Message: "archived entities cannot act in a new interaction",
			})
			return
		}
		characterStatus, _, _, err := entityCharacterStatus(
			r.Context(), tx, worldID, *request.ActingEntityID,
		)
		if err != nil {
			handleAppError(w, err)
			return
		}
		if characterStatus != "ready" {
			handleAppError(w, &statusError{
				Status: http.StatusConflict, Code: "character_setup_required",
				Message: "the acting character must have every required field completed",
				Fields: map[string]string{
					"acting_entity_id": "character setup is incomplete",
				},
			})
			return
		}
		actingEntityName = &name
	}

	var alreadySubmitted bool
	if err := tx.QueryRow(r.Context(), `
		select exists(
			select 1
			from interaction_action_submissions
			where interaction_id = $1 and world_id = $2
				and submitted_by_membership_id = $3 and status = 'submitted'
		)`, interactionID, worldID, member.ID).Scan(&alreadySubmitted); err != nil {
		handleAppError(w, err)
		return
	}
	if alreadySubmitted {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "action_already_submitted",
			Message: "withdraw the current action before submitting another",
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into interaction_action_submissions (
			id, interaction_id, world_id, submitted_by_membership_id,
			acting_entity_id, acting_entity_name, text, status
		) values ($1, $2, $3, $4, $5, $6, $7, 'submitted')`,
		actionID, interactionID, worldID, member.ID,
		request.ActingEntityID, actingEntityName, request.Text,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interactions
		set revision = revision + 1
		where world_id = $1 and id = $2`, worldID, interactionID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(
		r.Context(), tx, worldID, "submission-created", member.ID,
		&interactionID, &actionID, nil,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := loadInteractionAction(r.Context(), s.db, worldID, interactionID, actionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf(
		"/api/worlds/%s/interactions/%s/actions/%s", worldID, interactionID, actionID,
	))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleWithdrawInteractionAction(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	interactionID := r.PathValue("interaction_id")
	actionID := r.PathValue("action_id")
	if !validID(worldID) || !validID(interactionID) || !validID(actionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	var request withdrawInteractionActionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(
			w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required",
			map[string]string{"expected_revision": "a non-negative action revision is required"},
		)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	member, err := lockInteractionWorldMember(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if member.Role != "player" {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "player_required",
			Message: "only players may withdraw actions",
		})
		return
	}
	if err := requireInteractionMemberReadiness(r.Context(), tx, member); err != nil {
		handleAppError(w, err)
		return
	}

	var interactionStatus string
	if err := tx.QueryRow(r.Context(), `
		select status
		from interactions
		where world_id = $1 and id = $2
		for update`, worldID, interactionID).Scan(&interactionStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if interactionStatus != "open" {
		handleAppError(w, interactionLifecycleConflict(
			"actions may be withdrawn only while the interaction is open",
		))
		return
	}

	var submittedBy, actionStatus string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select submitted_by_membership_id::text, status, revision
		from interaction_action_submissions
		where world_id = $1 and interaction_id = $2 and id = $3
		for update`, worldID, interactionID, actionID,
	).Scan(&submittedBy, &actionStatus, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if submittedBy != member.ID {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "action_forbidden",
			Message: "players may withdraw only their own actions",
		})
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("action", *request.ExpectedRevision, revision))
		return
	}
	if actionStatus != "submitted" {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "action_not_submitted",
			Message: "only a submitted action can be withdrawn",
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interaction_action_submissions
		set status = 'withdrawn', revision = revision + 1
		where world_id = $1 and interaction_id = $2 and id = $3`,
		worldID, interactionID, actionID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interactions
		set revision = revision + 1
		where world_id = $1 and id = $2`, worldID, interactionID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(
		r.Context(), tx, worldID, "submission-withdrawn", member.ID,
		&interactionID, &actionID, nil,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := loadInteractionAction(r.Context(), s.db, worldID, interactionID, actionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleWorldEvents(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if !validID(worldID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "world ID is malformed", nil)
		return
	}
	actor, ok := actorFromRequest(r)
	if !ok {
		handleAppError(w, authenticationRequired())
		return
	}
	member, err := requirePlayReadyWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	after, err := worldEventCursor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor", err.Error(), nil)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	if err := writeWorldEventStreamChunk(w, controller, "retry: 1500\n\n"); err != nil {
		return
	}

	ticker := time.NewTicker(worldEventWaitInterval)
	defer ticker.Stop()
	for {
		wake := s.currentWorldEventWake()
		validSession, err := s.refreshAuthenticatedSession(r.Context(), actor)
		if err != nil || !validSession {
			return
		}
		member, err = requirePlayReadyWorldMember(r.Context(), s.db, r, worldID)
		if err != nil {
			return
		}
		events, err := loadVisibleWorldEvents(r.Context(), s.db, worldID, member, after)
		if err != nil {
			return
		}
		if len(events) == 0 {
			if err := writeWorldEventStreamChunk(w, controller, ": keep-alive\n\n"); err != nil {
				return
			}
		} else {
			var chunk strings.Builder
			batchAfter := after
			for _, event := range events {
				payload, err := json.Marshal(event)
				if err != nil {
					return
				}
				fmt.Fprintf(&chunk, "id: %d\nevent: world-event\ndata: %s\n\n", event.ID, payload)
				batchAfter = event.ID
			}
			if err := writeWorldEventStreamChunk(w, controller, chunk.String()); err != nil {
				return
			}
			after = batchAfter
		}
		if !waitForWorldEventRefresh(r.Context(), wake, ticker.C, len(events)) {
			return
		}
	}
}

func worldEventBatchMayHaveMore(eventCount int) bool {
	return eventCount >= worldEventBatchLimit
}

func waitForWorldEventRefresh(
	ctx context.Context,
	wake <-chan struct{},
	fallback <-chan time.Time,
	eventCount int,
) bool {
	if ctx.Err() != nil {
		return false
	}
	if worldEventBatchMayHaveMore(eventCount) {
		return true
	}
	select {
	case <-ctx.Done():
		return false
	case <-wake:
		return true
	case <-fallback:
		return true
	}
}

func writeWorldEventStreamChunk(
	w http.ResponseWriter,
	controller *http.ResponseController,
	chunk string,
) error {
	if err := setWorldEventWriteDeadline(controller, time.Now().Add(worldEventWriteTimeout)); err != nil {
		return err
	}
	if _, err := fmt.Fprint(w, chunk); err != nil {
		return err
	}
	if err := controller.Flush(); err != nil {
		return err
	}
	return setWorldEventWriteDeadline(controller, time.Time{})
}

func setWorldEventWriteDeadline(controller *http.ResponseController, deadline time.Time) error {
	err := controller.SetWriteDeadline(deadline)
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}

func loadInteractionResponse(
	ctx context.Context,
	db queryer,
	worldID, interactionID string,
	includePrivate bool,
) (interactionResponse, error) {
	var result interactionResponse
	var privateNotes *string
	if err := db.QueryRow(ctx, `
		select id::text, world_id::text, title, prompt, private_notes, status, revision,
			created_by_membership_id::text, presented_at, resolved_at, cancelled_at,
			created_at, updated_at
		from interactions
		where world_id = $1 and id = $2`, worldID, interactionID,
	).Scan(
		&result.ID, &result.WorldID, &result.Title, &result.Prompt, &privateNotes,
		&result.Status, &result.Revision, &result.CreatedByMembershipID,
		&result.PresentedAt, &result.ResolvedAt, &result.CancelledAt,
		&result.CreatedAt, &result.UpdatedAt,
	); err != nil {
		return result, err
	}
	if includePrivate {
		result.PrivateNotes = privateNotes
	}

	var err error
	result.AudienceMembershipIDs, err = loadInteractionStringColumn(ctx, db, `
		select membership_id::text
		from interaction_audience_members
		where world_id = $1 and interaction_id = $2
		order by membership_id`, worldID, interactionID)
	if err != nil {
		return result, err
	}
	result.EligibleResponderMembershipIDs, err = loadInteractionStringColumn(ctx, db, `
		select membership_id::text
		from interaction_eligible_responders
		where world_id = $1 and interaction_id = $2
		order by membership_id`, worldID, interactionID)
	if err != nil {
		return result, err
	}
	result.EntityIDs, err = loadInteractionStringColumn(ctx, db, `
		select entity_id::text
		from interaction_context_entities
		where world_id = $1 and interaction_id = $2 and ($3 or visibility = 'public')
		order by position`, worldID, interactionID, includePrivate)
	if err != nil {
		return result, err
	}
	result.Actions, err = loadInteractionActions(ctx, db, worldID, interactionID)
	if err != nil {
		return result, err
	}
	if result.Status == "resolved" {
		result.Resolution, err = loadInteractionResolutionResponse(
			ctx, db, worldID, interactionID, includePrivate,
		)
		if err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *Server) loadInteractionResponseSnapshot(
	ctx context.Context,
	worldID, interactionID string,
	includePrivate bool,
) (interactionResponse, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return interactionResponse{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	item, err := loadInteractionResponse(ctx, tx, worldID, interactionID, includePrivate)
	if err != nil {
		return interactionResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return interactionResponse{}, err
	}
	return item, nil
}

func loadInteractionActions(
	ctx context.Context,
	db queryer,
	worldID, interactionID string,
) ([]interactionActionResponse, error) {
	rows, err := db.Query(ctx, `
		select action.id::text, action.interaction_id::text,
			action.submitted_by_membership_id::text, membership.user_id::text,
			app_user.display_name, action.acting_entity_id::text, action.acting_entity_name,
			action.text, action.status, action.revision,
			action.created_at, action.updated_at
		from interaction_action_submissions action
		join world_memberships membership
			on membership.world_id = action.world_id
			and membership.id = action.submitted_by_membership_id
		join users app_user on app_user.id = membership.user_id
		where action.world_id = $1 and action.interaction_id = $2
		order by action.created_at, action.id`, worldID, interactionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]interactionActionResponse, 0)
	for rows.Next() {
		var item interactionActionResponse
		if err := rows.Scan(
			&item.ID, &item.InteractionID, &item.SubmittedByMembershipID,
			&item.SubmittedByUserID, &item.SubmittedByName,
			&item.ActingEntityID, &item.ActingEntityName, &item.Text,
			&item.Status, &item.Revision, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func loadInteractionAction(
	ctx context.Context,
	db queryer,
	worldID, interactionID, actionID string,
) (interactionActionResponse, error) {
	var item interactionActionResponse
	err := db.QueryRow(ctx, `
		select action.id::text, action.interaction_id::text,
			action.submitted_by_membership_id::text, membership.user_id::text,
			app_user.display_name, action.acting_entity_id::text, action.acting_entity_name,
			action.text, action.status, action.revision,
			action.created_at, action.updated_at
		from interaction_action_submissions action
		join world_memberships membership
			on membership.world_id = action.world_id
			and membership.id = action.submitted_by_membership_id
		join users app_user on app_user.id = membership.user_id
		where action.world_id = $1 and action.interaction_id = $2 and action.id = $3`,
		worldID, interactionID, actionID,
	).Scan(
		&item.ID, &item.InteractionID, &item.SubmittedByMembershipID,
		&item.SubmittedByUserID, &item.SubmittedByName,
		&item.ActingEntityID, &item.ActingEntityName, &item.Text,
		&item.Status, &item.Revision, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func validateInteractionRequest(
	ctx context.Context,
	tx pgx.Tx,
	worldID string,
	request *saveInteractionRequest,
	requireRevision, defaultAudience bool,
) (interactionAudience, map[string]string, error) {
	fields := make(map[string]string)
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	if requireRevision && (request.ExpectedRevision == nil || *request.ExpectedRevision < 0) {
		fields["expected_revision"] = "a non-negative expected revision is required"
	} else if request.ExpectedRevision != nil && *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "cannot be negative"
	}
	request.Title = cleanOptional(request.Title)
	request.PrivateNotes = cleanOptional(request.PrivateNotes)
	request.Prompt = strings.TrimSpace(request.Prompt)
	validateRequired(fields, "prompt", request.Prompt, 10000)
	if request.Title != nil && len([]rune(*request.Title)) > 200 {
		fields["title"] = "must be 200 characters or fewer"
	}
	if request.PrivateNotes != nil && len([]rune(*request.PrivateNotes)) > 20000 {
		fields["private_notes"] = "must be 20000 characters or fewer"
	}
	audienceOmitted := request.AudienceMembershipIDs == nil
	request.AudienceMembershipIDs = uniqueSorted(request.AudienceMembershipIDs)
	request.EligibleResponderMembershipIDs = uniqueSorted(request.EligibleResponderMembershipIDs)
	request.EntityIDs = uniqueInOrder(request.EntityIDs)
	for path, values := range map[string][]string{
		"audience_membership_ids":           request.AudienceMembershipIDs,
		"eligible_responder_membership_ids": request.EligibleResponderMembershipIDs,
		"entity_ids":                        request.EntityIDs,
	} {
		if len(values) > 500 {
			fields[path] = "must contain at most 500 IDs"
		}
		for index, id := range values {
			if !validID(id) {
				fields[fmt.Sprintf("%s[%d]", path, index)] = "must be a UUID"
			}
		}
	}
	if len(fields) > 0 {
		return interactionAudience{}, fields, nil
	}

	memberRoles := make(map[string]string)
	rows, err := tx.Query(ctx, `
		select id::text, role
		from world_memberships
		where world_id = $1 and status = 'active'
		order by id
		for share`, worldID)
	if err != nil {
		return interactionAudience{}, nil, err
	}
	for rows.Next() {
		var membershipID, role string
		if err := rows.Scan(&membershipID, &role); err != nil {
			rows.Close()
			return interactionAudience{}, nil, err
		}
		memberRoles[membershipID] = role
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return interactionAudience{}, nil, err
	}
	rows.Close()
	for membershipID, role := range memberRoles {
		if role != "player" {
			continue
		}
		playStatus, err := membershipPlayStatus(ctx, tx, worldID, membershipID, role, "active")
		if err != nil {
			return interactionAudience{}, nil, err
		}
		if playStatus != "ready" {
			delete(memberRoles, membershipID)
		}
	}

	if shouldDefaultInteractionAudience(defaultAudience, audienceOmitted) {
		request.AudienceMembershipIDs = make([]string, 0, len(memberRoles))
		for membershipID := range memberRoles {
			request.AudienceMembershipIDs = append(request.AudienceMembershipIDs, membershipID)
		}
		sort.Strings(request.AudienceMembershipIDs)
	}
	if request.Present && len(request.AudienceMembershipIDs) == 0 {
		fields["audience_membership_ids"] = "at least one audience member is required"
	}
	audience := make(map[string]struct{}, len(request.AudienceMembershipIDs))
	for index, membershipID := range request.AudienceMembershipIDs {
		if _, exists := memberRoles[membershipID]; !exists {
			fields[fmt.Sprintf("audience_membership_ids[%d]", index)] = "active play-ready world membership is required"
		}
		audience[membershipID] = struct{}{}
	}
	for index, membershipID := range request.EligibleResponderMembershipIDs {
		role, exists := memberRoles[membershipID]
		if !exists || role != "player" {
			fields[fmt.Sprintf("eligible_responder_membership_ids[%d]", index)] = "active play-ready player membership is required"
			continue
		}
		if _, visible := audience[membershipID]; !visible {
			fields[fmt.Sprintf("eligible_responder_membership_ids[%d]", index)] = "eligible responder must also be in the audience"
		}
	}
	for index, entityID := range request.EntityIDs {
		var archived bool
		err := tx.QueryRow(ctx, `
			select archived
			from entities
			where world_id = $1 and id = $2
			for share`, worldID, entityID).Scan(&archived)
		if errors.Is(err, pgx.ErrNoRows) {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "entity does not exist in this world"
			continue
		}
		if err != nil {
			return interactionAudience{}, nil, err
		}
		if archived {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "archived entity cannot be added to a new interaction"
			continue
		}
		status, _, _, err := entityCharacterStatus(ctx, tx, worldID, entityID)
		if err != nil {
			return interactionAudience{}, nil, err
		}
		if status == "setup-required" {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "controlled character setup must be complete"
		}
	}
	return interactionAudience{
		AudienceIDs:  request.AudienceMembershipIDs,
		ResponderIDs: request.EligibleResponderMembershipIDs,
		EntityIDs:    request.EntityIDs,
	}, fields, nil
}

func shouldDefaultInteractionAudience(defaultAudience, audienceOmitted bool) bool {
	return defaultAudience && audienceOmitted
}

func validateStoredInteractionForPresentation(
	ctx context.Context,
	tx pgx.Tx,
	worldID, interactionID string,
) (map[string]string, error) {
	var request saveInteractionRequest
	if err := tx.QueryRow(ctx, `
		select title, prompt, private_notes
		from interactions
		where world_id = $1 and id = $2`, worldID, interactionID,
	).Scan(&request.Title, &request.Prompt, &request.PrivateNotes); err != nil {
		return nil, err
	}
	var err error
	request.AudienceMembershipIDs, err = loadInteractionStringColumn(ctx, tx, `
		select membership_id::text
		from interaction_audience_members
		where world_id = $1 and interaction_id = $2
		order by membership_id`, worldID, interactionID)
	if err != nil {
		return nil, err
	}
	request.EligibleResponderMembershipIDs, err = loadInteractionStringColumn(ctx, tx, `
		select membership_id::text
		from interaction_eligible_responders
		where world_id = $1 and interaction_id = $2
		order by membership_id`, worldID, interactionID)
	if err != nil {
		return nil, err
	}
	request.EntityIDs, err = loadInteractionStringColumn(ctx, tx, `
		select entity_id::text
		from interaction_context_entities
		where world_id = $1 and interaction_id = $2
		order by position`, worldID, interactionID)
	if err != nil {
		return nil, err
	}
	request.Present = true
	_, fields, err := validateInteractionRequest(ctx, tx, worldID, &request, false, false)
	return fields, err
}

func replaceInteractionChildren(
	ctx context.Context,
	tx pgx.Tx,
	interactionID, worldID string,
	related interactionAudience,
) error {
	if _, err := tx.Exec(ctx, `
		delete from interaction_audience_members
		where interaction_id = $1 and world_id = $2`, interactionID, worldID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		delete from interaction_eligible_responders
		where interaction_id = $1 and world_id = $2`, interactionID, worldID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		delete from interaction_context_entities
		where interaction_id = $1 and world_id = $2`, interactionID, worldID); err != nil {
		return err
	}
	for _, membershipID := range related.AudienceIDs {
		if _, err := tx.Exec(ctx, `
			insert into interaction_audience_members (interaction_id, world_id, membership_id)
			values ($1, $2, $3)`, interactionID, worldID, membershipID); err != nil {
			return err
		}
	}
	for _, membershipID := range related.ResponderIDs {
		if _, err := tx.Exec(ctx, `
			insert into interaction_eligible_responders (interaction_id, world_id, membership_id)
			values ($1, $2, $3)`, interactionID, worldID, membershipID); err != nil {
			return err
		}
	}
	for position, entityID := range related.EntityIDs {
		if _, err := tx.Exec(ctx, `
			insert into interaction_context_entities (
				interaction_id, world_id, entity_id, visibility, position
			) values ($1, $2, $3, 'public', $4)`,
			interactionID, worldID, entityID, position,
		); err != nil {
			return err
		}
	}
	return nil
}

func loadVisibleWorldEvents(
	ctx context.Context,
	db queryer,
	worldID string,
	member authorizedWorldMember,
	after int64,
) ([]worldEventResponse, error) {
	facilitator := interactionFacilitator(member.Role)
	rows, err := db.Query(ctx, `
		select event.id, event.event_type, event.interaction_id::text,
			event.submission_id::text, event.resolution_id::text,
			event.actor_membership_id::text, event.created_at,
			event.invalidates_interaction_audience
		from world_events event
		left join interactions interaction
			on interaction.world_id = event.world_id and interaction.id = event.interaction_id
		where event.world_id = $1 and event.id > $2
			and (
				event.interaction_id is null
				or $3
				or (
					`+visibleWorldEventsAudiencePolicyQuery+`
				)
			)
		order by event.id
		limit $5`, worldID, after, facilitator, member.ID, worldEventBatchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]worldEventResponse, 0)
	for rows.Next() {
		var item worldEventResponse
		var invalidatesInteractionAudience bool
		if err := rows.Scan(
			&item.ID, &item.Type, &item.InteractionID, &item.SubmissionID,
			&item.ResolutionID, &item.ActorMembershipID, &item.CreatedAt,
			&invalidatesInteractionAudience,
		); err != nil {
			return nil, err
		}
		result = append(result, projectVisibleWorldEvent(
			item, facilitator, invalidatesInteractionAudience,
		))
	}
	return result, rows.Err()
}

func projectVisibleWorldEvent(
	item worldEventResponse,
	facilitator, invalidatesInteractionAudience bool,
) worldEventResponse {
	if facilitator || !invalidatesInteractionAudience {
		return item
	}
	item.Type = interactionFeedInvalidatedEventType
	item.InteractionID = nil
	item.SubmissionID = nil
	item.ResolutionID = nil
	item.ActorMembershipID = nil
	return item
}

func requirePlayReadyWorldMember(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID string,
) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if err := requireInteractionMemberReadiness(ctx, db, member); err != nil {
		return member, err
	}
	return member, nil
}

func requireInteractionMemberReadiness(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
) error {
	if member.Role != "player" {
		return nil
	}
	playStatus, err := membershipPlayStatus(
		ctx, db, member.WorldID, member.ID, member.Role, member.Status,
	)
	if err != nil {
		return err
	}
	if playStatus != "ready" {
		return &statusError{
			Status: http.StatusForbidden, Code: "character_setup_required",
			Message: "complete a controlled character before entering live play",
			Fields:  map[string]string{"play_status": playStatus},
		}
	}
	return nil
}

func lockInteractionWorldMember(
	ctx context.Context,
	tx pgx.Tx,
	r *http.Request,
	worldID string,
) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, tx, r, worldID)
	if err != nil {
		return member, err
	}
	locked := authorizedWorldMember{}
	err = tx.QueryRow(ctx, `
		select membership.id::text, membership.world_id::text, membership.user_id::text,
			membership.role, membership.status, world.status
		from world_memberships membership
		join worlds world on world.id = membership.world_id
		where membership.id = $1 and membership.world_id = $2 and membership.user_id = $3
		for share of membership, world`, member.ID, worldID, member.UserID,
	).Scan(
		&locked.ID, &locked.WorldID, &locked.UserID,
		&locked.Role, &locked.Status, &locked.WorldStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && locked.Status != "active") {
		return locked, &statusError{
			Status: http.StatusForbidden, Code: "world_forbidden",
			Message: "active world membership is required",
		}
	}
	if err != nil {
		return locked, err
	}
	if locked.WorldStatus != "active" {
		return locked, &statusError{
			Status: http.StatusConflict, Code: "world_archived",
			Message: "archived worlds cannot be changed",
		}
	}
	return locked, nil
}

func requireInteractionVisibility(
	ctx context.Context,
	db queryer,
	worldID, interactionID string,
	member authorizedWorldMember,
) error {
	if interactionFacilitator(member.Role) {
		var exists bool
		if err := db.QueryRow(ctx, `
			select exists(
				select 1 from interactions where world_id = $1 and id = $2
			)`, worldID, interactionID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return pgx.ErrNoRows
		}
		return nil
	}
	var visible bool
	if err := db.QueryRow(ctx, `
		select exists(
			select 1
			from interactions interaction
			join interaction_audience_members audience
				on audience.interaction_id = interaction.id
				and audience.world_id = interaction.world_id
			where interaction.world_id = $1 and interaction.id = $2
				and interaction.status in ('open', 'resolved')
				and audience.membership_id = $3
		)`, worldID, interactionID, member.ID).Scan(&visible); err != nil {
		return err
	}
	if !visible {
		return pgx.ErrNoRows
	}
	return nil
}

func loadInteractionStringColumn(
	ctx context.Context,
	db queryer,
	query string,
	arguments ...any,
) ([]string, error) {
	rows, err := db.Query(ctx, query, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func interactionDraftMatches(
	current interactionResponse,
	request saveInteractionRequest,
	related interactionAudience,
) bool {
	return interactionOptionalStringsEqual(current.Title, request.Title) &&
		current.Prompt == request.Prompt &&
		interactionOptionalStringsEqual(current.PrivateNotes, request.PrivateNotes) &&
		interactionStringSlicesEqual(current.AudienceMembershipIDs, related.AudienceIDs) &&
		interactionStringSlicesEqual(current.EligibleResponderMembershipIDs, related.ResponderIDs) &&
		interactionStringSlicesEqual(current.EntityIDs, related.EntityIDs)
}

func interactionOptionalStringsEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func interactionStringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func interactionFacilitator(role string) bool {
	return role == "owner" || role == "editor"
}

func facilitatorRequired() error {
	return &statusError{
		Status: http.StatusForbidden, Code: "facilitator_required",
		Message: "facilitator authority is required",
	}
}

func worldEventCursor(r *http.Request) (int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get("after"))
	if raw == "" {
		raw = strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	}
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, errors.New("after must be a non-negative event cursor")
	}
	return value, nil
}

func interactionConflict(expected, actual int64) error {
	return &statusError{
		Status: http.StatusConflict, Code: "revision_conflict",
		Message: "interaction changed since it was loaded",
		Fields: map[string]string{
			"expected_revision": fmt.Sprint(expected),
			"actual_revision":   fmt.Sprint(actual),
		},
	}
}
