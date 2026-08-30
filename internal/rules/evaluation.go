package rules

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// EvaluateEntity compiles the supplied Mechanic definitions and evaluates one
// Entity against Inline statuses reconstructed from immutable Status-instance
// modifier snapshots. It returns no
// partial result if mechanic-graph, input-override, status-instance, or
// arithmetic validation fails.
func EvaluateEntity(
	entity Entity,
	record InputOverrideRecord,
	definitions map[ID]MechanicDefinition,
	inlineStatuses map[ID]InlineStatus,
	statusInstances []StatusInstance,
) (EntityEvaluation, error) {
	graph, err := CompileMechanicGraph(definitions)
	if err != nil {
		return EntityEvaluation{}, err
	}
	return EvaluateEntityWithGraph(entity, record, graph, inlineStatuses, statusInstances)
}

// EvaluateEntityWithGraph evaluates against a previously compiled graph.
// References recursively request dependency effective values, which both
// propagates input modifiers and defensively detects runtime cycles.
func EvaluateEntityWithGraph(
	entity Entity,
	record InputOverrideRecord,
	graph MechanicGraph,
	inlineStatuses map[ID]InlineStatus,
	statusInstances []StatusInstance,
) (EntityEvaluation, error) {
	if !entity.ID.Valid() || !entity.WorldID.Valid() {
		return EntityEvaluation{}, evaluationError("entity", "evaluated entity requires non-empty entity and world IDs")
	}
	if graph.definitions == nil {
		return EntityEvaluation{}, domainError(ErrInvalidDefinition, ValidationErrors{validation(
			"uncompiled_graph", "graph", "mechanic graph must be created by CompileMechanicGraph",
		)})
	}
	if errs := ValidateInputOverrideRecord(record, entity, graph.definitions); len(errs) > 0 {
		return EntityEvaluation{}, domainError(ErrInvalidRuntimeSnapshot, errs)
	}
	if errs := ValidateInlineStatuses(inlineStatuses, graph.definitions); len(errs) > 0 {
		return EntityEvaluation{}, domainError(ErrInvalidDefinition, errs)
	}
	if errs := ValidateStatusInstances(entity, inlineStatuses, statusInstances); len(errs) > 0 {
		return EntityEvaluation{}, domainError(ErrInvalidRuntimeSnapshot, errs)
	}

	modifiersByMechanic := resolvedModifiersByMechanic(inlineStatuses, statusInstances)
	evaluator := entityEvaluator{
		entity:              entity,
		inputOverrides:      record,
		definitions:         graph.definitions,
		modifiersByMechanic: modifiersByMechanic,
		states:              make(map[ID]uint8, len(graph.definitions)),
		values:              make(map[ID]EvaluatedMechanic, len(graph.definitions)),
		stackIndexes:        make(map[ID]int, len(graph.definitions)),
	}

	order := make([]ID, 0, len(graph.order))
	includedInOrder := make(map[ID]struct{}, len(graph.order))
	for _, mechanicID := range graph.order {
		definition, exists := graph.definitions[mechanicID]
		if !exists || definition.WorldID != entity.WorldID {
			continue
		}
		if _, included := includedInOrder[mechanicID]; included {
			continue
		}
		if _, err := evaluator.evaluateMechanic(mechanicID); err != nil {
			return EntityEvaluation{}, err
		}
		order = append(order, mechanicID)
		includedInOrder[mechanicID] = struct{}{}
	}
	// A compiled graph normally lists every definition. This sorted fallback
	// makes evaluation total even if a caller reordered or shortened exported
	// Order while retaining the graph value.
	for _, mechanicID := range sortedDefinitionIDs(graph.definitions) {
		definition := graph.definitions[mechanicID]
		if definition.WorldID != entity.WorldID {
			continue
		}
		if _, included := includedInOrder[mechanicID]; included {
			continue
		}
		if _, err := evaluator.evaluateMechanic(mechanicID); err != nil {
			return EntityEvaluation{}, err
		}
		order = append(order, mechanicID)
		includedInOrder[mechanicID] = struct{}{}
	}

	return EntityEvaluation{
		EntityID: entity.ID,
		Revision: record.Revision,
		Order:    order,
		Values:   evaluator.values,
	}, nil
}

type resolvedModifier struct {
	instance     StatusInstance
	inlineStatus InlineStatus
	modifier     StatusModifier
}

func resolvedModifiersByMechanic(inlineStatuses map[ID]InlineStatus, instances []StatusInstance) map[ID][]resolvedModifier {
	result := make(map[ID][]resolvedModifier)
	for _, instance := range instances {
		inlineStatus := inlineStatuses[instance.SourceEffectID]
		for _, modifier := range inlineStatus.Modifiers {
			result[modifier.MechanicID] = append(result[modifier.MechanicID], resolvedModifier{
				instance:     instance,
				inlineStatus: inlineStatus,
				modifier:     modifier,
			})
		}
	}
	for mechanicID := range result {
		sort.Slice(result[mechanicID], func(i, j int) bool {
			left, right := result[mechanicID][i], result[mechanicID][j]
			if left.modifier.Priority != right.modifier.Priority {
				return left.modifier.Priority < right.modifier.Priority
			}
			if left.instance.AppliedOrder != right.instance.AppliedOrder {
				return left.instance.AppliedOrder < right.instance.AppliedOrder
			}
			if left.instance.ID != right.instance.ID {
				return left.instance.ID < right.instance.ID
			}
			if left.modifier.Position != right.modifier.Position {
				return left.modifier.Position < right.modifier.Position
			}
			return left.modifier.ID < right.modifier.ID
		})
	}
	return result
}

type entityEvaluator struct {
	entity              Entity
	inputOverrides      InputOverrideRecord
	definitions         map[ID]MechanicDefinition
	modifiersByMechanic map[ID][]resolvedModifier
	states              map[ID]uint8
	values              map[ID]EvaluatedMechanic
	stack               []ID
	stackIndexes        map[ID]int
}

func (e *entityEvaluator) evaluateMechanic(mechanicID ID) (EvaluatedMechanic, error) {
	if e.states[mechanicID] == 2 {
		return e.values[mechanicID], nil
	}
	if e.states[mechanicID] == 1 {
		start := e.stackIndexes[mechanicID]
		cycle := append([]ID(nil), e.stack[start:]...)
		cycle = append(cycle, mechanicID)
		parts := make([]string, len(cycle))
		for index, id := range cycle {
			parts[index] = string(id)
		}
		return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"]", "runtime dependency cycle: "+strings.Join(parts, " -> "))
	}
	definition, exists := e.definitions[mechanicID]
	if !exists {
		return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"]", "referenced mechanic is absent from the compiled graph")
	}
	if definition.WorldID != e.entity.WorldID {
		return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"]", "referenced mechanic belongs to another world")
	}

	e.states[mechanicID] = 1
	e.stackIndexes[mechanicID] = len(e.stack)
	e.stack = append(e.stack, mechanicID)
	defer func() {
		e.stack = e.stack[:len(e.stack)-1]
		delete(e.stackIndexes, mechanicID)
	}()

	evaluated := EvaluatedMechanic{
		MechanicID: mechanicID,
		SourceKind: definition.SourceKind,
		Modifiers:  []AppliedModifier{},
	}
	switch definition.SourceKind {
	case SourceInput:
		logical := ResolveLogicalInputValue(e.inputOverrides, definition)
		evaluated.Presence = logical.Presence
		evaluated.Intrinsic = CloneMechanicValue(logical.Value)
	case SourceDerived:
		evaluated.Presence = EvaluationPresenceDerived
		if definition.Expression == nil {
			return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"].expression", "derived mechanic has no expression")
		}
		value, trace, err := e.evaluateExpression(*definition.Expression)
		if err != nil {
			if errors.Is(err, ErrEvaluation) {
				return EvaluatedMechanic{}, err
			}
			return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"].expression", err.Error())
		}
		evaluated.Intrinsic = value
		evaluated.Expression = &trace
	default:
		return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"].source_kind", "mechanic has an unsupported source kind")
	}
	if evaluated.Intrinsic.Kind != definition.ValueKind || !validMechanicValueShape(evaluated.Intrinsic) {
		return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"]", "intrinsic value does not match the mechanic's scalar kind")
	}

	effective := CloneMechanicValue(evaluated.Intrinsic)
	for _, resolved := range e.modifiersByMechanic[mechanicID] {
		before := CloneMechanicValue(effective)
		after, err := applyModifier(effective, resolved.modifier)
		if err != nil {
			return EvaluatedMechanic{}, evaluationError(
				"active_status_instances["+string(resolved.instance.ID)+"].modifiers["+string(resolved.modifier.ID)+"]",
				err.Error(),
			)
		}
		effective = after
		evaluated.Modifiers = append(evaluated.Modifiers, AppliedModifier{
			StatusInstanceID: resolved.instance.ID,
			SourceEffectID:   resolved.inlineStatus.ID,
			ModifierID:       resolved.modifier.ID,
			Priority:         resolved.modifier.Priority,
			Position:         resolved.modifier.Position,
			Operation:        resolved.modifier.Operation,
			Operand:          CloneMechanicValue(resolved.modifier.Value),
			Before:           before,
			After:            CloneMechanicValue(after),
		})
	}
	evaluated.Effective = CloneMechanicValue(effective)
	e.values[mechanicID] = evaluated
	e.states[mechanicID] = 2
	return evaluated, nil
}

func (e *entityEvaluator) evaluateExpression(expression Expression) (MechanicValue, ExpressionTrace, error) {
	trace := ExpressionTrace{Operation: expression.Operation, MechanicID: expression.MechanicID, Operands: []ExpressionTrace{}}
	if expression.Literal != nil {
		literal := CloneMechanicValue(*expression.Literal)
		trace.Literal = &literal
	}

	if expression.Operation == ExpressionLiteral {
		if expression.Literal == nil {
			return MechanicValue{}, ExpressionTrace{}, fmt.Errorf("literal expression has no value")
		}
		trace.Value = CloneMechanicValue(*expression.Literal)
		return CloneMechanicValue(trace.Value), trace, nil
	}
	if expression.Operation == ExpressionMechanicReference {
		mechanic, err := e.evaluateMechanic(expression.MechanicID)
		if err != nil {
			return MechanicValue{}, ExpressionTrace{}, err
		}
		trace.Value = CloneMechanicValue(mechanic.Effective)
		return CloneMechanicValue(trace.Value), trace, nil
	}

	values := make([]MechanicValue, len(expression.Operands))
	for index, operand := range expression.Operands {
		value, operandTrace, err := e.evaluateExpression(operand)
		if err != nil {
			return MechanicValue{}, ExpressionTrace{}, err
		}
		values[index] = value
		trace.Operands = append(trace.Operands, operandTrace)
	}
	value, err := evaluateExpressionOperation(expression.Operation, values)
	if err != nil {
		return MechanicValue{}, ExpressionTrace{}, err
	}
	trace.Value = CloneMechanicValue(value)
	return CloneMechanicValue(value), trace, nil
}

func evaluateExpressionOperation(operation ExpressionOperation, operands []MechanicValue) (MechanicValue, error) {
	numberAt := func(index int) (Decimal, error) {
		if index >= len(operands) || operands[index].Kind != ValueNumber || operands[index].Number == nil {
			return Decimal{}, fmt.Errorf("%s requires numeric operands", operation)
		}
		return *operands[index].Number, nil
	}
	booleanAt := func(index int) (bool, error) {
		if index >= len(operands) || operands[index].Kind != ValueBoolean || operands[index].Boolean == nil {
			return false, fmt.Errorf("%s requires boolean operands", operation)
		}
		return *operands[index].Boolean, nil
	}
	foldNumbers := func(combine func(Decimal, Decimal) (Decimal, error)) (MechanicValue, error) {
		if len(operands) < 2 {
			return MechanicValue{}, fmt.Errorf("%s requires at least two operands", operation)
		}
		result, err := numberAt(0)
		if err != nil {
			return MechanicValue{}, err
		}
		for index := 1; index < len(operands); index++ {
			next, err := numberAt(index)
			if err != nil {
				return MechanicValue{}, err
			}
			result, err = combine(result, next)
			if err != nil {
				return MechanicValue{}, err
			}
		}
		return NewNumberMechanicValue(result), nil
	}
	compareNumbers := func(matches func(int) bool) (MechanicValue, error) {
		if len(operands) != 2 {
			return MechanicValue{}, fmt.Errorf("%s requires exactly two operands", operation)
		}
		left, err := numberAt(0)
		if err != nil {
			return MechanicValue{}, err
		}
		right, err := numberAt(1)
		if err != nil {
			return MechanicValue{}, err
		}
		return NewBooleanMechanicValue(matches(left.Cmp(right))), nil
	}

	switch operation {
	case ExpressionLiteral, ExpressionMechanicReference:
		return MechanicValue{}, fmt.Errorf("%s must be evaluated before operand dispatch", operation)

	case ExpressionAddNumber:
		return foldNumbers(func(left, right Decimal) (Decimal, error) { return left.Add(right) })

	case ExpressionMultiplyNumber:
		return foldNumbers(func(left, right Decimal) (Decimal, error) { return left.Multiply(right) })

	case ExpressionMinNumber:
		return foldNumbers(func(left, right Decimal) (Decimal, error) {
			if right.Cmp(left) < 0 {
				return right, nil
			}
			return left, nil
		})

	case ExpressionMaxNumber:
		return foldNumbers(func(left, right Decimal) (Decimal, error) {
			if right.Cmp(left) > 0 {
				return right, nil
			}
			return left, nil
		})

	case ExpressionSubtractNumber:
		if len(operands) != 2 {
			return MechanicValue{}, fmt.Errorf("subtract-number requires exactly two operands")
		}
		left, err := numberAt(0)
		if err != nil {
			return MechanicValue{}, err
		}
		right, err := numberAt(1)
		if err != nil {
			return MechanicValue{}, err
		}
		result, err := left.Subtract(right)
		if err != nil {
			return MechanicValue{}, err
		}
		return NewNumberMechanicValue(result), nil

	case ExpressionNegateNumber:
		if len(operands) != 1 {
			return MechanicValue{}, fmt.Errorf("negate-number requires exactly one operand")
		}
		operand, err := numberAt(0)
		if err != nil {
			return MechanicValue{}, err
		}
		result, err := operand.Negate()
		if err != nil {
			return MechanicValue{}, err
		}
		return NewNumberMechanicValue(result), nil

	case ExpressionAnd, ExpressionOr:
		if len(operands) < 2 {
			return MechanicValue{}, fmt.Errorf("%s requires at least two operands", operation)
		}
		result := operation == ExpressionAnd
		for index := range operands {
			value, err := booleanAt(index)
			if err != nil {
				return MechanicValue{}, err
			}
			if operation == ExpressionAnd {
				result = result && value
			} else {
				result = result || value
			}
		}
		return NewBooleanMechanicValue(result), nil

	case ExpressionNot:
		if len(operands) != 1 {
			return MechanicValue{}, fmt.Errorf("not requires exactly one operand")
		}
		value, err := booleanAt(0)
		if err != nil {
			return MechanicValue{}, err
		}
		return NewBooleanMechanicValue(!value), nil

	case ExpressionEqual:
		if len(operands) != 2 || operands[0].Kind != operands[1].Kind {
			return MechanicValue{}, fmt.Errorf("equal requires two operands of the same scalar kind")
		}
		return NewBooleanMechanicValue(MechanicValuesEqual(operands[0], operands[1])), nil

	case ExpressionLessNumber:
		return compareNumbers(func(comparison int) bool { return comparison < 0 })

	case ExpressionLessOrEqualNumber:
		return compareNumbers(func(comparison int) bool { return comparison <= 0 })

	case ExpressionGreaterNumber:
		return compareNumbers(func(comparison int) bool { return comparison > 0 })

	case ExpressionGreaterOrEqualNumber:
		return compareNumbers(func(comparison int) bool { return comparison >= 0 })

	case ExpressionIf:
		if len(operands) != 3 || operands[0].Kind != ValueBoolean || operands[0].Boolean == nil || operands[1].Kind != operands[2].Kind {
			return MechanicValue{}, fmt.Errorf("if requires a boolean condition and two same-kind branches")
		}
		if *operands[0].Boolean {
			return CloneMechanicValue(operands[1]), nil
		}
		return CloneMechanicValue(operands[2]), nil
	default:
		return MechanicValue{}, fmt.Errorf("unsupported expression operation %q", operation)
	}
}

func applyModifier(value MechanicValue, modifier StatusModifier) (MechanicValue, error) {
	switch modifier.Operation {
	case ModifierSet:
		if value.Kind != modifier.Value.Kind {
			return MechanicValue{}, fmt.Errorf("set modifier kind does not match current value")
		}
		return CloneMechanicValue(modifier.Value), nil
	case ModifierAddNumber:
		if value.Kind != ValueNumber || value.Number == nil || modifier.Value.Kind != ValueNumber || modifier.Value.Number == nil {
			return MechanicValue{}, fmt.Errorf("add-number modifier requires numeric values")
		}
		result, err := value.Number.Add(*modifier.Value.Number)
		if err != nil {
			return MechanicValue{}, err
		}
		return NewNumberMechanicValue(result), nil
	case ModifierMultiplyNumber:
		if value.Kind != ValueNumber || value.Number == nil || modifier.Value.Kind != ValueNumber || modifier.Value.Number == nil {
			return MechanicValue{}, fmt.Errorf("multiply-number modifier requires numeric values")
		}
		result, err := value.Number.Multiply(*modifier.Value.Number)
		if err != nil {
			return MechanicValue{}, err
		}
		return NewNumberMechanicValue(result), nil
	default:
		return MechanicValue{}, fmt.Errorf("unsupported modifier operation %q", modifier.Operation)
	}
}

func evaluationError(path, message string) error {
	return domainError(ErrEvaluation, ValidationErrors{validation("evaluation_failed", path, message)})
}
