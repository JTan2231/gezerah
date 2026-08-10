package rules

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// EvaluateEntityState compiles the supplied mechanic definitions and evaluates
// one entity against immutable consequence status snapshots. It returns no
// partial result if graph, state, status, or arithmetic validation fails.
func EvaluateEntityState(
	entity Entity,
	record StateRecord,
	definitions map[ID]MechanicDefinition,
	statusSnapshots map[ID]StatusSnapshot,
	activeStatuses []ActiveStatus,
) (EvaluatedState, error) {
	graph, err := CompileMechanicGraph(definitions)
	if err != nil {
		return EvaluatedState{}, err
	}
	return EvaluateEntityStateWithGraph(entity, record, graph, statusSnapshots, activeStatuses)
}

// EvaluateEntityStateWithGraph evaluates against a previously compiled graph.
// References recursively request dependency effective values, which both
// propagates input modifiers and defensively detects runtime cycles.
func EvaluateEntityStateWithGraph(
	entity Entity,
	record StateRecord,
	graph MechanicGraph,
	statusSnapshots map[ID]StatusSnapshot,
	activeStatuses []ActiveStatus,
) (EvaluatedState, error) {
	if !entity.ID.Valid() || !entity.WorldID.Valid() {
		return EvaluatedState{}, evaluationError("entity", "evaluated entity requires non-empty entity and world IDs")
	}
	if graph.definitions == nil {
		return EvaluatedState{}, domainError(ErrInvalidDefinition, ValidationErrors{validation(
			"uncompiled_graph", "graph", "mechanic graph must be created by CompileMechanicGraph",
		)})
	}
	if errs := ValidateStateRecord(record, entity, graph.definitions); len(errs) > 0 {
		return EvaluatedState{}, domainError(ErrInvalidState, errs)
	}
	if errs := ValidateStatusSnapshots(statusSnapshots, graph.definitions); len(errs) > 0 {
		return EvaluatedState{}, domainError(ErrInvalidDefinition, errs)
	}
	if errs := ValidateActiveStatuses(entity, statusSnapshots, activeStatuses); len(errs) > 0 {
		return EvaluatedState{}, domainError(ErrInvalidState, errs)
	}

	modifiersByMechanic := resolvedModifiersByMechanic(statusSnapshots, activeStatuses)
	evaluator := entityEvaluator{
		entity:              entity,
		record:              record,
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
			return EvaluatedState{}, err
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
			return EvaluatedState{}, err
		}
		order = append(order, mechanicID)
		includedInOrder[mechanicID] = struct{}{}
	}

	return EvaluatedState{
		EntityID: entity.ID,
		Revision: record.Revision,
		Order:    order,
		Values:   evaluator.values,
	}, nil
}

type resolvedModifier struct {
	active   ActiveStatus
	snapshot StatusSnapshot
	modifier StatusModifier
}

func resolvedModifiersByMechanic(statusSnapshots map[ID]StatusSnapshot, active []ActiveStatus) map[ID][]resolvedModifier {
	result := make(map[ID][]resolvedModifier)
	for _, instance := range active {
		snapshot := statusSnapshots[instance.SourceEffectID]
		for _, modifier := range snapshot.Modifiers {
			result[modifier.MechanicID] = append(result[modifier.MechanicID], resolvedModifier{
				active:   instance,
				snapshot: snapshot,
				modifier: modifier,
			})
		}
	}
	for mechanicID := range result {
		sort.Slice(result[mechanicID], func(i, j int) bool {
			left, right := result[mechanicID][i], result[mechanicID][j]
			if left.modifier.Priority != right.modifier.Priority {
				return left.modifier.Priority < right.modifier.Priority
			}
			if left.active.AppliedOrder != right.active.AppliedOrder {
				return left.active.AppliedOrder < right.active.AppliedOrder
			}
			if left.active.ID != right.active.ID {
				return left.active.ID < right.active.ID
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
	record              StateRecord
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
		logical := LogicalStateValue(e.record, definition)
		evaluated.InputPresence = logical.Presence
		evaluated.Intrinsic = CloneStateValue(logical.Value)
	case SourceDerived:
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
	if evaluated.Intrinsic.Kind != definition.ValueKind || !validStateValueShape(evaluated.Intrinsic) {
		return EvaluatedMechanic{}, evaluationError("mechanics["+string(mechanicID)+"]", "intrinsic value does not match the mechanic's scalar kind")
	}

	effective := CloneStateValue(evaluated.Intrinsic)
	for _, resolved := range e.modifiersByMechanic[mechanicID] {
		before := CloneStateValue(effective)
		after, err := applyModifier(effective, resolved.modifier)
		if err != nil {
			return EvaluatedMechanic{}, evaluationError(
				"active_statuses["+string(resolved.active.ID)+"].modifiers["+string(resolved.modifier.ID)+"]",
				err.Error(),
			)
		}
		effective = after
		evaluated.Modifiers = append(evaluated.Modifiers, AppliedModifier{
			StatusInstanceID: resolved.active.ID,
			SourceEffectID:   resolved.snapshot.ID,
			ModifierID:       resolved.modifier.ID,
			Priority:         resolved.modifier.Priority,
			Position:         resolved.modifier.Position,
			Operation:        resolved.modifier.Operation,
			Operand:          CloneStateValue(resolved.modifier.Value),
			Before:           before,
			After:            CloneStateValue(after),
		})
	}
	evaluated.Effective = CloneStateValue(effective)
	e.values[mechanicID] = evaluated
	e.states[mechanicID] = 2
	return evaluated, nil
}

func (e *entityEvaluator) evaluateExpression(expression Expression) (StateValue, ExpressionTrace, error) {
	trace := ExpressionTrace{Operation: expression.Operation, MechanicID: expression.MechanicID, Operands: []ExpressionTrace{}}
	if expression.Literal != nil {
		literal := CloneStateValue(*expression.Literal)
		trace.Literal = &literal
	}

	if expression.Operation == ExpressionLiteral {
		if expression.Literal == nil {
			return StateValue{}, ExpressionTrace{}, fmt.Errorf("literal expression has no value")
		}
		trace.Value = CloneStateValue(*expression.Literal)
		return CloneStateValue(trace.Value), trace, nil
	}
	if expression.Operation == ExpressionMechanicReference {
		mechanic, err := e.evaluateMechanic(expression.MechanicID)
		if err != nil {
			return StateValue{}, ExpressionTrace{}, err
		}
		trace.Value = CloneStateValue(mechanic.Effective)
		return CloneStateValue(trace.Value), trace, nil
	}

	values := make([]StateValue, len(expression.Operands))
	for index, operand := range expression.Operands {
		value, operandTrace, err := e.evaluateExpression(operand)
		if err != nil {
			return StateValue{}, ExpressionTrace{}, err
		}
		values[index] = value
		trace.Operands = append(trace.Operands, operandTrace)
	}
	value, err := evaluateExpressionOperation(expression.Operation, values)
	if err != nil {
		return StateValue{}, ExpressionTrace{}, err
	}
	trace.Value = CloneStateValue(value)
	return CloneStateValue(value), trace, nil
}

func evaluateExpressionOperation(operation ExpressionOperation, operands []StateValue) (StateValue, error) {
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
	foldNumbers := func(combine func(Decimal, Decimal) (Decimal, error)) (StateValue, error) {
		if len(operands) < 2 {
			return StateValue{}, fmt.Errorf("%s requires at least two operands", operation)
		}
		result, err := numberAt(0)
		if err != nil {
			return StateValue{}, err
		}
		for index := 1; index < len(operands); index++ {
			next, err := numberAt(index)
			if err != nil {
				return StateValue{}, err
			}
			result, err = combine(result, next)
			if err != nil {
				return StateValue{}, err
			}
		}
		return NewNumberValue(result), nil
	}
	compareNumbers := func(matches func(int) bool) (StateValue, error) {
		if len(operands) != 2 {
			return StateValue{}, fmt.Errorf("%s requires exactly two operands", operation)
		}
		left, err := numberAt(0)
		if err != nil {
			return StateValue{}, err
		}
		right, err := numberAt(1)
		if err != nil {
			return StateValue{}, err
		}
		return NewBooleanValue(matches(left.Cmp(right))), nil
	}

	switch operation {
	case ExpressionLiteral, ExpressionMechanicReference:
		return StateValue{}, fmt.Errorf("%s must be evaluated before operand dispatch", operation)

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
			return StateValue{}, fmt.Errorf("subtract-number requires exactly two operands")
		}
		left, err := numberAt(0)
		if err != nil {
			return StateValue{}, err
		}
		right, err := numberAt(1)
		if err != nil {
			return StateValue{}, err
		}
		result, err := left.Subtract(right)
		if err != nil {
			return StateValue{}, err
		}
		return NewNumberValue(result), nil

	case ExpressionNegateNumber:
		if len(operands) != 1 {
			return StateValue{}, fmt.Errorf("negate-number requires exactly one operand")
		}
		operand, err := numberAt(0)
		if err != nil {
			return StateValue{}, err
		}
		result, err := operand.Negate()
		if err != nil {
			return StateValue{}, err
		}
		return NewNumberValue(result), nil

	case ExpressionAnd, ExpressionOr:
		if len(operands) < 2 {
			return StateValue{}, fmt.Errorf("%s requires at least two operands", operation)
		}
		result := operation == ExpressionAnd
		for index := range operands {
			value, err := booleanAt(index)
			if err != nil {
				return StateValue{}, err
			}
			if operation == ExpressionAnd {
				result = result && value
			} else {
				result = result || value
			}
		}
		return NewBooleanValue(result), nil

	case ExpressionNot:
		if len(operands) != 1 {
			return StateValue{}, fmt.Errorf("not requires exactly one operand")
		}
		value, err := booleanAt(0)
		if err != nil {
			return StateValue{}, err
		}
		return NewBooleanValue(!value), nil

	case ExpressionEqual:
		if len(operands) != 2 || operands[0].Kind != operands[1].Kind {
			return StateValue{}, fmt.Errorf("equal requires two operands of the same scalar kind")
		}
		return NewBooleanValue(StateValuesEqual(operands[0], operands[1])), nil

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
			return StateValue{}, fmt.Errorf("if requires a boolean condition and two same-kind branches")
		}
		if *operands[0].Boolean {
			return CloneStateValue(operands[1]), nil
		}
		return CloneStateValue(operands[2]), nil
	default:
		return StateValue{}, fmt.Errorf("unsupported expression operation %q", operation)
	}
}

func applyModifier(value StateValue, modifier StatusModifier) (StateValue, error) {
	switch modifier.Operation {
	case ModifierSet:
		if value.Kind != modifier.Value.Kind {
			return StateValue{}, fmt.Errorf("set modifier kind does not match current value")
		}
		return CloneStateValue(modifier.Value), nil
	case ModifierAddNumber:
		if value.Kind != ValueNumber || value.Number == nil || modifier.Value.Kind != ValueNumber || modifier.Value.Number == nil {
			return StateValue{}, fmt.Errorf("add-number modifier requires numeric values")
		}
		result, err := value.Number.Add(*modifier.Value.Number)
		if err != nil {
			return StateValue{}, err
		}
		return NewNumberValue(result), nil
	case ModifierMultiplyNumber:
		if value.Kind != ValueNumber || value.Number == nil || modifier.Value.Kind != ValueNumber || modifier.Value.Number == nil {
			return StateValue{}, fmt.Errorf("multiply-number modifier requires numeric values")
		}
		result, err := value.Number.Multiply(*modifier.Value.Number)
		if err != nil {
			return StateValue{}, err
		}
		return NewNumberValue(result), nil
	default:
		return StateValue{}, fmt.Errorf("unsupported modifier operation %q", modifier.Operation)
	}
}

func evaluationError(path, message string) error {
	return domainError(ErrEvaluation, ValidationErrors{validation("evaluation_failed", path, message)})
}
