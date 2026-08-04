package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"dnd/internal/rules"
)

type loadedMechanic struct {
	Response   worldMechanicResponse
	Definition rules.MechanicDefinition
	Position   int
}

func (s *Server) handleListWorldMechanics(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	if kind != "" && kind != "capacity" && kind != "capability" {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "mechanic kind is invalid", map[string]string{"kind": "must be capacity or capability"})
		return
	}
	items, err := loadWorldMechanics(r.Context(), s.db, member.WorldID, kind)
	if err != nil {
		handleAppError(w, err)
		return
	}
	responses := make([]worldMechanicResponse, len(items))
	for index := range items {
		responses[index] = items[index].Response
	}
	writeJSON(w, http.StatusOK, responses)
}

func (s *Server) handleCreateWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	var request saveWorldMechanicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	item, err := s.saveWorldMechanic(r.Context(), member.WorldID, "", request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/worlds/%s/mechanics/%s", member.WorldID, item.ID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireActiveWorldMember(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	mechanicID := r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	item, err := loadWorldMechanic(r.Context(), s.db, member.WorldID, mechanicID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item.Response)
}

func (s *Server) handlePutWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	mechanicID := r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	var request saveWorldMechanicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	if request.ID != "" && request.ID != mechanicID {
		writeError(w, http.StatusBadRequest, "id_mismatch", "path and body IDs do not match", nil)
		return
	}
	item, err := s.saveWorldMechanic(r.Context(), member.WorldID, mechanicID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveWorldMechanic(w http.ResponseWriter, r *http.Request) {
	member, err := requireWorldEditor(r.Context(), s.db, r, r.PathValue("world_id"))
	if err != nil {
		handleAppError(w, err)
		return
	}
	mechanicID := r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	if _, err := s.db.Exec(r.Context(), `
		update world_mechanics set archived = true where world_id = $1 and id = $2`, member.WorldID, mechanicID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldMechanic(r.Context(), s.db, member.WorldID, mechanicID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item.Response)
}

func (s *Server) saveWorldMechanic(ctx context.Context, worldID, mechanicID string, request saveWorldMechanicRequest) (worldMechanicResponse, error) {
	var zero worldMechanicResponse
	creating := mechanicID == ""
	if creating {
		mechanicID = request.ID
		if mechanicID == "" {
			var err error
			mechanicID, err = newID()
			if err != nil {
				return zero, err
			}
		}
	}
	fields, definition := validateWorldMechanicRequest(worldID, mechanicID, request)
	if len(fields) > 0 {
		return zero, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "mechanic is invalid", Fields: fields}
	}
	request.Description = cleanOptional(request.Description)
	request.Unit = cleanOptional(request.Unit)
	valueKind := string(definition.ValueKind)
	defaultNumber := any(nil)
	if definition.ValueKind == rules.ValueNumber {
		defaultNumber = definition.DefaultValue.Number.String()
	}
	minimum, maximum, step := decimalDatabase(definition.Minimum), decimalDatabase(definition.Maximum), decimalDatabase(definition.Step)
	if creating {
		var position int
		if err := s.db.QueryRow(ctx, `select coalesce(max(position), -1) + 1 from world_mechanics where world_id = $1 and kind = $2`, worldID, request.Kind).Scan(&position); err != nil {
			return zero, err
		}
		_, err := s.db.Exec(ctx, `
				insert into world_mechanics
					(id, world_id, kind, mode, value_kind, name, description, minimum, maximum, step,
					 default_number, unit, mutable_during_play, position, archived)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false)`,
			mechanicID, worldID, request.Kind, request.Mode, valueKind, strings.TrimSpace(request.Name),
			request.Description, minimum, maximum, step, defaultNumber, request.Unit,
			request.MutableDuringPlay, position)
		if err != nil {
			return zero, err
		}
		item, err := loadWorldMechanic(ctx, s.db, worldID, mechanicID)
		return item.Response, err
	}

	current, err := loadWorldMechanic(ctx, s.db, worldID, mechanicID)
	if err != nil {
		return zero, err
	}
	if request.Kind != current.Response.Kind {
		return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_kind_fixed", Message: "a mechanic cannot move between capacities and capabilities"}
	}
	if valueKind != string(current.Definition.ValueKind) {
		var used bool
		if err := s.db.QueryRow(ctx, `
			select exists(select 1 from state_values where world_id = $1 and mechanic_id = $2)
				or exists(select 1 from interaction_resolution_effects where world_id = $1 and mechanic_id = $2)`, worldID, mechanicID).Scan(&used); err != nil {
			return zero, err
		}
		if used {
			return zero, &statusError{Status: http.StatusConflict, Code: "mechanic_in_use", Message: "a used mechanic cannot change between numeric and Boolean values"}
		}
	}
	_, err = s.db.Exec(ctx, `
		update world_mechanics set mode = $3, value_kind = $4, name = $5, description = $6,
			minimum = $7, maximum = $8, step = $9, default_number = $10, unit = $11,
			mutable_during_play = $12, archived = $13
		where world_id = $1 and id = $2`,
		worldID, mechanicID, request.Mode, valueKind, strings.TrimSpace(request.Name), request.Description,
		minimum, maximum, step, defaultNumber, request.Unit, request.MutableDuringPlay, request.Archived)
	if err != nil {
		return zero, err
	}
	item, err := loadWorldMechanic(ctx, s.db, worldID, mechanicID)
	return item.Response, err
}

func validateWorldMechanicRequest(worldID, mechanicID string, request saveWorldMechanicRequest) (map[string]string, rules.MechanicDefinition) {
	fields := map[string]string{}
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	validateRequired(fields, "name", request.Name, 200)
	validMode := (request.Kind == "capacity" && (request.Mode == "score" || request.Mode == "pool")) ||
		(request.Kind == "capability" && (request.Mode == "binary" || request.Mode == "rating"))
	if !validMode {
		fields["mode"] = "must be a mode belonging to the selected mechanic kind"
	}
	definition := rules.MechanicDefinition{ID: rules.ID(mechanicID), WorldID: rules.ID(worldID), Mutable: request.MutableDuringPlay, Archived: request.Archived}
	if request.Mode == "binary" {
		definition.ValueKind = rules.ValueBoolean
		definition.DefaultValue = rules.NewBooleanValue(false)
		if request.Minimum != nil || request.Maximum != nil || request.Step != nil || request.DefaultNumber != nil || request.Unit != nil {
			fields["mode"] = "binary mechanics cannot declare numeric settings"
		}
	} else {
		definition.ValueKind = rules.ValueNumber
		if request.DefaultNumber == nil {
			fields["default_number"] = "is required"
		} else if value, err := rules.ParseDecimal(request.DefaultNumber.String()); err != nil {
			fields["default_number"] = "must be a finite exact decimal"
		} else {
			definition.DefaultValue = rules.NewNumberValue(value)
		}
		for path, source := range map[string]*json.Number{"minimum": request.Minimum, "maximum": request.Maximum, "step": request.Step} {
			if source == nil {
				continue
			}
			parsed, err := rules.ParseDecimal(source.String())
			if err != nil {
				fields[path] = "must be a finite exact decimal"
				continue
			}
			switch path {
			case "minimum":
				definition.Minimum = &parsed
			case "maximum":
				definition.Maximum = &parsed
			case "step":
				definition.Step = &parsed
			}
		}
	}
	if len(fields) == 0 {
		for _, item := range rules.ValidateMechanicDefinition(definition) {
			fields[item.Path] = item.Message
		}
	}
	return fields, definition
}

func loadWorldMechanics(ctx context.Context, db queryer, worldID, kind string) ([]loadedMechanic, error) {
	query := `select id::text, kind, mode, value_kind, name, description,
		minimum::text, maximum::text, step::text, default_number::text, unit,
		mutable_during_play, position, archived, created_at, updated_at
		from world_mechanics where world_id = $1`
	args := []any{worldID}
	if kind != "" {
		query += ` and kind = $2`
		args = append(args, kind)
	}
	query += ` order by case kind when 'capacity' then 0 else 1 end, position, id`
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]loadedMechanic, 0)
	for rows.Next() {
		item, err := scanWorldMechanic(rows, worldID)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func loadWorldMechanic(ctx context.Context, db queryer, worldID, mechanicID string) (loadedMechanic, error) {
	row := db.QueryRow(ctx, `select id::text, kind, mode, value_kind, name, description,
		minimum::text, maximum::text, step::text, default_number::text, unit,
		mutable_during_play, position, archived, created_at, updated_at
		from world_mechanics where world_id = $1 and id = $2`, worldID, mechanicID)
	return scanWorldMechanic(row, worldID)
}

type rowScanner interface {
	Scan(...any) error
}

func scanWorldMechanic(row rowScanner, worldID string) (loadedMechanic, error) {
	var item loadedMechanic
	var valueKind string
	var minimum, maximum, step, defaultNumber *string
	err := row.Scan(
		&item.Response.ID, &item.Response.Kind, &item.Response.Mode, &valueKind,
		&item.Response.Name, &item.Response.Description, &minimum, &maximum, &step, &defaultNumber,
		&item.Response.Unit, &item.Response.MutableDuringPlay, &item.Position, &item.Response.Archived,
		&item.Response.CreatedAt, &item.Response.UpdatedAt,
	)
	if err != nil {
		return item, err
	}
	item.Response.Minimum = numberPointer(minimum)
	item.Response.Maximum = numberPointer(maximum)
	item.Response.Step = numberPointer(step)
	item.Response.DefaultNumber = numberPointer(defaultNumber)
	definition := rules.MechanicDefinition{
		ID: rules.ID(item.Response.ID), WorldID: rules.ID(worldID), ValueKind: rules.ValueKind(valueKind),
		Mutable: item.Response.MutableDuringPlay, Archived: item.Response.Archived,
		CreatedAt: item.Response.CreatedAt, UpdatedAt: item.Response.UpdatedAt,
	}
	var parseErr error
	definition.Minimum, parseErr = parseDecimalPointer(minimum)
	if parseErr == nil {
		definition.Maximum, parseErr = parseDecimalPointer(maximum)
	}
	if parseErr == nil {
		definition.Step, parseErr = parseDecimalPointer(step)
	}
	if parseErr != nil {
		return item, parseErr
	}
	if definition.ValueKind == rules.ValueBoolean {
		definition.DefaultValue = rules.NewBooleanValue(false)
	} else if defaultNumber != nil {
		value, err := rules.ParseDecimal(*defaultNumber)
		if err != nil {
			return item, err
		}
		definition.DefaultValue = rules.NewNumberValue(value)
	}
	item.Definition = definition
	return item, nil
}

func numberPointer(value *string) *json.Number {
	if value == nil {
		return nil
	}
	number := json.Number(*value)
	return &number
}

func parseDecimalPointer(value *string) (*rules.Decimal, error) {
	if value == nil {
		return nil, nil
	}
	parsed, err := rules.ParseDecimal(*value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func decimalDatabase(value *rules.Decimal) any {
	if value == nil {
		return nil
	}
	return value.String()
}

func mechanicDefinitions(items []loadedMechanic) map[rules.ID]rules.MechanicDefinition {
	result := make(map[rules.ID]rules.MechanicDefinition, len(items))
	for _, item := range items {
		result[item.Definition.ID] = item.Definition
	}
	return result
}
