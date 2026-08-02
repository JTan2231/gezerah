package rules

func ResolveChoice(input ResolutionInput) (ResolutionResult, error) {
	if errs := ValidateProblemDefinition(input.Problem, input.OwnerSchemas, input.Definitions, input.Conditions, input.Entities); len(errs) > 0 {
		return ResolutionResult{}, domainError(ErrInvalidDefinition, errs)
	}
	bindings := input.Bindings
	if bindings == nil {
		bindings = input.Instance.Bindings
	}
	instance := input.Instance
	instance.Bindings = bindings
	if errs := ValidateProblemInstance(input.Problem, instance, input.Entities); len(errs) > 0 {
		return ResolutionResult{}, domainError(ErrInvalidBindings, errs)
	}
	if errs := ValidateSnapshot(input.Snapshot, input.Entities, input.Definitions); len(errs) > 0 {
		return ResolutionResult{}, domainError(ErrInvalidState, errs)
	}
	choice, exists := findChoice(input.Problem.Choices, input.ChoiceID)
	if !exists {
		return ResolutionResult{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("unknown_choice", "choice_id", "choice does not belong to the problem definition")})
	}

	result := ResolutionResult{
		ProblemDefinitionID:     input.Problem.ID,
		ProblemInstanceID:       input.Instance.ID,
		ChoiceID:                choice.ID,
		BindingRevision:         input.Instance.BindingRevision,
		AvailabilityEvaluations: []ConditionEvaluation{},
		IncompleteEvaluations:   []ConditionEvaluation{},
		AppliedEffects:          []AppliedEffect{},
		ChangedRecordIDs:        []ID{},
	}

	availability := []*ConditionInvocation{input.Problem.AvailableWhen, choice.AvailableWhen}
	availabilityUnknown := make([]ConditionEvaluation, 0, len(availability))
	unavailable := false
	for _, invocation := range availability {
		if invocation == nil {
			continue
		}
		evaluation, err := evaluateInvocation(*invocation, input, bindings)
		if err != nil {
			return ResolutionResult{}, err
		}
		result.AvailabilityEvaluations = append(result.AvailabilityEvaluations, evaluation)
		switch evaluation.Status {
		case ConditionUnmet:
			unavailable = true
		case ConditionUnknown:
			availabilityUnknown = append(availabilityUnknown, evaluation)
		}
	}
	// Availability is a conjunction. Evaluate every authored guard so an unmet
	// guard can dominate an earlier unknown guard and the explanation remains
	// complete and deterministic.
	if unavailable {
		result.Status = ResolutionUnavailable
		return result, nil
	}
	if len(availabilityUnknown) > 0 {
		result.Status = ResolutionIncomplete
		result.IncompleteEvaluations = append(result.IncompleteEvaluations, availabilityUnknown...)
		return result, nil
	}

	var outcome *ChoiceOutcome
	switch choice.Resolution.Type {
	case ResolutionAutomatic:
		outcome = choice.Resolution.Automatic
	case ResolutionCondition:
		evaluation, err := evaluateInvocation(*choice.Resolution.Invocation, input, bindings)
		if err != nil {
			return ResolutionResult{}, err
		}
		result.ResolutionEvaluation = &evaluation
		switch evaluation.Status {
		case ConditionMet:
			outcome = choice.Resolution.Met
		case ConditionUnmet:
			outcome = choice.Resolution.Unmet
		case ConditionUnknown:
			result.Status = ResolutionIncomplete
			result.IncompleteEvaluations = append(result.IncompleteEvaluations, evaluation)
			return result, nil
		}
	default:
		return ResolutionResult{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("invalid_resolution_type", "choice.resolution.type", "unsupported choice resolution type")})
	}
	if outcome == nil {
		return ResolutionResult{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("missing_outcome", "choice.resolution", "selected outcome is absent")})
	}

	state, applied, changedIDs, err := ApplyConsequence(outcome.Consequences, input.Problem, bindings, input.Entities, input.Definitions, input.Snapshot)
	if err != nil {
		return ResolutionResult{}, err
	}
	result.Status = ResolutionApplied
	result.OutcomeID = outcome.ID
	result.AppliedEffects = applied
	result.State = state
	result.ChangedRecordIDs = changedIDs
	return result, nil
}

func evaluateInvocation(invocation ConditionInvocation, input ResolutionInput, bindings TargetBindings) (ConditionEvaluation, error) {
	condition, exists := input.Conditions[invocation.ConditionSetID]
	if !exists {
		return ConditionEvaluation{}, domainError(ErrInvalidDefinition, ValidationErrors{validation("unknown_condition_set", "invocation.condition_set_id", "condition set does not exist")})
	}
	if errs := ValidateConditionSet(condition, input.OwnerSchemas, input.Definitions); len(errs) > 0 {
		return ConditionEvaluation{}, domainError(ErrInvalidDefinition, errs)
	}
	parameterBindings, err := MapInvocationBindings(invocation, bindings)
	if err != nil {
		return ConditionEvaluation{}, err
	}
	return EvaluateCondition(condition, parameterBindings, input.Entities, input.Definitions, input.Snapshot)
}

func findChoice(choices []ChoiceDefinition, id ID) (ChoiceDefinition, bool) {
	for _, choice := range choices {
		if choice.ID == id {
			return choice, true
		}
	}
	return ChoiceDefinition{}, false
}
