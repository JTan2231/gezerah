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
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return zero, err
	}
	defer rollbackTx(ctx, tx)
	_, err = requireFacilitator(ctx, tx, r, worldID)
	if err != nil {
		return zero, err
	}
	rulesRevision, err := requireRulesRevision(ctx, tx, worldID, request.ExpectedRulesRevision)
	if err != nil {
		return zero, err
	}
	var status string
	var revision int64
	if err := tx.QueryRow(ctx, `select status, revision from interactions where world_id = $1 and id = $2`, worldID, interactionID).Scan(&status, &revision); err != nil {
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
	input, err := loadResolutionRuntimeInput(ctx, tx, worldID, interactionID, rulesRevision, request.Effects)
	if err != nil {
		return zero, err
	}
	before, err := evaluateResolutionStates(input, input.Snapshot.State, input.StatusSets)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	transition, err := rules.ApplyRuntimeTransition(
		input.Plan, input.Entities, input.Mechanics, input.Statuses.Snapshots, input.Snapshot,
	)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	applications, err := statusReceipts(transition.AppliedStatusCommands, input.StatusSets, input.Statuses)
	if err != nil {
		return zero, err
	}
	statusSets := previewStatusSets(input, transition)
	after, err := evaluateResolutionStates(input, transition.State, statusSets)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	changes := resolutionEffectiveChanges(input, before, after)
	result, err := previewRuntimeResult(
		interactionID, revision, strings.TrimSpace(request.Narrative), input,
		transition, applications, changes, statusSets,
	)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	return result, nil
}

func (s *Server) resolveInteraction(ctx context.Context, r *http.Request, worldID, interactionID string, request adjudicateInteractionRequest) (interactionResolutionResultResponse, error) {
	var zero interactionResolutionResultResponse
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer rollbackTx(ctx, tx)
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
	rulesRevision, err := lockRulesRevision(ctx, tx, worldID, request.ExpectedRulesRevision)
	if err != nil {
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
	targetIDs := effectTargetIDs(request.Effects)
	if err := lockTransitionState(ctx, tx, worldID, targetIDs); err != nil {
		return zero, err
	}
	input, err := loadResolutionRuntimeInput(ctx, tx, worldID, interactionID, rulesRevision, request.Effects)
	if err != nil {
		return zero, err
	}
	before, err := evaluateResolutionStates(input, input.Snapshot.State, input.StatusSets)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	transition, err := rules.ApplyRuntimeTransition(
		input.Plan, input.Entities, input.Mechanics, input.Statuses.Snapshots, input.Snapshot,
	)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	statusApplications, err := statusReceipts(transition.AppliedStatusCommands, input.StatusSets, input.Statuses)
	if err != nil {
		return zero, err
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
			 private_notes, status, created_by_membership_id, rules_revision)
		values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9)`,
		resolutionID, interactionID, worldID, request.SelectedActionID, request.ActionSummary,
		strings.TrimSpace(request.Narrative), request.PrivateNotes, member.ID, rulesRevision); err != nil {
		return zero, err
	}
	if err := persistTransitionState(ctx, tx, worldID, rules.TransitionResult{
		State: transition.State, ChangedRecordIDs: transition.ChangedRecordIDs,
	}, input.Mechanics); err != nil {
		return zero, err
	}
	if err := persistStatusCommands(ctx, tx, worldID, resolutionID, transition.AppliedStatusCommands, input.Statuses); err != nil {
		return zero, err
	}
	if err := insertRuntimeResolutionEffects(
		ctx, tx, worldID, resolutionID, input.Plan, transition, statusApplications, input.Statuses,
	); err != nil {
		return zero, err
	}
	afterStatusSets := make(map[rules.ID]loadedStatusSet, len(input.TargetIDs))
	for _, entityID := range input.TargetIDs {
		set, err := loadActiveStatusSet(ctx, tx, worldID, string(entityID))
		if err != nil {
			return zero, err
		}
		afterStatusSets[entityID] = set
	}
	after, err := evaluateResolutionStates(input, transition.State, afterStatusSets)
	if err != nil {
		return zero, domainTransitionError(err)
	}
	changes := resolutionEffectiveChanges(input, before, after)
	if err := insertEffectiveChangeReceipts(ctx, tx, worldID, resolutionID, changes); err != nil {
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
	if request.ExpectedRulesRevision == nil {
		fields["expected_rules_revision"] = "is required"
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
		switch effect.Type {
		case "set":
			if !validID(effect.MechanicID) {
				fields[path+".mechanic_id"] = "must be a UUID"
			}
			if effect.Value == nil || effect.Amount != nil || effect.Status != nil {
				fields[path] = "set requires value and no amount"
			}
			validateScalarEffectTargets(fields, path, effect)
		case "adjust-number":
			if !validID(effect.MechanicID) {
				fields[path+".mechanic_id"] = "must be a UUID"
			}
			if effect.Amount == nil || effect.Value != nil || effect.Status != nil {
				fields[path] = "adjust-number requires amount and no value"
			}
			if effect.Amount != nil {
				if _, err := effect.Amount.Decimal(); err != nil {
					fields[path+".amount"] = "must be a finite exact decimal"
				}
			}
			validateScalarEffectTargets(fields, path, effect)
		case "apply-status":
			if effect.MechanicID != "" {
				fields[path+".mechanic_id"] = "must be omitted for status effects"
			}
			if effect.Value != nil || effect.Amount != nil {
				fields[path] = "status effects cannot declare scalar operands"
			}
			validateStatusEffectTargets(fields, path, effect, false)
			if effect.Status == nil {
				fields[path+".status"] = "is required"
			} else {
				validateRequired(fields, path+".status.name", effect.Status.Name, 200)
				if effect.Status.Description != nil && len([]rune(strings.TrimSpace(*effect.Status.Description))) > 2000 {
					fields[path+".status.description"] = "must be at most 2000 characters"
				}
				for modifierIndex, modifier := range effect.Status.Modifiers {
					modifierPath := fmt.Sprintf("%s.status.modifiers[%d]", path, modifierIndex)
					if modifier.ID != "" && !validID(modifier.ID) {
						fields[modifierPath+".id"] = "must be a UUID"
					}
					if !validID(modifier.MechanicID) {
						fields[modifierPath+".mechanic_id"] = "must be a UUID"
					}
					if modifier.Operation != "set" && modifier.Operation != "add-number" && modifier.Operation != "multiply-number" {
						fields[modifierPath+".operation"] = "must be set, add-number, or multiply-number"
					}
					if _, err := stateValueDTOToDomain(modifier.Value); err != nil {
						fields[modifierPath+".value"] = err.Error()
					}
				}
			}
		case "remove-status":
			if effect.MechanicID != "" {
				fields[path+".mechanic_id"] = "must be omitted for status effects"
			}
			if effect.Value != nil || effect.Amount != nil || effect.Status != nil {
				fields[path] = "remove-status can declare only exact status targets"
			}
			validateStatusEffectTargets(fields, path, effect, true)
		default:
			fields[path+".type"] = "must be set, adjust-number, apply-status, or remove-status"
		}
	}
	return fields
}

func validateScalarEffectTargets(fields map[string]string, path string, effect concreteEffectDTO) {
	if len(effect.EntityIDs) == 0 {
		fields[path+".entity_ids"] = "must contain at least one entity"
	}
	if len(effect.Targets) > 0 {
		fields[path+".targets"] = "must be omitted for scalar effects"
	}
	seen := make(map[string]struct{}, len(effect.EntityIDs))
	for index, entityID := range effect.EntityIDs {
		itemPath := fmt.Sprintf("%s.entity_ids[%d]", path, index)
		if !validID(entityID) {
			fields[itemPath] = "must be a UUID"
		}
		if _, duplicate := seen[entityID]; duplicate {
			fields[itemPath] = "must not repeat a target entity"
		}
		seen[entityID] = struct{}{}
	}
}

func validateStatusEffectTargets(fields map[string]string, path string, effect concreteEffectDTO, requireInstance bool) {
	if len(effect.EntityIDs) > 0 {
		fields[path+".entity_ids"] = "must be omitted for status effects"
	}
	if len(effect.Targets) == 0 {
		fields[path+".targets"] = "must contain at least one target"
	}
	seenEntities := make(map[string]struct{}, len(effect.Targets))
	seenInstances := make(map[string]struct{}, len(effect.Targets))
	for index, target := range effect.Targets {
		itemPath := fmt.Sprintf("%s.targets[%d]", path, index)
		if !validID(target.EntityID) {
			fields[itemPath+".entity_id"] = "must be a UUID"
		}
		if _, duplicate := seenEntities[target.EntityID]; duplicate {
			fields[itemPath+".entity_id"] = "must not repeat a target entity"
		}
		seenEntities[target.EntityID] = struct{}{}
		if requireInstance {
			if !validID(target.StatusInstanceID) {
				fields[itemPath+".status_instance_id"] = "must be a UUID"
			}
			if _, duplicate := seenInstances[target.StatusInstanceID]; duplicate {
				fields[itemPath+".status_instance_id"] = "must not repeat a status instance"
			}
			seenInstances[target.StatusInstanceID] = struct{}{}
		} else if target.StatusInstanceID != "" {
			fields[itemPath+".status_instance_id"] = "must be omitted when applying a status"
		}
	}
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
		if err := tx.QueryRow(ctx, `select entity_id::text from entity_status_sets where world_id = $1 and entity_id = $2 for update`, worldID, entityID).Scan(&id); err != nil {
			return err
		}
	}
	return nil
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

func stateValueDatabaseColumns(value rules.StateValue) (any, any) {
	if value.Kind == rules.ValueNumber && value.Number != nil {
		return value.Number.String(), nil
	}
	if value.Kind == rules.ValueBoolean && value.Boolean != nil {
		return nil, *value.Boolean
	}
	return nil, nil
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
			private_notes, resolved_by_membership_id::text, rules_revision, applied_at
		from interaction_resolutions
		where world_id = $1 and interaction_id = $2 and status = 'applied'`, worldID, interactionID,
	).Scan(&item.ID, &item.SelectedActionID, &item.ActionSummary, &item.Narrative, &privateNotes, &item.ResolvedByMembershipID, &item.RulesRevision, &item.ResolvedAt)
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
		select id::text, position, operation, mechanic_id::text, status_name,
			status_description, value_kind, set_number::text, set_boolean, adjustment_amount::text
		from interaction_resolution_effects where world_id = $1 and resolution_id = $2
		order by position`, worldID, item.ID)
	if err != nil {
		return nil, err
	}
	type storedEffect struct {
		Effect     concreteEffectDTO
		Kind       *string
		SetNumber  *string
		SetBoolean *bool
		Adjustment *string
	}
	storedEffects := make([]storedEffect, 0)
	for rows.Next() {
		var stored storedEffect
		var position int
		var mechanicID, statusName, statusDescription *string
		if err := rows.Scan(
			&stored.Effect.ID, &position, &stored.Effect.Type, &mechanicID, &statusName, &statusDescription,
			&stored.Kind, &stored.SetNumber, &stored.SetBoolean, &stored.Adjustment,
		); err != nil {
			rows.Close()
			return nil, err
		}
		if mechanicID != nil {
			stored.Effect.MechanicID = *mechanicID
		}
		if statusName != nil {
			stored.Effect.Status = &statusEffectSpecDTO{
				Name: *statusName, Description: statusDescription, Modifiers: []saveStatusModifierRequest{},
			}
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
			select entity_id::text, status_instance_id::text from interaction_resolution_effect_targets
			where world_id = $1 and effect_id = $2 order by position`, worldID, effect.ID)
		if err != nil {
			return nil, err
		}
		effect.EntityIDs = []string{}
		effect.Targets = []statusEffectTargetDTO{}
		for targetRows.Next() {
			var id string
			var statusInstanceID *string
			if err := targetRows.Scan(&id, &statusInstanceID); err != nil {
				targetRows.Close()
				return nil, err
			}
			if effect.Type == "set" || effect.Type == "adjust-number" {
				effect.EntityIDs = append(effect.EntityIDs, id)
			} else {
				target := statusEffectTargetDTO{EntityID: id}
				if statusInstanceID != nil {
					target.StatusInstanceID = *statusInstanceID
				}
				effect.Targets = append(effect.Targets, target)
			}
		}
		if err := targetRows.Err(); err != nil {
			targetRows.Close()
			return nil, err
		}
		targetRows.Close()
		if effect.Type == "apply-status" {
			modifierRows, err := db.Query(ctx, `
				select id::text, mechanic_id::text, operation, value_kind,
					number_value::text, boolean_value, priority
				from interaction_resolution_status_effect_modifiers
				where world_id = $1 and effect_id = $2 order by position`, worldID, effect.ID)
			if err != nil {
				return nil, err
			}
			for modifierRows.Next() {
				var modifier saveStatusModifierRequest
				var kind string
				var number *string
				var boolean *bool
				if err := modifierRows.Scan(
					&modifier.ID, &modifier.MechanicID, &modifier.Operation, &kind,
					&number, &boolean, &modifier.Priority,
				); err != nil {
					modifierRows.Close()
					return nil, err
				}
				value, err := databaseStateValue(kind, number, boolean)
				if err != nil {
					modifierRows.Close()
					return nil, err
				}
				modifier.Value = stateValueDomainToDTO(value)
				effect.Status.Modifiers = append(effect.Status.Modifiers, modifier)
			}
			if err := modifierRows.Err(); err != nil {
				modifierRows.Close()
				return nil, err
			}
			modifierRows.Close()
		}
		if effect.Type == "set" && stored.Kind != nil {
			value, err := databaseStateValue(*stored.Kind, stored.SetNumber, stored.SetBoolean)
			if err != nil {
				return nil, err
			}
			dto := stateValueDomainToDTO(value)
			effect.Value = &dto
		} else if stored.Adjustment != nil {
			amount, err := rules.ParseDecimal(*stored.Adjustment)
			if err != nil {
				return nil, err
			}
			text := decimalTextFromDomain(amount)
			effect.Amount = &text
		}
		item.Effects = append(item.Effects, effect)
	}

	applicationRows, err := db.Query(ctx, `
		select application.effect_id::text, application.entity_id::text,
			application.mechanic_id::text, effect.operation, application.value_kind, application.changed,
			before_number::text, before_boolean, after_number::text, after_boolean
		from interaction_resolution_effect_applications application
		join interaction_resolution_effects effect
			on effect.id = application.effect_id and effect.resolution_id = application.resolution_id
		where application.world_id = $1 and application.resolution_id = $2
		order by application.position`, worldID, item.ID)
	if err != nil {
		return nil, err
	}
	item.AppliedEffects = make([]concreteAppliedEffectResponse, 0)
	for applicationRows.Next() {
		var application concreteAppliedEffectResponse
		var kind string
		var beforeNumber, afterNumber *string
		var beforeBoolean, afterBoolean *bool
		if err := applicationRows.Scan(&application.EffectID, &application.EntityID, &application.MechanicID, &application.Type, &kind, &application.Changed, &beforeNumber, &beforeBoolean, &afterNumber, &afterBoolean); err != nil {
			applicationRows.Close()
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
	if err := applicationRows.Err(); err != nil {
		applicationRows.Close()
		return nil, err
	}
	applicationRows.Close()

	statusRows, err := db.Query(ctx, `
		select effect_id::text, entity_id::text, operation, status_name,
			status_instance_id::text, changed, before_active, after_active
		from interaction_resolution_status_applications
		where world_id = $1 and resolution_id = $2 order by position`, worldID, item.ID)
	if err != nil {
		return nil, err
	}
	for statusRows.Next() {
		var application concreteAppliedEffectResponse
		var statusInstanceID *string
		var beforeActive, afterActive bool
		if err := statusRows.Scan(
			&application.EffectID, &application.EntityID, &application.Type,
			&application.StatusName, &statusInstanceID,
			&application.Changed, &beforeActive, &afterActive,
		); err != nil {
			statusRows.Close()
			return nil, err
		}
		if statusInstanceID != nil {
			application.StatusInstanceID = *statusInstanceID
		}
		application.ActiveBefore, application.ActiveAfter = &beforeActive, &afterActive
		item.AppliedEffects = append(item.AppliedEffects, application)
	}
	if err := statusRows.Err(); err != nil {
		statusRows.Close()
		return nil, err
	}
	statusRows.Close()

	effectPosition := make(map[string]int, len(item.Effects))
	targetPosition := make(map[string]map[string]int, len(item.Effects))
	for position, effect := range item.Effects {
		effectPosition[effect.ID] = position
		targetPosition[effect.ID] = make(map[string]int, len(effect.EntityIDs)+len(effect.Targets))
		for index, entityID := range effect.EntityIDs {
			targetPosition[effect.ID][entityID] = index
		}
		for index, target := range effect.Targets {
			targetPosition[effect.ID][target.EntityID] = index
		}
	}
	sort.SliceStable(item.AppliedEffects, func(i, j int) bool {
		left, right := item.AppliedEffects[i], item.AppliedEffects[j]
		if effectPosition[left.EffectID] != effectPosition[right.EffectID] {
			return effectPosition[left.EffectID] < effectPosition[right.EffectID]
		}
		return targetPosition[left.EffectID][left.EntityID] < targetPosition[right.EffectID][right.EntityID]
	})

	changeRows, err := db.Query(ctx, `
		select entity_id::text, mechanic_id::text, value_kind,
			before_number::text, before_boolean, after_number::text, after_boolean
		from interaction_resolution_effective_changes
		where world_id = $1 and resolution_id = $2 order by position`, worldID, item.ID)
	if err != nil {
		return nil, err
	}
	item.EffectiveChanges = []effectiveChangeResponse{}
	for changeRows.Next() {
		var change effectiveChangeResponse
		var kind string
		var beforeNumber, afterNumber *string
		var beforeBoolean, afterBoolean *bool
		if err := changeRows.Scan(
			&change.EntityID, &change.MechanicID, &kind,
			&beforeNumber, &beforeBoolean, &afterNumber, &afterBoolean,
		); err != nil {
			changeRows.Close()
			return nil, err
		}
		before, err := databaseStateValue(kind, beforeNumber, beforeBoolean)
		if err != nil {
			changeRows.Close()
			return nil, err
		}
		after, err := databaseStateValue(kind, afterNumber, afterBoolean)
		if err != nil {
			changeRows.Close()
			return nil, err
		}
		change.Before, change.After = stateValueDomainToDTO(before), stateValueDomainToDTO(after)
		item.EffectiveChanges = append(item.EffectiveChanges, change)
	}
	if err := changeRows.Err(); err != nil {
		changeRows.Close()
		return nil, err
	}
	changeRows.Close()
	return &item, nil
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
	result = interactionResolutionResultResponse{
		InteractionID: interactionID, InteractionRevision: revision,
		RulesRevision: receipt.RulesRevision, Narrative: receipt.Narrative,
		AppliedEffects: receipt.AppliedEffects, EffectiveChanges: receipt.EffectiveChanges,
		State: transitionStateResponse{Records: make(map[string]stateRecordResponse)},
	}
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
	if request.ExpectedRulesRevision == nil || *request.ExpectedRulesRevision != receipt.RulesRevision ||
		strings.TrimSpace(request.Narrative) != receipt.Narrative ||
		!optionalTrimmedEqual(request.SelectedActionID, receipt.SelectedActionID) ||
		!optionalTrimmedEqual(cleanOptional(request.ActionSummary), receipt.ActionSummary) ||
		!optionalTrimmedEqual(cleanOptional(request.PrivateNotes), receipt.PrivateNotes) ||
		len(request.Effects) != len(receipt.Effects) {
		return false, nil
	}
	for index := range request.Effects {
		left, right := request.Effects[index], receipt.Effects[index]
		if left.Type != right.Type || left.MechanicID != right.MechanicID ||
			(left.ID != "" && left.ID != right.ID) {
			return false, nil
		}
		switch left.Type {
		case "set":
			if !stringSlicesEqual(uniqueInOrder(left.EntityIDs), right.EntityIDs) {
				return false, nil
			}
			if left.Value == nil || right.Value == nil || !stateDTOEqual(*left.Value, *right.Value) {
				return false, nil
			}
		case "adjust-number":
			if !stringSlicesEqual(uniqueInOrder(left.EntityIDs), right.EntityIDs) {
				return false, nil
			}
			if left.Amount == nil || right.Amount == nil {
				return false, nil
			}
			leftDecimal, leftErr := left.Amount.Decimal()
			if leftErr != nil {
				return false, fmt.Errorf("validated adjustment amount is invalid: %w", leftErr)
			}
			rightDecimal, rightErr := right.Amount.Decimal()
			if rightErr != nil {
				return false, fmt.Errorf("stored adjustment amount is invalid: %w", rightErr)
			}
			if !leftDecimal.Equal(rightDecimal) {
				return false, nil
			}
		case "apply-status":
			if !statusTargetsEqual(left.Targets, right.Targets) || !statusSpecsEqual(left.Status, right.Status) {
				return false, nil
			}
		case "remove-status":
			if !statusTargetsEqual(left.Targets, right.Targets) || left.Status != nil || right.Status != nil {
				return false, nil
			}
		default:
			return false, nil
		}
	}
	return true, nil
}

func statusTargetsEqual(left, right []statusEffectTargetDTO) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].EntityID != right[index].EntityID || left[index].StatusInstanceID != right[index].StatusInstanceID {
			return false
		}
	}
	return true
}

func statusSpecsEqual(left, right *statusEffectSpecDTO) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if strings.TrimSpace(left.Name) != strings.TrimSpace(right.Name) ||
		!optionalTrimmedEqual(left.Description, right.Description) ||
		len(left.Modifiers) != len(right.Modifiers) {
		return false
	}
	for index := range left.Modifiers {
		leftModifier, rightModifier := left.Modifiers[index], right.Modifiers[index]
		if leftModifier.MechanicID != rightModifier.MechanicID ||
			leftModifier.Operation != rightModifier.Operation ||
			leftModifier.Priority != rightModifier.Priority ||
			(leftModifier.ID != "" && leftModifier.ID != rightModifier.ID) ||
			!stateDTOEqual(leftModifier.Value, rightModifier.Value) {
			return false
		}
	}
	return true
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
