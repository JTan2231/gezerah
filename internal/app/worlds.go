package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

const maxWorldProseGuideLength = 10000

func (s *Server) handleListWorlds(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select world_id::text from world_memberships
		where user_id = $1 and status = 'active'
		order by world_id limit 500`, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	worldIDs := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		worldIDs = append(worldIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	items := make([]worldResponse, 0, len(worldIDs))
	for _, worldID := range worldIDs {
		item, err := loadWorldResponse(r.Context(), s.db, worldID, userID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWorld(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createWorldRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "name", request.Name, 200)
	request.Description = cleanOptional(request.Description)
	request.ProseGuide = cleanOptional(request.ProseGuide)
	validateWorldProseGuide(fields, request.ProseGuide)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "world is invalid", fields)
		return
	}
	worldID := request.ID
	if worldID == "" {
		worldID, err = newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
	}
	membershipID, err := newID()
	if err != nil {
		handleAppError(w, err)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	if _, err := tx.Exec(r.Context(), `
		insert into worlds (id, name, description, prose_guide, created_by_user_id, facilitator_membership_id)
		values ($1, $2, $3, $4, $5, $6)`,
		worldID, strings.TrimSpace(request.Name), request.Description, request.ProseGuide, userID, membershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_memberships (id, world_id, user_id, role, status, joined_at)
		values ($1, $2, $3, 'owner', 'active', now())`, membershipID, worldID, userID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `insert into world_character_field_sets (world_id) values ($1)`, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(r.Context(), tx, worldID, "world-created", membershipID, nil, nil, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", publicProductPath("/api/worlds/"+worldID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWorld(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, member.WorldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateWorld(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request updateWorldRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required", map[string]string{"expected_revision": "is required"})
		return
	}
	var currentName string
	var currentDescription, currentProseGuide *string
	var actual int64
	if err := s.db.QueryRow(r.Context(), `
		select name, description, prose_guide, revision from worlds where id = $1`, member.WorldID,
	).Scan(&currentName, &currentDescription, &currentProseGuide, &actual); err != nil {
		handleAppError(w, err)
		return
	}
	if actual != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("world", *request.ExpectedRevision, actual))
		return
	}
	if request.Name != nil {
		currentName = strings.TrimSpace(*request.Name)
	}
	if request.Description.Set {
		currentDescription = cleanOptional(request.Description.Value)
	}
	if request.ProseGuide.Set {
		currentProseGuide = cleanOptional(request.ProseGuide.Value)
	}
	fields := map[string]string{}
	validateRequired(fields, "name", currentName, 200)
	validateWorldProseGuide(fields, currentProseGuide)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "world is invalid", fields)
		return
	}
	command, err := s.db.Exec(r.Context(), `
		update worlds set name = $2, description = $3, prose_guide = $4, revision = revision + 1
		where id = $1 and revision = $5`,
		member.WorldID, currentName, currentDescription, currentProseGuide, actual)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if command.RowsAffected() == 0 {
		handleAppError(w, revisionConflict("world", actual, actual+1))
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, member.WorldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateFacilitator(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	member, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request updateFacilitatorRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Source = strings.TrimSpace(request.Source)
	fields := map[string]string{}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "a non-negative expected revision is required"
	}
	switch request.Source {
	case "human":
		if request.MembershipID == nil || !validID(strings.TrimSpace(*request.MembershipID)) {
			fields["membership_id"] = "a human facilitator membership UUID is required"
		}
	case "terra", "agent":
		if request.MembershipID != nil {
			fields["membership_id"] = "must be omitted for a non-human facilitator"
		}
	default:
		fields["source"] = "must be human, terra, or agent"
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "facilitator assignment is invalid", fields)
		return
	}
	if request.Source == "terra" && s.models == nil {
		handleAppError(w, modelProviderUnavailable())
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var worldStatus, currentSource string
	var currentMembershipID *string
	var actualRevision int64
	if err := tx.QueryRow(r.Context(), `
		select status, revision, facilitator_source, facilitator_membership_id::text
		from worlds where id = $1 for update`, worldID,
	).Scan(&worldStatus, &actualRevision, &currentSource, &currentMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if worldStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"})
		return
	}
	var membershipRole, membershipStatus string
	if err := tx.QueryRow(r.Context(), `
		select role, status from world_memberships
		where world_id = $1 and id = $2 and user_id = $3
		for share`, worldID, member.ID, member.UserID,
	).Scan(&membershipRole, &membershipStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if membershipStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusForbidden, Code: "world_forbidden", Message: "active world membership is required"})
		return
	}
	requesterIsFacilitator := currentSource == "human" && currentMembershipID != nil && *currentMembershipID == member.ID
	if membershipRole != "owner" && membershipRole != "editor" && !requesterIsFacilitator {
		handleAppError(w, &statusError{Status: http.StatusForbidden, Code: "facilitator_assignment_forbidden", Message: "world editing or current facilitator authority is required"})
		return
	}
	if actualRevision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("world", *request.ExpectedRevision, actualRevision))
		return
	}

	var nextMembershipID *string
	if request.Source == "human" {
		targetID := strings.TrimSpace(*request.MembershipID)
		var targetRole, targetStatus string
		if err := tx.QueryRow(r.Context(), `
			select role, status from world_memberships
			where world_id = $1 and id = $2
			for share`, worldID, targetID,
		).Scan(&targetRole, &targetStatus); errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", "facilitator assignment is invalid", map[string]string{
				"membership_id": "must identify an active non-spectator membership in this world",
			})
			return
		} else if err != nil {
			handleAppError(w, err)
			return
		}
		if targetStatus != "active" || targetRole == "spectator" {
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", "facilitator assignment is invalid", map[string]string{
				"membership_id": "must identify an active non-spectator membership in this world",
			})
			return
		}
		nextMembershipID = &targetID
	}
	assignmentUnchanged := currentSource == request.Source &&
		((currentMembershipID == nil && nextMembershipID == nil) ||
			(currentMembershipID != nil && nextMembershipID != nil && *currentMembershipID == *nextMembershipID))
	if assignmentUnchanged {
		item, loadErr := loadWorldResponse(r.Context(), tx, worldID, member.UserID)
		if loadErr != nil {
			handleAppError(w, loadErr)
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	type unfinishedInteraction struct {
		id, status, facilitatorSource string
	}
	unfinished := make([]unfinishedInteraction, 0, 1)
	rows, err := tx.Query(r.Context(), `
		select id::text, status, facilitator_source from interactions
		where world_id = $1 and status in ('draft', 'open', 'adjudicating')
		order by created_at, id
		for update`, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	for rows.Next() {
		var item unfinishedInteraction
		if err := rows.Scan(&item.id, &item.status, &item.facilitatorSource); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		unfinished = append(unfinished, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	facilitatorRecovery := len(unfinished) == 1 &&
		(unfinished[0].status == "open" || unfinished[0].status == "adjudicating") &&
		unfinished[0].facilitatorSource == terraFacilitatorSource &&
		currentSource == terraFacilitatorSource &&
		request.Source == "human" &&
		nextMembershipID != nil && *nextMembershipID == member.ID && membershipRole == "owner"
	if len(unfinished) > 0 && !facilitatorRecovery {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "interactions_unfinished", Message: "resolve or cancel active interactions before changing facilitator"})
		return
	}
	if facilitatorRecovery {
		interactionID := unfinished[0].id
		var actionID string
		err := tx.QueryRow(r.Context(), `
			select id::text from interaction_actions
			where world_id = $1 and interaction_id = $2
				and submitted_by_membership_id = $3 and status = 'submitted'
			order by created_at desc, id desc
			limit 1 for update`, worldID, interactionID, member.ID,
		).Scan(&actionID)
		if err == nil {
			if _, err := tx.Exec(r.Context(), `
				update interaction_actions
				set status = 'withdrawn', revision = revision + 1
				where world_id = $1 and interaction_id = $2 and id = $3`,
				worldID, interactionID, actionID,
			); err != nil {
				handleAppError(w, err)
				return
			}
			if _, err := tx.Exec(r.Context(), `
				update interactions set revision = revision + 1
				where world_id = $1 and id = $2`, worldID, interactionID,
			); err != nil {
				handleAppError(w, err)
				return
			}
			if err := appendWorldEvent(
				r.Context(), tx, worldID, "action-withdrawn", member.ID,
				&interactionID, &actionID, nil,
			); err != nil {
				handleAppError(w, err)
				return
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		update worlds
		set facilitator_source = $2, facilitator_membership_id = $3, revision = revision + 1
		where id = $1`, worldID, request.Source, nextMembershipID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(r.Context(), tx, worldID, "facilitator-changed", member.ID, nil, nil, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveWorld(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldOwner(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request archiveWorldRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ExpectedRevision == nil {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "expected_revision is required", map[string]string{"expected_revision": "is required"})
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var actual int64
	var status string
	if err := tx.QueryRow(r.Context(), `select revision, status from worlds where id = $1 for update`, member.WorldID).Scan(&actual, &status); err != nil {
		handleAppError(w, err)
		return
	}
	if actual != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("world", *request.ExpectedRevision, actual))
		return
	}
	if status == "archived" {
		item, loadErr := loadWorldResponse(r.Context(), tx, member.WorldID, member.UserID)
		if loadErr != nil {
			handleAppError(w, loadErr)
			return
		}
		writeJSON(w, http.StatusOK, item)
		return
	}
	var unfinished int
	if err := tx.QueryRow(r.Context(), `
		select count(*)::int from interactions
		where world_id = $1 and status in ('draft', 'open', 'adjudicating')`, member.WorldID).Scan(&unfinished); err != nil {
		handleAppError(w, err)
		return
	}
	if unfinished > 0 {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "interactions_unfinished", Message: "resolve or cancel active interactions before archiving the world"})
		return
	}
	if _, err := tx.Exec(r.Context(), `update worlds set status = 'archived', revision = revision + 1 where id = $1`, member.WorldID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendWorldEvent(r.Context(), tx, member.WorldID, "world-archived", member.ID, nil, nil, nil); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, member.WorldID, member.UserID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func loadWorldResponse(ctx context.Context, db queryer, worldID, userID string) (worldResponse, error) {
	var item worldResponse
	var membershipStatus string
	var facilitatorSource string
	err := db.QueryRow(ctx, `
		select world.id::text, world.name, world.description, world.prose_guide,
			world.facilitator_source, world.status,
			world.facilitator_membership_id::text, facilitator_user.display_name,
			world.revision, world.roster_revision, membership.role, membership.id::text,
			membership.status,
			(select count(*)::int from world_memberships where world_id = world.id and status = 'active'),
			(select count(*)::int from world_mechanics where world_id = world.id and kind = 'capacity' and not archived),
			(select count(*)::int from world_mechanics where world_id = world.id and kind = 'capability' and not archived),
			(select count(*)::int from world_character_fields where world_id = world.id and not archived),
			rules.revision,
			world.created_at, world.updated_at,
			(select max(created_at) from interactions where world_id = world.id)
		from worlds world
		join world_mechanic_graphs rules on rules.world_id = world.id
		join world_memberships membership on membership.world_id = world.id and membership.user_id = $2
		left join world_memberships facilitator
			on facilitator.world_id = world.id and facilitator.id = world.facilitator_membership_id
		left join users facilitator_user on facilitator_user.id = facilitator.user_id
		where world.id = $1`, worldID, userID,
	).Scan(
		&item.ID, &item.Name, &item.Description, &item.ProseGuide,
		&facilitatorSource, &item.Status,
		&item.Facilitator.MembershipID, &item.Facilitator.DisplayName,
		&item.Revision, &item.RosterRevision, &item.Role, &item.MembershipID,
		&membershipStatus, &item.MemberCount, &item.CapacityCount, &item.CapabilityCount,
		&item.CharacterFieldCount, &item.RulesRevision,
		&item.CreatedAt, &item.UpdatedAt, &item.LastInteractionAt,
	)
	if err != nil {
		return item, err
	}
	item.Facilitator.Source = facilitatorSource
	item.CurrentPlayRole = currentPlayRole(
		item.Role,
		facilitatorSource == "human" && item.Facilitator.MembershipID != nil &&
			*item.Facilitator.MembershipID == item.MembershipID,
	)
	item.PlayStatus, err = membershipPlayStatus(ctx, db, worldID, item.MembershipID, item.Role, membershipStatus)
	return item, err
}

func validateWorldProseGuide(fields map[string]string, proseGuide *string) {
	if proseGuide != nil && len([]rune(*proseGuide)) > maxWorldProseGuideLength {
		fields["prose_guide"] = fmt.Sprintf("must be at most %d characters", maxWorldProseGuideLength)
	}
}

func (s *Server) handleListWorldMembers(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	var facilitatorSource string
	var facilitatorMembershipID *string
	if err := s.db.QueryRow(r.Context(), `
		select facilitator_source, facilitator_membership_id::text from worlds where id = $1`, member.WorldID,
	).Scan(&facilitatorSource, &facilitatorMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select membership.id::text, membership.user_id::text, users.display_name,
			membership.role, membership.status, membership.revision, membership.joined_at,
			membership.created_at, membership.updated_at
		from world_memberships membership
		join users on users.id = membership.user_id
		where membership.world_id = $1
		order by case membership.role when 'owner' then 0 when 'editor' then 1 when 'player' then 2 else 3 end,
			lower(users.display_name), membership.id`, member.WorldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	items := make([]worldMemberResponse, 0)
	for rows.Next() {
		var item worldMemberResponse
		if err := rows.Scan(&item.ID, &item.UserID, &item.DisplayName, &item.Role, &item.Status, &item.Revision, &item.JoinedAt, &item.CreatedAt, &item.UpdatedAt); err != nil {
			rows.Close()
			handleAppError(w, err)
			return
		}
		item.CurrentPlayRole = currentPlayRole(
			item.Role,
			facilitatorSource == "human" && facilitatorMembershipID != nil &&
				*facilitatorMembershipID == item.ID,
		)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		handleAppError(w, err)
		return
	}
	rows.Close()
	for index := range items {
		item := &items[index]
		controlRows, err := s.db.Query(r.Context(), `
			select entity_id::text from world_membership_entity_controls
			where world_id = $1 and membership_id = $2 order by entity_id`, member.WorldID, item.ID)
		if err != nil {
			handleAppError(w, err)
			return
		}
		item.ControlledEntityIDs = make([]string, 0)
		for controlRows.Next() {
			var id string
			if err := controlRows.Scan(&id); err != nil {
				controlRows.Close()
				handleAppError(w, err)
				return
			}
			item.ControlledEntityIDs = append(item.ControlledEntityIDs, id)
		}
		if err := controlRows.Err(); err != nil {
			controlRows.Close()
			handleAppError(w, err)
			return
		}
		controlRows.Close()
		item.PlayStatus, err = membershipPlayStatus(r.Context(), s.db, member.WorldID, item.ID, item.Role, item.Status)
		if err != nil {
			handleAppError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleListWorldInvites(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	rows, err := s.db.Query(r.Context(), `
		select invite.id::text, invite.role, users.display_name, invite.expires_at,
			invite.revoked_at, invite.use_count, invite.created_at
		from world_invites invite
		join world_memberships creator on creator.id = invite.created_by_membership_id
		join users on users.id = creator.user_id
		where invite.world_id = $1 order by invite.created_at desc, invite.id`, member.WorldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rows.Close()
	items := make([]worldInviteResponse, 0)
	for rows.Next() {
		var item worldInviteResponse
		if err := rows.Scan(&item.ID, &item.Role, &item.CreatedByDisplayName, &item.ExpiresAt, &item.RevokedAt, &item.UseCount, &item.CreatedAt); err != nil {
			handleAppError(w, err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleCreateWorldInvite(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request createWorldInviteRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if !validWorldInviteRole(request.Role) {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "invite role is invalid", map[string]string{"role": "must be editor, player, or spectator"})
		return
	}
	if request.ExpiresInDays == 0 {
		request.ExpiresInDays = 7
	}
	if request.ExpiresInDays < 1 || request.ExpiresInDays > 90 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "invite expiry is invalid", map[string]string{"expires_in_days": "must be between 1 and 90"})
		return
	}
	token, hash, err := newWorldInviteToken()
	if err != nil {
		handleAppError(w, err)
		return
	}
	var item worldInviteResponse
	err = s.db.QueryRow(r.Context(), `
		with inserted as (
			insert into world_invites (world_id, token_hash, role, created_by_membership_id, expires_at)
			values ($1, $2, $3, $4, now() + make_interval(days => $5))
			returning id, role, expires_at, revoked_at, use_count, created_at
		)
		select inserted.id::text, inserted.role, users.display_name, inserted.expires_at,
			inserted.revoked_at, inserted.use_count, inserted.created_at
		from inserted
		join world_memberships creator on creator.id = $4
		join users on users.id = creator.user_id`, member.WorldID, hash, request.Role, member.ID, request.ExpiresInDays,
	).Scan(&item.ID, &item.Role, &item.CreatedByDisplayName, &item.ExpiresAt, &item.RevokedAt, &item.UseCount, &item.CreatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	joinPath := publicProductPath("/play/invite/" + token)
	if request.Role == "editor" {
		joinPath = publicProductPath("/build/invite/" + token)
	}
	item.JoinPath = &joinPath
	w.Header().Set("Location", publicProductPath(fmt.Sprintf("/api/worlds/%s/invites/%s", member.WorldID, item.ID)))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleRevokeWorldInvite(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	inviteID := r.PathValue("invite_id")
	if !validID(inviteID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "invite ID is malformed", nil)
		return
	}
	var item worldInviteResponse
	err = s.db.QueryRow(r.Context(), `
		with changed as (
			update world_invites set revoked_at = coalesce(revoked_at, now())
			where id = $1 and world_id = $2
			returning id, role, created_by_membership_id, expires_at, revoked_at, use_count, created_at
		)
		select changed.id::text, changed.role, users.display_name, changed.expires_at,
			changed.revoked_at, changed.use_count, changed.created_at
		from changed join world_memberships creator on creator.id = changed.created_by_membership_id
		join users on users.id = creator.user_id`, inviteID, member.WorldID,
	).Scan(&item.ID, &item.Role, &item.CreatedByDisplayName, &item.ExpiresAt, &item.RevokedAt, &item.UseCount, &item.CreatedAt)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePreviewWorldInvite(w http.ResponseWriter, r *http.Request) {
	item, err := loadWorldInvitePreview(r.Context(), s.db, r.PathValue("token"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleRedeemWorldInvite(w http.ResponseWriter, r *http.Request) {
	userID, err := requireKnownActor(r.Context(), s.db, r)
	if err != nil {
		handleAppError(w, err)
		return
	}
	token := r.PathValue("token")
	if token == "" {
		handleAppError(w, inviteNotFound())
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)
	var inviteID, worldID, role string
	err = tx.QueryRow(r.Context(), `
		select invite.id::text, invite.world_id::text, invite.role
		from world_invites invite
		join worlds world on world.id = invite.world_id
		where invite.token_hash = $1 and invite.revoked_at is null
			and invite.expires_at > now() and world.status = 'active'
		for update of invite, world`, hashWorldInviteToken(token),
	).Scan(&inviteID, &worldID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		handleAppError(w, inviteNotFound())
		return
	}
	if err != nil {
		handleAppError(w, err)
		return
	}
	var alreadyRedeemed bool
	if err := tx.QueryRow(r.Context(), `
		select exists(select 1 from world_invite_redemptions where invite_id = $1 and user_id = $2)`, inviteID, userID,
	).Scan(&alreadyRedeemed); err != nil {
		handleAppError(w, err)
		return
	}
	if alreadyRedeemed {
		var reactivatedMembershipID string
		err := tx.QueryRow(r.Context(), `
			update world_memberships membership
			set status = 'active', revision = membership.revision + 1
			from world_invite_redemptions redemption
			where redemption.invite_id = $1 and redemption.user_id = $2
				and membership.id = redemption.world_membership_id
				and membership.world_id = redemption.world_id
				and membership.status <> 'active'
			returning membership.id::text`, inviteID, userID,
		).Scan(&reactivatedMembershipID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			handleAppError(w, err)
			return
		}
		if err == nil {
			if _, err := tx.Exec(r.Context(), `update worlds set roster_revision = roster_revision + 1 where id = $1`, worldID); err != nil {
				handleAppError(w, err)
				return
			}
			if err := appendWorldEvent(r.Context(), tx, worldID, "membership-created", reactivatedMembershipID, nil, nil, nil); err != nil {
				handleAppError(w, err)
				return
			}
		}
	}
	if !alreadyRedeemed {
		membershipID, idErr := newID()
		if idErr != nil {
			handleAppError(w, idErr)
			return
		}
		if err := tx.QueryRow(r.Context(), `
			insert into world_memberships (id, world_id, user_id, role, status, joined_at)
			values ($1, $2, $3, $4, 'active', now())
			on conflict (world_id, user_id) do update set
				role = case
					when world_memberships.role = 'owner' then 'owner'
					when world_memberships.status = 'active' then world_memberships.role
					else excluded.role
				end,
				status = 'active', joined_at = coalesce(world_memberships.joined_at, now()),
				revision = world_memberships.revision + 1
			returning id::text`, membershipID, worldID, userID, role,
		).Scan(&membershipID); err != nil {
			handleAppError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `
			insert into world_invite_redemptions (invite_id, world_id, user_id, world_membership_id)
			values ($1, $2, $3, $4)`, inviteID, worldID, userID, membershipID); err != nil {
			handleAppError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `update world_invites set use_count = use_count + 1 where id = $1`, inviteID); err != nil {
			handleAppError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `update worlds set roster_revision = roster_revision + 1 where id = $1`, worldID); err != nil {
			handleAppError(w, err)
			return
		}
		if err := appendWorldEvent(r.Context(), tx, worldID, "membership-created", membershipID, nil, nil, nil); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldResponse(r.Context(), s.db, worldID, userID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func loadWorldInvitePreview(ctx context.Context, db queryer, token string) (worldInvitePreviewResponse, error) {
	var item worldInvitePreviewResponse
	if token == "" {
		return item, inviteNotFound()
	}
	err := db.QueryRow(ctx, `
		select world.id::text, world.name, world.description, invite.role,
			users.display_name, invite.expires_at
		from world_invites invite
		join worlds world on world.id = invite.world_id
		join world_memberships creator on creator.id = invite.created_by_membership_id
		join users on users.id = creator.user_id
		where invite.token_hash = $1 and invite.revoked_at is null
			and invite.expires_at > now() and world.status = 'active'`, hashWorldInviteToken(token),
	).Scan(&item.WorldID, &item.WorldName, &item.WorldDescription, &item.Role, &item.InvitedByDisplayName, &item.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, inviteNotFound()
	}
	return item, err
}

func validWorldInviteRole(role string) bool {
	return role == "editor" || role == "player" || role == "spectator"
}

func newWorldInviteToken() (string, string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(value)
	return token, hashWorldInviteToken(token), nil
}

func hashWorldInviteToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func inviteNotFound() error {
	return &statusError{Status: http.StatusNotFound, Code: "invite_not_found", Message: "invite is unavailable"}
}

func appendWorldEvent(ctx context.Context, tx pgx.Tx, worldID, eventType, actorMembershipID string, interactionID, actionID, resolutionID *string) error {
	return appendWorldEventForSource(
		ctx, tx, worldID, eventType, "human", &actorMembershipID,
		interactionID, actionID, resolutionID, false,
	)
}

func appendWorldEventWithAudienceInvalidation(
	ctx context.Context,
	tx pgx.Tx,
	worldID, eventType, actorMembershipID string,
	interactionID, actionID, resolutionID *string,
	invalidatesInteractionAudience bool,
) error {
	return appendWorldEventForSource(
		ctx, tx, worldID, eventType, "human", &actorMembershipID,
		interactionID, actionID, resolutionID, invalidatesInteractionAudience,
	)
}

func appendWorldEventForSource(
	ctx context.Context,
	tx pgx.Tx,
	worldID, eventType, actorSource string,
	actorMembershipID, interactionID, actionID, resolutionID *string,
	invalidatesInteractionAudience bool,
) error {
	_, err := tx.Exec(ctx, `
		insert into world_events (
			world_id, event_type, actor_source, actor_membership_id, interaction_id,
			action_id, resolution_id, invalidates_interaction_audience
		) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		worldID, eventType, actorSource, actorMembershipID, interactionID, actionID, resolutionID,
		invalidatesInteractionAudience)
	return err
}
