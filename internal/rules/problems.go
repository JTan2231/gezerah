package rules

import (
	"fmt"
	"strings"
)

func ValidateProblemDefinition(problem ProblemDefinition, schemas map[ID]OwnerSchema, definitions map[ID]StateVariableDefinition, conditions map[ID]ConditionSet, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	if !problem.ID.Valid() {
		errs = append(errs, validation("required", "id", "problem-definition ID is required"))
	}
	if !problem.RuleSetID.Valid() {
		errs = append(errs, validation("required", "rule_set_id", "ruleset ID is required"))
	}
	if strings.TrimSpace(problem.Key) == "" {
		errs = append(errs, validation("required", "key", "problem-definition key is required"))
	}
	if strings.TrimSpace(problem.Name) == "" {
		errs = append(errs, validation("required", "name", "problem-definition name is required"))
	}
	for _, duplicate := range duplicateIDs(problem.InstanceOwnerSchemaIDs) {
		errs = append(errs, validation("duplicate", "instance_owner_schema_ids", fmt.Sprintf("owner schema %q is repeated", duplicate)))
	}
	for i, id := range problem.InstanceOwnerSchemaIDs {
		schema, exists := schemas[id]
		path := fmt.Sprintf("instance_owner_schema_ids[%d]", i)
		if !exists {
			errs = append(errs, validation("unknown_owner_schema", path, "instance owner schema does not exist"))
		} else if schema.RuleSetID != problem.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", path, "instance owner schema belongs to another ruleset"))
		}
	}

	errs = append(errs, validateProblemTargets(problem, schemas)...)
	if len(problem.Choices) == 0 {
		errs = append(errs, validation("required", "choices", "problem definitions require at least one choice"))
	}

	invocationIDs := make(map[ID]struct{})
	if problem.AvailableWhen != nil {
		errs = append(errs, validateProblemInvocation(*problem.AvailableWhen, "available_when", problem, conditions, invocationIDs)...)
	}
	choiceIDs, choiceKeys, choicePositions := map[ID]struct{}{}, map[string]struct{}{}, map[int]struct{}{}
	outcomeIDs, consequenceIDs, effectIDs := map[ID]struct{}{}, map[ID]struct{}{}, map[ID]struct{}{}
	for i, choice := range problem.Choices {
		path := fmt.Sprintf("choices[%s]", choice.ID)
		if !choice.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "choice ID is required"))
		}
		if _, exists := choiceIDs[choice.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "choice ID is repeated"))
		}
		choiceIDs[choice.ID] = struct{}{}
		if strings.TrimSpace(choice.Key) == "" {
			errs = append(errs, validation("required", path+".key", "choice key is required"))
		}
		if _, exists := choiceKeys[choice.Key]; exists {
			errs = append(errs, validation("duplicate", path+".key", "choice key is repeated"))
		}
		choiceKeys[choice.Key] = struct{}{}
		if strings.TrimSpace(choice.Name) == "" {
			errs = append(errs, validation("required", path+".name", "choice name is required"))
		}
		if choice.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "choice position cannot be negative"))
		}
		if _, exists := choicePositions[choice.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "choice position is repeated"))
		}
		choicePositions[choice.Position] = struct{}{}
		if choice.AvailableWhen != nil {
			errs = append(errs, validateProblemInvocation(*choice.AvailableWhen, path+".available_when", problem, conditions, invocationIDs)...)
		}
		errs = append(errs, validateChoiceResolution(choice.Resolution, path+".resolution", problem, schemas, definitions, conditions, entities, invocationIDs, outcomeIDs, consequenceIDs, effectIDs)...)
		_ = i
	}
	return errs
}

func validateProblemTargets(problem ProblemDefinition, schemas map[ID]OwnerSchema) ValidationErrors {
	var errs ValidationErrors
	ids, keys, positions := map[ID]struct{}{}, map[string]struct{}{}, map[int]struct{}{}
	instanceTargets := 0
	for _, target := range problem.Targets {
		path := "targets[" + string(target.ID) + "]"
		if !target.ID.Valid() {
			errs = append(errs, validation("required", path+".id", "target ID is required"))
		}
		if _, exists := ids[target.ID]; exists {
			errs = append(errs, validation("duplicate", path+".id", "target ID is repeated"))
		}
		ids[target.ID] = struct{}{}
		if strings.TrimSpace(target.Key) == "" {
			errs = append(errs, validation("required", path+".key", "target key is required"))
		}
		if _, exists := keys[target.Key]; exists {
			errs = append(errs, validation("duplicate", path+".key", "target key is repeated"))
		}
		keys[target.Key] = struct{}{}
		if strings.TrimSpace(target.Label) == "" {
			errs = append(errs, validation("required", path+".label", "target label is required"))
		}
		if target.Position < 0 {
			errs = append(errs, validation("invalid_position", path+".position", "target position cannot be negative"))
		}
		if _, exists := positions[target.Position]; exists {
			errs = append(errs, validation("duplicate", path+".position", "target position is repeated"))
		}
		positions[target.Position] = struct{}{}
		if target.Cardinality != CardinalityOne && target.Cardinality != CardinalityMany {
			errs = append(errs, validation("unsupported", path+".cardinality", "target cardinality must be one or many"))
		}
		if target.MinimumBindings < 0 {
			errs = append(errs, validation("invalid_binding_bounds", path+".minimum_bindings", "minimum bindings cannot be negative"))
		}
		if target.MaximumBindings != nil && *target.MaximumBindings < target.MinimumBindings {
			errs = append(errs, validation("invalid_binding_bounds", path+".maximum_bindings", "maximum bindings cannot be below minimum"))
		}
		if target.Cardinality == CardinalityOne && effectiveMaximum(target) > 1 {
			errs = append(errs, validation("invalid_binding_bounds", path+".maximum_bindings", "singular target maximum cannot exceed one"))
		}
		if target.Cardinality == CardinalityOne && target.MinimumBindings > 1 {
			errs = append(errs, validation("invalid_binding_bounds", path+".minimum_bindings", "singular target minimum cannot exceed one"))
		}
		if target.BindingSource != BindingSupplied && target.BindingSource != BindingProblemInstance {
			errs = append(errs, validation("unsupported", path+".binding_source", "unsupported target binding source"))
		}
		if target.BindingSource == BindingProblemInstance {
			instanceTargets++
			if target.Cardinality != CardinalityOne || target.MinimumBindings != 1 || effectiveMaximum(target) != 1 {
				errs = append(errs, validation("invalid_instance_target", path, "problem-instance target must be singular with exactly one binding"))
			}
			if !containsEveryID(problem.InstanceOwnerSchemaIDs, target.RequiredOwnerSchemaIDs) {
				errs = append(errs, validation("invalid_instance_target", path+".required_owner_schema_ids", "instance schema template does not include every schema required by the target"))
			}
		}
		for _, duplicate := range duplicateIDs(target.RequiredOwnerSchemaIDs) {
			errs = append(errs, validation("duplicate", path+".required_owner_schema_ids", fmt.Sprintf("owner schema %q is repeated", duplicate)))
		}
		for i, schemaID := range target.RequiredOwnerSchemaIDs {
			schema, exists := schemas[schemaID]
			schemaPath := fmt.Sprintf("%s.required_owner_schema_ids[%d]", path, i)
			if !exists {
				errs = append(errs, validation("unknown_owner_schema", schemaPath, "required owner schema does not exist"))
			} else if schema.RuleSetID != problem.RuleSetID {
				errs = append(errs, validation("cross_ruleset_reference", schemaPath, "required owner schema belongs to another ruleset"))
			}
		}
	}
	if instanceTargets > 1 {
		errs = append(errs, validation("duplicate_instance_target", "targets", "a problem may declare at most one problem-instance target"))
	}
	return errs
}

func validateProblemInvocation(invocation ConditionInvocation, path string, problem ProblemDefinition, conditions map[ID]ConditionSet, seen map[ID]struct{}) ValidationErrors {
	var errs ValidationErrors
	if _, exists := seen[invocation.ID]; exists {
		errs = append(errs, validation("invocation_reused", path+".id", "each invocation must be owned by exactly one usage site"))
	}
	seen[invocation.ID] = struct{}{}
	condition, exists := conditions[invocation.ConditionSetID]
	if !exists {
		return append(errs, validation("unknown_condition_set", path+".condition_set_id", "condition set does not exist"))
	}
	for _, item := range ValidateConditionInvocation(invocation, problem, condition) {
		item.Path = path + "." + item.Path
		errs = append(errs, item)
	}
	return errs
}

func validateChoiceResolution(resolution ChoiceResolution, path string, problem ProblemDefinition, schemas map[ID]OwnerSchema, definitions map[ID]StateVariableDefinition, conditions map[ID]ConditionSet, entities map[ID]Entity, invocationIDs, outcomeIDs, consequenceIDs, effectIDs map[ID]struct{}) ValidationErrors {
	var errs ValidationErrors
	switch resolution.Type {
	case ResolutionAutomatic:
		if resolution.Invocation != nil || resolution.Met != nil || resolution.Unmet != nil || resolution.Automatic == nil {
			errs = append(errs, validation("invalid_resolution_shape", path, "automatic resolution requires only one automatic outcome"))
		}
		if resolution.Automatic != nil {
			if resolution.Automatic.Branch != OutcomeAutomatic {
				errs = append(errs, validation("invalid_outcome_branch", path+".automatic.branch", "automatic outcome must use the automatic branch"))
			}
			errs = append(errs, validateOutcome(*resolution.Automatic, path+".automatic", problem, definitions, entities, outcomeIDs, consequenceIDs, effectIDs)...)
		}
	case ResolutionCondition:
		if resolution.Invocation == nil || resolution.Automatic != nil || resolution.Met == nil || resolution.Unmet == nil {
			errs = append(errs, validation("invalid_resolution_shape", path, "conditional resolution requires one invocation and explicit met and unmet outcomes"))
		}
		if resolution.Invocation != nil {
			errs = append(errs, validateProblemInvocation(*resolution.Invocation, path+".invocation", problem, conditions, invocationIDs)...)
		}
		if resolution.Met != nil {
			if resolution.Met.Branch != OutcomeMet {
				errs = append(errs, validation("invalid_outcome_branch", path+".met.branch", "met outcome must use the met branch"))
			}
			errs = append(errs, validateOutcome(*resolution.Met, path+".met", problem, definitions, entities, outcomeIDs, consequenceIDs, effectIDs)...)
		}
		if resolution.Unmet != nil {
			if resolution.Unmet.Branch != OutcomeUnmet {
				errs = append(errs, validation("invalid_outcome_branch", path+".unmet.branch", "unmet outcome must use the unmet branch"))
			}
			errs = append(errs, validateOutcome(*resolution.Unmet, path+".unmet", problem, definitions, entities, outcomeIDs, consequenceIDs, effectIDs)...)
		}
	default:
		errs = append(errs, validation("unsupported", path+".type", "resolution type must be automatic or condition"))
	}
	_ = schemas
	return errs
}

func validateOutcome(outcome ChoiceOutcome, path string, problem ProblemDefinition, definitions map[ID]StateVariableDefinition, entities map[ID]Entity, outcomeIDs, consequenceIDs, effectIDs map[ID]struct{}) ValidationErrors {
	var errs ValidationErrors
	if !outcome.ID.Valid() {
		errs = append(errs, validation("required", path+".id", "outcome ID is required"))
	}
	if _, exists := outcomeIDs[outcome.ID]; exists {
		errs = append(errs, validation("duplicate", path+".id", "outcome ID is repeated within the problem"))
	}
	outcomeIDs[outcome.ID] = struct{}{}
	if strings.TrimSpace(outcome.Label) == "" {
		errs = append(errs, validation("required", path+".label", "outcome label is required"))
	}
	consequence := outcome.Consequences
	if !consequence.ID.Valid() {
		errs = append(errs, validation("required", path+".consequences.id", "consequence-set ID is required"))
	}
	if _, exists := consequenceIDs[consequence.ID]; exists {
		errs = append(errs, validation("duplicate", path+".consequences.id", "consequence-set ID is repeated within the problem"))
	}
	consequenceIDs[consequence.ID] = struct{}{}
	positions := make(map[int]struct{}, len(consequence.Effects))
	for _, effect := range consequence.Effects {
		effectPath := path + ".consequences.effects[" + string(effect.ID) + "]"
		if _, exists := effectIDs[effect.ID]; exists {
			errs = append(errs, validation("duplicate", effectPath+".id", "effect ID is repeated within the problem"))
		}
		effectIDs[effect.ID] = struct{}{}
		if _, exists := positions[effect.Position]; exists {
			errs = append(errs, validation("duplicate", effectPath+".position", "effect position is repeated within the consequence set"))
		}
		positions[effect.Position] = struct{}{}
		errs = append(errs, ValidateEffect(effect, problem, definitions, entities, effectPath)...)
	}
	for position := 0; position < len(consequence.Effects); position++ {
		if _, exists := positions[position]; !exists {
			errs = append(errs, validation("incomplete_positions", path+".consequences.effects", "effect positions must form a complete zero-based sequence"))
			break
		}
	}
	return errs
}

func ValidateEffect(effect Effect, problem ProblemDefinition, definitions map[ID]StateVariableDefinition, entities map[ID]Entity, path string) ValidationErrors {
	var errs ValidationErrors
	if !effect.ID.Valid() {
		errs = append(errs, validation("required", path+".id", "effect ID is required"))
	}
	if effect.Position < 0 {
		errs = append(errs, validation("invalid_position", path+".position", "effect position cannot be negative"))
	}
	target, targetExists := problemTargetMap(problem)[effect.TargetDefinitionID]
	if !targetExists {
		errs = append(errs, validation("unknown_target", path+".target_definition_id", "effect target does not belong to the problem"))
	}
	definition, definitionExists := definitions[effect.StateVariableID]
	if !definitionExists {
		errs = append(errs, validation("unknown_state_variable", path+".state_variable_id", "effect state variable does not exist"))
	} else if definition.RuleSetID != problem.RuleSetID {
		errs = append(errs, validation("cross_ruleset_reference", path+".state_variable_id", "effect state variable belongs to another ruleset"))
	}
	if targetExists && definitionExists {
		if len(target.RequiredOwnerSchemaIDs) == 0 {
			errs = append(errs, validation("unconstrained_target", path+".target_definition_id", "targets used by effects require at least one owner schema"))
		}
		if !schemaSetsIntersect(target.RequiredOwnerSchemaIDs, definition.OwnerSchemaIDs) {
			errs = append(errs, validation("incompatible_target", path+".state_variable_id", "target schemas do not guarantee eligibility for the variable"))
		}
		if target.Cardinality == CardinalityOne && (target.MinimumBindings != 1 || effectiveMaximum(target) != 1) {
			errs = append(errs, validation("invalid_binding_bounds", path+".target_definition_id", "singular targets used by effects require exactly one binding"))
		}
		if !containsEffectOperation(definition.AllowedEffectOperations, effect.Operation) {
			errs = append(errs, validation("operation_not_enabled", path+".operation", "operation is not enabled by the variable"))
		}
		if !operationCompatible(effect.Operation, definition) {
			errs = append(errs, validation("incompatible_operation", path+".operation", "operation is incompatible with the variable schema"))
		}
		errs = append(errs, validateEffectOperand(effect, definition, entities, path)...)
	}
	return errs
}

func validateEffectOperand(effect Effect, definition StateVariableDefinition, entities map[ID]Entity, path string) ValidationErrors {
	var errs ValidationErrors
	switch effect.Operation {
	case EffectSet:
		if effect.Operand == nil || effect.AdjustmentAmount != nil {
			errs = append(errs, validation("invalid_effect_operand", path, "set requires one complete state value and no adjustment amount"))
		} else {
			errs = append(errs, ValidateStateValue(definition, *effect.Operand, entities)...)
		}
	case EffectClear:
		if effect.Operand != nil || effect.AdjustmentAmount != nil {
			errs = append(errs, validation("invalid_effect_operand", path, "clear accepts no operand"))
		}
	case EffectAdjustNumber:
		if effect.Operand != nil || effect.AdjustmentAmount == nil || !effect.AdjustmentAmount.Valid() {
			errs = append(errs, validation("invalid_effect_operand", path, "adjust-number requires one finite adjustment amount and no value operand"))
		}
	case EffectAddValue, EffectRemoveValue:
		if effect.Operand == nil || effect.AdjustmentAmount != nil || effect.Operand.Cardinality != CardinalityOne || len(effect.Operand.Values) != 1 {
			errs = append(errs, validation("invalid_effect_operand", path, "add-value and remove-value require exactly one scalar operand"))
		} else {
			scalarDefinition := definition
			scalarDefinition.Cardinality = CardinalityOne
			scalarValue := StateValue{Cardinality: CardinalityOne, Values: cloneScalars(effect.Operand.Values)}
			errs = append(errs, ValidateStateValue(scalarDefinition, scalarValue, entities)...)
		}
	default:
		errs = append(errs, validation("unsupported", path+".operation", "unsupported effect operation"))
	}
	return errs
}

func containsEffectOperation(operations []EffectOperation, expected EffectOperation) bool {
	for _, operation := range operations {
		if operation == expected {
			return true
		}
	}
	return false
}
