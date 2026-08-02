package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Server) registerInteractionCoreRoutes() {
	s.api.HandleFunc("GET /api/games/{game_id}/interactions", s.handleListInteractions)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions", s.handleCreateInteraction)
	s.api.HandleFunc("GET /api/games/{game_id}/interactions/{interaction_id}", s.handleGetInteraction)
	s.api.HandleFunc("PUT /api/games/{game_id}/interactions/{interaction_id}", s.handlePutInteraction)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/present", s.handlePresentInteraction)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/adjudicate", s.handleBeginInteractionAdjudication)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/cancel", s.handleCancelInteraction)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/actions", s.handleCreateInteractionAction)
	s.api.HandleFunc("POST /api/games/{game_id}/interactions/{interaction_id}/actions/{action_id}/withdraw", s.handleWithdrawInteractionAction)
	s.api.HandleFunc("GET /api/games/{game_id}/events", s.handleGameEvents)
}

func (s *Server) handleListInteractions(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	userID, err := requireKnownPlayActor(r.Context(), tx, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	member, err := requireActiveGameMember(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := tx.Query(r.Context(), `
		select interaction.id::text
		from interactions interaction
		where interaction.game_id = $1
			and (
				$2 = 'facilitator'
				or (
					interaction.status in ('open', 'resolved')
					and interaction.presented_at is not null
					and exists (
						select 1 from interaction_audience_members audience
						where audience.interaction_id = interaction.id
							and audience.game_id = interaction.game_id
							and audience.membership_id = $3
					)
				)
			)
		order by interaction.created_at desc, interaction.id desc limit 500`,
		gameID, member.Role, member.ID)
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
		item, err := loadInteractionResponse(r.Context(), tx, gameID, id, member.Role == "facilitator")
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
	gameID, interactionID := r.PathValue("game_id"), r.PathValue("interaction_id")
	if !validID(gameID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	userID, err := requireKnownPlayActor(r.Context(), tx, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	member, err := requireActiveGameMember(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := requireInteractionVisibility(r.Context(), tx, gameID, interactionID, member); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadInteractionResponse(r.Context(), tx, gameID, interactionID, member.Role == "facilitator")
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
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request saveInteractionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	interactionID := request.ID
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
	actor, ruleSetID, _, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	related, fields, err := validateInteractionRequest(r.Context(), tx, gameID, ruleSetID, &request, false)
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
			id, game_id, title, prompt, private_notes, status, revision,
			created_by_membership_id, presented_at
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, interactionID, gameID,
		nullableOptionalString(request.Title), request.Prompt, nullableOptionalString(request.PrivateNotes),
		status, revision, actor.ID, presentedAt); err != nil {
		handleAppError(w, err)
		return
	}
	if err := replaceInteractionChildren(r.Context(), tx, interactionID, gameID, related); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendInteractionGameEvent(r.Context(), tx, gameID, "interaction-created", actor.ID, interactionID, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if request.Present {
		if err := appendInteractionGameEvent(r.Context(), tx, gameID, "interaction-presented", actor.ID, interactionID, nil); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadInteractionResponseSnapshot(r.Context(), gameID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/games/%s/interactions/%s", gameID, interactionID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handlePutInteraction(w http.ResponseWriter, r *http.Request) {
	gameID, interactionID := r.PathValue("game_id"), r.PathValue("interaction_id")
	if !validID(gameID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
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
	actor, ruleSetID, _, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var status string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision from interactions
		where game_id = $1 and id = $2 for update`, gameID, interactionID).Scan(&status, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if status != "draft" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "interaction_not_editable", Message: "only draft interactions can be edited"})
		return
	}
	related, fields, err := validateInteractionRequest(r.Context(), tx, gameID, ruleSetID, &request, true)
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
	current, err := loadInteractionResponse(r.Context(), tx, gameID, interactionID, true)
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
		update interactions set title = $3, prompt = $4, private_notes = $5,
			revision = revision + 1
		where game_id = $1 and id = $2`, gameID, interactionID,
		nullableOptionalString(request.Title), request.Prompt, nullableOptionalString(request.PrivateNotes)); err != nil {
		handleAppError(w, err)
		return
	}
	if err := replaceInteractionChildren(r.Context(), tx, interactionID, gameID, related); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendInteractionGameEvent(r.Context(), tx, gameID, "interaction-updated", actor.ID, interactionID, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadInteractionResponseSnapshot(r.Context(), gameID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func interactionDraftMatches(current interactionResponse, request saveInteractionRequest, related interactionAudience) bool {
	return optionalStringsEqual(current.Title, request.Title) &&
		current.Prompt == request.Prompt &&
		optionalStringsEqual(current.PrivateNotes, request.PrivateNotes) &&
		equalStrings(current.AudienceMembershipIDs, related.AudienceIDs) &&
		equalStrings(current.EligibleResponderMembershipIDs, related.ResponderIDs) &&
		equalStrings(current.EntityIDs, related.EntityIDs)
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
	gameID, interactionID := r.PathValue("game_id"), r.PathValue("interaction_id")
	if !validID(gameID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request interactionLifecycleRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required", map[string]string{"expected_revision": "a non-negative expected revision is required"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	actor, _, _, err := lockGameForFacilitator(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var status string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision from interactions
		where game_id = $1 and id = $2 for update`, gameID, interactionID).Scan(&status, &revision); err != nil {
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
		_, err = tx.Exec(r.Context(), `
			update interactions set status = 'open', presented_at = now(), revision = revision + 1
			where game_id = $1 and id = $2`, gameID, interactionID)
		eventType = "interaction-presented"
	case "adjudicate":
		if status != "open" {
			handleAppError(w, interactionLifecycleConflict("only an open interaction can begin adjudication"))
			return
		}
		_, err = tx.Exec(r.Context(), `
			update interactions set status = 'adjudicating', revision = revision + 1
			where game_id = $1 and id = $2`, gameID, interactionID)
		eventType = "interaction-adjudicating"
	case "cancel":
		if status == "resolved" || status == "cancelled" {
			handleAppError(w, interactionLifecycleConflict("final interactions cannot be cancelled"))
			return
		}
		_, err = tx.Exec(r.Context(), `
			update interactions set status = 'cancelled', cancelled_at = now(), revision = revision + 1
			where game_id = $1 and id = $2`, gameID, interactionID)
		eventType = "interaction-cancelled"
	default:
		err = fmt.Errorf("unsupported interaction lifecycle command %q", command)
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendInteractionGameEvent(r.Context(), tx, gameID, eventType, actor.ID, interactionID, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := s.loadInteractionResponseSnapshot(r.Context(), gameID, interactionID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleCreateInteractionAction(w http.ResponseWriter, r *http.Request) {
	gameID, interactionID := r.PathValue("game_id"), r.PathValue("interaction_id")
	if !validID(gameID) || !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createInteractionActionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Text = strings.TrimSpace(request.Text)
	fields := map[string]string{}
	validateRequired(fields, "text", request.Text, 10000)
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
	var gameStatus string
	if err := tx.QueryRow(r.Context(), `select status from games where id = $1 for share`, gameID).Scan(&gameStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if gameStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "game_archived", Message: "archived games cannot receive actions"})
		return
	}
	member, err := requireActiveGameMember(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if member.Role != "player" {
		handleAppError(w, &statusError{Status: http.StatusForbidden, Code: "player_required", Message: "only players may submit actions"})
		return
	}
	var status string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision from interactions
		where game_id = $1 and id = $2 for update`, gameID, interactionID).Scan(&status, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, interactionConflict(*request.ExpectedRevision, revision))
		return
	}
	if status != "open" {
		handleAppError(w, interactionLifecycleConflict("actions may be submitted only while the interaction is open"))
		return
	}
	var eligible bool
	if err := tx.QueryRow(r.Context(), `
		select exists(
			select 1 from interaction_eligible_responders
			where interaction_id = $1 and game_id = $2 and membership_id = $3
		)`, interactionID, gameID, member.ID).Scan(&eligible); err != nil {
		handleAppError(w, err)
		return
	}
	if !eligible {
		handleAppError(w, &statusError{Status: http.StatusForbidden, Code: "responder_required", Message: "this player is not eligible to respond to the interaction"})
		return
	}
	var alreadySubmitted bool
	if err := tx.QueryRow(r.Context(), `
		select exists(
			select 1 from interaction_action_submissions
			where interaction_id = $1 and submitted_by_membership_id = $2 and status = 'submitted'
		)`, interactionID, member.ID).Scan(&alreadySubmitted); err != nil {
		handleAppError(w, err)
		return
	}
	if alreadySubmitted {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "action_already_submitted", Message: "withdraw the current action before submitting another"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into interaction_action_submissions (
			id, interaction_id, game_id, submitted_by_membership_id, text, status
		) values ($1, $2, $3, $4, $5, 'submitted')`, actionID, interactionID, gameID, member.ID, request.Text); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interactions set revision = revision + 1 where game_id = $1 and id = $2`, gameID, interactionID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendInteractionGameEvent(r.Context(), tx, gameID, "submission-created", member.ID, interactionID, &actionID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadInteractionAction(r.Context(), s.db, gameID, interactionID, actionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/games/%s/interactions/%s/actions/%s", gameID, interactionID, actionID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleWithdrawInteractionAction(w http.ResponseWriter, r *http.Request) {
	gameID, interactionID, actionID := r.PathValue("game_id"), r.PathValue("interaction_id"), r.PathValue("action_id")
	if !validID(gameID) || !validID(interactionID) || !validID(actionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "resource ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request withdrawInteractionActionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required", map[string]string{"expected_revision": "a non-negative action revision is required"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	var gameStatus string
	if err := tx.QueryRow(r.Context(), `select status from games where id = $1 for share`, gameID).Scan(&gameStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if gameStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "game_archived", Message: "archived games cannot receive action changes"})
		return
	}
	member, err := requireActiveGameMember(r.Context(), tx, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if member.Role != "player" {
		handleAppError(w, &statusError{Status: http.StatusForbidden, Code: "player_required", Message: "only players may withdraw actions"})
		return
	}
	var interactionStatus string
	if err := tx.QueryRow(r.Context(), `
		select status from interactions where game_id = $1 and id = $2 for update`,
		gameID, interactionID).Scan(&interactionStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if interactionStatus != "open" {
		handleAppError(w, interactionLifecycleConflict("actions may be withdrawn only while the interaction is open"))
		return
	}
	var submittedBy, actionStatus string
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select submitted_by_membership_id::text, status, revision
		from interaction_action_submissions
		where game_id = $1 and interaction_id = $2 and id = $3 for update`,
		gameID, interactionID, actionID).Scan(&submittedBy, &actionStatus, &revision); err != nil {
		handleAppError(w, err)
		return
	}
	if submittedBy != member.ID {
		handleAppError(w, &statusError{Status: http.StatusForbidden, Code: "action_forbidden", Message: "players may withdraw only their own actions"})
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("action", *request.ExpectedRevision, revision))
		return
	}
	if actionStatus != "submitted" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "action_not_submitted", Message: "only a submitted action can be withdrawn"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interaction_action_submissions
		set status = 'withdrawn', revision = revision + 1
		where game_id = $1 and interaction_id = $2 and id = $3`, gameID, interactionID, actionID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update interactions set revision = revision + 1 where game_id = $1 and id = $2`, gameID, interactionID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendInteractionGameEvent(r.Context(), tx, gameID, "submission-withdrawn", member.ID, interactionID, &actionID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadInteractionAction(r.Context(), s.db, gameID, interactionID, actionID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleGameEvents(w http.ResponseWriter, r *http.Request) {
	gameID := r.PathValue("game_id")
	if !validID(gameID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "game ID is malformed", nil)
		return
	}
	userID, err := requireKnownPlayActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	member, err := requireActiveGameMember(r.Context(), s.db, gameID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	after, err := eventCursor(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor", err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, "retry: 1500\n\n")
	controller := http.NewResponseController(w)
	if err := controller.Flush(); err != nil {
		return
	}
	ticker := time.NewTicker(eventPollInterval())
	defer ticker.Stop()
	for {
		// Membership status and role can change while a long-lived stream is
		// connected. Re-authorize every batch so revocation closes the stream and
		// role changes immediately alter event visibility.
		member, err = requireActiveGameMember(r.Context(), s.db, gameID, userID)
		if err != nil {
			return
		}
		events, err := loadVisibleGameEvents(r.Context(), s.db, gameID, member, after)
		if err != nil {
			return
		}
		if len(events) == 0 {
			_, _ = fmt.Fprintf(w, ": keep-alive\n\n")
		} else {
			for _, event := range events {
				payload, err := json.Marshal(event)
				if err != nil {
					return
				}
				if _, err := fmt.Fprintf(w, "id: %d\nevent: game-event\ndata: %s\n\n", event.ID, payload); err != nil {
					return
				}
				after = event.ID
			}
		}
		if err := controller.Flush(); err != nil {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func requireInteractionVisibility(ctx context.Context, db queryer, gameID, interactionID string, member authorizedGameMember) error {
	if member.Role == "facilitator" {
		var exists bool
		if err := db.QueryRow(ctx, `
			select exists(select 1 from interactions where game_id = $1 and id = $2)`,
			gameID, interactionID).Scan(&exists); err != nil {
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
			select 1 from interactions interaction
			join interaction_audience_members audience
				on audience.interaction_id = interaction.id and audience.game_id = interaction.game_id
			where interaction.game_id = $1 and interaction.id = $2
				and interaction.status in ('open', 'resolved') and interaction.presented_at is not null
				and audience.membership_id = $3
		)`, gameID, interactionID, member.ID).Scan(&visible); err != nil {
		return err
	}
	if !visible {
		return pgx.ErrNoRows
	}
	return nil
}

func eventCursor(r *http.Request) (int64, error) {
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

func interactionLifecycleConflict(message string) error {
	return &statusError{Status: http.StatusConflict, Code: "invalid_interaction_status", Message: message}
}
