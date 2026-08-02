package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type worldEntityProfileAccess struct {
	Member            authorizedWorldMember
	GameMembershipID  string
	EntityArchived    bool
	Controlled        bool
	CanReadRestricted bool
	CanEdit           bool
}

func (s *Server) handleReplaceWorldEntityControllers(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request replaceWorldEntityControllersRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := map[string]string{}
	if request.ExpectedGameRevision == nil || *request.ExpectedGameRevision < 0 {
		fields["expected_game_revision"] = "a non-negative expected game revision is required"
	}
	request.ControllerWorldMembershipIDs = uniqueSorted(request.ControllerWorldMembershipIDs)
	for index, membershipID := range request.ControllerWorldMembershipIDs {
		if !validID(membershipID) {
			fields[fmt.Sprintf("controller_world_membership_ids[%d]", index)] = "must be a UUID"
		}
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "entity controllers are invalid", fields)
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	member, err := requireWorldEditor(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var revision int64
	var gameStatus string
	if err := tx.QueryRow(r.Context(), `
		select revision, status from games where id = $1 for update`, member.PrimaryGameID,
	).Scan(&revision, &gameStatus); err != nil {
		handleAppError(w, err)
		return
	}
	if gameStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"})
		return
	}
	if revision != *request.ExpectedGameRevision {
		handleAppError(w, revisionConflict("game", *request.ExpectedGameRevision, revision))
		return
	}
	var entityArchived bool
	if err := tx.QueryRow(r.Context(), `
		select entity.archived
		from game_entities assignment
		join entities entity
			on entity.id = assignment.entity_id and entity.rule_set_id = assignment.rule_set_id
		where assignment.game_id = $1 and assignment.entity_id = $2
		for update of entity`, member.PrimaryGameID, entityID,
	).Scan(&entityArchived); err != nil {
		handleAppError(w, err)
		return
	}
	if entityArchived && len(request.ControllerWorldMembershipIDs) > 0 {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "entity_archived",
			Message: "archived entities cannot receive new player control assignments",
		})
		return
	}
	controllerGameMembershipIDs, err := resolveWorldControllerMembershipIDs(
		r.Context(), tx, worldID, member.PrimaryGameID,
		request.ControllerWorldMembershipIDs, "controller_world_membership_ids",
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	current, err := loadWorldEntityControllerWorldMembershipIDs(r.Context(), tx, worldID, member.PrimaryGameID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if equalStrings(current, request.ControllerWorldMembershipIDs) {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, worldEntityControllersResponse{
			EntityID: entityID, ControllerWorldMembershipIDs: current, GameRevision: revision,
		})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		delete from game_membership_entity_controls
		where game_id = $1 and entity_id = $2`, member.PrimaryGameID, entityID); err != nil {
		handleAppError(w, err)
		return
	}
	for _, controllerMembershipID := range controllerGameMembershipIDs {
		if _, err := tx.Exec(r.Context(), `
			insert into game_membership_entity_controls (game_id, membership_id, entity_id)
			values ($1, $2, $3)`, member.PrimaryGameID, controllerMembershipID, entityID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		update games set revision = $2 + 1 where id = $1`, member.PrimaryGameID, revision); err != nil {
		handleAppError(w, err)
		return
	}
	var actorGameMembershipID string
	if err := tx.QueryRow(r.Context(), `
		select id::text from game_memberships where game_id = $1 and user_id = $2`,
		member.PrimaryGameID, member.UserID,
	).Scan(&actorGameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(r.Context(), tx, member.PrimaryGameID, "entity-control-updated", actorGameMembershipID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, worldEntityControllersResponse{
		EntityID: entityID, ControllerWorldMembershipIDs: request.ControllerWorldMembershipIDs,
		GameRevision: revision + 1,
	})
}

func resolveWorldControllerMembershipIDs(
	ctx context.Context,
	db queryer,
	worldID, gameID string,
	worldMembershipIDs []string,
	field string,
) ([]string, error) {
	result := make([]string, 0, len(worldMembershipIDs))
	for index, worldMembershipID := range worldMembershipIDs {
		var gameMembershipID string
		err := db.QueryRow(ctx, `
			select game_membership.id::text
			from world_memberships world_membership
			join game_memberships game_membership
				on game_membership.game_id = $2
				and game_membership.user_id = world_membership.user_id
			where world_membership.rule_set_id = $1
				and world_membership.id = $3
				and world_membership.status = 'active'
				and world_membership.role = 'player'
				and game_membership.status = 'active'
				and game_membership.role = 'player'
			for share of world_membership, game_membership`,
			worldID, gameID, worldMembershipID,
		).Scan(&gameMembershipID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &statusError{
				Status: http.StatusUnprocessableEntity, Code: "invalid_controller",
				Message: "entity controllers are invalid",
				Fields: map[string]string{
					fmt.Sprintf("%s[%d]", field, index): "active player membership is required in this world",
				},
			}
		}
		if err != nil {
			return nil, err
		}
		result = append(result, gameMembershipID)
	}
	return result, nil
}

func loadWorldEntityControllerWorldMembershipIDs(
	ctx context.Context,
	db queryer,
	worldID, gameID, entityID string,
) ([]string, error) {
	rows, err := db.Query(ctx, `
		select world_membership.id::text
		from game_membership_entity_controls control
		join game_memberships game_membership
			on game_membership.id = control.membership_id and game_membership.game_id = control.game_id
		join world_memberships world_membership
			on world_membership.rule_set_id = $1 and world_membership.user_id = game_membership.user_id
		where control.game_id = $2 and control.entity_id = $3
		order by world_membership.id`, worldID, gameID, entityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var membershipID string
		if err := rows.Scan(&membershipID); err != nil {
			return nil, err
		}
		result = append(result, membershipID)
	}
	return result, rows.Err()
}

func (s *Server) handleGetWorldEntityProfile(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	access, err := loadWorldEntityProfileAccess(r.Context(), s.db, r, worldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if access.Member.Role == "player" && !access.Controlled {
		playStatus, err := loadWorldMemberPlayStatus(
			r.Context(), s.db, access.Member.PrimaryGameID, access.Member.UserID,
			access.Member.Role, access.Member.Status,
		)
		if err != nil {
			handleAppError(w, err)
			return
		}
		if playStatus != playStatusReady {
			handleAppError(w, &statusError{
				Status: http.StatusForbidden, Code: "character_setup_required",
				Message: "only controlled character setup is available before entering live play",
				Fields:  map[string]string{"play_status": playStatus},
			})
			return
		}
	}
	item, err := loadEntityProfileResponse(
		r.Context(), s.db, worldID, access.Member.PrimaryGameID, entityID,
		access.CanReadRestricted, access.CanEdit,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutWorldEntityProfile(w http.ResponseWriter, r *http.Request) {
	worldID, entityID := r.PathValue("world_id"), r.PathValue("entity_id")
	if !validID(entityID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "entity ID is malformed", nil)
		return
	}
	if _, err := requireActiveWorldMember(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request replaceEntityProfileRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := validateEntityProfileRequest(&request)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "entity profile is invalid", fields)
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	access, err := loadWorldEntityProfileAccess(r.Context(), tx, r, worldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if access.Member.WorldStatus != "active" {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"})
		return
	}
	if access.EntityArchived {
		handleAppError(w, &statusError{Status: http.StatusConflict, Code: "entity_archived", Message: "archived entity profiles cannot be changed"})
		return
	}
	if !access.CanEdit {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "entity_profile_forbidden",
			Message: "player control or world editing permission is required",
		})
		return
	}
	var fieldsRevision int64
	if err := tx.QueryRow(r.Context(), `
		select revision from world_character_field_sets
		where rule_set_id = $1 for share`, worldID,
	).Scan(&fieldsRevision); err != nil {
		handleAppError(w, err)
		return
	}
	if fieldsRevision != *request.ExpectedCharacterFieldsRevision {
		handleAppError(w, revisionConflict(
			"character fields", *request.ExpectedCharacterFieldsRevision, fieldsRevision,
		))
		return
	}
	for index, value := range request.Values {
		var exists bool
		if err := tx.QueryRow(r.Context(), `
			select exists(
				select 1 from world_character_fields
				where rule_set_id = $1 and id = $2 and not archived
			)`, worldID, value.FieldID,
		).Scan(&exists); err != nil {
			handleAppError(w, err)
			return
		}
		if !exists {
			handleAppError(w, &statusError{
				Status: http.StatusUnprocessableEntity, Code: "invalid_character_field",
				Message: "character profile values are invalid",
				Fields: map[string]string{
					fmt.Sprintf("values[%d].field_id", index): "active field does not exist in this world",
				},
			})
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		insert into entity_profiles (
			entity_id, rule_set_id, created_by_user_id, updated_by_user_id
		) values ($1, $2, $3, $3)
		on conflict (entity_id) do nothing`, entityID, worldID, access.Member.UserID); err != nil {
		handleAppError(w, err)
		return
	}
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select revision from entity_profiles
		where entity_id = $1 and rule_set_id = $2 for update`, entityID, worldID,
	).Scan(&revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("entity profile", *request.ExpectedRevision, revision))
		return
	}
	current, err := loadEntityProfileResponse(
		r.Context(), tx, worldID, access.Member.PrimaryGameID, entityID, true, true,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if entityProfileMatches(current.Fields, request.Values) {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		current.CanEdit = true
		writeJSON(w, http.StatusOK, current)
		return
	}
	desiredIDs := make([]string, 0, len(request.Values))
	for _, value := range request.Values {
		desiredIDs = append(desiredIDs, value.FieldID)
	}
	if _, err := tx.Exec(r.Context(), `
		delete from entity_profile_field_values value
		using world_character_fields field
		where value.entity_id = $1
			and value.rule_set_id = $2
			and field.id = value.field_id
			and field.rule_set_id = value.rule_set_id
			and not field.archived
			and not (value.field_id = any($3::uuid[]))`, entityID, worldID, desiredIDs); err != nil {
		handleAppError(w, err)
		return
	}
	for _, value := range request.Values {
		if _, err := tx.Exec(r.Context(), `
			insert into entity_profile_field_values (
				entity_id, field_id, rule_set_id, body,
				created_by_user_id, updated_by_user_id
			) values ($1, $2, $3, $4, $5, $5)
			on conflict (entity_id, field_id) do update set
				body = excluded.body,
				updated_by_user_id = excluded.updated_by_user_id`,
			entityID, value.FieldID, worldID, value.Value, access.Member.UserID,
		); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		update entity_profiles
		set revision = revision + 1, updated_by_user_id = $3
		where entity_id = $1 and rule_set_id = $2`, entityID, worldID, access.Member.UserID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := appendGameEvent(
		r.Context(), tx, access.Member.PrimaryGameID,
		"entity-profile-updated", access.GameMembershipID,
	); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadEntityProfileResponse(
		r.Context(), s.db, worldID, access.Member.PrimaryGameID, entityID, true, true,
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func loadWorldEntityProfileAccess(
	ctx context.Context,
	db queryer,
	r *http.Request,
	worldID, entityID string,
) (worldEntityProfileAccess, error) {
	var access worldEntityProfileAccess
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return access, err
	}
	access.Member = member
	if err := db.QueryRow(ctx, `
		select entity.archived
		from game_entities assignment
		join entities entity
			on entity.id = assignment.entity_id and entity.rule_set_id = assignment.rule_set_id
		where assignment.game_id = $1 and assignment.entity_id = $2`,
		member.PrimaryGameID, entityID,
	).Scan(&access.EntityArchived); err != nil {
		return access, err
	}
	var gameRole, gameStatus string
	var controlled bool
	if err := db.QueryRow(ctx, `
		select game_membership.id::text, game_membership.role, game_membership.status,
			exists(
				select 1 from game_membership_entity_controls control
				where control.game_id = game_membership.game_id
					and control.membership_id = game_membership.id
					and control.entity_id = $3
			)
		from game_memberships game_membership
		where game_membership.game_id = $1 and game_membership.user_id = $2`,
		member.PrimaryGameID, member.UserID, entityID,
	).Scan(&access.GameMembershipID, &gameRole, &gameStatus, &controlled); err != nil {
		return access, err
	}
	privileged := member.Role == "owner" || member.Role == "editor"
	activeController := member.Role == "player" && gameRole == "player" && gameStatus == "active" && controlled
	access.Controlled = activeController
	access.CanReadRestricted = privileged || activeController
	access.CanEdit = access.CanReadRestricted && member.WorldStatus == "active" && !access.EntityArchived
	return access, nil
}

func loadEntityProfileResponse(
	ctx context.Context,
	db queryer,
	worldID, gameID, entityID string,
	includeRestricted, canEdit bool,
) (entityProfileResponse, error) {
	result := entityProfileResponse{
		EntityID: entityID, CanEdit: canEdit,
		Fields:         make([]entityProfileFieldResponse, 0),
		LegacySections: make([]entityProfileSectionResponse, 0),
	}
	if err := db.QueryRow(ctx, `
		select revision from world_character_field_sets where rule_set_id = $1`, worldID,
	).Scan(&result.CharacterFieldsRevision); err != nil {
		return result, err
	}
	readiness, err := loadEntityCharacterReadiness(ctx, db, gameID, entityID)
	if err != nil {
		return result, err
	}
	result.CharacterStatus = readiness.Status
	result.RequiredFieldCount = readiness.RequiredFieldCount
	result.CompletedFieldCount = readiness.CompletedFieldCount
	var updatedByUserID string
	var createdAt, updatedAt time.Time
	err = db.QueryRow(ctx, `
		select revision, updated_by_user_id::text, created_at, updated_at
		from entity_profiles where rule_set_id = $1 and entity_id = $2`, worldID, entityID,
	).Scan(&result.Revision, &updatedByUserID, &createdAt, &updatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if err == nil {
		result.UpdatedByUserID = &updatedByUserID
		result.CreatedAt, result.UpdatedAt = &createdAt, &updatedAt
	}
	rows, err := db.Query(ctx, `
		select field.id::text, field.label, field.help_text, field.visibility,
			value.body, value.updated_by_user_id::text, value.updated_at
		from world_character_fields field
		left join entity_profile_field_values value
			on value.field_id = field.id
			and value.rule_set_id = field.rule_set_id
			and value.entity_id = $2
		where field.rule_set_id = $1 and not field.archived
			and ($3 or (field.visibility = 'table' and value.body is not null))
		order by field.position, field.id`, worldID, entityID, includeRestricted)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var field entityProfileFieldResponse
		if err := rows.Scan(
			&field.ID, &field.Label, &field.HelpText, &field.Visibility,
			&field.Value, &field.UpdatedByUserID, &field.UpdatedAt,
		); err != nil {
			rows.Close()
			return result, err
		}
		result.Fields = append(result.Fields, field)
		if includeRestricted && field.Value == nil {
			result.MissingFieldIDs = append(result.MissingFieldIDs, field.ID)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return result, err
	}
	rows.Close()

	rows, err = db.Query(ctx, `
		select id::text, title, body, visibility,
			created_by_user_id::text, updated_by_user_id::text, created_at, updated_at
		from entity_profile_sections
		where rule_set_id = $1 and entity_id = $2
			and ($3 or visibility = 'table')
		order by position, id`, worldID, entityID, includeRestricted)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var section entityProfileSectionResponse
		if err := rows.Scan(
			&section.ID, &section.Title, &section.Body, &section.Visibility,
			&section.CreatedByUserID, &section.UpdatedByUserID,
			&section.CreatedAt, &section.UpdatedAt,
		); err != nil {
			return result, err
		}
		result.LegacySections = append(result.LegacySections, section)
	}
	return result, rows.Err()
}

func validateEntityProfileRequest(request *replaceEntityProfileRequest) map[string]string {
	fields := map[string]string{}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "a non-negative expected revision is required"
	}
	if request.ExpectedCharacterFieldsRevision == nil || *request.ExpectedCharacterFieldsRevision < 0 {
		fields["expected_character_fields_revision"] = "a non-negative expected character fields revision is required"
	}
	if len(request.Values) > maxWorldCharacterFields {
		fields["values"] = fmt.Sprintf("must contain at most %d values", maxWorldCharacterFields)
	}
	seenIDs := make(map[string]struct{}, len(request.Values))
	normalized := make([]saveEntityProfileFieldValueRequest, 0, len(request.Values))
	for index := range request.Values {
		value := &request.Values[index]
		value.Value = strings.TrimSpace(value.Value)
		path := fmt.Sprintf("values[%d]", index)
		if !validID(value.FieldID) {
			fields[path+".field_id"] = "must be a UUID"
		} else if _, duplicate := seenIDs[value.FieldID]; duplicate {
			fields[path+".field_id"] = "must be unique within the profile"
		}
		seenIDs[value.FieldID] = struct{}{}
		if len(value.Value) > 20000 {
			fields[path+".value"] = "must be 20000 characters or fewer"
		}
		if value.Value != "" {
			normalized = append(normalized, *value)
		}
	}
	request.Values = normalized
	return fields
}

func entityProfileMatches(
	current []entityProfileFieldResponse,
	desired []saveEntityProfileFieldValueRequest,
) bool {
	currentValues := make(map[string]string)
	for _, field := range current {
		if field.Value != nil {
			currentValues[field.ID] = *field.Value
		}
	}
	if len(currentValues) != len(desired) {
		return false
	}
	for _, value := range desired {
		if currentValues[value.FieldID] != value.Value {
			return false
		}
	}
	return true
}
