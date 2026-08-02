package app

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"dnd/internal/rules"
)

type loadedWorldMechanic struct {
	Definition        rules.StateVariableDefinition
	Kind              string
	Mode              string
	MutableDuringPlay bool
}

func (s *Server) registerWorldMechanicRoutes() {
	s.api.HandleFunc("GET /api/worlds/{world_id}/mechanics", s.handleListWorldMechanics)
	s.api.HandleFunc("POST /api/worlds/{world_id}/mechanics", s.handleCreateWorldMechanic)
	s.api.HandleFunc("GET /api/worlds/{world_id}/mechanics/{mechanic_id}", s.handleGetWorldMechanic)
	s.api.HandleFunc("PUT /api/worlds/{world_id}/mechanics/{mechanic_id}", s.handlePutWorldMechanic)
	s.api.HandleFunc("POST /api/worlds/{world_id}/mechanics/{mechanic_id}/archive", s.handleArchiveWorldMechanic)
}

func (s *Server) handleListWorldMechanics(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if _, err := requireActiveWorldMember(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	if kind != "" && kind != "capacity" && kind != "capability" {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "mechanic kind is invalid", map[string]string{"kind": "must be capacity or capability"})
		return
	}
	items, err := loadWorldMechanics(r.Context(), s.db, worldID, kind)
	if err != nil {
		handleAppError(w, err)
		return
	}
	responses := make([]worldMechanicResponse, 0, len(items))
	for _, item := range items {
		responses = append(responses, worldMechanicToResponse(item))
	}
	writeJSON(w, http.StatusOK, responses)
}

func (s *Server) handleCreateWorldMechanic(w http.ResponseWriter, r *http.Request) {
	worldID := r.PathValue("world_id")
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request saveWorldMechanicRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	request.Archived = false
	item, err := s.saveWorldMechanic(r.Context(), worldID, "", request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	w.Header().Set("Location", fmt.Sprintf("/api/worlds/%s/mechanics/%s", worldID, item.ID))
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWorldMechanic(w http.ResponseWriter, r *http.Request) {
	worldID, mechanicID := r.PathValue("world_id"), r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	if _, err := requireActiveWorldMember(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	item, err := loadWorldMechanic(r.Context(), s.db, worldID, mechanicID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, worldMechanicToResponse(item))
}

func (s *Server) handlePutWorldMechanic(w http.ResponseWriter, r *http.Request) {
	worldID, mechanicID := r.PathValue("world_id"), r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
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
	item, err := s.saveWorldMechanic(r.Context(), worldID, mechanicID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleArchiveWorldMechanic(w http.ResponseWriter, r *http.Request) {
	worldID, mechanicID := r.PathValue("world_id"), r.PathValue("mechanic_id")
	if !validID(mechanicID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "mechanic ID is malformed", nil)
		return
	}
	if _, err := requireWorldEditor(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	current, err := loadWorldMechanic(r.Context(), s.db, worldID, mechanicID)
	if err != nil {
		handleAppError(w, err)
		return
	}
	request := worldMechanicToSaveRequest(current)
	request.Archived = true
	item, err := s.saveWorldMechanic(r.Context(), worldID, mechanicID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) saveWorldMechanic(ctx context.Context, worldID, mechanicID string, request saveWorldMechanicRequest) (worldMechanicResponse, error) {
	var empty worldMechanicResponse
	fields := validateWorldMechanicRequest(request)
	if mechanicID == "" && request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	if len(fields) > 0 {
		return empty, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "mechanic is invalid", Fields: fields}
	}

	creating := mechanicID == ""
	var current loadedWorldMechanic
	var err error
	if creating {
		mechanicID = request.ID
		if mechanicID == "" {
			mechanicID, err = newID()
			if err != nil {
				return empty, err
			}
		}
	} else {
		current, err = loadWorldMechanic(ctx, s.db, worldID, mechanicID)
		if err != nil {
			return empty, err
		}
		if current.Kind != request.Kind {
			return empty, &statusError{Status: http.StatusConflict, Code: "mechanic_kind_immutable", Message: "a capacity cannot be changed into a capability, or vice versa"}
		}
	}

	definition, err := worldMechanicRequestToDefinition(request, worldID, mechanicID)
	if err != nil {
		return empty, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "mechanic is invalid", Fields: map[string]string{"default_number": err.Error()}}
	}
	if creating {
		definition.Key = generatedMechanicKey(request.Kind, request.Name, mechanicID)
		var displayOrder int
		if err := s.db.QueryRow(ctx, `
			select coalesce(max(definition.display_order), -1) + 1
			from world_mechanics mechanic
			join state_variable_definitions definition on definition.id = mechanic.state_variable_id
			where mechanic.rule_set_id = $1 and mechanic.kind = $2`, worldID, request.Kind).Scan(&displayOrder); err != nil {
			return empty, err
		}
		definition.DisplayOrder = displayOrder
	} else {
		definition.Key = current.Definition.Key
		definition.DisplayOrder = current.Definition.DisplayOrder
		definition.CreatedAt = current.Definition.CreatedAt
		definition.UpdatedAt = current.Definition.UpdatedAt
	}
	definitionID := mechanicID
	if creating {
		definitionID = ""
	}
	definition, err = saveDefinitionDomain(ctx, s, worldID, definitionID, definition)
	if err != nil {
		return empty, err
	}
	if creating {
		_, err = s.db.Exec(ctx, `
			insert into world_mechanics (state_variable_id, rule_set_id, kind, mode, mutable_during_play)
			values ($1, $2, $3, $4, $5)`, mechanicID, worldID, request.Kind, request.Mode, request.MutableDuringPlay)
	} else {
		_, err = s.db.Exec(ctx, `
			update world_mechanics set mode = $3, mutable_during_play = $4
			where rule_set_id = $1 and state_variable_id = $2`, worldID, mechanicID, request.Mode, request.MutableDuringPlay)
	}
	if err != nil {
		return empty, err
	}
	loaded := loadedWorldMechanic{
		Definition: definition, Kind: request.Kind, Mode: request.Mode,
		MutableDuringPlay: request.MutableDuringPlay,
	}
	return worldMechanicToResponse(loaded), nil
}

func validateWorldMechanicRequest(request saveWorldMechanicRequest) map[string]string {
	fields := map[string]string{}
	validateRequired(fields, "name", request.Name, 200)
	if request.Kind != "capacity" && request.Kind != "capability" {
		fields["kind"] = "must be capacity or capability"
	}
	if request.Kind == "capacity" && request.Mode != "score" && request.Mode != "pool" {
		fields["mode"] = "capacities must use score or pool mode"
	}
	if request.Kind == "capability" && request.Mode != "binary" && request.Mode != "rating" {
		fields["mode"] = "capabilities must use binary or rating mode"
	}
	if request.Kind == "capability" && request.Mode == "binary" {
		if request.Minimum != nil || request.Maximum != nil || request.Step != nil || request.DefaultNumber != nil || request.Unit != nil {
			fields["mode"] = "binary capabilities cannot declare numeric settings"
		}
	}
	return fields
}

func worldMechanicRequestToDefinition(request saveWorldMechanicRequest, worldID, mechanicID string) (rules.StateVariableDefinition, error) {
	definition := rules.StateVariableDefinition{
		ID:                    rules.ID(mechanicID),
		RuleSetID:             rules.ID(worldID),
		Label:                 strings.TrimSpace(request.Name),
		OwnerSchemaIDs:        []rules.ID{},
		Cardinality:           rules.CardinalityOne,
		MissingKind:           rules.MissingDefault,
		OmitDefaultWhenStored: true,
		ConditionAddressable:  false,
		Archived:              request.Archived,
	}
	if request.Description != nil {
		definition.Description = strings.TrimSpace(*request.Description)
	}
	minimum, err := decimalPointerFromJSON(request.Minimum)
	if err != nil {
		return definition, fmt.Errorf("minimum must be a finite exact number")
	}
	maximum, err := decimalPointerFromJSON(request.Maximum)
	if err != nil {
		return definition, fmt.Errorf("maximum must be a finite exact number")
	}
	step, err := decimalPointerFromJSON(request.Step)
	if err != nil {
		return definition, fmt.Errorf("step must be a positive finite exact number")
	}
	defaultNumber, err := decimalPointerFromJSON(request.DefaultNumber)
	if err != nil {
		return definition, fmt.Errorf("default must be a finite exact number")
	}

	if request.Kind == "capability" && request.Mode == "binary" {
		definition.ValueKind = rules.ValueBoolean
		definition.PresentationGroup = "Capabilities"
		definition.PresentationControl = rules.ControlCheckbox
		value := rules.NewSingleValue(rules.NewBooleanValue(false))
		definition.DefaultValue = &value
		if request.MutableDuringPlay {
			definition.AllowedEffectOperations = []rules.EffectOperation{rules.EffectSet}
		}
		return definition, nil
	}

	definition.ValueKind = rules.ValueNumber
	definition.NumberMinimum = minimum
	definition.NumberMaximum = maximum
	definition.NumberStep = step
	if request.Unit != nil {
		definition.NumberUnit = strings.TrimSpace(*request.Unit)
	}
	if defaultNumber == nil {
		zero, parseErr := rules.ParseDecimal("0")
		if parseErr != nil {
			return definition, parseErr
		}
		defaultNumber = &zero
	}
	value := rules.NewSingleValue(rules.NewNumberValue(*defaultNumber))
	definition.DefaultValue = &value
	definition.PresentationControl = rules.ControlNumber
	if request.Kind == "capacity" {
		definition.PresentationGroup = "Capacities"
	} else {
		definition.PresentationGroup = "Capabilities"
	}
	if request.MutableDuringPlay {
		definition.AllowedEffectOperations = []rules.EffectOperation{rules.EffectAdjustNumber, rules.EffectSet}
	}
	sort.Slice(definition.AllowedEffectOperations, func(i, j int) bool {
		return definition.AllowedEffectOperations[i] < definition.AllowedEffectOperations[j]
	})
	return definition, nil
}

func loadWorldMechanics(ctx context.Context, db queryer, worldID, kind string) ([]loadedWorldMechanic, error) {
	query := `select state_variable_id::text from world_mechanics where rule_set_id = $1`
	args := []any{worldID}
	if kind != "" {
		query += ` and kind = $2`
		args = append(args, kind)
	}
	query += ` order by kind, state_variable_id`
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	items := make([]loadedWorldMechanic, 0, len(ids))
	for _, id := range ids {
		item, err := loadWorldMechanic(ctx, db, worldID, id)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Definition.Archived != items[j].Definition.Archived {
			return !items[i].Definition.Archived
		}
		if items[i].Definition.DisplayOrder != items[j].Definition.DisplayOrder {
			return items[i].Definition.DisplayOrder < items[j].Definition.DisplayOrder
		}
		return strings.ToLower(items[i].Definition.Label) < strings.ToLower(items[j].Definition.Label)
	})
	return items, nil
}

func loadWorldMechanic(ctx context.Context, db queryer, worldID, mechanicID string) (loadedWorldMechanic, error) {
	var item loadedWorldMechanic
	if err := db.QueryRow(ctx, `
		select kind, mode, mutable_during_play from world_mechanics
		where rule_set_id = $1 and state_variable_id = $2`, worldID, mechanicID,
	).Scan(&item.Kind, &item.Mode, &item.MutableDuringPlay); err != nil {
		return item, err
	}
	definition, err := loadDefinitionDomain(ctx, db, worldID, mechanicID)
	if err != nil {
		return item, err
	}
	item.Definition = definition
	return item, nil
}

func worldMechanicToResponse(item loadedWorldMechanic) worldMechanicResponse {
	response := worldMechanicResponse{
		ID: string(item.Definition.ID), Kind: item.Kind, Mode: item.Mode,
		Name: item.Definition.Label, MutableDuringPlay: item.MutableDuringPlay,
		Archived: item.Definition.Archived, CreatedAt: item.Definition.CreatedAt,
		UpdatedAt: item.Definition.UpdatedAt,
		Minimum:   decimalJSON(item.Definition.NumberMinimum),
		Maximum:   decimalJSON(item.Definition.NumberMaximum),
		Step:      decimalJSON(item.Definition.NumberStep),
	}
	if item.Definition.Description != "" {
		response.Description = &item.Definition.Description
	}
	if item.Definition.NumberUnit != "" {
		response.Unit = &item.Definition.NumberUnit
	}
	if item.Definition.ValueKind == rules.ValueNumber && item.Definition.DefaultValue != nil && len(item.Definition.DefaultValue.Values) == 1 {
		response.DefaultNumber = decimalJSON(item.Definition.DefaultValue.Values[0].Number)
	}
	return response
}

func worldMechanicToSaveRequest(item loadedWorldMechanic) saveWorldMechanicRequest {
	response := worldMechanicToResponse(item)
	return saveWorldMechanicRequest{
		ID: response.ID, Kind: response.Kind, Mode: response.Mode, Name: response.Name,
		Description: response.Description, Minimum: response.Minimum, Maximum: response.Maximum,
		Step: response.Step, DefaultNumber: response.DefaultNumber, Unit: response.Unit,
		MutableDuringPlay: response.MutableDuringPlay, Archived: response.Archived,
	}
}

func generatedMechanicKey(kind, name, id string) string {
	base := nonKeyCharacters.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	base = strings.Trim(base, "-")
	if base == "" || base[0] < 'a' || base[0] > 'z' {
		base = kind
	}
	if len(base) > 70 {
		base = strings.Trim(base[:70], "-")
	}
	suffix := strings.ReplaceAll(id, "-", "")
	if len(suffix) > 8 {
		suffix = suffix[:8]
	}
	return kind + "." + base + "-" + suffix
}
