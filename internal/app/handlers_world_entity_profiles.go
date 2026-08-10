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
	EntityArchived    bool
	Controlled        bool
	CanReadRestricted bool
	CanEdit           bool
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
	item, err := loadEntityProfileResponse(
		r.Context(), s.db, worldID, entityID, access.CanReadRestricted, access.CanEdit,
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
	defer rollbackTx(r.Context(), tx)

	access, err := loadWorldEntityProfileAccess(r.Context(), tx, r, worldID, entityID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if access.Member.WorldStatus != "active" {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "world_archived",
			Message: "archived worlds cannot be changed",
		})
		return
	}
	if access.EntityArchived {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "entity_archived",
			Message: "archived entity profiles cannot be changed",
		})
		return
	}
	if !access.CanReadRestricted {
		handleAppError(w, &statusError{
			Status: http.StatusForbidden, Code: "entity_profile_forbidden",
			Message: "entity control or world editing permission is required",
		})
		return
	}

	// Serialize profile creation and replacement through the entity. A profile
	// root is optional until the first non-empty write, so it cannot provide the
	// lock for concurrent first writes itself.
	if err := tx.QueryRow(r.Context(), `
		select archived
		from entities
		where world_id = $1 and id = $2
		for update`, worldID, entityID,
	).Scan(&access.EntityArchived); err != nil {
		handleAppError(w, err)
		return
	}
	if access.EntityArchived {
		handleAppError(w, &statusError{
			Status: http.StatusConflict, Code: "entity_archived",
			Message: "archived entity profiles cannot be changed",
		})
		return
	}

	var characterFieldsRevision int64
	if err := tx.QueryRow(r.Context(), `
		select revision
		from world_character_field_sets
		where world_id = $1
		for share`, worldID,
	).Scan(&characterFieldsRevision); err != nil {
		handleAppError(w, err)
		return
	}
	if characterFieldsRevision != *request.ExpectedCharacterFieldsRevision {
		handleAppError(w, revisionConflict(
			"character fields", *request.ExpectedCharacterFieldsRevision, characterFieldsRevision,
		))
		return
	}

	for index, value := range request.Values {
		var exists bool
		if err := tx.QueryRow(r.Context(), `
			select exists(
				select 1
				from world_character_fields
				where world_id = $1 and id = $2 and not archived
			)`, worldID, value.FieldID,
		).Scan(&exists); err != nil {
			handleAppError(w, err)
			return
		}
		if !exists {
			handleAppError(w, &statusError{
				Status:  http.StatusUnprocessableEntity,
				Code:    "invalid_character_field",
				Message: "character profile values are invalid",
				Fields: map[string]string{
					fmt.Sprintf("values[%d].field_id", index): "active field does not exist in this world",
				},
			})
			return
		}
	}

	profileExists := true
	var revision int64
	err = tx.QueryRow(r.Context(), `
		select revision
		from entity_profiles
		where entity_id = $1 and world_id = $2
		for update`, entityID, worldID,
	).Scan(&revision)
	if errors.Is(err, pgx.ErrNoRows) {
		profileExists = false
		revision = 0
	} else if err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("entity profile", *request.ExpectedRevision, revision))
		return
	}

	current, err := loadEntityProfileResponse(r.Context(), tx, worldID, entityID, true, true)
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

	if !profileExists {
		if _, err := tx.Exec(r.Context(), `
			insert into entity_profiles (
				entity_id, world_id, created_by_user_id, updated_by_user_id
			) values ($1, $2, $3, $3)`, entityID, worldID, access.Member.UserID); err != nil {
			handleAppError(w, err)
			return
		}
	}
	// Values for archived fields are intentionally retained. They become
	// visible again if an editor restores the same user-authored field.
	if _, err := tx.Exec(r.Context(), `
		delete from entity_profile_field_values value
		using world_character_fields field
		where value.entity_id = $1
			and value.world_id = $2
			and field.id = value.field_id
			and field.world_id = value.world_id
			and not field.archived`, entityID, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	for _, value := range request.Values {
		if _, err := tx.Exec(r.Context(), `
			insert into entity_profile_field_values (
				entity_id, field_id, world_id, body,
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
		where entity_id = $1 and world_id = $2`, entityID, worldID, access.Member.UserID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_events (world_id, event_type, actor_membership_id)
		values ($1, 'entity-profile-updated', $2)`, worldID, access.Member.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := loadEntityProfileResponse(r.Context(), s.db, worldID, entityID, true, true)
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
		select entity.archived,
			exists(
				select 1
				from world_membership_entity_controls control
				where control.world_id = entity.world_id
					and control.membership_id = $3
					and control.entity_id = entity.id
			)
		from entities entity
		where entity.world_id = $1 and entity.id = $2`, worldID, entityID, member.ID,
	).Scan(&access.EntityArchived, &access.Controlled); err != nil {
		return access, err
	}

	editor := member.Role == "owner" || member.Role == "editor"
	controller := member.Role == "player" && access.Controlled
	access.CanReadRestricted = editor || controller
	access.CanEdit = access.CanReadRestricted && member.WorldStatus == "active" && !access.EntityArchived
	return access, nil
}

func loadEntityProfileResponse(
	ctx context.Context,
	db queryer,
	worldID, entityID string,
	includeRestricted, canEdit bool,
) (entityProfileResponse, error) {
	result := entityProfileResponse{
		EntityID: entityID,
		CanEdit:  canEdit,
		Fields:   make([]entityProfileFieldResponse, 0),
	}
	if err := db.QueryRow(ctx, `
		select revision
		from world_character_field_sets
		where world_id = $1`, worldID,
	).Scan(&result.CharacterFieldsRevision); err != nil {
		return result, err
	}

	characterStatus, required, completed, err := entityCharacterStatus(ctx, db, worldID, entityID)
	if err != nil {
		return result, err
	}
	result.CharacterStatus = characterStatus
	result.RequiredFieldCount = required
	result.CompletedFieldCount = completed

	var updatedByUserID string
	var createdAt, updatedAt time.Time
	err = db.QueryRow(ctx, `
		select revision, updated_by_user_id::text, created_at, updated_at
		from entity_profiles
		where world_id = $1 and entity_id = $2`, worldID, entityID,
	).Scan(&result.Revision, &updatedByUserID, &createdAt, &updatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	if err == nil {
		result.UpdatedByUserID = &updatedByUserID
		result.CreatedAt = &createdAt
		result.UpdatedAt = &updatedAt
	}

	rows, err := db.Query(ctx, `
		select field.id::text, field.label, field.help_text, field.visibility,
			value.body, value.updated_by_user_id::text, value.updated_at
		from world_character_fields field
		left join entity_profile_field_values value
			on value.field_id = field.id
			and value.world_id = field.world_id
			and value.entity_id = $2
		where field.world_id = $1 and not field.archived
			and ($3 or (field.visibility = 'table' and value.body is not null))
		order by field.position, field.id`, worldID, entityID, includeRestricted)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var field entityProfileFieldResponse
		if err := rows.Scan(
			&field.ID, &field.Label, &field.HelpText, &field.Visibility,
			&field.Value, &field.UpdatedByUserID, &field.UpdatedAt,
		); err != nil {
			return result, err
		}
		result.Fields = append(result.Fields, field)
		if includeRestricted && field.Value == nil {
			result.MissingFieldIDs = append(result.MissingFieldIDs, field.ID)
		}
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
		if len([]rune(value.Value)) > 20000 {
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
