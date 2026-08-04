package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func (s *Server) handlePreviewInteractionResolution(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionResolution(w, r, true)
}

func (s *Server) handleResolveInteraction(w http.ResponseWriter, r *http.Request) {
	s.handleInteractionResolution(w, r, false)
}

func (s *Server) handleInteractionResolution(w http.ResponseWriter, r *http.Request, preview bool) {
	worldID, interactionID := r.PathValue("world_id"), r.PathValue("interaction_id")
	if !validID(interactionID) {
		writeError(w, http.StatusBadRequest, "invalid_id", "interaction ID is malformed", nil)
		return
	}
	if _, err := requireFacilitator(r.Context(), s.db, r, worldID); err != nil {
		handleAppError(w, err)
		return
	}
	var request adjudicateInteractionRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}
	fields := validateAdjudicationRequest(&request, !preview)
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "ruling is invalid", fields)
		return
	}
	if preview {
		result, err := s.previewInteractionResolution(r.Context(), r, worldID, interactionID, request)
		if err != nil {
			handleAppError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
		return
	}
	result, err := s.resolveInteraction(r.Context(), r, worldID, interactionID, request)
	if err != nil {
		handleAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) previewInteractionResolution(ctx context.Context, r *http.Request, worldID, interactionID string, request adjudicateInteractionRequest) (interactionResolutionResultResponse, error) {
	var zero interactionResolutionResultResponse
	member, err := requireFacilitator(ctx, s.db, r, worldID)
	if err != nil {
		return zero, err
	}
	var status string
	var revision int64
	if err := s.db.QueryRow(ctx, `select status, revision from interactions where world_id = $1 and id = $2`, worldID, interactionID).Scan(&status, &revision); err != nil {
		return zero, err
	}
	if status != "adjudicating" {
		return zero, interactionLifecycleConflict("interaction must be adjudicating before it can be resolved")
	}
	if revision != *request.ExpectedRevision {
		return zero, revisionConflict("interaction", *request.ExpectedRevision, revision)
	}
	if err := validateSelectedAction(ctx, s.db, worldID, interactionID, request.SelectedActionID); err != nil {
		return zero, err
	}
	plan, entities, definitions, snapshot, err := loadTransitionInput(ctx, s.db, worldID, request.Effects)
	if err != nil {
		return zero, err
	}
	transition, err := rules.ApplyTransition(plan, entities, definitions, snapshot)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	result := transitionResultToResponse(interactionID, revision, strings.TrimSpace(request.Narrative), transition, definitions, true)
	_ = member
	return result, nil
}

func (s *Server) resolveInteraction(ctx context.Context, r *http.Request, worldID, interactionID string, request adjudicateInteractionRequest) (interactionResolutionResultResponse, error) {
	var zero interactionResolutionResultResponse
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	member, err := requireFacilitator(ctx, tx, r, worldID)
	if err != nil {
		return zero, err
	}

	var replayInteractionID string
	err = tx.QueryRow(ctx, `
		select interaction_id::text from interaction_resolutions
		where world_id = $1 and idempotency_key = $2 and status = 'applied'`, worldID, strings.TrimSpace(request.IdempotencyKey),
	).Scan(&replayInteractionID)
	if err == nil {
		if replayInteractionID != interactionID {
			return zero, &statusError{Status: http.StatusConflict, Code: "idempotency_conflict", Message: "idempotency key was already used for another ruling"}
		}
		matches, err := resolutionRequestMatches(ctx, tx, worldID, interactionID, request)
		if err != nil {
			return zero, err
		}
		if !matches {
			return zero, &statusError{Status: http.StatusConflict, Code: "idempotency_conflict", Message: "idempotency key was reused with a different ruling"}
		}
		result, err := loadAppliedResolutionResult(ctx, tx, worldID, interactionID)
		if err != nil {
			return zero, err
		}
		result.Replayed = true
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return zero, err
	}

	var status string
	var revision int64
	if err := tx.QueryRow(ctx, `
		select status, revision from interactions where world_id = $1 and id = $2 for update`, worldID, interactionID,
	).Scan(&status, &revision); err != nil {
		return zero, err
	}
	if status != "adjudicating" {
		return zero, interactionLifecycleConflict("interaction must be adjudicating before it can be resolved")
	}
	if revision != *request.ExpectedRevision {
		return zero, revisionConflict("interaction", *request.ExpectedRevision, revision)
	}
	if err := validateSelectedAction(ctx, tx, worldID, interactionID, request.SelectedActionID); err != nil {
		return zero, err
	}
	plan, entities, definitions, _, err := loadTransitionInput(ctx, tx, worldID, request.Effects)
	if err != nil {
		return zero, err
	}
	targetIDs := transitionTargetIDs(plan)
	if err := lockTransitionState(ctx, tx, worldID, targetIDs); err != nil {
		return zero, err
	}
	snapshot, err := loadTransitionSnapshot(ctx, tx, worldID, targetIDs)
	if err != nil {
		return zero, err
	}
	transition, err := rules.ApplyTransition(plan, entities, definitions, snapshot)
	if err != nil {
		return zero, domainTransitionError(err)
	}

	resolutionID, err := newID()
	if err != nil {
		return zero, err
	}
	request.ActionSummary = cleanOptional(request.ActionSummary)
	request.PrivateNotes = cleanOptional(request.PrivateNotes)
	if _, err := tx.Exec(ctx, `
		insert into interaction_resolutions
			(id, interaction_id, world_id, selected_submission_id, action_summary, public_narrative,
			 private_notes, status, created_by_membership_id)
		values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)`,
		resolutionID, interactionID, worldID, request.SelectedActionID, request.ActionSummary,
		strings.TrimSpace(request.Narrative), request.PrivateNotes, member.ID); err != nil {
		return zero, err
	}
	if err := insertResolutionEffects(ctx, tx, worldID, resolutionID, plan, transition); err != nil {
		return zero, err
	}
	if err := persistTransitionState(ctx, tx, worldID, transition, definitions); err != nil {
		return zero, err
	}
	if request.SelectedActionID != nil {
		if _, err := tx.Exec(ctx, `
			update interaction_action_submissions set status = case when id = $3 then 'selected' else 'declined' end,
				revision = revision + 1
			where world_id = $1 and interaction_id = $2 and status = 'submitted'`, worldID, interactionID, *request.SelectedActionID); err != nil {
			return zero, err
		}
	} else if _, err := tx.Exec(ctx, `
		update interaction_action_submissions set status = 'declined', revision = revision + 1
		where world_id = $1 and interaction_id = $2 and status = 'submitted'`, worldID, interactionID); err != nil {
		return zero, err
	}
	if _, err := tx.Exec(ctx, `
		update interaction_resolutions set status = 'applied', resolved_by_membership_id = $3,
			idempotency_key = $4, applied_at = now()
		where world_id = $1 and id = $2`, worldID, resolutionID, member.ID, strings.TrimSpace(request.IdempotencyKey)); err != nil {
		return zero, err
	}
	if _, err := tx.Exec(ctx, `
		update interactions set status = 'resolved', resolved_at = now(), revision = revision + 1
		where world_id = $1 and id = $2`, worldID, interactionID); err != nil {
		return zero, err
	}
	if err := appendWorldEvent(ctx, tx, worldID, "resolution-applied", member.ID, &interactionID, nil, &resolutionID); err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	result, err := loadAppliedResolutionResult(ctx, s.db, worldID, interactionID)
	if err != nil {
		return zero, err
	}
	return result, nil
}

func validateAdjudicationRequest(request *adjudicateInteractionRequest, requireIdempotency bool) map[string]string {
	fields := map[string]string{}
	if request.ExpectedRevision == nil {
		fields["expected_revision"] = "is required"
	}
	validateRequired(fields, "narrative", request.Narrative, 20000)
	if requireIdempotency {
		validateRequired(fields, "idempotency_key", request.IdempotencyKey, 200)
	}
	if request.SelectedActionID != nil && !validID(*request.SelectedActionID) {
		fields["selected_action_id"] = "must be a UUID"
	}
	if request.ActionSummary != nil && len([]rune(strings.TrimSpace(*request.ActionSummary))) > 10000 {
		fields["action_summary"] = "must be at most 10000 characters"
	}
	if request.PrivateNotes != nil && len([]rune(strings.TrimSpace(*request.PrivateNotes))) > 20000 {
		fields["private_notes"] = "must be at most 20000 characters"
	}
	for index, effect := range request.Effects {
		path := fmt.Sprintf("effects[%d]", index)
		if effect.ID != "" && !validID(effect.ID) {
			fields[path+".id"] = "must be a UUID"
		}
		if !validID(effect.MechanicID) {
			fields[path+".mechanic_id"] = "must be a UUID"
		}
		if effect.Type != "set" && effect.Type != "adjust-number" {
			fields[path+".type"] = "must be set or adjust-number"
		}
		if effect.Type == "set" && (effect.Value == nil || effect.Amount != nil) {
			fields[path] = "set requires value and no amount"
		}
		if effect.Type == "adjust-number" && (effect.Amount == nil || effect.Value != nil) {
			fields[path] = "adjust-number requires amount and no value"
		}
		for entityIndex, entityID := range effect.EntityIDs {
			if !validID(entityID) {
				fields[fmt.Sprintf("%s.entity_ids[%d]", path, entityIndex)] = "must be a UUID"
			}
		}
	}
	return fields
}

func loadTransitionInput(ctx context.Context, db queryer, worldID string, items []concreteEffectDTO) (rules.TransitionPlan, map[rules.ID]rules.Entity, map[rules.ID]rules.MechanicDefinition, rules.StateSnapshot, error) {
	var zero rules.TransitionPlan
	mechanics, err := loadWorldMechanics(ctx, db, worldID, "")
	if err != nil {
		return zero, nil, nil, rules.StateSnapshot{}, err
	}
	definitions := mechanicDefinitions(mechanics)
	plan := rules.TransitionPlan{Effects: make([]rules.ConcreteEffect, len(items))}
	entitySet := make(map[rules.ID]struct{})
	for index, item := range items {
		effectID := item.ID
		if effectID == "" {
			effectID, err = newID()
			if err != nil {
				return zero, nil, nil, rules.StateSnapshot{}, err
			}
		}
		effect := rules.ConcreteEffect{ID: rules.ID(effectID), Position: index, Operation: rules.EffectOperation(item.Type), MechanicID: rules.ID(item.MechanicID)}
		for _, entityID := range uniqueInOrder(item.EntityIDs) {
			effect.EntityIDs = append(effect.EntityIDs, rules.ID(entityID))
			entitySet[rules.ID(entityID)] = struct{}{}
		}
		if item.Value != nil {
			value, conversionErr := stateValueDTOToDomain(*item.Value)
			if conversionErr != nil {
				return zero, nil, nil, rules.StateSnapshot{}, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "effect value is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].value", index): conversionErr.Error()}}
			}
			effect.Value = &value
		}
		if item.Amount != nil {
			amount, parseErr := rules.ParseDecimal(item.Amount.String())
			if parseErr != nil {
				return zero, nil, nil, rules.StateSnapshot{}, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "effect amount is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].amount", index): "must be a finite exact decimal"}}
			}
			effect.AdjustmentAmount = &amount
		}
		plan.Effects[index] = effect
	}
	entityIDs := make([]rules.ID, 0, len(entitySet))
	for id := range entitySet {
		entityIDs = append(entityIDs, id)
	}
	sort.Slice(entityIDs, func(i, j int) bool { return entityIDs[i] < entityIDs[j] })
	entities := make(map[rules.ID]rules.Entity, len(entityIDs))
	for _, entityID := range entityIDs {
		var entity rules.Entity
		entity.ID, entity.WorldID = entityID, rules.ID(worldID)
		if err := db.QueryRow(ctx, `
			select display_name, archived, created_at, updated_at from entities
			where world_id = $1 and id = $2`, worldID, entityID,
		).Scan(&entity.DisplayName, &entity.Archived, &entity.CreatedAt, &entity.UpdatedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return zero, nil, nil, rules.StateSnapshot{}, err
		}
		entities[entityID] = entity
	}
	snapshot, err := loadTransitionSnapshot(ctx, db, worldID, entityIDs)
	return plan, entities, definitions, snapshot, err
}

func transitionTargetIDs(plan rules.TransitionPlan) []rules.ID {
	set := make(map[rules.ID]struct{})
	for _, effect := range plan.Effects {
		for _, id := range effect.EntityIDs {
			set[id] = struct{}{}
		}
	}
	ids := make([]rules.ID, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func lockTransitionState(ctx context.Context, tx pgx.Tx, worldID string, entityIDs []rules.ID) error {
	for _, entityID := range entityIDs {
		var id string
		if err := tx.QueryRow(ctx, `select id::text from entities where world_id = $1 and id = $2 for update`, worldID, entityID).Scan(&id); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `select entity_id::text from state_records where world_id = $1 and entity_id = $2 for update`, worldID, entityID).Scan(&id); err != nil {
			return err
		}
	}
	return nil
}

func loadTransitionSnapshot(ctx context.Context, db queryer, worldID string, entityIDs []rules.ID) (rules.StateSnapshot, error) {
	result := rules.StateSnapshot{Records: make(map[rules.ID]rules.StateRecord, len(entityIDs))}
	for _, entityID := range entityIDs {
		record, err := loadStoredStateRecord(ctx, db, worldID, string(entityID))
		if err != nil {
			return result, err
		}
		result.Records[entityID] = record
	}
	return result, nil
}

func persistTransitionState(ctx context.Context, tx pgx.Tx, worldID string, transition rules.TransitionResult, definitions map[rules.ID]rules.MechanicDefinition) error {
	for _, entityID := range transition.ChangedRecordIDs {
		record := rules.NormalizeStateRecord(transition.State.Records[entityID], definitions)
		if _, err := tx.Exec(ctx, `delete from state_values where world_id = $1 and entity_id = $2`, worldID, entityID); err != nil {
			return err
		}
		mechanicIDs := make([]rules.ID, 0, len(record.Values))
		for mechanicID := range record.Values {
			mechanicIDs = append(mechanicIDs, mechanicID)
		}
		sort.Slice(mechanicIDs, func(i, j int) bool { return mechanicIDs[i] < mechanicIDs[j] })
		for _, mechanicID := range mechanicIDs {
			if err := insertStateValue(ctx, tx, worldID, string(entityID), mechanicID, record.Values[mechanicID]); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `update state_records set revision = revision + 1 where world_id = $1 and entity_id = $2`, worldID, entityID); err != nil {
			return err
		}
	}
	return nil
}

func insertResolutionEffects(ctx context.Context, tx pgx.Tx, worldID, resolutionID string, plan rules.TransitionPlan, transition rules.TransitionResult) error {
	applications := make(map[rules.ID][]rules.AppliedEffect)
	for _, application := range transition.AppliedEffects {
		applications[application.EffectID] = append(applications[application.EffectID], application)
	}
	applicationPosition := 0
	for _, effect := range plan.Effects {
		var setNumber, setBoolean, adjustment any
		valueKind := "number"
		if effect.Operation == rules.EffectSet && effect.Value != nil {
			valueKind = string(effect.Value.Kind)
			if effect.Value.Kind == rules.ValueNumber {
				setNumber = effect.Value.Number.String()
			} else {
				setBoolean = *effect.Value.Boolean
			}
		} else if effect.AdjustmentAmount != nil {
			adjustment = effect.AdjustmentAmount.String()
		}
		if _, err := tx.Exec(ctx, `
			insert into interaction_resolution_effects
				(id, resolution_id, world_id, position, operation, mechanic_id, value_kind,
				 set_number, set_boolean, adjustment_amount)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			effect.ID, resolutionID, worldID, effect.Position, effect.Operation, effect.MechanicID,
			valueKind, setNumber, setBoolean, adjustment); err != nil {
			return err
		}
		for position, entityID := range effect.EntityIDs {
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_effect_targets
					(effect_id, resolution_id, world_id, entity_id, position)
				values ($1, $2, $3, $4, $5)`, effect.ID, resolutionID, worldID, entityID, position); err != nil {
				return err
			}
		}
		for _, application := range applications[effect.ID] {
			applicationID, err := newID()
			if err != nil {
				return err
			}
			beforeNumber, beforeBoolean := stateValueDatabaseColumns(application.Before)
			afterNumber, afterBoolean := stateValueDatabaseColumns(application.After)
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_effect_applications
					(id, resolution_id, effect_id, world_id, mechanic_id, value_kind, entity_id,
					 position, changed, before_number, before_boolean, after_number, after_boolean)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
				applicationID, resolutionID, effect.ID, worldID, application.MechanicID,
				application.Before.Kind, application.EntityID, applicationPosition, application.Changed,
				beforeNumber, beforeBoolean, afterNumber, afterBoolean); err != nil {
				return err
			}
			applicationPosition++
		}
	}
	return nil
}

func stateValueDatabaseColumns(value rules.StateValue) (any, any) {
	if value.Kind == rules.ValueNumber && value.Number != nil {
		return value.Number.String(), nil
	}
	if value.Kind == rules.ValueBoolean && value.Boolean != nil {
		return nil, *value.Boolean
	}
	return nil, nil
}

func transitionResultToResponse(interactionID string, revision int64, narrative string, transition rules.TransitionResult, definitions map[rules.ID]rules.MechanicDefinition, preview bool) interactionResolutionResultResponse {
	changed := make(map[rules.ID]struct{}, len(transition.ChangedRecordIDs))
	for _, id := range transition.ChangedRecordIDs {
		changed[id] = struct{}{}
	}
	result := interactionResolutionResultResponse{
		Preview: preview, InteractionID: interactionID, InteractionRevision: revision,
		Narrative: narrative, AppliedEffects: appliedEffectsToResponse(transition.AppliedEffects),
		State: transitionStateResponse{Records: make(map[string]stateRecordResponse, len(transition.State.Records))},
	}
	if !preview {
		result.InteractionRevision++
	}
	for entityID, record := range transition.State.Records {
		logical := rules.MaterializeLogicalState(rules.Entity{ID: entityID, WorldID: definitionsWorldID(definitions)}, record, definitions)
		state := stateRecordResponse{EntityID: string(entityID), Revision: record.Revision, Values: make(map[string]stateValueDTO, len(logical.Values)), DefaultedMechanicIDs: make([]string, len(logical.DefaultedMechanicIDs)), UpdatedAt: record.UpdatedAt}
		if _, exists := changed[entityID]; exists {
			state.Revision++
		}
		for mechanicID, value := range logical.Values {
			state.Values[string(mechanicID)] = stateValueDomainToDTO(value)
		}
		for index, mechanicID := range logical.DefaultedMechanicIDs {
			state.DefaultedMechanicIDs[index] = string(mechanicID)
		}
		result.State.Records[string(entityID)] = state
	}
	return result
}

func definitionsWorldID(definitions map[rules.ID]rules.MechanicDefinition) rules.ID {
	for _, definition := range definitions {
		return definition.WorldID
	}
	return ""
}

func appliedEffectsToResponse(items []rules.AppliedEffect) []concreteAppliedEffectResponse {
	result := make([]concreteAppliedEffectResponse, len(items))
	for index, item := range items {
		before, after := stateValueDomainToDTO(item.Before), stateValueDomainToDTO(item.After)
		result[index] = concreteAppliedEffectResponse{EffectID: string(item.EffectID), EntityID: string(item.EntityID), MechanicID: string(item.MechanicID), Before: &before, After: &after, Changed: item.Changed}
	}
	return result
}

func domainTransitionError(err error) error {
	var domain *rules.DomainError
	if !errors.As(err, &domain) {
		return err
	}
	fields := make(map[string]string, len(domain.Errors))
	for _, item := range domain.Errors {
		fields[item.Path] = item.Message
	}
	return &statusError{Status: http.StatusUnprocessableEntity, Code: "transition_failed", Message: domain.Error(), Fields: fields}
}

func validateSelectedAction(ctx context.Context, db queryer, worldID, interactionID string, actionID *string) error {
	if actionID == nil {
		return nil
	}
	var valid bool
	if err := db.QueryRow(ctx, `
		select exists(select 1 from interaction_action_submissions
		where world_id = $1 and interaction_id = $2 and id = $3 and status = 'submitted')`,
		worldID, interactionID, *actionID).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return &statusError{Status: http.StatusUnprocessableEntity, Code: "invalid_reference", Message: "selected action is not an active submission for this interaction"}
	}
	return nil
}

func interactionLifecycleConflict(message string) error {
	return &statusError{Status: http.StatusConflict, Code: "interaction_lifecycle_conflict", Message: message}
}

func loadInteractionResolutionResponse(ctx context.Context, db queryer, worldID, interactionID string, includePrivate bool) (*interactionResolutionResponse, error) {
	var item interactionResolutionResponse
	var privateNotes *string
	err := db.QueryRow(ctx, `
		select id::text, selected_submission_id::text, action_summary, public_narrative,
			private_notes, resolved_by_membership_id::text, applied_at
		from interaction_resolutions
		where world_id = $1 and interaction_id = $2 and status = 'applied'`, worldID, interactionID,
	).Scan(&item.ID, &item.SelectedActionID, &item.ActionSummary, &item.Narrative, &privateNotes, &item.ResolvedByMembershipID, &item.ResolvedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if includePrivate {
		item.PrivateNotes = privateNotes
	}
	rows, err := db.Query(ctx, `
		select id::text, position, operation, mechanic_id::text, value_kind,
			set_number::text, set_boolean, adjustment_amount::text
		from interaction_resolution_effects where world_id = $1 and resolution_id = $2
		order by position`, worldID, item.ID)
	if err != nil {
		return nil, err
	}
	type storedEffect struct {
		Effect     concreteEffectDTO
		Kind       string
		SetNumber  *string
		SetBoolean *bool
		Adjustment *string
	}
	storedEffects := make([]storedEffect, 0)
	for rows.Next() {
		var stored storedEffect
		var position int
		if err := rows.Scan(
			&stored.Effect.ID, &position, &stored.Effect.Type, &stored.Effect.MechanicID,
			&stored.Kind, &stored.SetNumber, &stored.SetBoolean, &stored.Adjustment,
		); err != nil {
			rows.Close()
			return nil, err
		}
		storedEffects = append(storedEffects, stored)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	item.Effects = make([]concreteEffectDTO, 0, len(storedEffects))
	for _, stored := range storedEffects {
		effect := stored.Effect
		targetRows, err := db.Query(ctx, `
			select entity_id::text from interaction_resolution_effect_targets
			where world_id = $1 and effect_id = $2 order by position`, worldID, effect.ID)
		if err != nil {
			return nil, err
		}
		effect.EntityIDs = make([]string, 0)
		for targetRows.Next() {
			var id string
			if err := targetRows.Scan(&id); err != nil {
				targetRows.Close()
				return nil, err
			}
			effect.EntityIDs = append(effect.EntityIDs, id)
		}
		if err := targetRows.Err(); err != nil {
			targetRows.Close()
			return nil, err
		}
		targetRows.Close()
		if effect.Type == "set" {
			value, err := databaseStateValue(stored.Kind, stored.SetNumber, stored.SetBoolean)
			if err != nil {
				return nil, err
			}
			dto := stateValueDomainToDTO(value)
			effect.Value = &dto
		} else if stored.Adjustment != nil {
			number := jsonNumber(*stored.Adjustment)
			effect.Amount = &number
		}
		item.Effects = append(item.Effects, effect)
	}

	applicationRows, err := db.Query(ctx, `
		select effect_id::text, entity_id::text, mechanic_id::text, value_kind, changed,
			before_number::text, before_boolean, after_number::text, after_boolean
		from interaction_resolution_effect_applications
		where world_id = $1 and resolution_id = $2 order by position`, worldID, item.ID)
	if err != nil {
		return nil, err
	}
	defer applicationRows.Close()
	item.AppliedEffects = make([]concreteAppliedEffectResponse, 0)
	for applicationRows.Next() {
		var application concreteAppliedEffectResponse
		var kind string
		var beforeNumber, afterNumber *string
		var beforeBoolean, afterBoolean *bool
		if err := applicationRows.Scan(&application.EffectID, &application.EntityID, &application.MechanicID, &kind, &application.Changed, &beforeNumber, &beforeBoolean, &afterNumber, &afterBoolean); err != nil {
			return nil, err
		}
		before, err := databaseStateValue(kind, beforeNumber, beforeBoolean)
		if err != nil {
			return nil, err
		}
		after, err := databaseStateValue(kind, afterNumber, afterBoolean)
		if err != nil {
			return nil, err
		}
		beforeDTO, afterDTO := stateValueDomainToDTO(before), stateValueDomainToDTO(after)
		application.Before, application.After = &beforeDTO, &afterDTO
		item.AppliedEffects = append(item.AppliedEffects, application)
	}
	return &item, applicationRows.Err()
}

func databaseStateValue(kind string, number *string, boolean *bool) (rules.StateValue, error) {
	if kind == "number" && number != nil {
		value, err := rules.ParseDecimal(*number)
		if err != nil {
			return rules.StateValue{}, err
		}
		return rules.NewNumberValue(value), nil
	}
	if kind == "boolean" && boolean != nil {
		return rules.NewBooleanValue(*boolean), nil
	}
	return rules.StateValue{}, errors.New("invalid stored state value")
}

func loadAppliedResolutionResult(ctx context.Context, db queryer, worldID, interactionID string) (interactionResolutionResultResponse, error) {
	var result interactionResolutionResultResponse
	var revision int64
	if err := db.QueryRow(ctx, `select revision from interactions where world_id = $1 and id = $2`, worldID, interactionID).Scan(&revision); err != nil {
		return result, err
	}
	receipt, err := loadInteractionResolutionResponse(ctx, db, worldID, interactionID, true)
	if err != nil {
		return result, err
	}
	if receipt == nil {
		return result, pgx.ErrNoRows
	}
	result = interactionResolutionResultResponse{InteractionID: interactionID, InteractionRevision: revision, Narrative: receipt.Narrative, AppliedEffects: receipt.AppliedEffects, State: transitionStateResponse{Records: make(map[string]stateRecordResponse)}}
	entitySet := make(map[string]struct{})
	for _, application := range receipt.AppliedEffects {
		entitySet[application.EntityID] = struct{}{}
	}
	for entityID := range entitySet {
		state, err := loadLogicalStateResponse(ctx, db, worldID, entityID)
		if err != nil {
			return result, err
		}
		result.State.Records[entityID] = state
	}
	return result, nil
}

func resolutionRequestMatches(ctx context.Context, db queryer, worldID, interactionID string, request adjudicateInteractionRequest) (bool, error) {
	receipt, err := loadInteractionResolutionResponse(ctx, db, worldID, interactionID, true)
	if err != nil || receipt == nil {
		return false, err
	}
	if strings.TrimSpace(request.Narrative) != receipt.Narrative || !optionalTrimmedEqual(request.SelectedActionID, receipt.SelectedActionID) || !optionalTrimmedEqual(cleanOptional(request.ActionSummary), receipt.ActionSummary) || !optionalTrimmedEqual(cleanOptional(request.PrivateNotes), receipt.PrivateNotes) || len(request.Effects) != len(receipt.Effects) {
		return false, nil
	}
	for index := range request.Effects {
		left, right := request.Effects[index], receipt.Effects[index]
		if left.Type != right.Type || left.MechanicID != right.MechanicID || !stringSlicesEqual(uniqueInOrder(left.EntityIDs), right.EntityIDs) {
			return false, nil
		}
		if left.Type == "set" {
			if left.Value == nil || right.Value == nil || !stateDTOEqual(*left.Value, *right.Value) {
				return false, nil
			}
		} else if left.Amount == nil || right.Amount == nil {
			return false, nil
		} else {
			leftDecimal, leftErr := rules.ParseDecimal(left.Amount.String())
			rightDecimal, rightErr := rules.ParseDecimal(right.Amount.String())
			if leftErr != nil || rightErr != nil || !leftDecimal.Equal(rightDecimal) {
				return false, nil
			}
		}
	}
	return true, nil
}

func optionalTrimmedEqual(left, right *string) bool {
	left, right = cleanOptional(left), cleanOptional(right)
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func stringSlicesEqual(left, right []string) bool {
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

func stateDTOEqual(left, right stateValueDTO) bool {
	leftValue, leftErr := stateValueDTOToDomain(left)
	rightValue, rightErr := stateValueDTOToDomain(right)
	return leftErr == nil && rightErr == nil && rules.StateValuesEqual(leftValue, rightValue)
}
