package rules

import "fmt"

func ValidateConditionInvocation(invocation ConditionInvocation, problem ProblemDefinition, condition ConditionSet) ValidationErrors {
	var errs ValidationErrors
	path := "invocations[" + string(invocation.ID) + "]"
	if !invocation.ID.Valid() {
		errs = append(errs, validation("required", path+".id", "condition invocation ID is required"))
	}
	if invocation.ConditionSetID != condition.ID {
		errs = append(errs, validation("condition_mismatch", path+".condition_set_id", "invocation does not reference the supplied condition set"))
	}
	if condition.RuleSetID != problem.RuleSetID {
		errs = append(errs, validation("cross_ruleset_reference", path+".condition_set_id", "condition set belongs to another ruleset"))
	}

	parameters := make(map[ID]ConditionParameter, len(condition.Parameters))
	for _, parameter := range condition.Parameters {
		parameters[parameter.ID] = parameter
	}
	targets := problemTargetMap(problem)
	mapped := make(map[ID]struct{}, len(invocation.Arguments))
	for i, argument := range invocation.Arguments {
		argumentPath := fmt.Sprintf("%s.arguments[%d]", path, i)
		parameter, parameterExists := parameters[argument.ParameterID]
		if !parameterExists {
			errs = append(errs, validation("unknown_parameter", argumentPath+".parameter_id", "condition parameter does not belong to the invoked set"))
		}
		if _, duplicate := mapped[argument.ParameterID]; duplicate {
			errs = append(errs, validation("duplicate_mapping", argumentPath+".parameter_id", "condition parameter is mapped more than once"))
		}
		mapped[argument.ParameterID] = struct{}{}
		target, targetExists := targets[argument.TargetDefinitionID]
		if !targetExists {
			errs = append(errs, validation("unknown_target", argumentPath+".target_definition_id", "target does not belong to the problem"))
		}
		if parameterExists && targetExists {
			if parameter.Cardinality != target.Cardinality {
				errs = append(errs, validation("cardinality_mismatch", argumentPath+".target_definition_id", "parameter and target cardinalities differ"))
			}
			if !containsEveryID(target.RequiredOwnerSchemaIDs, parameter.RequiredOwnerSchemaIDs) {
				errs = append(errs, validation("incompatible_target", argumentPath+".target_definition_id", "target does not require every schema required by the parameter"))
			}
			if len(target.RequiredOwnerSchemaIDs) == 0 {
				errs = append(errs, validation("unconstrained_target", argumentPath+".target_definition_id", "targets used by conditions require at least one owner schema"))
			}
			if target.Cardinality == CardinalityOne && (target.MinimumBindings != 1 || effectiveMaximum(target) != 1) {
				errs = append(errs, validation("invalid_binding_bounds", argumentPath+".target_definition_id", "singular targets used by conditions require exactly one binding"))
			}
			if maximum := effectiveMaximum(target); maximum >= 0 {
				if required := maximumParameterAtLeast(condition.Root, parameter.ID); required > maximum {
					errs = append(errs, validation("unreachable_required_count", argumentPath+".target_definition_id", "target maximum is below an at-least count used by the mapped parameter"))
				}
			}
		}
	}
	for _, parameter := range condition.Parameters {
		if _, exists := mapped[parameter.ID]; !exists {
			errs = append(errs, validation("missing_mapping", path+".arguments", fmt.Sprintf("parameter %q is not mapped", parameter.ID)))
		}
	}
	return errs
}

func MapInvocationBindings(invocation ConditionInvocation, targetBindings TargetBindings) (ParameterBindings, error) {
	result := make(ParameterBindings, len(invocation.Arguments))
	var errs ValidationErrors
	for i, argument := range invocation.Arguments {
		entities, exists := targetBindings[argument.TargetDefinitionID]
		if !exists {
			errs = append(errs, validation("missing_target_binding", fmt.Sprintf("arguments[%d].target_definition_id", i), "mapped target has no current binding"))
			continue
		}
		if _, duplicate := result[argument.ParameterID]; duplicate {
			errs = append(errs, validation("duplicate_mapping", fmt.Sprintf("arguments[%d].parameter_id", i), "condition parameter is mapped more than once"))
			continue
		}
		result[argument.ParameterID] = append([]ID(nil), entities...)
	}
	if len(errs) > 0 {
		return nil, domainError(ErrInvalidBindings, errs)
	}
	return result, nil
}

func ValidateTargetBindings(problem ProblemDefinition, instance ProblemInstance, bindings TargetBindings, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	targets := problemTargetMap(problem)
	for _, target := range problem.Targets {
		entityIDs, exists := bindings[target.ID]
		path := "bindings[" + string(target.ID) + "]"
		if !exists {
			errs = append(errs, validation("missing_target_binding", path, "every problem target must have a current binding collection"))
			continue
		}
		if len(entityIDs) < target.MinimumBindings {
			errs = append(errs, validation("too_few_bindings", path, "binding count is below the target minimum"))
		}
		if maximum := effectiveMaximum(target); maximum >= 0 && len(entityIDs) > maximum {
			errs = append(errs, validation("too_many_bindings", path, "binding count exceeds the target maximum"))
		}
		if target.BindingSource == BindingProblemInstance && (len(entityIDs) != 1 || entityIDs[0] != instance.ID) {
			errs = append(errs, validation("invalid_instance_binding", path, "problem-instance target must bind exactly the instance entity"))
		}
		seen := make(map[ID]struct{}, len(entityIDs))
		for i, entityID := range entityIDs {
			entityPath := fmt.Sprintf("%s.entities[%d]", path, i)
			if _, duplicate := seen[entityID]; duplicate {
				errs = append(errs, validation("duplicate_binding", entityPath, "an entity may appear only once in one target"))
			}
			seen[entityID] = struct{}{}
			entity, entityExists := entities[entityID]
			if !entityExists {
				errs = append(errs, validation("unknown_entity", entityPath, "bound entity does not exist"))
				continue
			}
			if entity.RuleSetID != problem.RuleSetID {
				errs = append(errs, validation("cross_ruleset_reference", entityPath, "bound entity belongs to another ruleset"))
			}
			if !EntityImplementsAll(entity, target.RequiredOwnerSchemaIDs) {
				errs = append(errs, validation("ineligible_binding", entityPath, "bound entity does not implement every schema required by the target"))
			}
		}
	}
	for targetID := range bindings {
		if _, exists := targets[targetID]; !exists {
			errs = append(errs, validation("unexpected_target_binding", "bindings["+string(targetID)+"]", "binding target does not belong to the problem"))
		}
	}
	return errs
}

func ValidateProblemInstance(problem ProblemDefinition, instance ProblemInstance, entities map[ID]Entity) ValidationErrors {
	var errs ValidationErrors
	if !instance.ID.Valid() {
		errs = append(errs, validation("required", "id", "problem-instance ID is required"))
	}
	if instance.RuleSetID != problem.RuleSetID {
		errs = append(errs, validation("cross_ruleset_reference", "rule_set_id", "problem instance belongs to another ruleset"))
	}
	if instance.ProblemDefinitionID != problem.ID {
		errs = append(errs, validation("definition_mismatch", "problem_definition_id", "problem instance references another definition"))
	}
	if instance.BindingRevision < 0 {
		errs = append(errs, validation("invalid_revision", "binding_revision", "binding revision cannot be negative"))
	}
	entity, exists := entities[instance.ID]
	if !exists {
		errs = append(errs, validation("missing_instance_entity", "id", "problem instance must also exist as a generic entity"))
	} else {
		if entity.RuleSetID != instance.RuleSetID {
			errs = append(errs, validation("cross_ruleset_reference", "id", "problem-instance entity belongs to another ruleset"))
		}
		if !EntityImplementsAll(entity, problem.InstanceOwnerSchemaIDs) {
			errs = append(errs, validation("invalid_instance_schemas", "id", "problem-instance entity is missing a schema from the definition creation template"))
		}
	}
	errs = append(errs, ValidateTargetBindings(problem, instance, instance.Bindings, entities)...)
	return errs
}

func problemTargetMap(problem ProblemDefinition) map[ID]ProblemTargetDefinition {
	result := make(map[ID]ProblemTargetDefinition, len(problem.Targets))
	for _, target := range problem.Targets {
		result[target.ID] = target
	}
	return result
}

func containsEveryID(have, required []ID) bool {
	set := idSet(have)
	for _, id := range required {
		if _, exists := set[id]; !exists {
			return false
		}
	}
	return true
}

// effectiveMaximum returns -1 for an unbounded many target. A singular target
// always has an effective maximum of one even if the transport omitted it.
func effectiveMaximum(target ProblemTargetDefinition) int {
	if target.MaximumBindings != nil {
		return *target.MaximumBindings
	}
	if target.Cardinality == CardinalityOne {
		return 1
	}
	return -1
}

func maximumParameterAtLeast(expression ConditionExpression, parameterID ID) int {
	maximum := 0
	if expression.Criterion != nil && expression.Criterion.ParameterID == parameterID && expression.Criterion.Quantifier == QuantifierAtLeast {
		maximum = expression.Criterion.RequiredCount
	}
	for _, child := range expression.Children {
		if value := maximumParameterAtLeast(child, parameterID); value > maximum {
			maximum = value
		}
	}
	return maximum
}
