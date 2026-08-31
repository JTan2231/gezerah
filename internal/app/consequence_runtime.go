package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"scryer/internal/rules"

	"github.com/jackc/pgx/v5"
)

type inlineStatusDetails struct {
	Name        string
	Description *string
	Modifiers   []statusModifierResponse
}

type consequenceInlineStatuses struct {
	InlineStatuses map[rules.ID]rules.InlineStatus
	Details        map[rules.ID]inlineStatusDetails
}

type consequenceRuntimeInput struct {
	InteractionID  string
	Plan           rules.TransitionPlan
	Entities       map[rules.ID]rules.Entity
	Mechanics      map[rules.ID]rules.MechanicDefinition
	InlineStatuses consequenceInlineStatuses
	Snapshot       rules.RuntimeSnapshot
	StatusSets     map[rules.ID]loadedStatusInstanceSet
	TargetIDs      []rules.ID
	RulesRevision  int64
}

type statusApplicationResult struct {
	EffectID         rules.ID
	EntityID         rules.ID
	StatusInstanceID rules.ID
	StatusName       string
	Operation        rules.EffectOperation
	Changed          bool
	BeforeActive     bool
	AfterActive      bool
}

func effectTargetIDs(items []concreteEffectDTO) []rules.ID {
	set := make(map[rules.ID]struct{})
	for _, effect := range items {
		for _, entityID := range effect.EntityIDs {
			set[rules.ID(entityID)] = struct{}{}
		}
		for _, target := range effect.Targets {
			set[rules.ID(target.EntityID)] = struct{}{}
		}
	}
	result := make([]rules.ID, 0, len(set))
	for entityID := range set {
		result = append(result, entityID)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func loadConsequenceRuntimeInput(
	ctx context.Context,
	db queryer,
	worldID, interactionID string,
	rulesRevision int64,
	items []concreteEffectDTO,
) (consequenceRuntimeInput, error) {
	var result consequenceRuntimeInput
	mechanics, err := loadWorldMechanics(ctx, db, worldID, "")
	if err != nil {
		return result, err
	}
	result.InteractionID = interactionID
	result.Mechanics = mechanicDefinitions(mechanics)
	result.InlineStatuses = consequenceInlineStatuses{
		InlineStatuses: make(map[rules.ID]rules.InlineStatus),
		Details:        make(map[rules.ID]inlineStatusDetails),
	}
	result.RulesRevision = rulesRevision
	result.Plan = rules.TransitionPlan{Effects: make([]rules.ConcreteEffect, len(items))}
	entitySet := make(map[rules.ID]struct{})
	for index, item := range items {
		effectID := item.ID
		if effectID == "" {
			effectID, err = newID()
			if err != nil {
				return result, err
			}
		}
		effect := rules.ConcreteEffect{
			ID: rules.ID(effectID), Position: index, Operation: rules.EffectOperation(item.Type),
			MechanicID: rules.ID(item.MechanicID),
		}
		if effect.Operation == rules.EffectSet || effect.Operation == rules.EffectAdjustNumber {
			for _, entityID := range uniqueInOrder(item.EntityIDs) {
				effect.EntityIDs = append(effect.EntityIDs, rules.ID(entityID))
				entitySet[rules.ID(entityID)] = struct{}{}
			}
		} else {
			for _, target := range item.Targets {
				entityID := rules.ID(target.EntityID)
				effect.EntityIDs = append(effect.EntityIDs, entityID)
				entitySet[entityID] = struct{}{}
			}
		}
		if item.Value != nil {
			value, conversionErr := mechanicValueDTOToDomain(*item.Value)
			if conversionErr != nil {
				return result, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "effect value is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].value", index): conversionErr.Error()}}
			}
			effect.Value = &value
		}
		if item.Amount != nil {
			amount, parseErr := item.Amount.Decimal()
			if parseErr != nil {
				return result, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "effect amount is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].amount", index): "must be a finite exact decimal"}}
			}
			effect.AdjustmentAmount = &amount
		}
		switch effect.Operation {
		case rules.EffectApplyStatus:
			if item.InlineStatus == nil {
				return result, errors.New("validated apply-status Effect is missing its Inline status")
			}
			inlineStatus := rules.InlineStatus{
				ID: rules.ID(effectID), WorldID: rules.ID(worldID),
				Modifiers: make([]rules.StatusModifier, len(item.InlineStatus.Modifiers)),
			}
			details := inlineStatusDetails{
				Name: strings.TrimSpace(item.InlineStatus.Name), Description: cleanOptional(item.InlineStatus.Description),
				Modifiers: make([]statusModifierResponse, len(item.InlineStatus.Modifiers)),
			}
			for modifierIndex, itemModifier := range item.InlineStatus.Modifiers {
				modifierID := itemModifier.ID
				if modifierID == "" {
					modifierID, err = newID()
					if err != nil {
						return result, err
					}
				}
				value, conversionErr := mechanicValueDTOToDomain(itemModifier.Value)
				if conversionErr != nil {
					return result, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "status modifier is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].status.modifiers[%d].value", index, modifierIndex): conversionErr.Error()}}
				}
				inlineStatus.Modifiers[modifierIndex] = rules.StatusModifier{
					ID: rules.ID(modifierID), Position: modifierIndex, Priority: itemModifier.Priority,
					MechanicID: rules.ID(itemModifier.MechanicID),
					Operation:  rules.ModifierOperation(itemModifier.Operation), Value: value,
				}
				details.Modifiers[modifierIndex] = statusModifierResponse{
					ID: modifierID, MechanicID: itemModifier.MechanicID,
					Operation: itemModifier.Operation, Value: mechanicValueDomainToDTO(value),
					Priority: itemModifier.Priority, Position: modifierIndex,
				}
			}
			effect.InlineStatus = &inlineStatus
			effect.StatusInstances = make(map[rules.ID]rules.StatusInstance, len(effect.EntityIDs))
			for _, entityID := range effect.EntityIDs {
				instanceID, idErr := newID()
				if idErr != nil {
					return result, idErr
				}
				effect.StatusInstances[entityID] = rules.StatusInstance{
					ID: rules.ID(instanceID), WorldID: rules.ID(worldID), EntityID: entityID,
					SourceEffectID: effect.ID,
				}
			}
			result.InlineStatuses.InlineStatuses[effect.ID] = inlineStatus
			result.InlineStatuses.Details[effect.ID] = details
		case rules.EffectRemoveStatus:
			effect.StatusInstanceIDs = make(map[rules.ID]rules.ID, len(item.Targets))
			for _, target := range item.Targets {
				effect.StatusInstanceIDs[rules.ID(target.EntityID)] = rules.ID(target.StatusInstanceID)
			}
		case rules.EffectSet, rules.EffectAdjustNumber:
			// Scalar operands were converted above; no Inline status is needed.
		default:
			return result, fmt.Errorf("unsupported effect operation %q", effect.Operation)
		}
		result.Plan.Effects[index] = effect
	}
	result.TargetIDs = make([]rules.ID, 0, len(entitySet))
	for id := range entitySet {
		result.TargetIDs = append(result.TargetIDs, id)
	}
	sort.Slice(result.TargetIDs, func(i, j int) bool { return result.TargetIDs[i] < result.TargetIDs[j] })
	result.Entities = make(map[rules.ID]rules.Entity, len(result.TargetIDs))
	characterStatuses := make(map[rules.ID]string, len(result.TargetIDs))
	result.StatusSets = make(map[rules.ID]loadedStatusInstanceSet, len(result.TargetIDs))
	result.Snapshot = rules.RuntimeSnapshot{
		InputOverrides:  rules.InputOverrideSnapshot{ByEntity: make(map[rules.ID]rules.InputOverrideRecord, len(result.TargetIDs))},
		StatusInstances: []rules.StatusInstance{},
	}
	for _, entityID := range result.TargetIDs {
		entity, entityErr := loadEntityForRules(ctx, db, worldID, string(entityID))
		if errors.Is(entityErr, pgx.ErrNoRows) {
			continue
		}
		if entityErr != nil {
			return result, entityErr
		}
		result.Entities[entityID] = entity
		if !entity.Archived {
			status, _, _, statusErr := entityCharacterStatus(ctx, db, worldID, string(entityID))
			if statusErr != nil {
				return result, statusErr
			}
			characterStatuses[entityID] = status
		}
		record, recordErr := loadInputOverrideRecord(ctx, db, worldID, string(entityID))
		if recordErr != nil {
			return result, recordErr
		}
		result.Snapshot.InputOverrides.ByEntity[entityID] = record
		statusSet, statusErr := loadStatusInstanceSet(ctx, db, worldID, string(entityID))
		if statusErr != nil {
			return result, statusErr
		}
		result.StatusSets[entityID] = statusSet
		result.Snapshot.StatusInstances = append(result.Snapshot.StatusInstances, statusSet.Instances...)
		for sourceEffectID, inlineStatus := range statusSet.InlineStatuses {
			result.InlineStatuses.InlineStatuses[sourceEffectID] = inlineStatus
		}
	}
	if err := consequenceTargetEligibilityError(result.Plan, characterStatuses); err != nil {
		return result, err
	}
	return result, nil
}

func consequenceTargetEligibilityError(plan rules.TransitionPlan, characterStatuses map[rules.ID]string) error {
	errs := make(rules.ValidationErrors, 0)
	for effectIndex, effect := range plan.Effects {
		for entityIndex, entityID := range effect.EntityIDs {
			if characterStatuses[entityID] != "setup-required" {
				continue
			}
			errs = append(errs, rules.ValidationError{
				Code:    "incomplete_entity",
				Path:    fmt.Sprintf("effects[%d].entity_ids[%d]", effectIndex, entityIndex),
				Message: "controlled character setup must be complete",
			})
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return domainTransitionError(&rules.DomainError{Kind: rules.ErrInvalidTransition, Errors: errs})
}

func statusApplicationResults(
	applications []rules.StatusApplication,
	initial map[rules.ID]loadedStatusInstanceSet,
	inlineStatuses consequenceInlineStatuses,
) ([]statusApplicationResult, error) {
	activeNames := make(map[rules.ID]string)
	for _, set := range initial {
		for _, status := range set.Responses {
			activeNames[rules.ID(status.ID)] = status.Name
		}
	}
	results := make([]statusApplicationResult, 0, len(applications))
	for _, application := range applications {
		var name string
		switch application.Operation {
		case rules.EffectApplyStatus:
			details, exists := inlineStatuses.Details[application.SourceEffectID]
			if !exists {
				return nil, fmt.Errorf("inline status %s is missing", application.SourceEffectID)
			}
			name = details.Name
			activeNames[application.StatusInstanceID] = name
		case rules.EffectRemoveStatus:
			var exists bool
			name, exists = activeNames[application.StatusInstanceID]
			if !exists {
				return nil, fmt.Errorf("status instance %s is missing", application.StatusInstanceID)
			}
			delete(activeNames, application.StatusInstanceID)
		case rules.EffectSet, rules.EffectAdjustNumber:
			return nil, fmt.Errorf("scalar operation %s is not a Status Application", application.Operation)
		default:
			return nil, fmt.Errorf("unsupported Status Application %s", application.Operation)
		}
		results = append(results, statusApplicationResult{
			EffectID: application.EffectID, EntityID: application.EntityID,
			StatusInstanceID: application.StatusInstanceID, StatusName: name,
			Operation: application.Operation, Changed: true,
			BeforeActive: application.Operation == rules.EffectRemoveStatus,
			AfterActive:  application.Operation == rules.EffectApplyStatus,
		})
	}
	return results, nil
}

func previewStatusSets(input consequenceRuntimeInput, transition rules.RuntimeTransitionResult) map[rules.ID]loadedStatusInstanceSet {
	changed := make(map[rules.ID]struct{})
	for _, application := range transition.StatusApplications {
		changed[application.EntityID] = struct{}{}
	}
	existingResponses := make(map[rules.ID]statusInstanceResponse)
	existingInlineStatuses := make(map[rules.ID]rules.InlineStatus)
	for _, set := range input.StatusSets {
		for _, response := range set.Responses {
			existingResponses[rules.ID(response.ID)] = response
		}
		for sourceEffectID, inlineStatus := range set.InlineStatuses {
			existingInlineStatuses[sourceEffectID] = inlineStatus
		}
	}
	now := time.Now().UTC()
	result := make(map[rules.ID]loadedStatusInstanceSet, len(input.TargetIDs))
	for _, entityID := range input.TargetIDs {
		initial := input.StatusSets[entityID]
		set := loadedStatusInstanceSet{
			Revision: initial.Revision, Instances: []rules.StatusInstance{},
			InlineStatuses: make(map[rules.ID]rules.InlineStatus),
			Responses:      []statusInstanceResponse{}, Names: make(map[rules.ID]string),
		}
		if _, exists := changed[entityID]; exists {
			set.Revision++
		}
		for _, status := range transition.StatusInstances {
			if status.EntityID != entityID {
				continue
			}
			set.Instances = append(set.Instances, status)
			if response, exists := existingResponses[status.ID]; exists {
				set.Responses = append(set.Responses, response)
				set.InlineStatuses[status.SourceEffectID] = existingInlineStatuses[status.SourceEffectID]
				set.Names[status.SourceEffectID] = response.Name
				continue
			}
			details := input.InlineStatuses.Details[status.SourceEffectID]
			set.Responses = append(set.Responses, statusInstanceResponse{
				ID: string(status.ID), Name: details.Name, Description: details.Description,
				SourceInteractionID: input.InteractionID, SourceEffectID: string(status.SourceEffectID),
				AppliedOrder: status.AppliedOrder, AppliedAt: now, Modifiers: details.Modifiers,
			})
			set.InlineStatuses[status.SourceEffectID] = input.InlineStatuses.InlineStatuses[status.SourceEffectID]
			set.Names[status.SourceEffectID] = details.Name
		}
		result[entityID] = set
	}
	return result
}

func evaluateConsequenceEntities(
	input consequenceRuntimeInput,
	inputOverrides rules.InputOverrideSnapshot,
	statusSets map[rules.ID]loadedStatusInstanceSet,
) (map[rules.ID]rules.EntityEvaluation, error) {
	result := make(map[rules.ID]rules.EntityEvaluation, len(input.TargetIDs))
	for _, entityID := range input.TargetIDs {
		entity, exists := input.Entities[entityID]
		if !exists {
			continue
		}
		record, exists := inputOverrides.ByEntity[entityID]
		if !exists {
			continue
		}
		set := statusSets[entityID]
		evaluated, err := rules.EvaluateEntity(entity, record, input.Mechanics, set.InlineStatuses, set.Instances)
		if err != nil {
			return nil, err
		}
		result[entityID] = evaluated
	}
	return result, nil
}

func consequenceEffectiveChanges(
	input consequenceRuntimeInput,
	before map[rules.ID]rules.EntityEvaluation,
	after map[rules.ID]rules.EntityEvaluation,
) []effectiveChangeResponse {
	result := make([]effectiveChangeResponse, 0)
	for _, entityID := range input.TargetIDs {
		beforeState, beforeExists := before[entityID]
		afterState, afterExists := after[entityID]
		if !beforeExists || !afterExists {
			continue
		}
		result = append(result, effectiveChanges(entityID, beforeState, afterState)...)
	}
	return result
}

func runtimeEffectApplicationsToResponse(
	plan rules.TransitionPlan,
	transition rules.RuntimeTransitionResult,
	statusApplications []statusApplicationResult,
) []effectApplicationResponse {
	scalarByEffect := make(map[rules.ID][]rules.ScalarApplication)
	for _, application := range transition.ScalarApplications {
		scalarByEffect[application.EffectID] = append(scalarByEffect[application.EffectID], application)
	}
	statusByEffect := make(map[rules.ID][]statusApplicationResult)
	for _, application := range statusApplications {
		statusByEffect[application.EffectID] = append(statusByEffect[application.EffectID], application)
	}
	result := make([]effectApplicationResponse, 0, len(transition.ScalarApplications)+len(statusApplications))
	for _, effect := range plan.Effects {
		for _, application := range scalarByEffect[effect.ID] {
			before, after := mechanicValueDomainToDTO(application.Before), mechanicValueDomainToDTO(application.After)
			result = append(result, effectApplicationResponse{
				Type: string(effect.Operation), EffectID: string(effect.ID),
				EntityID: string(application.EntityID), MechanicID: string(application.MechanicID),
				Before: &before, After: &after, Changed: application.Changed,
			})
		}
		for _, application := range statusByEffect[effect.ID] {
			before, after := application.BeforeActive, application.AfterActive
			result = append(result, effectApplicationResponse{
				Type: string(application.Operation), EffectID: string(effect.ID),
				EntityID: string(application.EntityID), StatusInstanceID: string(application.StatusInstanceID),
				StatusName: application.StatusName, ActiveBefore: &before, ActiveAfter: &after,
				Changed: application.Changed,
			})
		}
	}
	return result
}

func buildConsequencePreviewResult(
	interactionID string,
	interactionRevision int64,
	narrative string,
	input consequenceRuntimeInput,
	transition rules.RuntimeTransitionResult,
	statusApplications []statusApplicationResult,
	changes []effectiveChangeResponse,
	statusSets map[rules.ID]loadedStatusInstanceSet,
) (consequenceApplicationResultResponse, error) {
	result := consequenceApplicationResultResponse{
		Preview: true, InteractionID: interactionID, InteractionRevision: interactionRevision,
		RulesRevision: input.RulesRevision, Narrative: narrative,
		Applications:     runtimeEffectApplicationsToResponse(input.Plan, transition, statusApplications),
		EffectiveChanges: changes,
		EntitySheets:     make(map[string]entitySheetResponse, len(input.TargetIDs)),
	}
	changedEntities := make(map[rules.ID]struct{}, len(transition.ChangedEntityIDs))
	for _, entityID := range transition.ChangedEntityIDs {
		changedEntities[entityID] = struct{}{}
	}
	for _, entityID := range input.TargetIDs {
		entity, exists := input.Entities[entityID]
		if !exists {
			continue
		}
		record := transition.InputOverrides.ByEntity[entityID]
		if _, changed := changedEntities[entityID]; changed {
			record.Revision++
		}
		response, err := buildEntitySheetResponse(entity, record, input.Mechanics, input.RulesRevision, statusSets[entityID])
		if err != nil {
			return consequenceApplicationResultResponse{}, err
		}
		result.EntitySheets[string(entityID)] = response
	}
	return result, nil
}

func persistStatusApplications(
	ctx context.Context,
	tx pgx.Tx,
	worldID, resolutionID string,
	applications []rules.StatusApplication,
	inlineStatuses consequenceInlineStatuses,
) error {
	changedEntities := make(map[rules.ID]struct{})
	for _, application := range applications {
		switch application.Operation {
		case rules.EffectApplyStatus:
			details, exists := inlineStatuses.Details[application.SourceEffectID]
			if !exists {
				return fmt.Errorf("inline status %s is missing", application.SourceEffectID)
			}
			if _, err := tx.Exec(ctx, `
				insert into entity_status_instances
					(id, world_id, entity_id, source_resolution_id, source_effect_id,
					 status_name, status_description)
				values ($1, $2, $3, $4, $5, $6, $7)`,
				application.StatusInstanceID, worldID, application.EntityID, resolutionID,
				application.SourceEffectID, details.Name, details.Description); err != nil {
				return err
			}
			for _, modifier := range details.Modifiers {
				number, boolean := mechanicValueDTOColumns(modifier.Value)
				if _, err := tx.Exec(ctx, `
					insert into entity_status_instance_modifiers
						(status_instance_id, world_id, entity_id, source_resolution_id,
						 source_effect_id, source_modifier_id, position, priority, operation,
						 mechanic_id, value_kind, number_value, boolean_value)
					values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
					application.StatusInstanceID, worldID, application.EntityID, resolutionID,
					application.SourceEffectID, modifier.ID, modifier.Position, modifier.Priority,
					modifier.Operation, modifier.MechanicID, modifier.Value.Kind, number, boolean); err != nil {
					return err
				}
			}
		case rules.EffectRemoveStatus:
			commandTag, err := tx.Exec(ctx, `
				update entity_status_instances
				set status = 'removed', removed_at = now()
				where world_id = $1 and entity_id = $2 and id = $3 and status = 'active'`,
				worldID, application.EntityID, application.StatusInstanceID)
			if err != nil {
				return err
			}
			if commandTag.RowsAffected() != 1 {
				return errors.New("status instance changed while the resolution was being committed")
			}
		case rules.EffectSet, rules.EffectAdjustNumber:
			return fmt.Errorf("scalar operation %s is not a Status Application", application.Operation)
		default:
			return fmt.Errorf("unsupported Status Application %s", application.Operation)
		}
		changedEntities[application.EntityID] = struct{}{}
	}
	entityIDs := make([]rules.ID, 0, len(changedEntities))
	for entityID := range changedEntities {
		entityIDs = append(entityIDs, entityID)
	}
	sort.Slice(entityIDs, func(i, j int) bool { return entityIDs[i] < entityIDs[j] })
	for _, entityID := range entityIDs {
		if _, err := tx.Exec(ctx, `
			update entity_status_sets set revision = revision + 1
			where world_id = $1 and entity_id = $2`, worldID, entityID); err != nil {
			return err
		}
	}
	return nil
}

func insertRuntimeResolutionEffects(
	ctx context.Context,
	tx pgx.Tx,
	worldID, resolutionID string,
	plan rules.TransitionPlan,
	transition rules.RuntimeTransitionResult,
	statusApplications []statusApplicationResult,
	inlineStatuses consequenceInlineStatuses,
) error {
	scalarByEffect := make(map[rules.ID][]rules.ScalarApplication)
	for _, application := range transition.ScalarApplications {
		scalarByEffect[application.EffectID] = append(scalarByEffect[application.EffectID], application)
	}
	statusByEffect := make(map[rules.ID][]statusApplicationResult)
	for _, application := range statusApplications {
		statusByEffect[application.EffectID] = append(statusByEffect[application.EffectID], application)
	}
	scalarPosition, statusPosition := 0, 0
	for _, effect := range plan.Effects {
		var mechanicID, valueKind, setNumber, setBoolean, adjustment, statusName, statusDescription any
		switch effect.Operation {
		case rules.EffectSet:
			mechanicID = effect.MechanicID
			valueKind = effect.Value.Kind
			if effect.Value.Kind == rules.ValueNumber {
				setNumber = effect.Value.Number.String()
			} else {
				setBoolean = *effect.Value.Boolean
			}
		case rules.EffectAdjustNumber:
			mechanicID = effect.MechanicID
			valueKind = rules.ValueNumber
			adjustment = effect.AdjustmentAmount.String()
		case rules.EffectApplyStatus:
			details := inlineStatuses.Details[effect.ID]
			statusName, statusDescription = details.Name, details.Description
		case rules.EffectRemoveStatus:
			// Removal effects carry their status instance on each target row.
		default:
			return fmt.Errorf("unsupported effect operation %q", effect.Operation)
		}
		if _, err := tx.Exec(ctx, `
			insert into interaction_resolution_effects
				(id, resolution_id, world_id, position, operation, mechanic_id,
				 value_kind, set_number, set_boolean, adjustment_amount, status_name, status_description)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			effect.ID, resolutionID, worldID, effect.Position, effect.Operation,
			mechanicID, valueKind, setNumber, setBoolean, adjustment, statusName, statusDescription); err != nil {
			return err
		}
		if effect.Operation == rules.EffectApplyStatus {
			for _, modifier := range inlineStatuses.Details[effect.ID].Modifiers {
				number, boolean := mechanicValueDTOColumns(modifier.Value)
				if _, err := tx.Exec(ctx, `
					insert into interaction_resolution_inline_status_modifiers
						(id, effect_id, resolution_id, world_id, position, priority, operation,
						 mechanic_id, value_kind, number_value, boolean_value)
					values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
					modifier.ID, effect.ID, resolutionID, worldID, modifier.Position, modifier.Priority,
					modifier.Operation, modifier.MechanicID, modifier.Value.Kind, number, boolean); err != nil {
					return err
				}
			}
		}
		for position, entityID := range effect.EntityIDs {
			var statusInstanceID any
			if effect.Operation == rules.EffectRemoveStatus {
				statusInstanceID = effect.StatusInstanceIDs[entityID]
			}
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_effect_targets
					(effect_id, resolution_id, world_id, entity_id, position, effect_operation, status_instance_id)
				values ($1, $2, $3, $4, $5, $6, $7)`,
				effect.ID, resolutionID, worldID, entityID, position, effect.Operation, statusInstanceID); err != nil {
				return err
			}
		}
		for _, application := range scalarByEffect[effect.ID] {
			applicationID, err := newID()
			if err != nil {
				return err
			}
			beforeNumber, beforeBoolean := mechanicValueDatabaseColumns(application.Before)
			afterNumber, afterBoolean := mechanicValueDatabaseColumns(application.After)
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_scalar_applications
					(id, resolution_id, effect_id, world_id, mechanic_id, value_kind,
					 entity_id, position, changed, before_number, before_boolean,
					 after_number, after_boolean)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
				applicationID, resolutionID, effect.ID, worldID, application.MechanicID,
				application.Before.Kind, application.EntityID, scalarPosition, application.Changed,
				beforeNumber, beforeBoolean, afterNumber, afterBoolean); err != nil {
				return err
			}
			scalarPosition++
		}
		for _, application := range statusByEffect[effect.ID] {
			applicationID, err := newID()
			if err != nil {
				return err
			}
			var targetStatusInstanceID any
			if application.Operation == rules.EffectRemoveStatus {
				targetStatusInstanceID = application.StatusInstanceID
			}
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_status_applications
					(id, resolution_id, effect_id, world_id, entity_id, status_name,
					 status_instance_id, target_status_instance_id, position, operation,
					 changed, before_active, after_active)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
				applicationID, resolutionID, effect.ID, worldID, application.EntityID,
				application.StatusName, application.StatusInstanceID, targetStatusInstanceID,
				statusPosition, application.Operation, application.Changed,
				application.BeforeActive, application.AfterActive); err != nil {
				return err
			}
			statusPosition++
		}
	}
	return nil
}

func insertEffectiveChanges(
	ctx context.Context,
	tx pgx.Tx,
	worldID, resolutionID string,
	changes []effectiveChangeResponse,
) error {
	for position, change := range changes {
		before, err := mechanicValueDTOToDomain(change.Before)
		if err != nil {
			return err
		}
		after, err := mechanicValueDTOToDomain(change.After)
		if err != nil {
			return err
		}
		beforeNumber, beforeBoolean := mechanicValueDatabaseColumns(before)
		afterNumber, afterBoolean := mechanicValueDatabaseColumns(after)
		if _, err := tx.Exec(ctx, `
			insert into interaction_resolution_effective_changes
				(resolution_id, world_id, entity_id, mechanic_id, value_kind, position,
				 before_number, before_boolean, after_number, after_boolean)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			resolutionID, worldID, change.EntityID, change.MechanicID, before.Kind, position,
			beforeNumber, beforeBoolean, afterNumber, afterBoolean); err != nil {
			return err
		}
	}
	return nil
}

func mechanicValueDTOColumns(value mechanicValueDTO) (any, any) {
	if value.Kind == string(rules.ValueNumber) && value.Number != nil {
		return value.Number.String(), nil
	}
	if value.Kind == string(rules.ValueBoolean) && value.Boolean != nil {
		return nil, *value.Boolean
	}
	return nil, nil
}
