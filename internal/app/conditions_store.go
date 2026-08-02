package app

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func loadConditionsDomain(ctx context.Context, db queryer, ruleSetID string, definitions map[rules.ID]rules.StateVariableDefinition) (map[rules.ID]rules.ConditionSet, error) {
	rows, err := db.Query(ctx, `select id::text from condition_sets where rule_set_id = $1 order by lower(name), id`, ruleSetID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	result := make(map[rules.ID]rules.ConditionSet, len(ids))
	for _, id := range ids {
		set, err := loadConditionDomain(ctx, db, ruleSetID, id, definitions)
		if err != nil {
			return nil, err
		}
		result[set.ID] = set
	}
	return result, nil
}

func loadConditionDomain(ctx context.Context, db queryer, ruleSetID, conditionID string, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ConditionSet, error) {
	var set rules.ConditionSet
	var id string
	var description *string
	err := db.QueryRow(ctx, `
		select id::text, key, name, description, archived, created_at, updated_at
		from condition_sets where rule_set_id = $1 and id = $2`, ruleSetID, conditionID,
	).Scan(&id, &set.Key, &set.Name, &description, &set.Archived, &set.CreatedAt, &set.UpdatedAt)
	if err != nil {
		return set, err
	}
	set.ID, set.RuleSetID = rules.ID(id), rules.ID(ruleSetID)
	if description != nil {
		set.Description = *description
	}

	rows, err := db.Query(ctx, `
		select id::text, key, label, cardinality, position
		from condition_parameters where rule_set_id = $1 and condition_set_id = $2 order by position`, ruleSetID, conditionID)
	if err != nil {
		return set, err
	}
	for rows.Next() {
		var parameter rules.ConditionParameter
		var parameterID, cardinality string
		if err := rows.Scan(&parameterID, &parameter.Key, &parameter.Label, &cardinality, &parameter.Position); err != nil {
			rows.Close()
			return set, err
		}
		parameter.ID, parameter.Cardinality = rules.ID(parameterID), rules.Cardinality(cardinality)
		set.Parameters = append(set.Parameters, parameter)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return set, err
	}
	rows.Close()
	for index := range set.Parameters {
		set.Parameters[index].RequiredOwnerSchemaIDs, err = loadIDColumn(ctx, db, `
			select owner_schema_id::text from condition_parameter_required_owner_schemas
			where rule_set_id = $1 and condition_parameter_id = $2 order by owner_schema_id`, ruleSetID, set.Parameters[index].ID)
		if err != nil {
			return set, err
		}
	}

	type loadedNode struct {
		expression rules.ConditionExpression
		parentID   *string
	}
	nodes := map[rules.ID]loadedNode{}
	var rootID rules.ID
	rows, err = db.Query(ctx, `
		select n.id::text, n.parent_node_id::text, n.position, n.node_type, n.required_count,
			c.condition_parameter_id::text, c.quantifier, c.required_count,
			c.state_variable_id::text, c.operator,
			np.value::text, np.minimum::text, np.maximum::text, bp.value
		from condition_expression_nodes n
		left join condition_criteria c on c.expression_node_id = n.id
		left join condition_number_predicates np on np.criterion_node_id = n.id
		left join condition_boolean_predicates bp on bp.criterion_node_id = n.id
		where n.rule_set_id = $1 and n.condition_set_id = $2
		order by n.parent_node_id nulls first, n.position, n.id`, ruleSetID, conditionID)
	if err != nil {
		return set, err
	}
	for rows.Next() {
		var nodeID, nodeType string
		var parentID, parameterID, quantifier, variableID, operator *string
		var nodeRequired, criterionRequired *int
		var numberValue, minimum, maximum *string
		var booleanValue *bool
		var position int
		if err := rows.Scan(
			&nodeID, &parentID, &position, &nodeType, &nodeRequired,
			&parameterID, &quantifier, &criterionRequired, &variableID, &operator,
			&numberValue, &minimum, &maximum, &booleanValue,
		); err != nil {
			rows.Close()
			return set, err
		}
		node := rules.ConditionExpression{ID: rules.ID(nodeID), Type: rules.ExpressionType(nodeType), Position: position}
		if nodeRequired != nil {
			node.RequiredCount = *nodeRequired
		}
		if node.Type == rules.ExpressionCriterion {
			if parameterID == nil || quantifier == nil || variableID == nil || operator == nil {
				rows.Close()
				return set, fmt.Errorf("criterion node %s is missing its criterion row", nodeID)
			}
			criterion := &rules.ConditionCriterion{
				ParameterID: rules.ID(*parameterID), Quantifier: rules.ConditionQuantifier(*quantifier),
				StateVariableID: rules.ID(*variableID),
			}
			if criterionRequired != nil {
				criterion.RequiredCount = *criterionRequired
			}
			definition, exists := definitions[criterion.StateVariableID]
			if !exists {
				rows.Close()
				return set, fmt.Errorf("criterion node %s references an unknown variable", nodeID)
			}
			predicate, err := loadPredicateDomain(*operator, definition, numberValue, minimum, maximum, booleanValue)
			if err != nil {
				rows.Close()
				return set, err
			}
			criterion.Predicate = predicate
			node.Criterion = criterion
		}
		nodes[node.ID] = loadedNode{expression: node, parentID: parentID}
		if parentID == nil {
			rootID = node.ID
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return set, err
	}
	rows.Close()
	for nodeID, loaded := range nodes {
		if loaded.expression.Criterion == nil {
			continue
		}
		kind := loaded.expression.Criterion.Predicate.Kind
		if kind != rules.PredicateChoice && kind != rules.PredicateChoiceSet {
			continue
		}
		ids, loadErr := loadIDColumn(ctx, db, `
			select choice_option_id::text from condition_choice_operands
			where criterion_node_id = $1 order by position`, nodeID)
		if loadErr != nil {
			return set, loadErr
		}
		loaded.expression.Criterion.Predicate.ChoiceOptionIDs = ids
		nodes[nodeID] = loaded
	}
	if !rootID.Valid() {
		return set, fmt.Errorf("condition set %s has no root expression", conditionID)
	}
	children := make(map[rules.ID][]rules.ID)
	for nodeID, node := range nodes {
		if node.parentID != nil {
			children[rules.ID(*node.parentID)] = append(children[rules.ID(*node.parentID)], nodeID)
		}
	}
	var assemble func(rules.ID) (rules.ConditionExpression, error)
	visiting := map[rules.ID]bool{}
	assemble = func(nodeID rules.ID) (rules.ConditionExpression, error) {
		loaded, exists := nodes[nodeID]
		if !exists {
			return rules.ConditionExpression{}, fmt.Errorf("condition expression %s is missing", nodeID)
		}
		if visiting[nodeID] {
			return rules.ConditionExpression{}, fmt.Errorf("condition expression tree contains a cycle")
		}
		visiting[nodeID] = true
		childIDs := children[nodeID]
		sort.Slice(childIDs, func(i, j int) bool {
			return nodes[childIDs[i]].expression.Position < nodes[childIDs[j]].expression.Position
		})
		for _, childID := range childIDs {
			child, err := assemble(childID)
			if err != nil {
				return rules.ConditionExpression{}, err
			}
			loaded.expression.Children = append(loaded.expression.Children, child)
		}
		visiting[nodeID] = false
		return loaded.expression, nil
	}
	set.Root, err = assemble(rootID)
	return set, err
}

func loadPredicateDomain(operator string, definition rules.StateVariableDefinition, numberValue, minimum, maximum *string, booleanValue *bool) (rules.Predicate, error) {
	predicate := rules.Predicate{Operator: rules.PredicateOperator(operator)}
	switch definition.ValueKind {
	case rules.ValueNumber:
		predicate.Kind = rules.PredicateNumber
		if operator == string(rules.OperatorBetween) {
			predicate.Kind = rules.PredicateNumberRange
		}
		var err error
		if predicate.NumberValue, err = parseNullableDecimal(numberValue); err != nil {
			return predicate, err
		}
		if predicate.Minimum, err = parseNullableDecimal(minimum); err != nil {
			return predicate, err
		}
		if predicate.Maximum, err = parseNullableDecimal(maximum); err != nil {
			return predicate, err
		}
	case rules.ValueBoolean:
		predicate.Kind = rules.PredicateBoolean
		predicate.BooleanValue = booleanValue
	case rules.ValueChoice:
		predicate.Kind = rules.PredicateChoice
		if operator == string(rules.OperatorOneOf) {
			predicate.Kind = rules.PredicateChoiceSet
		}
	default:
		return predicate, fmt.Errorf("criterion variable kind %s is not supported", definition.ValueKind)
	}
	return predicate, nil
}

func saveConditionDomain(ctx context.Context, server *Server, ruleSetID, conditionID string, set rules.ConditionSet) (rules.ConditionSet, error) {
	tx, err := server.db.Begin(ctx)
	if err != nil {
		return rules.ConditionSet{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Configuration writers use one global order: schema roots (when an
	// operation creates schema references), variable roots, condition roots,
	// problem roots, then entity/state roots. The shared dependency locks make
	// archive checks and a variable's first-use check authoritative until this
	// transaction commits.
	for _, schemaID := range uniqueConditionOwnerSchemaIDs(set) {
		var lockedID string
		if err := tx.QueryRow(ctx, `
			select id::text from state_owner_schemas
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, schemaID).Scan(&lockedID); err != nil {
			return rules.ConditionSet{}, err
		}
	}
	definitionIDs := uniqueConditionVariableIDs(set.Root)
	for _, definitionID := range definitionIDs {
		var lockedID string
		if err := tx.QueryRow(ctx, `
			select id::text from state_variable_definitions
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, definitionID).Scan(&lockedID); err != nil {
			return rules.ConditionSet{}, err
		}
	}

	creating := conditionID == ""
	if creating {
		conditionID = string(set.ID)
		if _, err := tx.Exec(ctx, `
			insert into condition_sets (id, rule_set_id, key, name, description, archived)
			values ($1, $2, $3, $4, $5, false)`, set.ID, set.RuleSetID, set.Key, set.Name, nullableString(set.Description)); err != nil {
			return rules.ConditionSet{}, err
		}
	} else {
		var lockedID string
		if err := tx.QueryRow(ctx, `
			select id::text from condition_sets
			where rule_set_id = $1 and id = $2 for update`, ruleSetID, conditionID).Scan(&lockedID); err != nil {
			return rules.ConditionSet{}, err
		}
	}

	// The request was mapped and validated before opening the transaction.
	// Dependencies may have changed before their shared locks were acquired, so
	// compare references and validate the tree once more against the protected
	// view.
	definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.ConditionSet{}, err
	}
	schemas, err := loadOwnerSchemasDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.ConditionSet{}, err
	}
	var current rules.ConditionSet
	if !creating {
		current, err = loadConditionDomain(ctx, tx, ruleSetID, conditionID, definitions)
		if err != nil {
			return rules.ConditionSet{}, err
		}
	}
	if fields := archivedConditionReferenceFields(set, current, schemas, definitions); len(fields) > 0 {
		return rules.ConditionSet{}, &statusError{
			Status:  http.StatusUnprocessableEntity,
			Code:    "archived_reference",
			Message: "archived resources cannot receive new condition references",
			Fields:  fields,
		}
	}
	if validation := rules.ValidateConditionSet(set, schemas, definitions); len(validation) > 0 {
		return rules.ConditionSet{}, validationStatus("condition set is invalid against current configuration", validation)
	}

	if !creating {
		references, err := lockAndLoadConditionReferences(ctx, tx, ruleSetID, conditionID)
		if err != nil {
			return rules.ConditionSet{}, err
		}
		if err := validateConditionReferences(set, references); err != nil {
			return rules.ConditionSet{}, err
		}
		if _, err := tx.Exec(ctx, `
			update condition_sets set key = $3, name = $4, description = $5, archived = $6
			where rule_set_id = $1 and id = $2`, ruleSetID, conditionID, set.Key, set.Name, nullableString(set.Description), set.Archived); err != nil {
			return rules.ConditionSet{}, err
		}
		if _, err := tx.Exec(ctx, `delete from condition_expression_nodes where rule_set_id = $1 and condition_set_id = $2`, ruleSetID, conditionID); err != nil {
			return rules.ConditionSet{}, err
		}
	}

	if err := mergeConditionParameters(ctx, tx, set); err != nil {
		return rules.ConditionSet{}, err
	}
	if err := insertConditionExpression(ctx, tx, set, set.Root, nil); err != nil {
		return rules.ConditionSet{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return rules.ConditionSet{}, err
	}
	definitions, err = loadDefinitionsDomain(ctx, server.db, ruleSetID)
	if err != nil {
		return rules.ConditionSet{}, err
	}
	return loadConditionDomain(ctx, server.db, ruleSetID, conditionID, definitions)
}

func uniqueConditionOwnerSchemaIDs(set rules.ConditionSet) []rules.ID {
	ids := make(map[rules.ID]struct{})
	for _, parameter := range set.Parameters {
		for _, schemaID := range parameter.RequiredOwnerSchemaIDs {
			ids[schemaID] = struct{}{}
		}
	}
	result := make([]rules.ID, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

// archivedConditionReferenceFields permits an archived dependency only when
// the same stable owned child already referenced it. Metadata, ordering,
// predicates, and other editable details can therefore change without forcing
// an existing archived dependency to be replaced.
func archivedConditionReferenceFields(
	proposed, current rules.ConditionSet,
	schemas map[rules.ID]rules.OwnerSchema,
	definitions map[rules.ID]rules.StateVariableDefinition,
) map[string]string {
	fields := make(map[string]string)
	currentParameterSchemas := make(map[rules.ID]map[rules.ID]struct{}, len(current.Parameters))
	for _, parameter := range current.Parameters {
		references := make(map[rules.ID]struct{}, len(parameter.RequiredOwnerSchemaIDs))
		for _, schemaID := range parameter.RequiredOwnerSchemaIDs {
			references[schemaID] = struct{}{}
		}
		currentParameterSchemas[parameter.ID] = references
	}
	for parameterIndex, parameter := range proposed.Parameters {
		retained := currentParameterSchemas[parameter.ID]
		for schemaIndex, schemaID := range parameter.RequiredOwnerSchemaIDs {
			schema, exists := schemas[schemaID]
			if !exists || !schema.Archived {
				continue
			}
			if _, existed := retained[schemaID]; !existed {
				fields[fmt.Sprintf("parameters[%d].required_owner_schema_ids[%d]", parameterIndex, schemaIndex)] = "archived owner schemas cannot receive new references"
			}
		}
	}

	currentCriteria := make(map[rules.ID]rules.ID)
	visitConditionCriteria(current.Root, "root", func(_ string, expression rules.ConditionExpression) {
		currentCriteria[expression.ID] = expression.Criterion.StateVariableID
	})
	visitConditionCriteria(proposed.Root, "root", func(path string, expression rules.ConditionExpression) {
		variableID := expression.Criterion.StateVariableID
		definition, exists := definitions[variableID]
		if !exists || !definition.Archived {
			return
		}
		if previous, retained := currentCriteria[expression.ID]; !retained || previous != variableID {
			fields[path+".state_variable_id"] = "archived state variables cannot receive new criteria"
		}
	})
	return fields
}

func visitConditionCriteria(expression rules.ConditionExpression, path string, visit func(string, rules.ConditionExpression)) {
	if expression.Criterion != nil {
		visit(path, expression)
		return
	}
	for index, child := range expression.Children {
		visitConditionCriteria(child, fmt.Sprintf("%s.children[%d]", path, index), visit)
	}
}

func uniqueConditionVariableIDs(expression rules.ConditionExpression) []rules.ID {
	set := make(map[rules.ID]struct{})
	var visit func(rules.ConditionExpression)
	visit = func(node rules.ConditionExpression) {
		if node.Criterion != nil {
			set[node.Criterion.StateVariableID] = struct{}{}
		}
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(expression)
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

type conditionReference struct {
	problem    rules.ProblemDefinition
	invocation rules.ConditionInvocation
}

// lockAndLoadConditionReferences follows the configuration lock order used by
// problem saves and resolution: condition roots first, then problem roots in
// UUID order. The condition root is already locked by the caller, so a new
// reference cannot appear while the affected problem set is being discovered.
func lockAndLoadConditionReferences(ctx context.Context, tx pgx.Tx, ruleSetID, conditionID string) ([]conditionReference, error) {
	rows, err := tx.Query(ctx, `
		select distinct problem_definition_id::text
		from condition_invocations
		where rule_set_id = $1 and condition_set_id = $2
		order by problem_definition_id::text`, ruleSetID, conditionID)
	if err != nil {
		return nil, err
	}
	problemIDs := make([]string, 0)
	for rows.Next() {
		var problemID string
		if err := rows.Scan(&problemID); err != nil {
			rows.Close()
			return nil, err
		}
		problemIDs = append(problemIDs, problemID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	for _, problemID := range problemIDs {
		var lockedID string
		if err := tx.QueryRow(ctx, `
			select id::text from problem_definitions
			where rule_set_id = $1 and id = $2 for update`, ruleSetID, problemID).Scan(&lockedID); err != nil {
			return nil, err
		}
	}

	references := make([]conditionReference, 0)
	for _, problemID := range problemIDs {
		problem, err := loadConditionReferenceProblem(ctx, tx, ruleSetID, problemID)
		if err != nil {
			return nil, err
		}
		invocations, err := loadProblemInvocations(ctx, tx, ruleSetID, problemID)
		if err != nil {
			return nil, err
		}
		invocationIDs := make([]rules.ID, 0, len(invocations))
		for invocationID := range invocations {
			invocationIDs = append(invocationIDs, invocationID)
		}
		sort.Slice(invocationIDs, func(i, j int) bool { return invocationIDs[i] < invocationIDs[j] })
		for _, invocationID := range invocationIDs {
			invocation := invocations[invocationID]
			if invocation.ConditionSetID == rules.ID(conditionID) {
				references = append(references, conditionReference{problem: problem, invocation: invocation})
			}
		}
	}
	return references, nil
}

// loadConditionReferenceProblem hydrates the target subset required by
// ValidateConditionInvocation. The problem root is locked by the caller.
func loadConditionReferenceProblem(ctx context.Context, db queryer, ruleSetID, problemID string) (rules.ProblemDefinition, error) {
	problem := rules.ProblemDefinition{ID: rules.ID(problemID), RuleSetID: rules.ID(ruleSetID)}
	rows, err := db.Query(ctx, `
		select id::text, cardinality, minimum_bindings, maximum_bindings
		from problem_target_definitions
		where rule_set_id = $1 and problem_definition_id = $2
		order by id`, ruleSetID, problemID)
	if err != nil {
		return problem, err
	}
	for rows.Next() {
		var target rules.ProblemTargetDefinition
		var targetID, cardinality string
		if err := rows.Scan(&targetID, &cardinality, &target.MinimumBindings, &target.MaximumBindings); err != nil {
			rows.Close()
			return problem, err
		}
		target.ID, target.Cardinality = rules.ID(targetID), rules.Cardinality(cardinality)
		problem.Targets = append(problem.Targets, target)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return problem, err
	}
	rows.Close()
	for index := range problem.Targets {
		problem.Targets[index].RequiredOwnerSchemaIDs, err = loadIDColumn(ctx, db, `
			select owner_schema_id::text from problem_target_required_owner_schemas
			where rule_set_id = $1 and target_definition_id = $2
			order by owner_schema_id`, ruleSetID, problem.Targets[index].ID)
		if err != nil {
			return problem, err
		}
	}
	return problem, nil
}

func validateConditionReferences(set rules.ConditionSet, references []conditionReference) error {
	fields := make(map[string]string)
	for _, reference := range references {
		for _, item := range rules.ValidateConditionInvocation(reference.invocation, reference.problem, set) {
			path := fmt.Sprintf("problem_definitions[%s].%s", reference.problem.ID, item.Path)
			fields[path] = item.Message
		}
	}
	if len(fields) == 0 {
		return nil
	}
	return &statusError{
		Status:  http.StatusConflict,
		Code:    "condition_in_use",
		Message: "condition changes would invalidate existing problem invocations",
		Fields:  fields,
	}
}

func mergeConditionParameters(ctx context.Context, tx pgx.Tx, set rules.ConditionSet) error {
	proposed := make(map[rules.ID]struct{}, len(set.Parameters))
	for _, parameter := range set.Parameters {
		proposed[parameter.ID] = struct{}{}
	}
	rows, err := tx.Query(ctx, `
		select id::text from condition_parameters where rule_set_id = $1 and condition_set_id = $2`, set.RuleSetID, set.ID)
	if err != nil {
		return err
	}
	var removed []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if _, exists := proposed[rules.ID(id)]; !exists {
			removed = append(removed, id)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, id := range removed {
		if _, err := tx.Exec(ctx, `delete from condition_parameters where rule_set_id = $1 and condition_set_id = $2 and id = $3`, set.RuleSetID, set.ID, id); err != nil {
			return err
		}
	}
	// Move retained rows out of the authored position range before reordering.
	if _, err := tx.Exec(ctx, `
		update condition_parameters set position = position + 1000000
		where rule_set_id = $1 and condition_set_id = $2`, set.RuleSetID, set.ID); err != nil {
		return err
	}
	for _, parameter := range set.Parameters {
		command, err := tx.Exec(ctx, `
			update condition_parameters set key = $4, label = $5, cardinality = $6, position = $7
			where id = $1 and condition_set_id = $2 and rule_set_id = $3`,
			parameter.ID, set.ID, set.RuleSetID, parameter.Key, parameter.Label, parameter.Cardinality, parameter.Position)
		if err != nil {
			return err
		}
		if command.RowsAffected() == 0 {
			if _, err := tx.Exec(ctx, `
				insert into condition_parameters (id, rule_set_id, condition_set_id, key, label, cardinality, position)
				values ($1, $2, $3, $4, $5, $6, $7)`,
				parameter.ID, set.RuleSetID, set.ID, parameter.Key, parameter.Label, parameter.Cardinality, parameter.Position); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			delete from condition_parameter_required_owner_schemas
			where rule_set_id = $1 and condition_parameter_id = $2`, set.RuleSetID, parameter.ID); err != nil {
			return err
		}
		for _, schemaID := range parameter.RequiredOwnerSchemaIDs {
			if _, err := tx.Exec(ctx, `
				insert into condition_parameter_required_owner_schemas (condition_parameter_id, rule_set_id, owner_schema_id)
				values ($1, $2, $3)`, parameter.ID, set.RuleSetID, schemaID); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertConditionExpression(ctx context.Context, tx pgx.Tx, set rules.ConditionSet, expression rules.ConditionExpression, parentID *rules.ID) error {
	var parent any
	if parentID != nil {
		parent = string(*parentID)
	}
	var required any
	if expression.Type == rules.ExpressionAtLeast {
		required = expression.RequiredCount
	}
	if _, err := tx.Exec(ctx, `
		insert into condition_expression_nodes (id, rule_set_id, condition_set_id, parent_node_id, position, node_type, required_count)
		values ($1, $2, $3, $4, $5, $6, $7)`, expression.ID, set.RuleSetID, set.ID, parent, expression.Position, expression.Type, required); err != nil {
		return err
	}
	if expression.Type == rules.ExpressionCriterion && expression.Criterion != nil {
		criterion := expression.Criterion
		var criterionRequired any
		if criterion.Quantifier == rules.QuantifierAtLeast {
			criterionRequired = criterion.RequiredCount
		}
		if _, err := tx.Exec(ctx, `
			insert into condition_criteria (
				expression_node_id, condition_set_id, rule_set_id, condition_parameter_id,
				state_variable_id, quantifier, required_count, operator
			) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			expression.ID, set.ID, set.RuleSetID, criterion.ParameterID, criterion.StateVariableID,
			criterion.Quantifier, criterionRequired, criterion.Predicate.Operator,
		); err != nil {
			return err
		}
		if err := insertConditionPredicate(ctx, tx, expression.ID, criterion.Predicate); err != nil {
			return err
		}
	}
	for _, child := range expression.Children {
		parent := expression.ID
		if err := insertConditionExpression(ctx, tx, set, child, &parent); err != nil {
			return err
		}
	}
	return nil
}

func insertConditionPredicate(ctx context.Context, tx pgx.Tx, nodeID rules.ID, predicate rules.Predicate) error {
	switch predicate.Kind {
	case rules.PredicateNumber:
		_, err := tx.Exec(ctx, `
			insert into condition_number_predicates (criterion_node_id, value)
			values ($1, $2)`, nodeID, decimalDatabase(predicate.NumberValue))
		return err
	case rules.PredicateNumberRange:
		_, err := tx.Exec(ctx, `
			insert into condition_number_predicates (criterion_node_id, minimum, maximum)
			values ($1, $2, $3)`, nodeID, decimalDatabase(predicate.Minimum), decimalDatabase(predicate.Maximum))
		return err
	case rules.PredicateBoolean:
		_, err := tx.Exec(ctx, `
			insert into condition_boolean_predicates (criterion_node_id, value)
			values ($1, $2)`, nodeID, *predicate.BooleanValue)
		return err
	case rules.PredicateChoice, rules.PredicateChoiceSet:
		for position, optionID := range predicate.ChoiceOptionIDs {
			if _, err := tx.Exec(ctx, `
				insert into condition_choice_operands (criterion_node_id, choice_option_id, position)
				values ($1, $2, $3)`, nodeID, optionID, position); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported predicate kind %s", predicate.Kind)
	}
}

func sortedConditionSlice(conditions map[rules.ID]rules.ConditionSet) []rules.ConditionSet {
	result := make([]rules.ConditionSet, 0, len(conditions))
	for _, set := range conditions {
		result = append(result, set)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Archived != result[j].Archived {
			return !result[i].Archived
		}
		if strings.ToLower(result[i].Name) != strings.ToLower(result[j].Name) {
			return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
		}
		return result[i].ID < result[j].ID
	})
	return result
}
