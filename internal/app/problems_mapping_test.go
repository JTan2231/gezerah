package app

import (
	"encoding/json"
	"reflect"
	"testing"

	"dnd/internal/rules"
)

func TestProblemRequestMappingGeneratesOwnedIDsAndPreservesDecimal(t *testing.T) {
	t.Parallel()
	const (
		ruleSetID    = "00000000-0000-4000-8000-000000000001"
		targetID     = "00000000-0000-4000-8000-000000000002"
		definitionID = "00000000-0000-4000-8000-000000000003"
	)
	amount := json.Number("9007199254740993.125")
	maximum := 1
	problem, err := problemRequestToDomain(saveProblemDefinitionRequest{
		Key: "locked-door", Name: "Locked door",
		Targets: []problemTargetDTO{{
			ID: targetID, Key: "door", Label: "Door", Cardinality: "one",
			MinimumBindings: 1, MaximumBindings: &maximum, BindingSource: "supplied",
		}},
		Choices: []problemChoiceDTO{{
			Key: "force", Name: "Force",
			Resolution: choiceResolutionDTO{Type: "automatic", Outcome: &choiceOutcomeDTO{
				Label: "Opened", Consequences: consequenceSetDTO{Effects: []stateEffectDTO{{
					Type: "adjust-number", TargetDefinitionID: targetID,
					StateVariableID: definitionID, Amount: &amount,
				}}},
			}},
		}},
	}, ruleSetID, map[rules.ID]rules.StateVariableDefinition{
		rules.ID(definitionID): {ID: rules.ID(definitionID), ValueKind: rules.ValueNumber, Cardinality: rules.CardinalityOne},
	})
	if err != nil {
		t.Fatalf("map problem: %v", err)
	}
	if !validID(string(problem.ID)) || !validID(string(problem.Choices[0].ID)) ||
		!validID(string(problem.Choices[0].Resolution.Automatic.ID)) ||
		!validID(string(problem.Choices[0].Resolution.Automatic.Consequences.ID)) ||
		!validID(string(problem.Choices[0].Resolution.Automatic.Consequences.Effects[0].ID)) {
		t.Fatal("server-managed aggregate IDs were not generated as UUIDs")
	}
	effect := problem.Choices[0].Resolution.Automatic.Consequences.Effects[0]
	if got := effect.AdjustmentAmount.String(); got != amount.String() {
		t.Fatalf("adjustment amount = %q, want %q", got, amount)
	}
	encoded := effectDomainToDTO(effect, map[rules.ID]rules.StateVariableDefinition{
		rules.ID(definitionID): {ID: rules.ID(definitionID), ValueKind: rules.ValueNumber, Cardinality: rules.CardinalityOne},
	})
	if encoded.Amount == nil || encoded.Amount.String() != amount.String() {
		t.Fatalf("encoded adjustment = %#v, want %s", encoded.Amount, amount)
	}
}

func TestDuplicateProblemRemapsNestedIDsAndReferences(t *testing.T) {
	t.Parallel()
	const (
		problemID     = rules.ID("10000000-0000-4000-8000-000000000001")
		targetID      = rules.ID("10000000-0000-4000-8000-000000000002")
		conditionID   = rules.ID("10000000-0000-4000-8000-000000000003")
		parameterID   = rules.ID("10000000-0000-4000-8000-000000000004")
		invocationID  = rules.ID("10000000-0000-4000-8000-000000000005")
		choiceID      = rules.ID("10000000-0000-4000-8000-000000000006")
		outcomeID     = rules.ID("10000000-0000-4000-8000-000000000007")
		consequenceID = rules.ID("10000000-0000-4000-8000-000000000008")
		effectID      = rules.ID("10000000-0000-4000-8000-000000000009")
		variableID    = rules.ID("10000000-0000-4000-8000-000000000010")
	)
	invocation := &rules.ConditionInvocation{
		ID: invocationID, ConditionSetID: conditionID,
		Arguments: []rules.ConditionInvocationArgument{{ParameterID: parameterID, TargetDefinitionID: targetID}},
	}
	original := rules.ProblemDefinition{
		ID: problemID, Key: "original", Name: "Original",
		Targets:       []rules.ProblemTargetDefinition{{ID: targetID, Key: "target"}},
		AvailableWhen: invocation,
		Choices: []rules.ChoiceDefinition{{
			ID: choiceID, Key: "act", Name: "Act",
			Resolution: rules.ChoiceResolution{Type: rules.ResolutionAutomatic, Automatic: &rules.ChoiceOutcome{
				ID: outcomeID, Branch: rules.OutcomeAutomatic, Label: "Done",
				Consequences: rules.ConsequenceSet{ID: consequenceID, Effects: []rules.Effect{{
					ID: effectID, Operation: rules.EffectClear,
					TargetDefinitionID: targetID, StateVariableID: variableID,
				}}},
			}},
		}},
	}
	duplicate, err := duplicateProblemDomain(original, "copy", "Copy")
	if err != nil {
		t.Fatalf("duplicate problem: %v", err)
	}
	if duplicate.ID == original.ID || duplicate.Targets[0].ID == targetID || duplicate.AvailableWhen.ID == invocationID ||
		duplicate.Choices[0].ID == choiceID || duplicate.Choices[0].Resolution.Automatic.ID == outcomeID ||
		duplicate.Choices[0].Resolution.Automatic.Consequences.ID == consequenceID ||
		duplicate.Choices[0].Resolution.Automatic.Consequences.Effects[0].ID == effectID {
		t.Fatal("one or more owned IDs were reused by duplicate")
	}
	newTargetID := duplicate.Targets[0].ID
	if duplicate.AvailableWhen.Arguments[0].TargetDefinitionID != newTargetID ||
		duplicate.Choices[0].Resolution.Automatic.Consequences.Effects[0].TargetDefinitionID != newTargetID {
		t.Fatal("nested target references were not remapped")
	}
	if original.AvailableWhen.Arguments[0].TargetDefinitionID != targetID ||
		original.Choices[0].Resolution.Automatic.Consequences.Effects[0].TargetDefinitionID != targetID {
		t.Fatal("duplicating mutated the original aggregate")
	}
}

func TestBindingMappingAddsAutomaticSelfBinding(t *testing.T) {
	t.Parallel()
	const (
		instanceID = rules.ID("20000000-0000-4000-8000-000000000001")
		autoID     = rules.ID("20000000-0000-4000-8000-000000000002")
		suppliedID = rules.ID("20000000-0000-4000-8000-000000000003")
		entityID   = "20000000-0000-4000-8000-000000000004"
	)
	problem := rules.ProblemDefinition{Targets: []rules.ProblemTargetDefinition{
		{ID: autoID, BindingSource: rules.BindingProblemInstance},
		{ID: suppliedID, BindingSource: rules.BindingSupplied},
	}}
	bindings, err := bindingsDTOToDomain([]problemTargetBindingDTO{{
		TargetDefinitionID: string(suppliedID), EntityIDs: []string{entityID},
	}}, problem, instanceID)
	if err != nil {
		t.Fatalf("map bindings: %v", err)
	}
	if !reflect.DeepEqual(bindings[autoID], []rules.ID{instanceID}) ||
		!reflect.DeepEqual(bindings[suppliedID], []rules.ID{rules.ID(entityID)}) {
		t.Fatalf("bindings = %#v", bindings)
	}
	if _, err := bindingsDTOToDomain([]problemTargetBindingDTO{
		{TargetDefinitionID: string(autoID), EntityIDs: []string{string(instanceID)}},
		{TargetDefinitionID: string(suppliedID), EntityIDs: []string{entityID}},
	}, problem, instanceID); err == nil {
		t.Fatal("automatic target was accepted as a supplied binding")
	}
}

func TestResolutionResultAlwaysSerializesRequiredArrays(t *testing.T) {
	t.Parallel()
	response := resolutionResultToDTO(rules.ResolutionResult{
		Status:              rules.ResolutionUnavailable,
		ProblemDefinitionID: "30000000-0000-4000-8000-000000000001",
		ProblemInstanceID:   "30000000-0000-4000-8000-000000000002",
		ChoiceID:            "30000000-0000-4000-8000-000000000003",
	}, false, nil, nil)
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	for _, field := range []string{"availability_evaluations", "evaluations", "applied_effects"} {
		if got := string(object[field]); got != "[]" {
			t.Errorf("%s = %s, want []", field, got)
		}
	}
}

func TestArchivedProblemReferencesAllowRetainedStableChildrenOnly(t *testing.T) {
	t.Parallel()
	const (
		schemaID      = rules.ID("40000000-0000-4000-8000-000000000001")
		targetID      = rules.ID("40000000-0000-4000-8000-000000000002")
		conditionID   = rules.ID("40000000-0000-4000-8000-000000000003")
		invocationID  = rules.ID("40000000-0000-4000-8000-000000000004")
		definitionID  = rules.ID("40000000-0000-4000-8000-000000000005")
		effectID      = rules.ID("40000000-0000-4000-8000-000000000006")
		newInvocation = rules.ID("40000000-0000-4000-8000-000000000007")
		newEffect     = rules.ID("40000000-0000-4000-8000-000000000008")
		choiceID      = rules.ID("40000000-0000-4000-8000-000000000009")
		outcomeID     = rules.ID("40000000-0000-4000-8000-000000000010")
		consequenceID = rules.ID("40000000-0000-4000-8000-000000000011")
	)
	current := rules.ProblemDefinition{
		InstanceOwnerSchemaIDs: []rules.ID{schemaID},
		Targets:                []rules.ProblemTargetDefinition{{ID: targetID, RequiredOwnerSchemaIDs: []rules.ID{schemaID}}},
		AvailableWhen:          &rules.ConditionInvocation{ID: invocationID, ConditionSetID: conditionID},
		Choices: []rules.ChoiceDefinition{{
			ID: choiceID,
			Resolution: rules.ChoiceResolution{Type: rules.ResolutionAutomatic, Automatic: &rules.ChoiceOutcome{
				ID: outcomeID, Consequences: rules.ConsequenceSet{ID: consequenceID, Effects: []rules.Effect{{
					ID: effectID, TargetDefinitionID: targetID, StateVariableID: definitionID,
				}}},
			}},
		}},
	}
	schemas := map[rules.ID]rules.OwnerSchema{schemaID: {ID: schemaID, Archived: true}}
	definitions := map[rules.ID]rules.StateVariableDefinition{
		definitionID: {ID: definitionID, Archived: true, OwnerSchemaIDs: []rules.ID{schemaID}},
	}
	conditions := map[rules.ID]rules.ConditionSet{conditionID: {ID: conditionID, Archived: true}}
	if fields := archivedProblemReferenceFields(current, current, schemas, definitions, conditions); len(fields) != 0 {
		t.Fatalf("retained archived references rejected: %v", fields)
	}

	proposed := current
	proposed.Choices = append([]rules.ChoiceDefinition(nil), current.Choices...)
	proposed.Choices[0].AvailableWhen = &rules.ConditionInvocation{ID: newInvocation, ConditionSetID: conditionID}
	proposed.Choices[0].Resolution.Automatic = &rules.ChoiceOutcome{
		ID: outcomeID,
		Consequences: rules.ConsequenceSet{ID: consequenceID, Effects: []rules.Effect{
			{ID: effectID, TargetDefinitionID: targetID, StateVariableID: definitionID},
			{ID: newEffect, TargetDefinitionID: targetID, StateVariableID: definitionID},
		}},
	}
	fields := archivedProblemReferenceFields(proposed, current, schemas, definitions, conditions)
	if _, exists := fields["choices["+string(choiceID)+"].available_when.condition_set_id"]; !exists {
		t.Fatalf("new archived condition invocation was accepted: %v", fields)
	}
	newEffectPath := "choices[" + string(choiceID) + "].resolution.outcome.consequences.effects[" + string(newEffect) + "]"
	if _, exists := fields[newEffectPath+".state_variable_id"]; !exists {
		t.Fatalf("new archived-variable effect was accepted: %v", fields)
	}
	if _, exists := fields[newEffectPath+".target_definition_id"]; !exists {
		t.Fatalf("new archived-schema effect was accepted: %v", fields)
	}
}

func TestArchivedProblemReferencesAllowNewEffectWithActiveCompatibleSchema(t *testing.T) {
	t.Parallel()
	const (
		archivedSchemaID = rules.ID("50000000-0000-4000-8000-000000000001")
		activeSchemaID   = rules.ID("50000000-0000-4000-8000-000000000002")
		targetID         = rules.ID("50000000-0000-4000-8000-000000000003")
		definitionID     = rules.ID("50000000-0000-4000-8000-000000000004")
		choiceID         = rules.ID("50000000-0000-4000-8000-000000000005")
		outcomeID        = rules.ID("50000000-0000-4000-8000-000000000006")
		consequenceID    = rules.ID("50000000-0000-4000-8000-000000000007")
		effectID         = rules.ID("50000000-0000-4000-8000-000000000008")
	)
	current := rules.ProblemDefinition{
		Targets: []rules.ProblemTargetDefinition{{
			ID: targetID, RequiredOwnerSchemaIDs: []rules.ID{archivedSchemaID, activeSchemaID},
		}},
	}
	proposed := current
	proposed.Choices = []rules.ChoiceDefinition{{
		ID: choiceID,
		Resolution: rules.ChoiceResolution{Type: rules.ResolutionAutomatic, Automatic: &rules.ChoiceOutcome{
			ID: outcomeID,
			Consequences: rules.ConsequenceSet{ID: consequenceID, Effects: []rules.Effect{{
				ID: effectID, TargetDefinitionID: targetID, StateVariableID: definitionID,
			}}},
		}},
	}}
	schemas := map[rules.ID]rules.OwnerSchema{
		archivedSchemaID: {ID: archivedSchemaID, Archived: true},
		activeSchemaID:   {ID: activeSchemaID},
	}
	definitions := map[rules.ID]rules.StateVariableDefinition{
		definitionID: {
			ID: definitionID, OwnerSchemaIDs: []rules.ID{archivedSchemaID, activeSchemaID},
		},
	}
	fields := archivedProblemReferenceFields(proposed, current, schemas, definitions, nil)
	effectPath := "choices[" + string(choiceID) + "].resolution.outcome.consequences.effects[" + string(effectID) + "]"
	if _, exists := fields[effectPath+".target_definition_id"]; exists {
		t.Fatalf("active compatible schema did not permit the new effect: %v", fields)
	}
}
