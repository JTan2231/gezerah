package rules

import (
	"fmt"
	"sort"
	"strings"
)

// InferExpressionType validates one expression against its owning mechanic
// and the complete world definition set. It also returns the expression's
// inferred scalar kind when inference succeeds.
func InferExpressionType(expression Expression, owner MechanicDefinition, definitions map[ID]MechanicDefinition) (ValueKind, ValidationErrors) {
	return inferExpressionType(expression, owner, definitions, "expression", nil, nil)
}

// ValidateMechanicGraph validates definition identity/source rules, recursively
// type-checks every derived expression, validates same-world references, and
// reports dependency cycles with a concrete cycle path.
func ValidateMechanicGraph(definitions map[ID]MechanicDefinition) ValidationErrors {
	var errs ValidationErrors
	dependencies := make(map[ID]map[ID]struct{}, len(definitions))
	dependencyPaths := make(map[ID]map[ID]string, len(definitions))

	for _, mechanicID := range sortedDefinitionIDs(definitions) {
		definition := definitions[mechanicID]
		path := "mechanics[" + string(mechanicID) + "]"
		if definition.ID != mechanicID {
			errs = append(errs, validation("mechanic_id_mismatch", path+".id", "mechanic map key and definition ID differ"))
		}
		for _, item := range ValidateMechanicDefinition(definition) {
			item.Path = pathForNestedValidation(path, item.Path)
			errs = append(errs, item)
		}
		dependencies[mechanicID] = make(map[ID]struct{})
		dependencyPaths[mechanicID] = make(map[ID]string)
		if definition.SourceKind != SourceDerived || definition.Expression == nil {
			continue
		}
		inferred, expressionErrors := inferExpressionType(
			*definition.Expression,
			definition,
			definitions,
			path+".expression",
			dependencies[mechanicID],
			dependencyPaths[mechanicID],
		)
		errs = append(errs, expressionErrors...)
		if validValueKind(inferred) && validValueKind(definition.ValueKind) && inferred != definition.ValueKind {
			errs = append(errs, validation(
				"expression_type_mismatch",
				path+".value_kind",
				fmt.Sprintf("derived expression produces %s, but mechanic declares %s", inferred, definition.ValueKind),
			))
		}
	}

	errs = append(errs, detectDependencyCycles(definitions, dependencies, dependencyPaths)...)
	return errs
}

// CompileMechanicGraph returns an immutable-by-convention evaluation plan.
// Invalid definitions never produce a partially usable graph.
func CompileMechanicGraph(definitions map[ID]MechanicDefinition) (MechanicGraph, error) {
	if errs := ValidateMechanicGraph(definitions); len(errs) > 0 {
		return MechanicGraph{}, domainError(ErrInvalidDefinition, errs)
	}

	dependencies := make(map[ID][]ID, len(definitions))
	for id, definition := range definitions {
		set := make(map[ID]struct{})
		if definition.SourceKind == SourceDerived && definition.Expression != nil {
			collectExpressionDependencies(*definition.Expression, set)
		}
		dependencies[id] = sortedIDSet(set)
	}
	order := dependencyOrder(definitions, dependencies)
	cloned := make(map[ID]MechanicDefinition, len(definitions))
	for id, definition := range definitions {
		cloned[id] = cloneMechanicDefinition(definition)
	}
	return MechanicGraph{
		Order:        append([]ID(nil), order...),
		Dependencies: dependencies,
		definitions:  cloned,
		order:        append([]ID(nil), order...),
	}, nil
}

func inferExpressionType(
	expression Expression,
	owner MechanicDefinition,
	definitions map[ID]MechanicDefinition,
	path string,
	dependencies map[ID]struct{},
	dependencyPaths map[ID]string,
) (ValueKind, ValidationErrors) {
	var errs ValidationErrors
	requireNoLiteral := func() {
		if expression.Literal != nil {
			errs = append(errs, validation("invalid_expression_shape", path+".literal", "operation cannot declare a literal"))
		}
	}
	requireNoReference := func() {
		if expression.MechanicID.Valid() {
			errs = append(errs, validation("invalid_expression_shape", path+".mechanic_id", "operation cannot declare a mechanic reference"))
		}
	}
	requireArity := func(minimum, maximum int) {
		count := len(expression.Operands)
		if count < minimum || (maximum >= 0 && count > maximum) {
			expected := fmt.Sprintf("at least %d", minimum)
			if minimum == maximum {
				expected = fmt.Sprintf("exactly %d", minimum)
			}
			errs = append(errs, validation("invalid_expression_arity", path+".operands", fmt.Sprintf("operation requires %s operands", expected)))
		}
	}
	inferOperands := func() ([]ValueKind, ValidationErrors) {
		kinds := make([]ValueKind, len(expression.Operands))
		var nested ValidationErrors
		for index, operand := range expression.Operands {
			kind, operandErrors := inferExpressionType(
				operand,
				owner,
				definitions,
				fmt.Sprintf("%s.operands[%d]", path, index),
				dependencies,
				dependencyPaths,
			)
			kinds[index] = kind
			nested = append(nested, operandErrors...)
		}
		return kinds, nested
	}
	requireOperandKinds := func(kinds []ValueKind, expected ValueKind) {
		for index, kind := range kinds {
			if validValueKind(kind) && kind != expected {
				errs = append(errs, validation(
					"expression_type_mismatch",
					fmt.Sprintf("%s.operands[%d]", path, index),
					fmt.Sprintf("operand must be %s", expected),
				))
			}
		}
	}

	switch expression.Operation {
	case ExpressionLiteral:
		requireNoReference()
		requireArity(0, 0)
		if expression.Literal == nil {
			errs = append(errs, validation("required", path+".literal", "literal operation requires a typed scalar"))
			return "", errs
		}
		for _, item := range validateExpressionLiteral(*expression.Literal) {
			item.Path = pathForNestedValidation(path+".literal", item.Path)
			errs = append(errs, item)
		}
		if validMechanicValueShape(*expression.Literal) {
			return expression.Literal.Kind, errs
		}
		return "", errs

	case ExpressionMechanicReference:
		requireNoLiteral()
		requireArity(0, 0)
		if !expression.MechanicID.Valid() {
			errs = append(errs, validation("required", path+".mechanic_id", "mechanic reference requires an ID"))
			return "", errs
		}
		definition, exists := definitions[expression.MechanicID]
		if !exists {
			errs = append(errs, validation("unknown_mechanic", path+".mechanic_id", "referenced mechanic does not exist"))
			return "", errs
		}
		if definition.ID != expression.MechanicID {
			errs = append(errs, validation("mechanic_id_mismatch", path+".mechanic_id", "mechanic map key and definition ID differ"))
		}
		if definition.WorldID != owner.WorldID {
			errs = append(errs, validation("cross_world_reference", path+".mechanic_id", "derived expression references a mechanic in another world"))
		} else {
			if dependencies != nil {
				dependencies[expression.MechanicID] = struct{}{}
			}
			if dependencyPaths != nil {
				if _, recorded := dependencyPaths[expression.MechanicID]; !recorded {
					dependencyPaths[expression.MechanicID] = path + ".mechanic_id"
				}
			}
		}
		if !owner.Archived && definition.Archived {
			errs = append(errs, validation("archived_dependency", path+".mechanic_id", "active derived mechanics cannot reference archived mechanics"))
		}
		return definition.ValueKind, errs

	case ExpressionAddNumber, ExpressionMultiplyNumber, ExpressionMinNumber, ExpressionMaxNumber:
		requireNoLiteral()
		requireNoReference()
		requireArity(2, -1)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		requireOperandKinds(kinds, ValueNumber)
		return ValueNumber, errs

	case ExpressionSubtractNumber:
		requireNoLiteral()
		requireNoReference()
		requireArity(2, 2)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		requireOperandKinds(kinds, ValueNumber)
		return ValueNumber, errs

	case ExpressionNegateNumber:
		requireNoLiteral()
		requireNoReference()
		requireArity(1, 1)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		requireOperandKinds(kinds, ValueNumber)
		return ValueNumber, errs

	case ExpressionAnd, ExpressionOr:
		requireNoLiteral()
		requireNoReference()
		requireArity(2, -1)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		requireOperandKinds(kinds, ValueBoolean)
		return ValueBoolean, errs

	case ExpressionNot:
		requireNoLiteral()
		requireNoReference()
		requireArity(1, 1)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		requireOperandKinds(kinds, ValueBoolean)
		return ValueBoolean, errs

	case ExpressionEqual:
		requireNoLiteral()
		requireNoReference()
		requireArity(2, 2)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		if len(kinds) == 2 && validValueKind(kinds[0]) && validValueKind(kinds[1]) && kinds[0] != kinds[1] {
			errs = append(errs, validation("expression_type_mismatch", path+".operands[1]", "equal operands must have the same scalar kind"))
		}
		return ValueBoolean, errs

	case ExpressionLessNumber, ExpressionLessOrEqualNumber, ExpressionGreaterNumber, ExpressionGreaterOrEqualNumber:
		requireNoLiteral()
		requireNoReference()
		requireArity(2, 2)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		requireOperandKinds(kinds, ValueNumber)
		return ValueBoolean, errs

	case ExpressionIf:
		requireNoLiteral()
		requireNoReference()
		requireArity(3, 3)
		kinds, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		if len(kinds) > 0 && validValueKind(kinds[0]) && kinds[0] != ValueBoolean {
			errs = append(errs, validation("expression_type_mismatch", path+".operands[0]", "if condition must be boolean"))
		}
		if len(kinds) == 3 && validValueKind(kinds[1]) && validValueKind(kinds[2]) && kinds[1] != kinds[2] {
			errs = append(errs, validation("expression_type_mismatch", path+".operands[2]", "if branches must have the same scalar kind"))
		}
		if len(kinds) > 1 {
			return kinds[1], errs
		}
		return "", errs

	default:
		errs = append(errs, validation("unsupported", path+".operation", "unsupported expression operation"))
		// Traverse children even for an unknown node so callers receive useful
		// nested reference/type diagnostics in one validation pass.
		_, operandErrors := inferOperands()
		errs = append(errs, operandErrors...)
		return "", errs
	}
}

func validateExpressionLiteral(value MechanicValue) ValidationErrors {
	if !validValueKind(value.Kind) || !validMechanicValueShape(value) {
		return ValidationErrors{validation("invalid_typed_value", "", "literal must contain exactly one number or boolean value")}
	}
	return nil
}

func collectExpressionDependencies(expression Expression, result map[ID]struct{}) {
	if expression.Operation == ExpressionMechanicReference && expression.MechanicID.Valid() {
		result[expression.MechanicID] = struct{}{}
	}
	for _, operand := range expression.Operands {
		collectExpressionDependencies(operand, result)
	}
}

func detectDependencyCycles(
	definitions map[ID]MechanicDefinition,
	dependencySets map[ID]map[ID]struct{},
	dependencyPaths map[ID]map[ID]string,
) ValidationErrors {
	states := make(map[ID]uint8, len(definitions))
	stack := make([]ID, 0, len(definitions))
	stackIndexes := make(map[ID]int, len(definitions))
	reported := make(map[string]struct{})
	var errs ValidationErrors

	var visit func(ID)
	visit = func(mechanicID ID) {
		states[mechanicID] = 1
		stackIndexes[mechanicID] = len(stack)
		stack = append(stack, mechanicID)
		for _, dependencyID := range sortedIDSet(dependencySets[mechanicID]) {
			if _, exists := definitions[dependencyID]; !exists {
				continue
			}
			switch states[dependencyID] {
			case 0:
				visit(dependencyID)
			case 1:
				start := stackIndexes[dependencyID]
				cycle := append([]ID(nil), stack[start:]...)
				cycle = append(cycle, dependencyID)
				parts := make([]string, len(cycle))
				for index, id := range cycle {
					parts[index] = string(id)
				}
				key := strings.Join(parts, " -> ")
				if _, exists := reported[key]; exists {
					continue
				}
				reported[key] = struct{}{}
				path := "mechanics[" + string(mechanicID) + "].expression"
				if recorded := dependencyPaths[mechanicID][dependencyID]; recorded != "" {
					path = recorded
				}
				errs = append(errs, validation("dependency_cycle", path, "dependency cycle: "+key))
			}
		}
		stack = stack[:len(stack)-1]
		delete(stackIndexes, mechanicID)
		states[mechanicID] = 2
	}

	for _, mechanicID := range sortedDefinitionIDs(definitions) {
		if states[mechanicID] == 0 {
			visit(mechanicID)
		}
	}
	return errs
}

func dependencyOrder(definitions map[ID]MechanicDefinition, dependencies map[ID][]ID) []ID {
	visited := make(map[ID]bool, len(definitions))
	order := make([]ID, 0, len(definitions))
	var visit func(ID)
	visit = func(mechanicID ID) {
		if visited[mechanicID] {
			return
		}
		visited[mechanicID] = true
		for _, dependencyID := range dependencies[mechanicID] {
			visit(dependencyID)
		}
		order = append(order, mechanicID)
	}
	for _, mechanicID := range sortedDefinitionIDs(definitions) {
		visit(mechanicID)
	}
	return order
}

func sortedDefinitionIDs(definitions map[ID]MechanicDefinition) []ID {
	result := make([]ID, 0, len(definitions))
	for id := range definitions {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func sortedIDSet(set map[ID]struct{}) []ID {
	result := make([]ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func cloneMechanicDefinition(definition MechanicDefinition) MechanicDefinition {
	result := definition
	result.DefaultValue = CloneMechanicValue(definition.DefaultValue)
	if definition.Minimum != nil {
		result.Minimum = decimalPointer(*definition.Minimum)
	}
	if definition.Maximum != nil {
		result.Maximum = decimalPointer(*definition.Maximum)
	}
	if definition.Step != nil {
		result.Step = decimalPointer(*definition.Step)
	}
	if definition.Expression != nil {
		cloned := cloneExpression(*definition.Expression)
		result.Expression = &cloned
	}
	return result
}

func cloneExpression(expression Expression) Expression {
	result := expression
	if expression.Literal != nil {
		literal := CloneMechanicValue(*expression.Literal)
		result.Literal = &literal
	}
	result.Operands = make([]Expression, len(expression.Operands))
	for index, operand := range expression.Operands {
		result.Operands[index] = cloneExpression(operand)
	}
	return result
}
