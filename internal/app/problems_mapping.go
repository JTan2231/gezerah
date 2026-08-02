package app

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"dnd/internal/rules"
)

func problemRequestToDomain(request saveProblemDefinitionRequest, ruleSetID string, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ProblemDefinition, error) {
	if request.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ProblemDefinition{}, err
		}
		request.ID = generated
	}
	problem := rules.ProblemDefinition{
		ID:                     rules.ID(request.ID),
		RuleSetID:              rules.ID(ruleSetID),
		Key:                    strings.TrimSpace(request.Key),
		Name:                   strings.TrimSpace(request.Name),
		InstanceOwnerSchemaIDs: stringIDs(uniqueSorted(request.InstanceOwnerSchemaIDs)),
		Archived:               request.Archived,
	}
	if request.Description != nil {
		problem.Description = strings.TrimSpace(*request.Description)
	}
	for position, target := range request.Targets {
		if target.ID == "" {
			generated, err := newID()
			if err != nil {
				return problem, err
			}
			target.ID = generated
		}
		converted := rules.ProblemTargetDefinition{
			ID:                     rules.ID(target.ID),
			Key:                    strings.TrimSpace(target.Key),
			Label:                  strings.TrimSpace(target.Label),
			Cardinality:            rules.Cardinality(target.Cardinality),
			MinimumBindings:        target.MinimumBindings,
			MaximumBindings:        target.MaximumBindings,
			BindingSource:          rules.BindingSource(target.BindingSource),
			RequiredOwnerSchemaIDs: stringIDs(uniqueSorted(target.RequiredOwnerSchemaIDs)),
			Position:               position,
		}
		if target.Description != nil {
			converted.Description = strings.TrimSpace(*target.Description)
		}
		problem.Targets = append(problem.Targets, converted)
	}
	if request.AvailableWhen != nil {
		converted, convertErr := invocationDTOToDomain(*request.AvailableWhen)
		if convertErr != nil {
			return problem, fmt.Errorf("available_when: %w", convertErr)
		}
		problem.AvailableWhen = &converted
	}
	for position, choice := range request.Choices {
		converted, convertErr := choiceDTOToDomain(choice, position, definitions)
		if convertErr != nil {
			return problem, fmt.Errorf("choices[%d]: %w", position, convertErr)
		}
		problem.Choices = append(problem.Choices, converted)
	}
	return problem, nil
}

func invocationDTOToDomain(invocation conditionInvocationDTO) (rules.ConditionInvocation, error) {
	if invocation.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ConditionInvocation{}, err
		}
		invocation.ID = generated
	}
	result := rules.ConditionInvocation{
		ID:             rules.ID(invocation.ID),
		ConditionSetID: rules.ID(invocation.ConditionSetID),
		Arguments:      make([]rules.ConditionInvocationArgument, 0, len(invocation.Arguments)),
	}
	for _, argument := range invocation.Arguments {
		result.Arguments = append(result.Arguments, rules.ConditionInvocationArgument{
			ParameterID:        rules.ID(argument.ParameterID),
			TargetDefinitionID: rules.ID(argument.TargetDefinitionID),
		})
	}
	return result, nil
}

func choiceDTOToDomain(choice problemChoiceDTO, position int, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ChoiceDefinition, error) {
	if choice.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ChoiceDefinition{}, err
		}
		choice.ID = generated
	}
	result := rules.ChoiceDefinition{
		ID:          rules.ID(choice.ID),
		Key:         strings.TrimSpace(choice.Key),
		Name:        strings.TrimSpace(choice.Name),
		Position:    position,
		Description: optionalStringValue(choice.Description),
	}
	if choice.AvailableWhen != nil {
		converted, err := invocationDTOToDomain(*choice.AvailableWhen)
		if err != nil {
			return result, fmt.Errorf("available_when: %w", err)
		}
		result.AvailableWhen = &converted
	}
	resolution, err := resolutionDTOToDomain(choice.Resolution, definitions)
	if err != nil {
		return result, fmt.Errorf("resolution: %w", err)
	}
	result.Resolution = resolution
	return result, nil
}

func resolutionDTOToDomain(resolution choiceResolutionDTO, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ChoiceResolution, error) {
	result := rules.ChoiceResolution{Type: rules.ResolutionType(resolution.Type)}
	switch result.Type {
	case rules.ResolutionAutomatic:
		if resolution.Outcome == nil || resolution.Invocation != nil || resolution.Met != nil || resolution.Unmet != nil {
			return result, errors.New("automatic resolution requires only outcome")
		}
		outcome, err := outcomeDTOToDomain(*resolution.Outcome, rules.OutcomeAutomatic, definitions)
		if err != nil {
			return result, fmt.Errorf("outcome: %w", err)
		}
		result.Automatic = &outcome
	case rules.ResolutionCondition:
		if resolution.Invocation == nil || resolution.Outcome != nil || resolution.Met == nil || resolution.Unmet == nil {
			return result, errors.New("conditional resolution requires invocation, met, and unmet")
		}
		invocation, err := invocationDTOToDomain(*resolution.Invocation)
		if err != nil {
			return result, fmt.Errorf("invocation: %w", err)
		}
		met, err := outcomeDTOToDomain(*resolution.Met, rules.OutcomeMet, definitions)
		if err != nil {
			return result, fmt.Errorf("met: %w", err)
		}
		unmet, err := outcomeDTOToDomain(*resolution.Unmet, rules.OutcomeUnmet, definitions)
		if err != nil {
			return result, fmt.Errorf("unmet: %w", err)
		}
		result.Invocation, result.Met, result.Unmet = &invocation, &met, &unmet
	default:
		return result, fmt.Errorf("unsupported resolution type %q", resolution.Type)
	}
	return result, nil
}

func outcomeDTOToDomain(outcome choiceOutcomeDTO, branch rules.OutcomeBranch, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ChoiceOutcome, error) {
	if outcome.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ChoiceOutcome{}, err
		}
		outcome.ID = generated
	}
	if outcome.Consequences.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.ChoiceOutcome{}, err
		}
		outcome.Consequences.ID = generated
	}
	result := rules.ChoiceOutcome{
		ID:     rules.ID(outcome.ID),
		Branch: branch,
		Label:  strings.TrimSpace(outcome.Label),
		Consequences: rules.ConsequenceSet{
			ID:      rules.ID(outcome.Consequences.ID),
			Effects: make([]rules.Effect, 0, len(outcome.Consequences.Effects)),
		},
	}
	for position, effect := range outcome.Consequences.Effects {
		converted, err := effectDTOToDomain(effect, position, definitions)
		if err != nil {
			return result, fmt.Errorf("consequences.effects[%d]: %w", position, err)
		}
		result.Consequences.Effects = append(result.Consequences.Effects, converted)
	}
	return result, nil
}

func effectDTOToDomain(effect stateEffectDTO, position int, definitions map[rules.ID]rules.StateVariableDefinition) (rules.Effect, error) {
	if effect.ID == "" {
		generated, err := newID()
		if err != nil {
			return rules.Effect{}, err
		}
		effect.ID = generated
	}
	result := rules.Effect{
		ID:                 rules.ID(effect.ID),
		Position:           position,
		Operation:          rules.EffectOperation(effect.Type),
		TargetDefinitionID: rules.ID(effect.TargetDefinitionID),
		StateVariableID:    rules.ID(effect.StateVariableID),
	}
	definition, exists := definitions[result.StateVariableID]
	if !exists {
		return result, fmt.Errorf("state_variable_id %q does not exist", effect.StateVariableID)
	}
	switch result.Operation {
	case rules.EffectSet:
		if effect.Value == nil || effect.Amount != nil {
			return result, errors.New("set requires value and does not accept amount")
		}
		value, err := stateValueDTOToDomain(*effect.Value, definition)
		if err != nil {
			return result, err
		}
		result.Operand = &value
	case rules.EffectClear:
		if effect.Value != nil || effect.Amount != nil {
			return result, errors.New("clear accepts neither value nor amount")
		}
	case rules.EffectAdjustNumber:
		if effect.Value != nil || effect.Amount == nil {
			return result, errors.New("adjust-number requires amount and does not accept value")
		}
		amount, err := rules.ParseDecimal(effect.Amount.String())
		if err != nil {
			return result, err
		}
		result.AdjustmentAmount = &amount
	case rules.EffectAddValue, rules.EffectRemoveValue:
		if effect.Value == nil || effect.Amount != nil || effect.Value.Many || len(effect.Value.Values) != 1 {
			return result, errors.New("add-value and remove-value require one scalar value and do not accept amount")
		}
		scalar, err := scalarDTOToDomain(effect.Value.Values[0], definition)
		if err != nil {
			return result, err
		}
		value := rules.NewSingleValue(scalar)
		result.Operand = &value
	default:
		return result, fmt.Errorf("unsupported effect type %q", effect.Type)
	}
	return result, nil
}

func problemToResponse(problem rules.ProblemDefinition, definitions map[rules.ID]rules.StateVariableDefinition) problemDefinitionResponse {
	response := problemDefinitionResponse{
		ID:                     string(problem.ID),
		Key:                    problem.Key,
		Name:                   problem.Name,
		InstanceOwnerSchemaIDs: idsToStrings(problem.InstanceOwnerSchemaIDs),
		Targets:                make([]problemTargetDTO, 0, len(problem.Targets)),
		Choices:                make([]problemChoiceDTO, 0, len(problem.Choices)),
		Archived:               problem.Archived,
		CreatedAt:              problem.CreatedAt,
		UpdatedAt:              problem.UpdatedAt,
	}
	if problem.Description != "" {
		response.Description = &problem.Description
	}
	targets := append([]rules.ProblemTargetDefinition(nil), problem.Targets...)
	sort.Slice(targets, func(i, j int) bool { return targets[i].Position < targets[j].Position })
	for _, target := range targets {
		item := problemTargetDTO{
			ID:                     string(target.ID),
			Key:                    target.Key,
			Label:                  target.Label,
			Cardinality:            string(target.Cardinality),
			MinimumBindings:        target.MinimumBindings,
			MaximumBindings:        target.MaximumBindings,
			BindingSource:          string(target.BindingSource),
			RequiredOwnerSchemaIDs: idsToStrings(target.RequiredOwnerSchemaIDs),
		}
		if target.Description != "" {
			item.Description = &target.Description
		}
		response.Targets = append(response.Targets, item)
	}
	response.AvailableWhen = invocationDomainToDTO(problem.AvailableWhen)
	choices := append([]rules.ChoiceDefinition(nil), problem.Choices...)
	sort.Slice(choices, func(i, j int) bool { return choices[i].Position < choices[j].Position })
	for _, choice := range choices {
		response.Choices = append(response.Choices, choiceDomainToDTO(choice, definitions))
	}
	return response
}

func invocationDomainToDTO(invocation *rules.ConditionInvocation) *conditionInvocationDTO {
	if invocation == nil {
		return nil
	}
	result := &conditionInvocationDTO{
		ID:             string(invocation.ID),
		ConditionSetID: string(invocation.ConditionSetID),
		Arguments:      make([]conditionInvocationArgumentDTO, 0, len(invocation.Arguments)),
	}
	for _, argument := range invocation.Arguments {
		result.Arguments = append(result.Arguments, conditionInvocationArgumentDTO{
			ParameterID:        string(argument.ParameterID),
			TargetDefinitionID: string(argument.TargetDefinitionID),
		})
	}
	return result
}

func choiceDomainToDTO(choice rules.ChoiceDefinition, definitions map[rules.ID]rules.StateVariableDefinition) problemChoiceDTO {
	result := problemChoiceDTO{
		ID:            string(choice.ID),
		Key:           choice.Key,
		Name:          choice.Name,
		AvailableWhen: invocationDomainToDTO(choice.AvailableWhen),
		Resolution:    resolutionDomainToDTO(choice.Resolution, definitions),
	}
	if choice.Description != "" {
		result.Description = &choice.Description
	}
	return result
}

func resolutionDomainToDTO(resolution rules.ChoiceResolution, definitions map[rules.ID]rules.StateVariableDefinition) choiceResolutionDTO {
	result := choiceResolutionDTO{Type: string(resolution.Type)}
	if resolution.Type == rules.ResolutionAutomatic {
		result.Outcome = outcomeDomainToDTO(resolution.Automatic, definitions)
	} else {
		result.Invocation = invocationDomainToDTO(resolution.Invocation)
		result.Met = outcomeDomainToDTO(resolution.Met, definitions)
		result.Unmet = outcomeDomainToDTO(resolution.Unmet, definitions)
	}
	return result
}

func outcomeDomainToDTO(outcome *rules.ChoiceOutcome, definitions map[rules.ID]rules.StateVariableDefinition) *choiceOutcomeDTO {
	if outcome == nil {
		return nil
	}
	result := &choiceOutcomeDTO{
		ID:    string(outcome.ID),
		Label: outcome.Label,
		Consequences: consequenceSetDTO{
			ID:      string(outcome.Consequences.ID),
			Effects: make([]stateEffectDTO, 0, len(outcome.Consequences.Effects)),
		},
	}
	effects := append([]rules.Effect(nil), outcome.Consequences.Effects...)
	sort.Slice(effects, func(i, j int) bool { return effects[i].Position < effects[j].Position })
	for _, effect := range effects {
		result.Consequences.Effects = append(result.Consequences.Effects, effectDomainToDTO(effect, definitions))
	}
	return result
}

func effectDomainToDTO(effect rules.Effect, definitions map[rules.ID]rules.StateVariableDefinition) stateEffectDTO {
	result := stateEffectDTO{
		ID:                 string(effect.ID),
		Type:               string(effect.Operation),
		TargetDefinitionID: string(effect.TargetDefinitionID),
		StateVariableID:    string(effect.StateVariableID),
	}
	if effect.AdjustmentAmount != nil {
		result.Amount = decimalJSON(effect.AdjustmentAmount)
	}
	if effect.Operand != nil {
		definition := definitions[effect.StateVariableID]
		value := stateValueDomainToDTO(*effect.Operand, definition)
		result.Value = &value
	}
	return result
}

func duplicateProblemDomain(original rules.ProblemDefinition, key, name string) (rules.ProblemDefinition, error) {
	copy := original
	rootID, err := newID()
	if err != nil {
		return copy, err
	}
	copy.ID = rules.ID(rootID)
	copy.Key, copy.Name, copy.Archived = strings.TrimSpace(key), strings.TrimSpace(name), false
	copy.CreatedAt, copy.UpdatedAt = time.Time{}, time.Time{}
	targetIDs := make(map[rules.ID]rules.ID, len(original.Targets))
	copy.Targets = make([]rules.ProblemTargetDefinition, len(original.Targets))
	for i, target := range original.Targets {
		id, generateErr := newID()
		if generateErr != nil {
			return copy, generateErr
		}
		targetIDs[target.ID] = rules.ID(id)
		target.ID = rules.ID(id)
		target.RequiredOwnerSchemaIDs = append([]rules.ID(nil), target.RequiredOwnerSchemaIDs...)
		copy.Targets[i] = target
	}
	cloneInvocation := func(source *rules.ConditionInvocation) (*rules.ConditionInvocation, error) {
		if source == nil {
			return nil, nil
		}
		id, generateErr := newID()
		if generateErr != nil {
			return nil, generateErr
		}
		cloned := *source
		cloned.ID = rules.ID(id)
		cloned.Arguments = append([]rules.ConditionInvocationArgument(nil), source.Arguments...)
		for index := range cloned.Arguments {
			cloned.Arguments[index].TargetDefinitionID = targetIDs[cloned.Arguments[index].TargetDefinitionID]
		}
		return &cloned, nil
	}
	copy.AvailableWhen, err = cloneInvocation(original.AvailableWhen)
	if err != nil {
		return copy, err
	}
	copy.Choices = make([]rules.ChoiceDefinition, len(original.Choices))
	for i, choice := range original.Choices {
		choiceID, generateErr := newID()
		if generateErr != nil {
			return copy, generateErr
		}
		choice.ID = rules.ID(choiceID)
		choice.AvailableWhen, err = cloneInvocation(choice.AvailableWhen)
		if err != nil {
			return copy, err
		}
		choice.Resolution.Invocation, err = cloneInvocation(choice.Resolution.Invocation)
		if err != nil {
			return copy, err
		}
		for _, outcome := range []*rules.ChoiceOutcome{choice.Resolution.Automatic, choice.Resolution.Met, choice.Resolution.Unmet} {
			if outcome == nil {
				continue
			}
			outcomeID, generateErr := newID()
			if generateErr != nil {
				return copy, generateErr
			}
			consequenceID, generateErr := newID()
			if generateErr != nil {
				return copy, generateErr
			}
			cloned := *outcome
			cloned.ID = rules.ID(outcomeID)
			cloned.Consequences.ID = rules.ID(consequenceID)
			cloned.Consequences.Effects = make([]rules.Effect, len(outcome.Consequences.Effects))
			for effectIndex, effect := range outcome.Consequences.Effects {
				effectID, idErr := newID()
				if idErr != nil {
					return copy, idErr
				}
				effect.ID = rules.ID(effectID)
				effect.TargetDefinitionID = targetIDs[effect.TargetDefinitionID]
				if effect.Operand != nil {
					operand := rules.CloneStateValue(*effect.Operand)
					effect.Operand = &operand
				}
				cloned.Consequences.Effects[effectIndex] = effect
			}
			switch cloned.Branch {
			case rules.OutcomeAutomatic:
				choice.Resolution.Automatic = &cloned
			case rules.OutcomeMet:
				choice.Resolution.Met = &cloned
			case rules.OutcomeUnmet:
				choice.Resolution.Unmet = &cloned
			}
		}
		copy.Choices[i] = choice
	}
	return copy, nil
}

func optionalStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func validateProblemUUIDs(problem rules.ProblemDefinition) map[string]string {
	fields := make(map[string]string)
	check := func(path string, id rules.ID) {
		if !validID(string(id)) {
			fields[path] = "must be a UUID"
		}
	}
	check("id", problem.ID)
	for i, id := range problem.InstanceOwnerSchemaIDs {
		check(fmt.Sprintf("instance_owner_schema_ids[%d]", i), id)
	}
	for _, target := range problem.Targets {
		base := "targets[" + string(target.ID) + "]"
		check(base+".id", target.ID)
		for i, id := range target.RequiredOwnerSchemaIDs {
			check(fmt.Sprintf("%s.required_owner_schema_ids[%d]", base, i), id)
		}
	}
	validateInvocationUUIDs := func(path string, invocation *rules.ConditionInvocation) {
		if invocation == nil {
			return
		}
		check(path+".id", invocation.ID)
		check(path+".condition_set_id", invocation.ConditionSetID)
		for i, argument := range invocation.Arguments {
			check(fmt.Sprintf("%s.arguments[%d].parameter_id", path, i), argument.ParameterID)
			check(fmt.Sprintf("%s.arguments[%d].target_definition_id", path, i), argument.TargetDefinitionID)
		}
	}
	validateInvocationUUIDs("available_when", problem.AvailableWhen)
	for _, choice := range problem.Choices {
		base := "choices[" + string(choice.ID) + "]"
		check(base+".id", choice.ID)
		validateInvocationUUIDs(base+".available_when", choice.AvailableWhen)
		validateInvocationUUIDs(base+".resolution.invocation", choice.Resolution.Invocation)
		for branch, outcome := range map[string]*rules.ChoiceOutcome{
			"automatic": choice.Resolution.Automatic, "met": choice.Resolution.Met, "unmet": choice.Resolution.Unmet,
		} {
			if outcome == nil {
				continue
			}
			path := base + ".resolution." + branch
			check(path+".id", outcome.ID)
			check(path+".consequences.id", outcome.Consequences.ID)
			for _, effect := range outcome.Consequences.Effects {
				effectPath := path + ".consequences.effects[" + string(effect.ID) + "]"
				check(effectPath+".id", effect.ID)
				check(effectPath+".target_definition_id", effect.TargetDefinitionID)
				check(effectPath+".state_variable_id", effect.StateVariableID)
			}
		}
	}
	return fields
}

// archivedProblemReferenceFields distinguishes an existing stable reference
// from a newly selected dependency. Archived resources remain usable by the
// aggregate children that already reference them, but a new child ID (or an
// existing child redirected to a different dependency) cannot select one.
func archivedProblemReferenceFields(
	proposed, current rules.ProblemDefinition,
	schemas map[rules.ID]rules.OwnerSchema,
	definitions map[rules.ID]rules.StateVariableDefinition,
	conditions map[rules.ID]rules.ConditionSet,
) map[string]string {
	fields := make(map[string]string)
	currentInstanceSchemas := idSetForProblemMapping(current.InstanceOwnerSchemaIDs)
	for index, schemaID := range proposed.InstanceOwnerSchemaIDs {
		if schema, exists := schemas[schemaID]; exists && schema.Archived {
			if _, retained := currentInstanceSchemas[schemaID]; !retained {
				fields[fmt.Sprintf("instance_owner_schema_ids[%d]", index)] = "archived owner schemas cannot receive new references"
			}
		}
	}

	currentTargets := make(map[rules.ID]rules.ProblemTargetDefinition, len(current.Targets))
	proposedTargets := make(map[rules.ID]rules.ProblemTargetDefinition, len(proposed.Targets))
	for _, target := range current.Targets {
		currentTargets[target.ID] = target
	}
	for _, target := range proposed.Targets {
		proposedTargets[target.ID] = target
		retainedSchemas := idSetForProblemMapping(currentTargets[target.ID].RequiredOwnerSchemaIDs)
		for index, schemaID := range target.RequiredOwnerSchemaIDs {
			if schema, exists := schemas[schemaID]; exists && schema.Archived {
				if _, retained := retainedSchemas[schemaID]; !retained {
					fields[fmt.Sprintf("targets[%s].required_owner_schema_ids[%d]", target.ID, index)] = "archived owner schemas cannot receive new references"
				}
			}
		}
	}

	currentInvocations := make(map[rules.ID]rules.ID)
	visitInvocationsWithPath(current, func(_ string, invocation rules.ConditionInvocation) {
		currentInvocations[invocation.ID] = invocation.ConditionSetID
	})
	visitInvocationsWithPath(proposed, func(path string, invocation rules.ConditionInvocation) {
		condition, exists := conditions[invocation.ConditionSetID]
		if !exists || !condition.Archived {
			return
		}
		if previous, retained := currentInvocations[invocation.ID]; !retained || previous != invocation.ConditionSetID {
			fields[path+".condition_set_id"] = "archived condition sets cannot receive new invocations"
		}
	})

	currentEffects := make(map[rules.ID]rules.Effect)
	visitEffectsWithPath(current, func(_ string, effect rules.Effect) { currentEffects[effect.ID] = effect })
	visitEffectsWithPath(proposed, func(path string, effect rules.Effect) {
		previous, retained := currentEffects[effect.ID]
		retained = retained && previous.StateVariableID == effect.StateVariableID && previous.TargetDefinitionID == effect.TargetDefinitionID
		definition, definitionExists := definitions[effect.StateVariableID]
		if definitionExists && definition.Archived && !retained {
			fields[path+".state_variable_id"] = "archived state variables cannot receive new effects"
		}
		if retained || !definitionExists {
			return
		}
		target, targetExists := proposedTargets[effect.TargetDefinitionID]
		if !targetExists {
			return
		}
		definitionSchemas := idSetForProblemMapping(definition.OwnerSchemaIDs)
		compatibleSchemas := 0
		allCompatibleSchemasArchived := true
		for _, schemaID := range target.RequiredOwnerSchemaIDs {
			if _, compatible := definitionSchemas[schemaID]; !compatible {
				continue
			}
			compatibleSchemas++
			if schema, exists := schemas[schemaID]; !exists || !schema.Archived {
				allCompatibleSchemasArchived = false
			}
		}
		if compatibleSchemas > 0 && allCompatibleSchemasArchived {
			fields[path+".target_definition_id"] = "new effects cannot depend exclusively on archived owner schemas"
		}
	})
	return fields
}

func idSetForProblemMapping(ids []rules.ID) map[rules.ID]struct{} {
	result := make(map[rules.ID]struct{}, len(ids))
	for _, id := range ids {
		result[id] = struct{}{}
	}
	return result
}

func visitInvocationsWithPath(problem rules.ProblemDefinition, visit func(string, rules.ConditionInvocation)) {
	if problem.AvailableWhen != nil {
		visit("available_when", *problem.AvailableWhen)
	}
	for _, choice := range problem.Choices {
		base := "choices[" + string(choice.ID) + "]"
		if choice.AvailableWhen != nil {
			visit(base+".available_when", *choice.AvailableWhen)
		}
		if choice.Resolution.Invocation != nil {
			visit(base+".resolution.invocation", *choice.Resolution.Invocation)
		}
	}
}

func visitEffectsWithPath(problem rules.ProblemDefinition, visit func(string, rules.Effect)) {
	for _, choice := range problem.Choices {
		choicePath := "choices[" + string(choice.ID) + "].resolution"
		for branch, outcome := range map[string]*rules.ChoiceOutcome{
			"outcome": choice.Resolution.Automatic,
			"met":     choice.Resolution.Met,
			"unmet":   choice.Resolution.Unmet,
		} {
			if outcome == nil {
				continue
			}
			for _, effect := range outcome.Consequences.Effects {
				visit(choicePath+"."+branch+".consequences.effects["+string(effect.ID)+"]", effect)
			}
		}
	}
}

func bindingsDTOToDomain(values []problemTargetBindingDTO, problem rules.ProblemDefinition, instanceID rules.ID) (rules.TargetBindings, error) {
	targets := make(map[rules.ID]rules.ProblemTargetDefinition, len(problem.Targets))
	result := make(rules.TargetBindings, len(problem.Targets))
	for _, target := range problem.Targets {
		targets[target.ID] = target
		if target.BindingSource == rules.BindingProblemInstance {
			result[target.ID] = []rules.ID{instanceID}
		}
	}
	seen := make(map[rules.ID]struct{}, len(values))
	for i, binding := range values {
		targetID := rules.ID(binding.TargetDefinitionID)
		target, exists := targets[targetID]
		if !exists {
			return nil, fmt.Errorf("bindings[%d].target_definition_id does not belong to the problem", i)
		}
		if target.BindingSource != rules.BindingSupplied {
			return nil, fmt.Errorf("bindings[%d] must not supply the automatic problem-instance target", i)
		}
		if _, duplicate := seen[targetID]; duplicate {
			return nil, fmt.Errorf("bindings[%d] repeats a target", i)
		}
		seen[targetID] = struct{}{}
		entityIDs := make([]rules.ID, len(binding.EntityIDs))
		for index, entityID := range binding.EntityIDs {
			if !validID(entityID) {
				return nil, fmt.Errorf("bindings[%d].entity_ids[%d] must be a UUID", i, index)
			}
			entityIDs[index] = rules.ID(entityID)
		}
		result[targetID] = entityIDs
	}
	for _, target := range problem.Targets {
		if target.BindingSource == rules.BindingSupplied {
			if _, exists := seen[target.ID]; !exists {
				return nil, fmt.Errorf("binding for supplied target %q is required", target.ID)
			}
		}
	}
	return result, nil
}

func problemEvaluationToDTO(evaluation rules.ConditionEvaluation, definitions map[rules.ID]rules.StateVariableDefinition) conditionEvaluationDTO {
	missing := make([]stateAddressDTO, 0, len(evaluation.MissingValues))
	for _, address := range evaluation.MissingValues {
		missing = append(missing, stateAddressDTO{EntityID: string(address.EntityID), StateVariableID: string(address.StateVariableID)})
	}
	return conditionEvaluationDTO{
		ConditionSetID: string(evaluation.ConditionSetID),
		Status:         string(evaluation.Status),
		Root:           problemEvaluationNodeToDTO(evaluation.Root, definitions),
		MissingValues:  missing,
	}
}

func problemEvaluationNodeToDTO(node rules.ConditionEvaluationNode, definitions map[rules.ID]rules.StateVariableDefinition) conditionEvaluationNodeDTO {
	result := conditionEvaluationNodeDTO{
		ExpressionID:  string(node.ExpressionID),
		Status:        string(node.Status),
		Message:       node.Message,
		EntityResults: make([]conditionEntityResultDTO, 0, len(node.EntityResults)),
		Children:      make([]conditionEvaluationNodeDTO, 0, len(node.Children)),
	}
	if node.ParameterID != "" {
		parameterID := string(node.ParameterID)
		result.ParameterID = &parameterID
	}
	for _, entityResult := range node.EntityResults {
		item := conditionEntityResultDTO{
			EntityID: string(entityResult.EntityID), Status: string(entityResult.Status),
			Address: stateAddressDTO{EntityID: string(entityResult.Address.EntityID), StateVariableID: string(entityResult.Address.StateVariableID)},
		}
		if entityResult.Actual != nil {
			definition := definitions[entityResult.Address.StateVariableID]
			actual := stateValueDomainToDTO(*entityResult.Actual, definition)
			item.Actual = &actual
		}
		result.EntityResults = append(result.EntityResults, item)
	}
	for _, child := range node.Children {
		result.Children = append(result.Children, problemEvaluationNodeToDTO(child, definitions))
	}
	return result
}

func resolutionResultToDTO(result rules.ResolutionResult, preview bool, entities map[rules.ID]rules.Entity, definitions map[rules.ID]rules.StateVariableDefinition) choiceResolutionResultDTO {
	response := choiceResolutionResultDTO{
		Status:                  string(result.Status),
		Preview:                 preview,
		ProblemDefinitionID:     string(result.ProblemDefinitionID),
		ProblemInstanceID:       string(result.ProblemInstanceID),
		ChoiceID:                string(result.ChoiceID),
		OutcomeID:               string(result.OutcomeID),
		AvailabilityEvaluations: make([]conditionEvaluationDTO, 0, len(result.AvailabilityEvaluations)),
		Evaluations:             make([]conditionEvaluationDTO, 0, len(result.IncompleteEvaluations)),
		AppliedEffects:          make([]appliedEffectDTO, 0, len(result.AppliedEffects)),
	}
	for _, evaluation := range result.AvailabilityEvaluations {
		response.AvailabilityEvaluations = append(response.AvailabilityEvaluations, problemEvaluationToDTO(evaluation, definitions))
	}
	if result.ResolutionEvaluation != nil {
		evaluation := problemEvaluationToDTO(*result.ResolutionEvaluation, definitions)
		response.ResolutionEvaluation = &evaluation
	}
	for _, evaluation := range result.IncompleteEvaluations {
		response.Evaluations = append(response.Evaluations, problemEvaluationToDTO(evaluation, definitions))
	}
	for _, effect := range result.AppliedEffects {
		item := appliedEffectDTO{
			EffectID: string(effect.EffectID), TargetDefinitionID: string(effect.TargetDefinitionID),
			EntityID: string(effect.EntityID), StateVariableID: string(effect.StateVariableID), Changed: effect.Changed,
		}
		definition := definitions[effect.StateVariableID]
		if effect.Before != nil {
			before := stateValueDomainToDTO(*effect.Before, definition)
			item.Before = &before
		}
		if effect.After != nil {
			after := stateValueDomainToDTO(*effect.After, definition)
			item.After = &after
		}
		response.AppliedEffects = append(response.AppliedEffects, item)
	}
	if result.Status == rules.ResolutionApplied {
		bindingRevision := result.BindingRevision
		response.BindingRevision = &bindingRevision
		response.State = &resolutionStateDTO{Records: make(map[string]stateRecordResponse, len(result.State.Records))}
		for entityID, record := range result.State.Records {
			entity, exists := entities[entityID]
			if !exists {
				continue
			}
			logical := rules.MaterializeLogicalState(entity, record, definitions)
			state := stateRecordResponse{
				OwnerEntityID: string(entityID), Revision: record.Revision, UpdatedAt: record.UpdatedAt,
				Values:                 make(map[string]stateValueDTO, len(logical.Values)),
				DefaultedDefinitionIDs: idsToStrings(logical.DefaultedDefinitionIDs),
				UnknownDefinitionIDs:   idsToStrings(logical.UnknownDefinitionIDs),
			}
			for definitionID, value := range logical.Values {
				state.Values[string(definitionID)] = stateValueDomainToDTO(value, definitions[definitionID])
			}
			response.State.Records[string(entityID)] = state
		}
	}
	return response
}

func domainRuntimeError(err error) error {
	var domain *rules.DomainError
	if !errors.As(err, &domain) {
		return err
	}
	status := http.StatusUnprocessableEntity
	code := "resolution_failed"
	if errors.Is(err, rules.ErrInvalidDefinition) {
		code = "invalid_definition"
	} else if errors.Is(err, rules.ErrInvalidBindings) {
		code = "invalid_bindings"
	} else if errors.Is(err, rules.ErrInvalidState) {
		code = "invalid_state"
	} else if errors.Is(err, rules.ErrEffectApplication) {
		code = "effect_application_failed"
	}
	fields := make(map[string]string, len(domain.Errors))
	for _, item := range domain.Errors {
		fields[item.Path] = item.Message
	}
	return &statusError{Status: status, Code: code, Message: domain.Error(), Fields: fields}
}
