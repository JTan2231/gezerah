package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const maxWorldCharacterFields = 50

func (s *Server) handleGetWorldCharacterFields(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	member, err := requireActiveWorldMember(r.Context(), s.db, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}

	item, err := loadWorldCharacterFieldSetResponse(
		r.Context(), s.db, worldID, member.Role != "spectator",
	)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handlePutWorldCharacterFields(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}

	var request replaceWorldCharacterFieldsRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := validateWorldCharacterFieldsRequest(&request)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "character fields are invalid", fields)
		return
	}
	for index := range request.Fields {
		if request.Fields[index].ID != "" {
			continue
		}
		fieldID, err := newID()
		if err != nil {
			handleAppError(w, err)
			return
		}
		request.Fields[index].ID = fieldID
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		handleAppError(w, err)
		return
	}
	defer rollbackTx(r.Context(), tx)

	member, err := requireWorldEditor(r.Context(), tx, r, worldID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	var revision int64
	if err := tx.QueryRow(r.Context(), `
		select revision
		from world_character_field_sets
		where world_id = $1
		for update`, worldID,
	).Scan(&revision); err != nil {
		handleAppError(w, err)
		return
	}
	if revision != *request.ExpectedRevision {
		handleAppError(w, revisionConflict("character fields", *request.ExpectedRevision, revision))
		return
	}

	current, err := loadWorldCharacterFieldSetResponse(r.Context(), tx, worldID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	if worldCharacterFieldsMatch(current.Fields, request.Fields) {
		if err := tx.Commit(r.Context()); err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, current)
		return
	}

	currentIDs := make([]string, len(current.Fields))
	desiredIDs := make([]string, len(request.Fields))
	for index := range current.Fields {
		currentIDs[index] = current.Fields[index].ID
	}
	for index := range request.Fields {
		desiredIDs[index] = request.Fields[index].ID
	}
	sort.Strings(currentIDs)
	sort.Strings(desiredIDs)
	if !characterFieldStringSlicesEqual(currentIDs, desiredIDs) {
		var unfinished bool
		if err := tx.QueryRow(r.Context(), `
			select exists(
				select 1
				from interactions
				where world_id = $1 and status in ('draft', 'open', 'adjudicating')
			)`, worldID,
		).Scan(&unfinished); err != nil {
			handleAppError(w, err)
			return
		}
		if unfinished {
			handleAppError(w, &statusError{
				Status:  http.StatusConflict,
				Code:    "character_fields_in_use",
				Message: "finish or cancel active interactions before changing character requirements",
			})
			return
		}
	}

	for index, field := range request.Fields {
		var existingWorldID string
		err := tx.QueryRow(r.Context(), `
			select world_id::text
			from world_character_fields
			where id = $1`, field.ID,
		).Scan(&existingWorldID)
		if err == nil && existingWorldID != worldID {
			handleAppError(w, &statusError{
				Status:  http.StatusUnprocessableEntity,
				Code:    "invalid_character_field",
				Message: "character fields are invalid",
				Fields: map[string]string{
					fmt.Sprintf("fields[%d].id", index): "field belongs to another world",
				},
			})
			return
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			handleAppError(w, err)
			return
		}
	}

	if _, err := tx.Exec(r.Context(), `
		update world_character_fields
		set archived = true, updated_by_user_id = $2
		where world_id = $1 and not archived`, worldID, member.UserID); err != nil {
		handleAppError(w, err)
		return
	}
	for position, field := range request.Fields {
		if _, err := tx.Exec(r.Context(), `
			insert into world_character_fields (
				id, world_id, label, help_text, visibility, position, archived,
				created_by_user_id, updated_by_user_id
			) values ($1, $2, $3, $4, $5, $6, false, $7, $7)
			on conflict (id) do update set
				label = excluded.label,
				help_text = excluded.help_text,
				visibility = excluded.visibility,
				position = excluded.position,
				archived = false,
				updated_by_user_id = excluded.updated_by_user_id`,
			field.ID, worldID, field.Label, field.HelpText, field.Visibility,
			position, member.UserID,
		); err != nil {
			handleAppError(w, err)
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		update world_character_field_sets
		set revision = revision + 1
		where world_id = $1`, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		insert into world_events (world_id, event_type, actor_membership_id)
		values ($1, 'character-fields-updated', $2)`, worldID, member.ID); err != nil {
		handleAppError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		handleAppError(w, err)
		return
	}

	item, err := loadWorldCharacterFieldSetResponse(r.Context(), s.db, worldID, true)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func loadWorldCharacterFieldSetResponse(
	ctx context.Context,
	db queryer,
	worldID string,
	includeRestricted bool,
) (worldCharacterFieldSetResponse, error) {
	result := worldCharacterFieldSetResponse{
		Fields: make([]worldCharacterFieldResponse, 0),
	}
	if err := db.QueryRow(ctx, `
		select revision, created_at, updated_at
		from world_character_field_sets
		where world_id = $1`, worldID,
	).Scan(&result.Revision, &result.CreatedAt, &result.UpdatedAt); err != nil {
		return result, err
	}

	rows, err := db.Query(ctx, `
		select id::text, label, help_text, visibility,
			created_by_user_id::text, updated_by_user_id::text, created_at, updated_at
		from world_character_fields
		where world_id = $1 and not archived
			and ($2 or visibility = 'table')
		order by position, id`, worldID, includeRestricted)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var field worldCharacterFieldResponse
		if err := rows.Scan(
			&field.ID, &field.Label, &field.HelpText, &field.Visibility,
			&field.CreatedByUserID, &field.UpdatedByUserID,
			&field.CreatedAt, &field.UpdatedAt,
		); err != nil {
			return result, err
		}
		result.Fields = append(result.Fields, field)
	}
	return result, rows.Err()
}

func validateWorldCharacterFieldsRequest(request *replaceWorldCharacterFieldsRequest) map[string]string {
	fields := map[string]string{}
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "a non-negative expected revision is required"
	}
	if len(request.Fields) > maxWorldCharacterFields {
		fields["fields"] = fmt.Sprintf("must contain at most %d fields", maxWorldCharacterFields)
	}

	seenIDs := make(map[string]struct{}, len(request.Fields))
	seenLabels := make(map[string]struct{}, len(request.Fields))
	for index := range request.Fields {
		field := &request.Fields[index]
		field.Label = strings.TrimSpace(field.Label)
		field.HelpText = cleanOptional(field.HelpText)
		if field.Visibility == "" {
			field.Visibility = "table"
		}

		path := fmt.Sprintf("fields[%d]", index)
		if field.ID != "" {
			if !validID(field.ID) {
				fields[path+".id"] = "must be a UUID"
			} else if _, duplicate := seenIDs[field.ID]; duplicate {
				fields[path+".id"] = "must be unique within the field set"
			}
			seenIDs[field.ID] = struct{}{}
		}
		validateRequired(fields, path+".label", field.Label, 200)
		normalizedLabel := strings.ToLower(field.Label)
		if _, duplicate := seenLabels[normalizedLabel]; duplicate && normalizedLabel != "" {
			fields[path+".label"] = "must be unique within the field set"
		}
		seenLabels[normalizedLabel] = struct{}{}
		if field.HelpText != nil && len([]rune(*field.HelpText)) > 2000 {
			fields[path+".help_text"] = "must be 2000 characters or fewer"
		}
		if field.Visibility != "table" && field.Visibility != "controllers-and-facilitators" {
			fields[path+".visibility"] = "must be table or controllers-and-facilitators"
		}
	}
	return fields
}

func worldCharacterFieldsMatch(
	current []worldCharacterFieldResponse,
	desired []saveWorldCharacterFieldRequest,
) bool {
	if len(current) != len(desired) {
		return false
	}
	for index := range current {
		if current[index].ID != desired[index].ID ||
			current[index].Label != desired[index].Label ||
			!characterFieldOptionalStringsEqual(current[index].HelpText, desired[index].HelpText) ||
			current[index].Visibility != desired[index].Visibility {
			return false
		}
	}
	return true
}

func characterFieldStringSlicesEqual(left, right []string) bool {
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

func characterFieldOptionalStringsEqual(left, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}
