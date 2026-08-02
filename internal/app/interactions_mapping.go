package app

import (
	"errors"
	"fmt"
	"strings"

	"dnd/internal/rules"
)

func concreteEffectsDTOToDomain(items []concreteEffectDTO, definitions map[rules.ID]rules.StateVariableDefinition) ([]rules.ConcreteEffect, error) {
	result := make([]rules.ConcreteEffect, 0, len(items))
	for position, item := range items {
		converted, err := concreteEffectDTOToDomain(item, position, definitions)
		if err != nil {
			return nil, fmt.Errorf("effects[%d]: %w", position, err)
		}
		result = append(result, converted)
	}
	return result, nil
}

func concreteEffectDTOToDomain(item concreteEffectDTO, position int, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ConcreteEffect, error) {
	if item.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ConcreteEffect{}, err
		}
		item.ID = generated
	}
	if !validID(item.ID) {
		return rules.ConcreteEffect{}, errors.New("effect ID must be a UUID")
	}
	if len(item.EntityIDs) == 0 {
		return rules.ConcreteEffect{}, errors.New("at least one entity_id is required")
	}
	entityIDs := make([]rules.ID, len(item.EntityIDs))
	seen := make(map[string]struct{}, len(item.EntityIDs))
	for index, id := range item.EntityIDs {
		if !validID(id) {
			return rules.ConcreteEffect{}, fmt.Errorf("entity_ids[%d] must be a UUID", index)
		}
		if _, duplicate := seen[id]; duplicate {
			return rules.ConcreteEffect{}, fmt.Errorf("entity_ids[%d] repeats an entity", index)
		}
		seen[id] = struct{}{}
		entityIDs[index] = rules.ID(id)
	}
	result := rules.ConcreteEffect{
		ID:              rules.ID(item.ID),
		Position:        position,
		Operation:       rules.EffectOperation(item.Type),
		EntityIDs:       entityIDs,
		StateVariableID: rules.ID(item.StateVariableID),
	}
	definition, exists := definitions[result.StateVariableID]
	if !exists {
		return result, fmt.Errorf("state_variable_id %q does not exist", item.StateVariableID)
	}
	if definition.Archived {
		return result, fmt.Errorf("state_variable_id %q is archived", item.StateVariableID)
	}
	switch result.Operation {
	case rules.EffectSet:
		if item.Value == nil || item.Amount != nil {
			return result, errors.New("set requires value and does not accept amount")
		}
		value, err := stateValueDTOToDomain(*item.Value, definition)
		if err != nil {
			return result, err
		}
		result.Operand = &value
	case rules.EffectClear:
		if item.Value != nil || item.Amount != nil {
			return result, errors.New("clear accepts neither value nor amount")
		}
	case rules.EffectAdjustNumber:
		if item.Value != nil || item.Amount == nil {
			return result, errors.New("adjust-number requires amount and does not accept value")
		}
		amount, err := rules.ParseDecimal(item.Amount.String())
		if err != nil {
			return result, err
		}
		result.AdjustmentAmount = &amount
	case rules.EffectAddValue, rules.EffectRemoveValue:
		if item.Value == nil || item.Amount != nil || item.Value.Many || len(item.Value.Values) != 1 {
			return result, errors.New("add-value and remove-value require one scalar value and do not accept amount")
		}
		scalar, err := scalarDTOToDomain(item.Value.Values[0], definition)
		if err != nil {
			return result, err
		}
		value := rules.NewSingleValue(scalar)
		result.Operand = &value
	default:
		return result, fmt.Errorf("unsupported effect type %q", item.Type)
	}
	return result, nil
}

func concreteEffectDomainToDTO(effect rules.ConcreteEffect, definitions map[rules.ID]rules.StateVariableDefinition) concreteEffectDTO {
	result := concreteEffectDTO{
		ID:              string(effect.ID),
		Type:            string(effect.Operation),
		EntityIDs:       idsToStrings(effect.EntityIDs),
		StateVariableID: string(effect.StateVariableID),
	}
	if effect.AdjustmentAmount != nil {
		result.Amount = decimalJSON(effect.AdjustmentAmount)
	}
	if effect.Operand != nil {
		value := stateValueDomainToDTO(*effect.Operand, definitions[effect.StateVariableID])
		result.Value = &value
	}
	return result
}

func validateAdjudicationRequest(request *adjudicateInteractionRequest, requireIdempotency bool) map[string]string {
	fields := make(map[string]string)
	if request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "a non-negative expected revision is required"
	}
	request.Narrative = strings.TrimSpace(request.Narrative)
	if request.Narrative == "" {
		fields["narrative"] = "public narrative is required"
	} else if len(request.Narrative) > 20000 {
		fields["narrative"] = "must be 20000 characters or fewer"
	}
	request.ActionSummary = cleanOptional(request.ActionSummary)
	request.PrivateNotes = cleanOptional(request.PrivateNotes)
	request.SelectedActionID = cleanOptional(request.SelectedActionID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if requireIdempotency && request.IdempotencyKey == "" {
		fields["idempotency_key"] = "an idempotency key is required"
	} else if len(request.IdempotencyKey) > 200 {
		fields["idempotency_key"] = "must be 200 characters or fewer"
	}
	if request.ActionSummary != nil && len(*request.ActionSummary) > 10000 {
		fields["action_summary"] = "must be 10000 characters or fewer"
	}
	if request.PrivateNotes != nil && len(*request.PrivateNotes) > 20000 {
		fields["private_notes"] = "must be 20000 characters or fewer"
	}
	if request.SelectedActionID != nil && !validID(*request.SelectedActionID) {
		fields["selected_action_id"] = "must be a UUID"
	}
	return fields
}
