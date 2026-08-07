package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

type statusEffectSnapshot struct {
	Name        string
	Description *string
	Modifiers   []statusModifierResponse
}

type resolutionStatusConfiguration struct {
	Snapshots map[rules.ID]rules.StatusSnapshot
	Responses map[rules.ID]statusEffectSnapshot
}

type resolutionRuntimeInput struct {
	InteractionID string
	Plan          rules.TransitionPlan
	Entities      map[rules.ID]rules.Entity
	Mechanics     map[rules.ID]rules.MechanicDefinition
	Statuses      resolutionStatusConfiguration
	Snapshot      rules.RuntimeSnapshot
	StatusSets    map[rules.ID]loadedStatusSet
	TargetIDs     []rules.ID
	RulesRevision int64
}

type statusApplicationReceipt struct {
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

func loadResolutionRuntimeInput(
	ctx context.Context,
	db queryer,
	worldID, interactionID string,
	rulesRevision int64,
	items []concreteEffectDTO,
) (resolutionRuntimeInput, error) {
	var result resolutionRuntimeInput
	mechanics, err := loadWorldMechanics(ctx, db, worldID, "")
	if err != nil {
		return result, err
	}
	result.InteractionID = interactionID
	result.Mechanics = mechanicDefinitions(mechanics)
	result.Statuses = resolutionStatusConfiguration{
		Snapshots: make(map[rules.ID]rules.StatusSnapshot),
		Responses: make(map[rules.ID]statusEffectSnapshot),
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
			value, conversionErr := stateValueDTOToDomain(*item.Value)
			if conversionErr != nil {
				return result, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "effect value is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].value", index): conversionErr.Error()}}
			}
			effect.Value = &value
		}
		if item.Amount != nil {
			amount, parseErr := rules.ParseDecimal(item.Amount.String())
			if parseErr != nil {
				return result, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "effect amount is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].amount", index): "must be a finite exact decimal"}}
			}
			effect.AdjustmentAmount = &amount
		}
		switch effect.Operation {
		case rules.EffectApplyStatus:
			if item.Status == nil {
				return result, errors.New("validated apply-status effect is missing its status")
			}
			snapshot := rules.StatusSnapshot{
				ID: rules.ID(effectID), WorldID: rules.ID(worldID),
				Modifiers: make([]rules.StatusModifier, len(item.Status.Modifiers)),
			}
			response := statusEffectSnapshot{
				Name: strings.TrimSpace(item.Status.Name), Description: cleanOptional(item.Status.Description),
				Modifiers: make([]statusModifierResponse, len(item.Status.Modifiers)),
			}
			for modifierIndex, itemModifier := range item.Status.Modifiers {
				modifierID := itemModifier.ID
				if modifierID == "" {
					modifierID, err = newID()
					if err != nil {
						return result, err
					}
				}
				value, conversionErr := stateValueDTOToDomain(itemModifier.Value)
				if conversionErr != nil {
					return result, &statusError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "status modifier is invalid", Fields: map[string]string{fmt.Sprintf("effects[%d].status.modifiers[%d].value", index, modifierIndex): conversionErr.Error()}}
				}
				snapshot.Modifiers[modifierIndex] = rules.StatusModifier{
					ID: rules.ID(modifierID), Position: modifierIndex, Priority: itemModifier.Priority,
					MechanicID: rules.ID(itemModifier.MechanicID),
					Operation:  rules.ModifierOperation(itemModifier.Operation), Value: value,
				}
				response.Modifiers[modifierIndex] = statusModifierResponse{
					ID: modifierID, MechanicID: itemModifier.MechanicID,
					Operation: itemModifier.Operation, Value: itemModifier.Value,
					Priority: itemModifier.Priority, Position: modifierIndex,
				}
			}
			effect.Status = &snapshot
			effect.StatusInstances = make(map[rules.ID]rules.ActiveStatus, len(effect.EntityIDs))
			for _, entityID := range effect.EntityIDs {
				instanceID, idErr := newID()
				if idErr != nil {
					return result, idErr
				}
				effect.StatusInstances[entityID] = rules.ActiveStatus{
					ID: rules.ID(instanceID), WorldID: rules.ID(worldID), EntityID: entityID,
					SourceEffectID: effect.ID,
				}
			}
			result.Statuses.Snapshots[effect.ID] = snapshot
			result.Statuses.Responses[effect.ID] = response
		case rules.EffectRemoveStatus:
			effect.StatusInstanceIDs = make(map[rules.ID]rules.ID, len(item.Targets))
			for _, target := range item.Targets {
				effect.StatusInstanceIDs[rules.ID(target.EntityID)] = rules.ID(target.StatusInstanceID)
			}
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
	result.StatusSets = make(map[rules.ID]loadedStatusSet, len(result.TargetIDs))
	result.Snapshot = rules.RuntimeSnapshot{
		State:          rules.StateSnapshot{Records: make(map[rules.ID]rules.StateRecord, len(result.TargetIDs))},
		ActiveStatuses: []rules.ActiveStatus{},
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
		record, recordErr := loadStoredStateRecord(ctx, db, worldID, string(entityID))
		if recordErr != nil {
			return result, recordErr
		}
		result.Snapshot.State.Records[entityID] = record
		statusSet, statusErr := loadActiveStatusSet(ctx, db, worldID, string(entityID))
		if statusErr != nil {
			return result, statusErr
		}
		result.StatusSets[entityID] = statusSet
		result.Snapshot.ActiveStatuses = append(result.Snapshot.ActiveStatuses, statusSet.Active...)
		for sourceEffectID, snapshot := range statusSet.Snapshots {
			result.Statuses.Snapshots[sourceEffectID] = snapshot
		}
	}
	if err := resolutionTargetEligibilityError(result.Plan, characterStatuses); err != nil {
		return result, err
	}
	return result, nil
}

func resolutionTargetEligibilityError(plan rules.TransitionPlan, characterStatuses map[rules.ID]string) error {
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

func statusReceipts(
	commands []rules.AppliedStatusCommand,
	initial map[rules.ID]loadedStatusSet,
	configuration resolutionStatusConfiguration,
) ([]statusApplicationReceipt, error) {
	activeNames := make(map[rules.ID]string)
	for _, set := range initial {
		for _, status := range set.Responses {
			activeNames[rules.ID(status.ID)] = status.Name
		}
	}
	receipts := make([]statusApplicationReceipt, 0, len(commands))
	for _, command := range commands {
		var name string
		switch command.Operation {
		case rules.EffectApplyStatus:
			configured, exists := configuration.Responses[command.SourceEffectID]
			if !exists {
				return nil, fmt.Errorf("inline status snapshot %s is missing", command.SourceEffectID)
			}
			name = configured.Name
			activeNames[command.StatusInstanceID] = name
		case rules.EffectRemoveStatus:
			var exists bool
			name, exists = activeNames[command.StatusInstanceID]
			if !exists {
				return nil, fmt.Errorf("active status instance %s is missing", command.StatusInstanceID)
			}
			delete(activeNames, command.StatusInstanceID)
		default:
			return nil, fmt.Errorf("unsupported status command %s", command.Operation)
		}
		receipts = append(receipts, statusApplicationReceipt{
			EffectID: command.EffectID, EntityID: command.EntityID,
			StatusInstanceID: command.StatusInstanceID, StatusName: name,
			Operation: command.Operation, Changed: true,
			BeforeActive: command.Operation == rules.EffectRemoveStatus,
			AfterActive:  command.Operation == rules.EffectApplyStatus,
		})
	}
	return receipts, nil
}

func previewStatusSets(input resolutionRuntimeInput, transition rules.RuntimeTransitionResult) map[rules.ID]loadedStatusSet {
	changed := make(map[rules.ID]struct{})
	for _, command := range transition.AppliedStatusCommands {
		changed[command.EntityID] = struct{}{}
	}
	existingResponses := make(map[rules.ID]activeStatusResponse)
	existingSnapshots := make(map[rules.ID]rules.StatusSnapshot)
	for _, set := range input.StatusSets {
		for _, response := range set.Responses {
			existingResponses[rules.ID(response.ID)] = response
		}
		for sourceEffectID, snapshot := range set.Snapshots {
			existingSnapshots[sourceEffectID] = snapshot
		}
	}
	now := time.Now().UTC()
	result := make(map[rules.ID]loadedStatusSet, len(input.TargetIDs))
	for _, entityID := range input.TargetIDs {
		initial := input.StatusSets[entityID]
		set := loadedStatusSet{
			Revision: initial.Revision, Active: []rules.ActiveStatus{},
			Snapshots: make(map[rules.ID]rules.StatusSnapshot),
			Responses: []activeStatusResponse{}, Names: make(map[rules.ID]string),
		}
		if _, exists := changed[entityID]; exists {
			set.Revision++
		}
		for _, status := range transition.ActiveStatuses {
			if status.EntityID != entityID {
				continue
			}
			set.Active = append(set.Active, status)
			if response, exists := existingResponses[status.ID]; exists {
				set.Responses = append(set.Responses, response)
				set.Snapshots[status.SourceEffectID] = existingSnapshots[status.SourceEffectID]
				set.Names[status.SourceEffectID] = response.Name
				continue
			}
			configured := input.Statuses.Responses[status.SourceEffectID]
			set.Responses = append(set.Responses, activeStatusResponse{
				ID: string(status.ID), Name: configured.Name, Description: configured.Description,
				SourceInteractionID: input.InteractionID, SourceEffectID: string(status.SourceEffectID),
				AppliedOrder: status.AppliedOrder, AppliedAt: now, Modifiers: configured.Modifiers,
			})
			set.Snapshots[status.SourceEffectID] = input.Statuses.Snapshots[status.SourceEffectID]
			set.Names[status.SourceEffectID] = configured.Name
		}
		result[entityID] = set
	}
	return result
}

func evaluateResolutionStates(
	input resolutionRuntimeInput,
	state rules.StateSnapshot,
	statusSets map[rules.ID]loadedStatusSet,
) (map[rules.ID]rules.EvaluatedState, error) {
	result := make(map[rules.ID]rules.EvaluatedState, len(input.TargetIDs))
	for _, entityID := range input.TargetIDs {
		entity, exists := input.Entities[entityID]
		if !exists {
			continue
		}
		record, exists := state.Records[entityID]
		if !exists {
			continue
		}
		set := statusSets[entityID]
		evaluated, err := rules.EvaluateEntityState(entity, record, input.Mechanics, set.Snapshots, set.Active)
		if err != nil {
			return nil, err
		}
		result[entityID] = evaluated
	}
	return result, nil
}

func resolutionEffectiveChanges(
	input resolutionRuntimeInput,
	before map[rules.ID]rules.EvaluatedState,
	after map[rules.ID]rules.EvaluatedState,
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

func runtimeAppliedEffectsToResponse(
	plan rules.TransitionPlan,
	transition rules.RuntimeTransitionResult,
	statusApplications []statusApplicationReceipt,
) []concreteAppliedEffectResponse {
	scalarByEffect := make(map[rules.ID][]rules.AppliedEffect)
	for _, application := range transition.AppliedEffects {
		scalarByEffect[application.EffectID] = append(scalarByEffect[application.EffectID], application)
	}
	statusByEffect := make(map[rules.ID][]statusApplicationReceipt)
	for _, application := range statusApplications {
		statusByEffect[application.EffectID] = append(statusByEffect[application.EffectID], application)
	}
	result := make([]concreteAppliedEffectResponse, 0, len(transition.AppliedEffects)+len(statusApplications))
	for _, effect := range plan.Effects {
		for _, application := range scalarByEffect[effect.ID] {
			before, after := stateValueDomainToDTO(application.Before), stateValueDomainToDTO(application.After)
			result = append(result, concreteAppliedEffectResponse{
				Type: string(effect.Operation), EffectID: string(effect.ID),
				EntityID: string(application.EntityID), MechanicID: string(application.MechanicID),
				Before: &before, After: &after, Changed: application.Changed,
			})
		}
		for _, application := range statusByEffect[effect.ID] {
			before, after := application.BeforeActive, application.AfterActive
			result = append(result, concreteAppliedEffectResponse{
				Type: string(application.Operation), EffectID: string(effect.ID),
				EntityID: string(application.EntityID), StatusInstanceID: string(application.StatusInstanceID),
				StatusName: application.StatusName, ActiveBefore: &before, ActiveAfter: &after,
				Changed: application.Changed,
			})
		}
	}
	return result
}

func previewRuntimeResult(
	interactionID string,
	interactionRevision int64,
	narrative string,
	input resolutionRuntimeInput,
	transition rules.RuntimeTransitionResult,
	statusApplications []statusApplicationReceipt,
	changes []effectiveChangeResponse,
	statusSets map[rules.ID]loadedStatusSet,
) (interactionResolutionResultResponse, error) {
	result := interactionResolutionResultResponse{
		Preview: true, InteractionID: interactionID, InteractionRevision: interactionRevision,
		RulesRevision: input.RulesRevision, Narrative: narrative,
		AppliedEffects:   runtimeAppliedEffectsToResponse(input.Plan, transition, statusApplications),
		EffectiveChanges: changes,
		State:            transitionStateResponse{Records: make(map[string]stateRecordResponse, len(input.TargetIDs))},
	}
	changedRecords := make(map[rules.ID]struct{}, len(transition.ChangedRecordIDs))
	for _, entityID := range transition.ChangedRecordIDs {
		changedRecords[entityID] = struct{}{}
	}
	for _, entityID := range input.TargetIDs {
		entity, exists := input.Entities[entityID]
		if !exists {
			continue
		}
		record := transition.State.Records[entityID]
		if _, changed := changedRecords[entityID]; changed {
			record.Revision++
		}
		response, err := evaluatedStateResponse(entity, record, input.Mechanics, input.RulesRevision, statusSets[entityID])
		if err != nil {
			return interactionResolutionResultResponse{}, err
		}
		result.State.Records[string(entityID)] = response
	}
	return result, nil
}

func persistStatusCommands(
	ctx context.Context,
	tx pgx.Tx,
	worldID, resolutionID string,
	commands []rules.AppliedStatusCommand,
	configuration resolutionStatusConfiguration,
) error {
	changedEntities := make(map[rules.ID]struct{})
	for _, command := range commands {
		switch command.Operation {
		case rules.EffectApplyStatus:
			configured, exists := configuration.Responses[command.SourceEffectID]
			if !exists {
				return fmt.Errorf("inline status snapshot %s is missing", command.SourceEffectID)
			}
			if _, err := tx.Exec(ctx, `
				insert into entity_status_instances
					(id, world_id, entity_id, source_resolution_id, source_effect_id,
					 status_name, status_description)
				values ($1, $2, $3, $4, $5, $6, $7)`,
				command.StatusInstanceID, worldID, command.EntityID, resolutionID,
				command.SourceEffectID, configured.Name, configured.Description); err != nil {
				return err
			}
			for _, modifier := range configured.Modifiers {
				number, boolean := stateValueDTOColumns(modifier.Value)
				if _, err := tx.Exec(ctx, `
					insert into entity_status_instance_modifiers
						(status_instance_id, world_id, entity_id, source_resolution_id,
						 source_effect_id, source_modifier_id, position, priority, operation,
						 mechanic_id, value_kind, number_value, boolean_value)
					values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
					command.StatusInstanceID, worldID, command.EntityID, resolutionID,
					command.SourceEffectID, modifier.ID, modifier.Position, modifier.Priority,
					modifier.Operation, modifier.MechanicID, modifier.Value.Kind, number, boolean); err != nil {
					return err
				}
			}
		case rules.EffectRemoveStatus:
			commandTag, err := tx.Exec(ctx, `
				update entity_status_instances
				set status = 'removed', removed_at = now()
				where world_id = $1 and entity_id = $2 and id = $3 and status = 'active'`,
				worldID, command.EntityID, command.StatusInstanceID)
			if err != nil {
				return err
			}
			if commandTag.RowsAffected() != 1 {
				return errors.New("active status changed while resolution was being applied")
			}
		default:
			return fmt.Errorf("unsupported status command %s", command.Operation)
		}
		changedEntities[command.EntityID] = struct{}{}
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
	statusApplications []statusApplicationReceipt,
	configuration resolutionStatusConfiguration,
) error {
	scalarByEffect := make(map[rules.ID][]rules.AppliedEffect)
	for _, application := range transition.AppliedEffects {
		scalarByEffect[application.EffectID] = append(scalarByEffect[application.EffectID], application)
	}
	statusByEffect := make(map[rules.ID][]statusApplicationReceipt)
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
			configured := configuration.Responses[effect.ID]
			statusName, statusDescription = configured.Name, configured.Description
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
			for _, modifier := range configuration.Responses[effect.ID].Modifiers {
				number, boolean := stateValueDTOColumns(modifier.Value)
				if _, err := tx.Exec(ctx, `
					insert into interaction_resolution_status_effect_modifiers
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
			beforeNumber, beforeBoolean := stateValueDatabaseColumns(application.Before)
			afterNumber, afterBoolean := stateValueDatabaseColumns(application.After)
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_effect_applications
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

func insertEffectiveChangeReceipts(
	ctx context.Context,
	tx pgx.Tx,
	worldID, resolutionID string,
	changes []effectiveChangeResponse,
) error {
	for position, change := range changes {
		before, err := stateValueDTOToDomain(change.Before)
		if err != nil {
			return err
		}
		after, err := stateValueDTOToDomain(change.After)
		if err != nil {
			return err
		}
		beforeNumber, beforeBoolean := stateValueDatabaseColumns(before)
		afterNumber, afterBoolean := stateValueDatabaseColumns(after)
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

func stateValueDTOColumns(value stateValueDTO) (any, any) {
	if value.Kind == string(rules.ValueNumber) && value.Number != nil {
		return value.Number.String(), nil
	}
	if value.Kind == string(rules.ValueBoolean) && value.Boolean != nil {
		return nil, *value.Boolean
	}
	return nil, nil
}
