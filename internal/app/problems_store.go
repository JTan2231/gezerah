package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

type loadedProblemInstance struct {
	Instance      rules.ProblemInstance
	Entity        rules.Entity
	StateRevision int64
}

type loadedProblemSnapshot struct {
	Problem     rules.ProblemDefinition
	Definitions map[rules.ID]rules.StateVariableDefinition
}

type loadedProblemInstanceSnapshot struct {
	Loaded  loadedProblemInstance
	Problem rules.ProblemDefinition
}

// readProblemSnapshot gives every multi-query aggregate read one coherent
// database snapshot. A pool alone may route successive statements to
// different connections, and Read Committed can mix children from before and
// after a whole-resource save.
func readProblemSnapshot[T any](ctx context.Context, server *Server, read func(pgx.Tx) (T, error)) (T, error) {
	var zero T
	tx, err := server.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return zero, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	value, err := read(tx)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	return value, nil
}

func loadOneProblemSnapshot(ctx context.Context, server *Server, ruleSetID, problemID string) (loadedProblemSnapshot, error) {
	return readProblemSnapshot(ctx, server, func(tx pgx.Tx) (loadedProblemSnapshot, error) {
		definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
		if err != nil {
			return loadedProblemSnapshot{}, err
		}
		problem, err := loadProblemDomain(ctx, tx, ruleSetID, problemID, definitions)
		if err != nil {
			return loadedProblemSnapshot{}, err
		}
		schemas, err := loadOwnerSchemasDomain(ctx, tx, ruleSetID)
		if err != nil {
			return loadedProblemSnapshot{}, err
		}
		entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
		if err != nil {
			return loadedProblemSnapshot{}, err
		}
		conditions, err := loadConditionsDomain(ctx, tx, ruleSetID, definitions)
		if err != nil {
			return loadedProblemSnapshot{}, err
		}
		if validation := rules.ValidateProblemDefinition(problem, schemas, definitions, conditions, entities); len(validation) > 0 {
			return loadedProblemSnapshot{}, fmt.Errorf("stored problem %s is invalid: %w", problemID, validation)
		}
		return loadedProblemSnapshot{Problem: problem, Definitions: definitions}, nil
	})
}

func loadProblemsDomain(ctx context.Context, db queryer, ruleSetID string, definitions map[rules.ID]rules.StateVariableDefinition) (map[rules.ID]rules.ProblemDefinition, error) {
	rows, err := db.Query(ctx, `
		select id::text from problem_definitions
		where rule_set_id = $1 order by lower(name), id`, ruleSetID)
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
	result := make(map[rules.ID]rules.ProblemDefinition, len(ids))
	for _, id := range ids {
		problem, err := loadProblemDomain(ctx, db, ruleSetID, id, definitions)
		if err != nil {
			return nil, err
		}
		result[problem.ID] = problem
	}
	return result, nil
}

func loadProblemDomain(ctx context.Context, db queryer, ruleSetID, problemID string, definitions map[rules.ID]rules.StateVariableDefinition) (rules.ProblemDefinition, error) {
	var problem rules.ProblemDefinition
	var id string
	var description, availableInvocationID *string
	err := db.QueryRow(ctx, `
		select id::text, key, name, description, available_condition_invocation_id::text,
			archived, created_at, updated_at
		from problem_definitions where rule_set_id = $1 and id = $2`, ruleSetID, problemID,
	).Scan(&id, &problem.Key, &problem.Name, &description, &availableInvocationID, &problem.Archived, &problem.CreatedAt, &problem.UpdatedAt)
	if err != nil {
		return problem, err
	}
	problem.ID, problem.RuleSetID = rules.ID(id), rules.ID(ruleSetID)
	if description != nil {
		problem.Description = *description
	}
	problem.InstanceOwnerSchemaIDs, err = loadIDColumn(ctx, db, `
		select owner_schema_id::text from problem_definition_instance_owner_schemas
		where rule_set_id = $1 and problem_definition_id = $2 order by owner_schema_id`, ruleSetID, problemID)
	if err != nil {
		return problem, err
	}

	rows, err := db.Query(ctx, `
		select id::text, key, label, description, cardinality, minimum_bindings,
			maximum_bindings, binding_source, position
		from problem_target_definitions
		where rule_set_id = $1 and problem_definition_id = $2 order by position`, ruleSetID, problemID)
	if err != nil {
		return problem, err
	}
	loadedTargets := make([]rules.ProblemTargetDefinition, 0)
	for rows.Next() {
		var target rules.ProblemTargetDefinition
		var targetID, cardinality, bindingSource string
		var targetDescription *string
		if err := rows.Scan(
			&targetID, &target.Key, &target.Label, &targetDescription, &cardinality,
			&target.MinimumBindings, &target.MaximumBindings, &bindingSource, &target.Position,
		); err != nil {
			rows.Close()
			return problem, err
		}
		target.ID = rules.ID(targetID)
		target.Cardinality, target.BindingSource = rules.Cardinality(cardinality), rules.BindingSource(bindingSource)
		if targetDescription != nil {
			target.Description = *targetDescription
		}
		loadedTargets = append(loadedTargets, target)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return problem, err
	}
	rows.Close()
	for _, target := range loadedTargets {
		target.RequiredOwnerSchemaIDs, err = loadIDColumn(ctx, db, `
			select owner_schema_id::text from problem_target_required_owner_schemas
			where rule_set_id = $1 and target_definition_id = $2 order by owner_schema_id`, ruleSetID, target.ID)
		if err != nil {
			return problem, err
		}
		problem.Targets = append(problem.Targets, target)
	}

	invocations, err := loadProblemInvocations(ctx, db, ruleSetID, problemID)
	if err != nil {
		return problem, err
	}
	if availableInvocationID != nil {
		invocation, exists := invocations[rules.ID(*availableInvocationID)]
		if !exists {
			return problem, fmt.Errorf("problem availability invocation %s is missing", *availableInvocationID)
		}
		problem.AvailableWhen = cloneInvocationValue(invocation)
	}

	rows, err = db.Query(ctx, `
		select id::text, key, name, description, position, available_condition_invocation_id::text
		from problem_choices where rule_set_id = $1 and problem_definition_id = $2 order by position`, ruleSetID, problemID)
	if err != nil {
		return problem, err
	}
	type loadedChoice struct {
		choice      rules.ChoiceDefinition
		availableID *string
	}
	loadedChoices := make([]loadedChoice, 0)
	for rows.Next() {
		var choice rules.ChoiceDefinition
		var choiceID string
		var choiceDescription, choiceAvailableID *string
		if err := rows.Scan(&choiceID, &choice.Key, &choice.Name, &choiceDescription, &choice.Position, &choiceAvailableID); err != nil {
			rows.Close()
			return problem, err
		}
		choice.ID = rules.ID(choiceID)
		if choiceDescription != nil {
			choice.Description = *choiceDescription
		}
		loadedChoices = append(loadedChoices, loadedChoice{choice: choice, availableID: choiceAvailableID})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return problem, err
	}
	rows.Close()
	for _, loaded := range loadedChoices {
		choice := loaded.choice
		if loaded.availableID != nil {
			invocation, exists := invocations[rules.ID(*loaded.availableID)]
			if !exists {
				return problem, fmt.Errorf("choice availability invocation %s is missing", *loaded.availableID)
			}
			choice.AvailableWhen = cloneInvocationValue(invocation)
		}
		if err := loadChoiceResolution(ctx, db, ruleSetID, string(choice.ID), invocations, definitions, &choice); err != nil {
			return problem, err
		}
		problem.Choices = append(problem.Choices, choice)
	}
	if len(problem.Choices) == 0 {
		return problem, fmt.Errorf("problem %s has no stored choices", problem.ID)
	}
	return problem, nil
}

func loadProblemInvocations(ctx context.Context, db queryer, ruleSetID, problemID string) (map[rules.ID]rules.ConditionInvocation, error) {
	rows, err := db.Query(ctx, `
		select id::text, condition_set_id::text from condition_invocations
		where rule_set_id = $1 and problem_definition_id = $2 order by id`, ruleSetID, problemID)
	if err != nil {
		return nil, err
	}
	result := make(map[rules.ID]rules.ConditionInvocation)
	for rows.Next() {
		var id, conditionID string
		if err := rows.Scan(&id, &conditionID); err != nil {
			rows.Close()
			return nil, err
		}
		invocation := rules.ConditionInvocation{ID: rules.ID(id), ConditionSetID: rules.ID(conditionID)}
		result[invocation.ID] = invocation
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	invocationIDs := make([]rules.ID, 0, len(result))
	for id := range result {
		invocationIDs = append(invocationIDs, id)
	}
	sort.Slice(invocationIDs, func(i, j int) bool { return invocationIDs[i] < invocationIDs[j] })
	for _, invocationID := range invocationIDs {
		invocation := result[invocationID]
		argumentRows, err := db.Query(ctx, `
			select condition_parameter_id::text, target_definition_id::text
			from condition_invocation_arguments
			where rule_set_id = $1 and condition_invocation_id = $2
			order by condition_parameter_id`, ruleSetID, invocationID)
		if err != nil {
			return nil, err
		}
		for argumentRows.Next() {
			var parameterID, targetID string
			if err := argumentRows.Scan(&parameterID, &targetID); err != nil {
				argumentRows.Close()
				return nil, err
			}
			invocation.Arguments = append(invocation.Arguments, rules.ConditionInvocationArgument{
				ParameterID: rules.ID(parameterID), TargetDefinitionID: rules.ID(targetID),
			})
		}
		if err := argumentRows.Err(); err != nil {
			argumentRows.Close()
			return nil, err
		}
		argumentRows.Close()
		result[invocation.ID] = invocation
	}
	return result, nil
}

func loadChoiceResolution(ctx context.Context, db queryer, ruleSetID, choiceID string, invocations map[rules.ID]rules.ConditionInvocation, definitions map[rules.ID]rules.StateVariableDefinition, choice *rules.ChoiceDefinition) error {
	var resolutionType string
	var invocationID *string
	if err := db.QueryRow(ctx, `
		select resolution_type, condition_invocation_id::text from choice_resolutions
		where rule_set_id = $1 and choice_id = $2`, ruleSetID, choiceID,
	).Scan(&resolutionType, &invocationID); err != nil {
		return err
	}
	choice.Resolution.Type = rules.ResolutionType(resolutionType)
	if invocationID != nil {
		invocation, exists := invocations[rules.ID(*invocationID)]
		if !exists {
			return fmt.Errorf("choice resolution invocation %s is missing", *invocationID)
		}
		choice.Resolution.Invocation = cloneInvocationValue(invocation)
	}
	rows, err := db.Query(ctx, `
		select id::text, branch, label from choice_outcomes
		where rule_set_id = $1 and choice_id = $2 order by branch`, ruleSetID, choiceID)
	if err != nil {
		return err
	}
	outcomes := make([]rules.ChoiceOutcome, 0)
	for rows.Next() {
		var outcome rules.ChoiceOutcome
		var outcomeID, branch string
		if err := rows.Scan(&outcomeID, &branch, &outcome.Label); err != nil {
			rows.Close()
			return err
		}
		outcome.ID, outcome.Branch = rules.ID(outcomeID), rules.OutcomeBranch(branch)
		outcomes = append(outcomes, outcome)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, outcome := range outcomes {
		if err := loadConsequenceSet(ctx, db, ruleSetID, string(outcome.ID), definitions, &outcome.Consequences); err != nil {
			return err
		}
		switch outcome.Branch {
		case rules.OutcomeAutomatic:
			choice.Resolution.Automatic = &outcome
		case rules.OutcomeMet:
			choice.Resolution.Met = &outcome
		case rules.OutcomeUnmet:
			choice.Resolution.Unmet = &outcome
		default:
			return fmt.Errorf("stored outcome branch %q is unsupported", outcome.Branch)
		}
	}
	switch choice.Resolution.Type {
	case rules.ResolutionAutomatic:
		if choice.Resolution.Invocation != nil || choice.Resolution.Automatic == nil || choice.Resolution.Met != nil || choice.Resolution.Unmet != nil {
			return fmt.Errorf("choice %s has malformed stored automatic resolution", choice.ID)
		}
	case rules.ResolutionCondition:
		if choice.Resolution.Invocation == nil || choice.Resolution.Automatic != nil || choice.Resolution.Met == nil || choice.Resolution.Unmet == nil {
			return fmt.Errorf("choice %s has malformed stored conditional resolution", choice.ID)
		}
	default:
		return fmt.Errorf("choice %s has unsupported stored resolution type %q", choice.ID, choice.Resolution.Type)
	}
	return nil
}

func loadConsequenceSet(ctx context.Context, db queryer, ruleSetID, outcomeID string, definitions map[rules.ID]rules.StateVariableDefinition, consequence *rules.ConsequenceSet) error {
	var consequenceID string
	if err := db.QueryRow(ctx, `
		select id::text from consequence_sets where rule_set_id = $1 and outcome_id = $2`, ruleSetID, outcomeID,
	).Scan(&consequenceID); err != nil {
		return err
	}
	consequence.ID = rules.ID(consequenceID)
	rows, err := db.Query(ctx, `
		select id::text, position, operation, target_definition_id::text,
			state_variable_id::text, adjustment_amount::text
		from effects where rule_set_id = $1 and consequence_set_id = $2 order by position`, ruleSetID, consequenceID)
	if err != nil {
		return err
	}
	effects := make([]rules.Effect, 0)
	for rows.Next() {
		var effect rules.Effect
		var effectID, operation, targetID, definitionID string
		var adjustment *string
		if err := rows.Scan(&effectID, &effect.Position, &operation, &targetID, &definitionID, &adjustment); err != nil {
			rows.Close()
			return err
		}
		effect.ID = rules.ID(effectID)
		effect.Operation = rules.EffectOperation(operation)
		effect.TargetDefinitionID, effect.StateVariableID = rules.ID(targetID), rules.ID(definitionID)
		if adjustment != nil {
			parsed, err := rules.ParseDecimal(*adjustment)
			if err != nil {
				rows.Close()
				return err
			}
			effect.AdjustmentAmount = &parsed
		}
		if effect.Operation == rules.EffectAdjustNumber && effect.AdjustmentAmount == nil {
			rows.Close()
			return fmt.Errorf("effect %s is missing its adjustment amount", effect.ID)
		}
		if effect.Operation != rules.EffectAdjustNumber && effect.AdjustmentAmount != nil {
			rows.Close()
			return fmt.Errorf("effect %s has an unexpected adjustment amount", effect.ID)
		}
		effects = append(effects, effect)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, effect := range effects {
		definition, exists := definitions[effect.StateVariableID]
		if !exists {
			return fmt.Errorf("effect %s references missing state variable %s", effect.ID, effect.StateVariableID)
		}
		if err := loadEffectOperand(ctx, db, ruleSetID, string(effect.ID), definition, &effect); err != nil {
			return err
		}
		consequence.Effects = append(consequence.Effects, effect)
	}
	return nil
}

func loadEffectOperand(ctx context.Context, db queryer, ruleSetID, effectID string, definition rules.StateVariableDefinition, effect *rules.Effect) error {
	rows, err := db.Query(ctx, `
		select value_kind, text_value, number_value::text, boolean_value, choice_option_id::text,
			measurement_amount::text, measurement_unit_id::text, referenced_entity_id::text, fallback_name
		from effect_value_operands where rule_set_id = $1 and effect_id = $2 order by position`, ruleSetID, effectID)
	if err != nil {
		return err
	}
	values := make([]rules.ScalarValue, 0)
	for rows.Next() {
		scalar, err := scanScalar(rows)
		if err != nil {
			rows.Close()
			return err
		}
		values = append(values, scalar)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	switch effect.Operation {
	case rules.EffectSet:
		if definition.Cardinality == rules.CardinalityOne && len(values) != 1 {
			return fmt.Errorf("effect %s has %d operands; scalar set requires exactly one", effect.ID, len(values))
		}
		operand := rules.StateValue{Cardinality: definition.Cardinality, Values: values}
		effect.Operand = &operand
	case rules.EffectAddValue, rules.EffectRemoveValue:
		if len(values) != 1 {
			return fmt.Errorf("effect %s has %d operands; add/remove requires exactly one", effect.ID, len(values))
		}
		operand := rules.StateValue{Cardinality: rules.CardinalityOne, Values: values}
		effect.Operand = &operand
	case rules.EffectClear, rules.EffectAdjustNumber:
		if len(values) != 0 {
			return fmt.Errorf("effect %s has unexpected operand rows", effect.ID)
		}
	default:
		return fmt.Errorf("effect %s has unsupported stored operation %q", effect.ID, effect.Operation)
	}
	return nil
}

func cloneInvocationValue(invocation rules.ConditionInvocation) *rules.ConditionInvocation {
	copy := invocation
	copy.Arguments = append([]rules.ConditionInvocationArgument(nil), invocation.Arguments...)
	return &copy
}

func sortedProblemSlice(problems map[rules.ID]rules.ProblemDefinition) []rules.ProblemDefinition {
	result := make([]rules.ProblemDefinition, 0, len(problems))
	for _, problem := range problems {
		result = append(result, problem)
	}
	sort.Slice(result, func(i, j int) bool {
		if strings.ToLower(result[i].Name) != strings.ToLower(result[j].Name) {
			return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
		}
		return result[i].ID < result[j].ID
	})
	return result
}

func saveProblemDomain(ctx context.Context, server *Server, ruleSetID, existingID string, proposed rules.ProblemDefinition) (rules.ProblemDefinition, error) {
	tx, err := server.db.Begin(ctx)
	if err != nil {
		return rules.ProblemDefinition{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	// Schema roots have no downstream lock dependencies. Configuration writers
	// then use one global order: variable roots, condition roots, problem root,
	// and finally entity/state roots.
	for _, schemaID := range problemOwnerSchemaIDs(proposed) {
		var locked string
		if err := tx.QueryRow(ctx, `
			select id::text from state_owner_schemas
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, schemaID,
		).Scan(&locked); err != nil {
			return rules.ProblemDefinition{}, err
		}
	}
	for _, definitionID := range problemStateVariableIDs(proposed) {
		var locked string
		if err := tx.QueryRow(ctx, `
			select id::text from state_variable_definitions
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, definitionID,
		).Scan(&locked); err != nil {
			return rules.ProblemDefinition{}, err
		}
	}
	for _, conditionID := range problemConditionIDs(proposed) {
		var locked string
		if err := tx.QueryRow(ctx, `
			select id::text from condition_sets where rule_set_id = $1 and id = $2 for update`, ruleSetID, conditionID,
		).Scan(&locked); err != nil {
			return rules.ProblemDefinition{}, err
		}
	}
	creating := existingID == ""
	var current rules.ProblemDefinition
	if creating {
		_, err = tx.Exec(ctx, `
			insert into problem_definitions (id, rule_set_id, key, name, description, archived)
			values ($1, $2, $3, $4, $5, $6)`,
			proposed.ID, proposed.RuleSetID, proposed.Key, proposed.Name, nullableString(proposed.Description), proposed.Archived)
		if err != nil {
			return rules.ProblemDefinition{}, err
		}
		existingID = string(proposed.ID)
	} else {
		var locked string
		if err := tx.QueryRow(ctx, `
			select id::text from problem_definitions where rule_set_id = $1 and id = $2 for update`, ruleSetID, existingID,
		).Scan(&locked); err != nil {
			return rules.ProblemDefinition{}, err
		}
	}

	// Request validation happens before the transaction for a responsive API,
	// but referenced conditions or variables may have changed before their
	// locks were acquired. Rebuild every dependency from the locked view and
	// validate once more before writing any owned structure.
	definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.ProblemDefinition{}, err
	}
	if !creating {
		current, err = loadProblemDomain(ctx, tx, ruleSetID, existingID, definitions)
		if err != nil {
			return rules.ProblemDefinition{}, err
		}
	}
	schemas, err := loadOwnerSchemasDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.ProblemDefinition{}, err
	}
	validationEntityIDs, err := problemValidationEntityIDs(ctx, tx, ruleSetID, current, proposed)
	if err != nil {
		return rules.ProblemDefinition{}, err
	}
	if err := lockEntityAndStateRoots(ctx, tx, ruleSetID, validationEntityIDs); err != nil {
		return rules.ProblemDefinition{}, err
	}
	entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.ProblemDefinition{}, err
	}
	conditions, err := loadConditionsDomain(ctx, tx, ruleSetID, definitions)
	if err != nil {
		return rules.ProblemDefinition{}, err
	}
	if validation := rules.ValidateProblemDefinition(proposed, schemas, definitions, conditions, entities); len(validation) > 0 {
		return rules.ProblemDefinition{}, validationStatus("problem definition is invalid", validation)
	}
	if fields := archivedProblemReferenceFields(proposed, current, schemas, definitions, conditions); len(fields) > 0 {
		return rules.ProblemDefinition{}, &statusError{
			Status: http.StatusUnprocessableEntity, Code: "archived_reference",
			Message: "archived resources cannot receive new problem references", Fields: fields,
		}
	}

	if !creating {
		if err := validateProblemInstancesForUpdate(ctx, tx, ruleSetID, current, proposed, entities); err != nil {
			return rules.ProblemDefinition{}, err
		}
		if _, err := tx.Exec(ctx, `
			update problem_definitions set key = $3, name = $4, description = $5,
				available_condition_invocation_id = null, archived = $6
			where rule_set_id = $1 and id = $2`,
			ruleSetID, existingID, proposed.Key, proposed.Name, nullableString(proposed.Description), proposed.Archived); err != nil {
			return rules.ProblemDefinition{}, err
		}
		if err := clearProblemOwnedStructure(ctx, tx, ruleSetID, existingID); err != nil {
			return rules.ProblemDefinition{}, err
		}
		if err := mergeProblemTargets(ctx, tx, ruleSetID, existingID, current.Targets, proposed.Targets); err != nil {
			return rules.ProblemDefinition{}, err
		}
	}
	if creating {
		if err := mergeProblemTargets(ctx, tx, ruleSetID, existingID, nil, proposed.Targets); err != nil {
			return rules.ProblemDefinition{}, err
		}
	}
	if err := replaceProblemInstanceSchemas(ctx, tx, proposed); err != nil {
		return rules.ProblemDefinition{}, err
	}
	if err := insertProblemOwnedStructure(ctx, tx, proposed, ruleSetID, definitions); err != nil {
		return rules.ProblemDefinition{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return rules.ProblemDefinition{}, err
	}
	return readProblemSnapshot(ctx, server, func(tx pgx.Tx) (rules.ProblemDefinition, error) {
		currentDefinitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
		if err != nil {
			return rules.ProblemDefinition{}, err
		}
		return loadProblemDomain(ctx, tx, ruleSetID, existingID, currentDefinitions)
	})
}

func problemConditionIDs(problem rules.ProblemDefinition) []rules.ID {
	set := make(map[rules.ID]struct{})
	add := func(invocation *rules.ConditionInvocation) {
		if invocation != nil {
			set[invocation.ConditionSetID] = struct{}{}
		}
	}
	add(problem.AvailableWhen)
	for _, choice := range problem.Choices {
		add(choice.AvailableWhen)
		add(choice.Resolution.Invocation)
	}
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func problemStateVariableIDs(problem rules.ProblemDefinition) []rules.ID {
	set := make(map[rules.ID]struct{})
	for _, choice := range problem.Choices {
		for _, outcome := range []*rules.ChoiceOutcome{choice.Resolution.Automatic, choice.Resolution.Met, choice.Resolution.Unmet} {
			if outcome == nil {
				continue
			}
			for _, effect := range outcome.Consequences.Effects {
				set[effect.StateVariableID] = struct{}{}
			}
		}
	}
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func problemOwnerSchemaIDs(problem rules.ProblemDefinition) []rules.ID {
	set := make(map[rules.ID]struct{}, len(problem.InstanceOwnerSchemaIDs))
	for _, id := range problem.InstanceOwnerSchemaIDs {
		set[id] = struct{}{}
	}
	for _, target := range problem.Targets {
		for _, id := range target.RequiredOwnerSchemaIDs {
			set[id] = struct{}{}
		}
	}
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func clearProblemOwnedStructure(ctx context.Context, tx pgx.Tx, ruleSetID, problemID string) error {
	if _, err := tx.Exec(ctx, `delete from problem_choices where rule_set_id = $1 and problem_definition_id = $2`, ruleSetID, problemID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from condition_invocations where rule_set_id = $1 and problem_definition_id = $2`, ruleSetID, problemID); err != nil {
		return err
	}
	return nil
}

func mergeProblemTargets(ctx context.Context, tx pgx.Tx, ruleSetID, problemID string, current, proposed []rules.ProblemTargetDefinition) error {
	currentByID := make(map[rules.ID]rules.ProblemTargetDefinition, len(current))
	proposedByID := make(map[rules.ID]rules.ProblemTargetDefinition, len(proposed))
	for _, target := range current {
		currentByID[target.ID] = target
	}
	// Move current rows out of the unique key/position namespace first so an
	// authored reorder or key swap can be applied without transient conflicts.
	if len(current) > 0 {
		if _, err := tx.Exec(ctx, `
			update problem_target_definitions
			set position = position + 1000000, key = '__temporary__-' || id::text
			where rule_set_id = $1 and problem_definition_id = $2`, ruleSetID, problemID); err != nil {
			return err
		}
	}
	for _, target := range proposed {
		proposedByID[target.ID] = target
		if _, exists := currentByID[target.ID]; exists {
			_, err := tx.Exec(ctx, `
				update problem_target_definitions set key = $4, label = $5, description = $6,
					cardinality = $7, minimum_bindings = $8, maximum_bindings = $9,
					binding_source = $10, position = $11
				where rule_set_id = $1 and problem_definition_id = $2 and id = $3`,
				ruleSetID, problemID, target.ID, target.Key, target.Label, nullableString(target.Description),
				target.Cardinality, target.MinimumBindings, target.MaximumBindings, target.BindingSource, target.Position)
			if err != nil {
				return err
			}
		} else {
			_, err := tx.Exec(ctx, `
				insert into problem_target_definitions (
					id, rule_set_id, problem_definition_id, key, label, description,
					cardinality, minimum_bindings, maximum_bindings, binding_source, position
				) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				target.ID, ruleSetID, problemID, target.Key, target.Label, nullableString(target.Description),
				target.Cardinality, target.MinimumBindings, target.MaximumBindings, target.BindingSource, target.Position)
			if err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `delete from problem_target_required_owner_schemas where rule_set_id = $1 and target_definition_id = $2`, ruleSetID, target.ID); err != nil {
			return err
		}
		for _, schemaID := range target.RequiredOwnerSchemaIDs {
			if _, err := tx.Exec(ctx, `
				insert into problem_target_required_owner_schemas (target_definition_id, rule_set_id, owner_schema_id)
				values ($1, $2, $3)`, target.ID, ruleSetID, schemaID); err != nil {
				return err
			}
		}
	}
	for _, target := range current {
		if _, exists := proposedByID[target.ID]; exists {
			continue
		}
		var bindingCount int
		if err := tx.QueryRow(ctx, `
			select count(*) from problem_instance_target_bindings
			where rule_set_id = $1 and target_definition_id = $2`, ruleSetID, target.ID).Scan(&bindingCount); err != nil {
			return err
		}
		if bindingCount > 0 {
			return &statusError{
				Status: http.StatusConflict, Code: "target_in_use",
				Message: "a target with existing instance bindings cannot be removed",
				Fields:  map[string]string{"targets[" + string(target.ID) + "]": "has existing problem-instance bindings"},
			}
		}
		command, err := tx.Exec(ctx, `
			delete from problem_target_definitions
			where rule_set_id = $1 and problem_definition_id = $2 and id = $3`, ruleSetID, problemID, target.ID)
		if err != nil {
			return err
		}
		if command.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
	}
	return nil
}

func replaceProblemInstanceSchemas(ctx context.Context, tx pgx.Tx, problem rules.ProblemDefinition) error {
	if _, err := tx.Exec(ctx, `
		delete from problem_definition_instance_owner_schemas
		where rule_set_id = $1 and problem_definition_id = $2`, problem.RuleSetID, problem.ID); err != nil {
		return err
	}
	for _, schemaID := range problem.InstanceOwnerSchemaIDs {
		if _, err := tx.Exec(ctx, `
			insert into problem_definition_instance_owner_schemas (problem_definition_id, rule_set_id, owner_schema_id)
			values ($1, $2, $3)`, problem.ID, problem.RuleSetID, schemaID); err != nil {
			return err
		}
	}
	return nil
}

func insertProblemOwnedStructure(ctx context.Context, tx pgx.Tx, problem rules.ProblemDefinition, ruleSetID string, definitions map[rules.ID]rules.StateVariableDefinition) error {
	invocations := collectProblemInvocations(problem)
	for _, invocation := range invocations {
		if _, err := tx.Exec(ctx, `
			insert into condition_invocations (id, rule_set_id, problem_definition_id, condition_set_id)
			values ($1, $2, $3, $4)`, invocation.ID, ruleSetID, problem.ID, invocation.ConditionSetID); err != nil {
			return err
		}
		for _, argument := range invocation.Arguments {
			if _, err := tx.Exec(ctx, `
				insert into condition_invocation_arguments (
					condition_invocation_id, rule_set_id, condition_parameter_id, target_definition_id
				) values ($1, $2, $3, $4)`, invocation.ID, ruleSetID, argument.ParameterID, argument.TargetDefinitionID); err != nil {
				return err
			}
		}
	}
	if problem.AvailableWhen != nil {
		if _, err := tx.Exec(ctx, `
			update problem_definitions set available_condition_invocation_id = $3
			where rule_set_id = $1 and id = $2`, ruleSetID, problem.ID, problem.AvailableWhen.ID); err != nil {
			return err
		}
	}
	for _, choice := range problem.Choices {
		var availableID any
		if choice.AvailableWhen != nil {
			availableID = choice.AvailableWhen.ID
		}
		if _, err := tx.Exec(ctx, `
			insert into problem_choices (
				id, rule_set_id, problem_definition_id, key, name, description, position, available_condition_invocation_id
			) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			choice.ID, ruleSetID, problem.ID, choice.Key, choice.Name, nullableString(choice.Description), choice.Position, availableID); err != nil {
			return err
		}
		var resolutionInvocationID any
		if choice.Resolution.Invocation != nil {
			resolutionInvocationID = choice.Resolution.Invocation.ID
		}
		if _, err := tx.Exec(ctx, `
			insert into choice_resolutions (choice_id, rule_set_id, resolution_type, condition_invocation_id)
			values ($1, $2, $3, $4)`, choice.ID, ruleSetID, choice.Resolution.Type, resolutionInvocationID); err != nil {
			return err
		}
		for _, outcome := range []*rules.ChoiceOutcome{choice.Resolution.Automatic, choice.Resolution.Met, choice.Resolution.Unmet} {
			if outcome == nil {
				continue
			}
			if _, err := tx.Exec(ctx, `
				insert into choice_outcomes (id, rule_set_id, choice_id, branch, label)
				values ($1, $2, $3, $4, $5)`, outcome.ID, ruleSetID, choice.ID, outcome.Branch, outcome.Label); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				insert into consequence_sets (id, rule_set_id, outcome_id)
				values ($1, $2, $3)`, outcome.Consequences.ID, ruleSetID, outcome.ID); err != nil {
				return err
			}
			for _, effect := range outcome.Consequences.Effects {
				if err := insertProblemEffect(ctx, tx, ruleSetID, outcome.Consequences.ID, effect, definitions[effect.StateVariableID]); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func collectProblemInvocations(problem rules.ProblemDefinition) []rules.ConditionInvocation {
	result := make([]rules.ConditionInvocation, 0)
	if problem.AvailableWhen != nil {
		result = append(result, *problem.AvailableWhen)
	}
	for _, choice := range problem.Choices {
		if choice.AvailableWhen != nil {
			result = append(result, *choice.AvailableWhen)
		}
		if choice.Resolution.Invocation != nil {
			result = append(result, *choice.Resolution.Invocation)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func insertProblemEffect(ctx context.Context, tx pgx.Tx, ruleSetID string, consequenceID rules.ID, effect rules.Effect, definition rules.StateVariableDefinition) error {
	var adjustment any
	if effect.AdjustmentAmount != nil {
		adjustment = effect.AdjustmentAmount.String()
	}
	if _, err := tx.Exec(ctx, `
		insert into effects (
			id, rule_set_id, consequence_set_id, position, operation,
			target_definition_id, state_variable_id, adjustment_amount
		) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		effect.ID, ruleSetID, consequenceID, effect.Position, effect.Operation,
		effect.TargetDefinitionID, effect.StateVariableID, adjustment); err != nil {
		return err
	}
	if effect.Operand == nil {
		return nil
	}
	for position, scalar := range effect.Operand.Values {
		columns := scalarDatabaseColumns(scalar)
		if _, err := tx.Exec(ctx, `
			insert into effect_value_operands (
				id, rule_set_id, effect_id, state_variable_id, value_kind, cardinality, position,
				text_value, number_value, boolean_value, choice_option_id,
				measurement_amount, measurement_unit_id, referenced_entity_id, fallback_name
			) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			ruleSetID, effect.ID, effect.StateVariableID, scalar.Kind, definition.Cardinality, position,
			columns.Text, columns.Number, columns.Boolean, columns.ChoiceOptionID,
			columns.MeasurementAmount, columns.MeasurementUnitID, columns.ReferencedEntityID, columns.FallbackName); err != nil {
			return err
		}
	}
	return nil
}

func problemValidationEntityIDs(ctx context.Context, tx pgx.Tx, ruleSetID string, current, proposed rules.ProblemDefinition) ([]rules.ID, error) {
	set := make(map[rules.ID]struct{})
	visitEffectsWithPath(proposed, func(_ string, effect rules.Effect) {
		if effect.Operand == nil {
			return
		}
		for _, scalar := range effect.Operand.Values {
			if scalar.Kind == rules.ValueReference {
				set[scalar.ReferencedEntityID] = struct{}{}
			}
		}
	})
	if !current.ID.Valid() {
		return sortedRuleIDs(set), nil
	}
	rows, err := tx.Query(ctx, `
		select entity_id::text from problem_instances
		where rule_set_id = $1 and problem_definition_id = $2 order by entity_id`, ruleSetID, current.ID)
	if err != nil {
		return nil, err
	}
	instanceIDs := make([]string, 0)
	for rows.Next() {
		var instanceID string
		if err := rows.Scan(&instanceID); err != nil {
			rows.Close()
			return nil, err
		}
		instanceIDs = append(instanceIDs, instanceID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, instanceID := range instanceIDs {
		loaded, err := loadProblemInstanceDomain(ctx, tx, ruleSetID, instanceID, current)
		if err != nil {
			return nil, err
		}
		set[rules.ID(instanceID)] = struct{}{}
		for _, entityID := range boundEntityIDs(loaded.Instance.Bindings) {
			set[entityID] = struct{}{}
		}
	}
	return sortedRuleIDs(set), nil
}

func sortedRuleIDs(set map[rules.ID]struct{}) []rules.ID {
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func validateProblemInstancesForUpdate(ctx context.Context, tx pgx.Tx, ruleSetID string, current, proposed rules.ProblemDefinition, entities map[rules.ID]rules.Entity) error {
	rows, err := tx.Query(ctx, `
		select entity_id::text from problem_instances
		where rule_set_id = $1 and problem_definition_id = $2 order by entity_id`, ruleSetID, current.ID)
	if err != nil {
		return err
	}
	var instanceIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		instanceIDs = append(instanceIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(instanceIDs) == 0 {
		return nil
	}
	proposedTargets := make(map[rules.ID]rules.ProblemTargetDefinition, len(proposed.Targets))
	for _, target := range proposed.Targets {
		proposedTargets[target.ID] = target
	}
	for _, instanceID := range instanceIDs {
		loaded, err := loadProblemInstanceDomain(ctx, tx, ruleSetID, instanceID, current)
		if err != nil {
			return err
		}
		projected := make(rules.TargetBindings, len(proposed.Targets))
		for targetID := range proposedTargets {
			projected[targetID] = append([]rules.ID(nil), loaded.Instance.Bindings[targetID]...)
		}
		instance := loaded.Instance
		instance.Bindings = projected
		if validation := rules.ValidateProblemInstance(proposed, instance, entities); len(validation) > 0 {
			fields := make(map[string]string, len(validation))
			for _, item := range validation {
				fields[fmt.Sprintf("instances[%s].%s", instanceID, item.Path)] = item.Message
			}
			return &statusError{
				Status: http.StatusConflict, Code: "instances_would_be_invalid",
				Message: "problem changes would invalidate existing instances", Fields: fields,
			}
		}
	}
	return nil
}

func loadProblemInstanceDomain(ctx context.Context, db queryer, ruleSetID, instanceID string, problem rules.ProblemDefinition) (loadedProblemInstance, error) {
	var loaded loadedProblemInstance
	var entityID, problemID, displayName string
	var key *string
	err := db.QueryRow(ctx, `
		select pi.entity_id::text, pi.problem_definition_id::text, pi.binding_revision,
			pi.created_at, pi.updated_at, e.key, e.display_name, e.archived,
			e.created_at, e.updated_at, sr.revision
		from problem_instances pi
		join entities e on e.rule_set_id = pi.rule_set_id and e.id = pi.entity_id
		join state_records sr on sr.rule_set_id = pi.rule_set_id and sr.owner_entity_id = pi.entity_id
		where pi.rule_set_id = $1 and pi.entity_id = $2`, ruleSetID, instanceID,
	).Scan(
		&entityID, &problemID, &loaded.Instance.BindingRevision,
		&loaded.Instance.CreatedAt, &loaded.Instance.UpdatedAt, &key, &displayName, &loaded.Entity.Archived,
		&loaded.Entity.CreatedAt, &loaded.Entity.UpdatedAt, &loaded.StateRevision,
	)
	if err != nil {
		return loaded, err
	}
	loaded.Instance.ID = rules.ID(entityID)
	loaded.Instance.RuleSetID = rules.ID(ruleSetID)
	loaded.Instance.ProblemDefinitionID = rules.ID(problemID)
	loaded.Instance.DisplayName = displayName
	loaded.Entity.ID, loaded.Entity.RuleSetID = rules.ID(entityID), rules.ID(ruleSetID)
	loaded.Entity.DisplayName = displayName
	if key != nil {
		loaded.Entity.Key = *key
	}
	loaded.Entity.OwnerSchemaIDs, err = loadIDColumn(ctx, db, `
		select owner_schema_id::text from entity_owner_schemas
		where rule_set_id = $1 and entity_id = $2 order by owner_schema_id`, ruleSetID, instanceID)
	if err != nil {
		return loaded, err
	}
	loaded.Instance.Bindings = make(rules.TargetBindings, len(problem.Targets))
	targets := make(map[rules.ID]rules.ProblemTargetDefinition, len(problem.Targets))
	for _, target := range problem.Targets {
		targets[target.ID] = target
		loaded.Instance.Bindings[target.ID] = []rules.ID{}
	}
	rows, err := db.Query(ctx, `
		select target_definition_id::text, entity_id::text
		from problem_instance_target_bindings
		where rule_set_id = $1 and problem_instance_id = $2
		order by target_definition_id, position`, ruleSetID, instanceID)
	if err != nil {
		return loaded, err
	}
	for rows.Next() {
		var targetID, boundEntityID string
		if err := rows.Scan(&targetID, &boundEntityID); err != nil {
			rows.Close()
			return loaded, err
		}
		if _, exists := targets[rules.ID(targetID)]; !exists {
			rows.Close()
			return loaded, fmt.Errorf("problem instance %s has a binding for unknown target %s", instanceID, targetID)
		}
		loaded.Instance.Bindings[rules.ID(targetID)] = append(loaded.Instance.Bindings[rules.ID(targetID)], rules.ID(boundEntityID))
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return loaded, err
	}
	rows.Close()
	for _, target := range problem.Targets {
		entityIDs := loaded.Instance.Bindings[target.ID]
		maximum := -1
		if target.MaximumBindings != nil {
			maximum = *target.MaximumBindings
		} else if target.Cardinality == rules.CardinalityOne {
			maximum = 1
		}
		if len(entityIDs) < target.MinimumBindings || maximum >= 0 && len(entityIDs) > maximum {
			return loaded, fmt.Errorf("problem instance %s has an invalid binding count for target %s", instanceID, target.ID)
		}
		if target.BindingSource == rules.BindingProblemInstance && (len(entityIDs) != 1 || entityIDs[0] != loaded.Instance.ID) {
			return loaded, fmt.Errorf("problem instance %s has a malformed automatic binding for target %s", instanceID, target.ID)
		}
	}
	return loaded, nil
}

func loadProblemInstancesDomain(ctx context.Context, db queryer, ruleSetID string, definitions map[rules.ID]rules.StateVariableDefinition) ([]loadedProblemInstance, error) {
	rows, err := db.Query(ctx, `
		select entity_id::text, problem_definition_id::text from problem_instances
		where rule_set_id = $1 order by created_at, entity_id`, ruleSetID)
	if err != nil {
		return nil, err
	}
	type pair struct{ instanceID, problemID string }
	pairs := make([]pair, 0)
	for rows.Next() {
		var item pair
		if err := rows.Scan(&item.instanceID, &item.problemID); err != nil {
			rows.Close()
			return nil, err
		}
		pairs = append(pairs, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	entities, err := loadEntitiesDomain(ctx, db, ruleSetID)
	if err != nil {
		return nil, err
	}
	schemas, err := loadOwnerSchemasDomain(ctx, db, ruleSetID)
	if err != nil {
		return nil, err
	}
	conditions, err := loadConditionsDomain(ctx, db, ruleSetID, definitions)
	if err != nil {
		return nil, err
	}
	problems := make(map[string]rules.ProblemDefinition)
	result := make([]loadedProblemInstance, 0, len(pairs))
	for _, item := range pairs {
		problem, exists := problems[item.problemID]
		if !exists {
			problem, err = loadProblemDomain(ctx, db, ruleSetID, item.problemID, definitions)
			if err != nil {
				return nil, err
			}
			if validation := rules.ValidateProblemDefinition(problem, schemas, definitions, conditions, entities); len(validation) > 0 {
				return nil, fmt.Errorf("stored problem %s is invalid: %w", item.problemID, validation)
			}
			problems[item.problemID] = problem
		}
		loaded, err := loadProblemInstanceDomain(ctx, db, ruleSetID, item.instanceID, problem)
		if err != nil {
			return nil, err
		}
		if validation := rules.ValidateProblemInstance(problem, loaded.Instance, entities); len(validation) > 0 {
			return nil, fmt.Errorf("stored problem instance %s is invalid: %w", item.instanceID, validation)
		}
		result = append(result, loaded)
	}
	return result, nil
}

func createProblemInstanceDomain(ctx context.Context, server *Server, ruleSetID string, problem rules.ProblemDefinition, entity rules.Entity, bindings rules.TargetBindings) (loadedProblemInstance, error) {
	tx, err := server.db.Begin(ctx)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var locked string
	if err := tx.QueryRow(ctx, `
		select id::text from problem_definitions
		where rule_set_id = $1 and id = $2 and archived = false for share`, ruleSetID, problem.ID,
	).Scan(&locked); err != nil {
		return loadedProblemInstance{}, err
	}
	definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	currentProblem, err := loadProblemDomain(ctx, tx, ruleSetID, string(problem.ID), definitions)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	for _, schemaID := range currentProblem.InstanceOwnerSchemaIDs {
		var archived bool
		if err := tx.QueryRow(ctx, `
			select archived from state_owner_schemas
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, schemaID).Scan(&archived); err != nil {
			return loadedProblemInstance{}, err
		}
		if archived {
			return loadedProblemInstance{}, &statusError{
				Status: http.StatusConflict, Code: "archived_schema",
				Message: "a problem instance cannot create memberships for archived owner schemas",
				Fields:  map[string]string{"instance_owner_schema_ids": "contains archived owner schema " + string(schemaID)},
			}
		}
	}
	// The definition lock makes this the authoritative creation template and
	// target set, even if configuration changed after request validation.
	entity.OwnerSchemaIDs = append([]rules.ID(nil), currentProblem.InstanceOwnerSchemaIDs...)
	bindings = bindingsForCurrentProblem(currentProblem, bindings, entity.ID)
	if err := lockEntityAndStateRoots(ctx, tx, ruleSetID, boundEntityIDs(bindings)); err != nil {
		return loadedProblemInstance{}, err
	}
	entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	entities[entity.ID] = entity
	instance := rules.ProblemInstance{
		ID: entity.ID, RuleSetID: rules.ID(ruleSetID), ProblemDefinitionID: currentProblem.ID,
		DisplayName: entity.DisplayName, Bindings: bindings,
	}
	if validation := rules.ValidateProblemInstance(currentProblem, instance, entities); len(validation) > 0 {
		return loadedProblemInstance{}, validationStatus("problem instance is invalid", validation)
	}
	var key any
	if entity.Key != "" {
		key = entity.Key
	}
	if _, err := tx.Exec(ctx, `
		insert into entities (id, rule_set_id, key, display_name, archived)
		values ($1, $2, $3, $4, false)`, entity.ID, ruleSetID, key, entity.DisplayName); err != nil {
		return loadedProblemInstance{}, err
	}
	if _, err := tx.Exec(ctx, `
		insert into state_records (owner_entity_id, rule_set_id, revision)
		values ($1, $2, 0)`, entity.ID, ruleSetID); err != nil {
		return loadedProblemInstance{}, err
	}
	for _, schemaID := range entity.OwnerSchemaIDs {
		if _, err := tx.Exec(ctx, `
			insert into entity_owner_schemas (entity_id, rule_set_id, owner_schema_id)
			values ($1, $2, $3)`, entity.ID, ruleSetID, schemaID); err != nil {
			return loadedProblemInstance{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		insert into problem_instances (entity_id, rule_set_id, problem_definition_id, binding_revision)
		values ($1, $2, $3, 0)`, entity.ID, ruleSetID, currentProblem.ID); err != nil {
		return loadedProblemInstance{}, err
	}
	if err := insertProblemBindings(ctx, tx, ruleSetID, entity.ID, bindings); err != nil {
		return loadedProblemInstance{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return loadedProblemInstance{}, err
	}
	return loadProblemInstanceSnapshot(ctx, server, ruleSetID, string(entity.ID))
}

func replaceProblemBindingsDomain(ctx context.Context, server *Server, ruleSetID, instanceID string, expectedRevision int64, proposed rules.TargetBindings) (loadedProblemInstance, error) {
	tx, err := server.db.Begin(ctx)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var problemID string
	if err := tx.QueryRow(ctx, `
		select problem_definition_id::text from problem_instances
		where rule_set_id = $1 and entity_id = $2`, ruleSetID, instanceID).Scan(&problemID); err != nil {
		return loadedProblemInstance{}, err
	}
	var locked string
	if err := tx.QueryRow(ctx, `
		select id::text from problem_definitions where rule_set_id = $1 and id = $2 for share`, ruleSetID, problemID,
	).Scan(&locked); err != nil {
		return loadedProblemInstance{}, err
	}
	var actualRevision int64
	if err := tx.QueryRow(ctx, `
		select binding_revision from problem_instances
		where rule_set_id = $1 and entity_id = $2 for update`, ruleSetID, instanceID,
	).Scan(&actualRevision); err != nil {
		return loadedProblemInstance{}, err
	}
	if actualRevision != expectedRevision {
		return loadedProblemInstance{}, revisionConflict("binding", expectedRevision, actualRevision)
	}
	definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	problem, err := loadProblemDomain(ctx, tx, ruleSetID, problemID, definitions)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	discovered, err := loadProblemInstanceDomain(ctx, tx, ruleSetID, instanceID, problem)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	proposed = bindingsForCurrentProblem(problem, proposed, rules.ID(instanceID))
	entityIDs := bindingEntityIDUnion(discovered.Instance.Bindings, proposed)
	if err := lockEntityAndStateRoots(ctx, tx, ruleSetID, entityIDs); err != nil {
		return loadedProblemInstance{}, err
	}
	entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	current, err := loadProblemInstanceDomain(ctx, tx, ruleSetID, instanceID, problem)
	if err != nil {
		return loadedProblemInstance{}, err
	}
	candidate := current.Instance
	candidate.Bindings = proposed
	if validation := rules.ValidateProblemInstance(problem, candidate, entities); len(validation) > 0 {
		return loadedProblemInstance{}, validationStatus("problem bindings are invalid", validation)
	}
	if targetBindingsEqual(current.Instance.Bindings, proposed) {
		if err := tx.Commit(ctx); err != nil {
			return loadedProblemInstance{}, err
		}
		return loadProblemInstanceSnapshot(ctx, server, ruleSetID, instanceID)
	}
	if _, err := tx.Exec(ctx, `
		delete from problem_instance_target_bindings
		where rule_set_id = $1 and problem_instance_id = $2`, ruleSetID, instanceID); err != nil {
		return loadedProblemInstance{}, err
	}
	if err := insertProblemBindings(ctx, tx, ruleSetID, rules.ID(instanceID), proposed); err != nil {
		return loadedProblemInstance{}, err
	}
	if _, err := tx.Exec(ctx, `
		update problem_instances set binding_revision = binding_revision + 1
		where rule_set_id = $1 and entity_id = $2`, ruleSetID, instanceID); err != nil {
		return loadedProblemInstance{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return loadedProblemInstance{}, err
	}
	return loadProblemInstanceSnapshot(ctx, server, ruleSetID, instanceID)
}

func loadProblemInstanceSnapshot(ctx context.Context, server *Server, ruleSetID, instanceID string) (loadedProblemInstance, error) {
	snapshot, err := loadProblemInstanceAndDefinitionSnapshot(ctx, server, ruleSetID, instanceID)
	return snapshot.Loaded, err
}

func loadProblemInstanceAndDefinitionSnapshot(ctx context.Context, server *Server, ruleSetID, instanceID string) (loadedProblemInstanceSnapshot, error) {
	return readProblemSnapshot(ctx, server, func(tx pgx.Tx) (loadedProblemInstanceSnapshot, error) {
		definitions, problem, err := loadProblemForInstance(ctx, tx, ruleSetID, instanceID)
		if err != nil {
			return loadedProblemInstanceSnapshot{}, err
		}
		loaded, err := loadProblemInstanceDomain(ctx, tx, ruleSetID, instanceID, problem)
		if err != nil {
			return loadedProblemInstanceSnapshot{}, err
		}
		entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
		if err != nil {
			return loadedProblemInstanceSnapshot{}, err
		}
		schemas, err := loadOwnerSchemasDomain(ctx, tx, ruleSetID)
		if err != nil {
			return loadedProblemInstanceSnapshot{}, err
		}
		conditions, err := loadConditionsDomain(ctx, tx, ruleSetID, definitions)
		if err != nil {
			return loadedProblemInstanceSnapshot{}, err
		}
		if validation := rules.ValidateProblemDefinition(problem, schemas, definitions, conditions, entities); len(validation) > 0 {
			return loadedProblemInstanceSnapshot{}, fmt.Errorf("stored problem %s is invalid: %w", problem.ID, validation)
		}
		if validation := rules.ValidateProblemInstance(problem, loaded.Instance, entities); len(validation) > 0 {
			return loadedProblemInstanceSnapshot{}, fmt.Errorf("stored problem instance %s is invalid: %w", instanceID, validation)
		}
		return loadedProblemInstanceSnapshot{Loaded: loaded, Problem: problem}, nil
	})
}

// bindingsForCurrentProblem rebuilds the complete binding map against the
// definition protected by the transaction's configuration lock. In
// particular, it recreates the automatic self binding and represents a newly
// added optional supplied target as an explicit empty collection.
func bindingsForCurrentProblem(problem rules.ProblemDefinition, provided rules.TargetBindings, instanceID rules.ID) rules.TargetBindings {
	result := make(rules.TargetBindings, len(problem.Targets)+len(provided))
	currentTargets := make(map[rules.ID]struct{}, len(problem.Targets))
	for _, target := range problem.Targets {
		currentTargets[target.ID] = struct{}{}
		entityIDs, exists := provided[target.ID]
		if target.BindingSource == rules.BindingProblemInstance {
			if !exists || len(entityIDs) == 1 && entityIDs[0] == instanceID {
				result[target.ID] = []rules.ID{instanceID}
			} else {
				// Preserve an incompatible value so domain validation reports the
				// stale or malformed automatic binding instead of silently ignoring it.
				result[target.ID] = append([]rules.ID(nil), entityIDs...)
			}
			continue
		}
		result[target.ID] = append([]rules.ID(nil), entityIDs...)
	}
	for targetID, entityIDs := range provided {
		if _, exists := currentTargets[targetID]; !exists {
			result[targetID] = append([]rules.ID(nil), entityIDs...)
		}
	}
	return result
}

func bindingEntityIDUnion(bindings ...rules.TargetBindings) []rules.ID {
	set := make(map[rules.ID]struct{})
	for _, collection := range bindings {
		for _, entityIDs := range collection {
			for _, entityID := range entityIDs {
				set[entityID] = struct{}{}
			}
		}
	}
	result := make([]rules.ID, 0, len(set))
	for entityID := range set {
		result = append(result, entityID)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

// lockEntityAndStateRoots follows the same entity-then-state order as
// saveEntity. Binding writers and resolution call it with sorted IDs so a
// concurrent membership edit cannot be validated against stale schemas.
func lockEntityAndStateRoots(ctx context.Context, tx pgx.Tx, ruleSetID string, entityIDs []rules.ID) error {
	ids := append([]rules.ID(nil), entityIDs...)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	var previous rules.ID
	for index, entityID := range ids {
		if index > 0 && entityID == previous {
			continue
		}
		previous = entityID
		var lockedEntity string
		err := tx.QueryRow(ctx, `
			select id::text from entities
			where rule_set_id = $1 and id = $2 for update`, ruleSetID, entityID).Scan(&lockedEntity)
		if errors.Is(err, pgx.ErrNoRows) {
			// Domain validation reports a missing bound entity with its binding
			// path. A not-yet-inserted problem-instance entity also lands here.
			continue
		}
		if err != nil {
			return err
		}
		var lockedState string
		if err := tx.QueryRow(ctx, `
			select owner_entity_id::text from state_records
			where rule_set_id = $1 and owner_entity_id = $2 for update`, ruleSetID, entityID).Scan(&lockedState); err != nil {
			return err
		}
	}
	return nil
}

func insertProblemBindings(ctx context.Context, tx pgx.Tx, ruleSetID string, instanceID rules.ID, bindings rules.TargetBindings) error {
	targetIDs := make([]rules.ID, 0, len(bindings))
	for targetID := range bindings {
		targetIDs = append(targetIDs, targetID)
	}
	sort.Slice(targetIDs, func(i, j int) bool { return targetIDs[i] < targetIDs[j] })
	for _, targetID := range targetIDs {
		for position, entityID := range bindings[targetID] {
			if _, err := tx.Exec(ctx, `
				insert into problem_instance_target_bindings (
					id, rule_set_id, problem_instance_id, target_definition_id, entity_id, position
				) values (gen_random_uuid(), $1, $2, $3, $4, $5)`,
				ruleSetID, instanceID, targetID, entityID, position); err != nil {
				return err
			}
		}
	}
	return nil
}

func targetBindingsEqual(left, right rules.TargetBindings) bool {
	if len(left) != len(right) {
		return false
	}
	for targetID, leftEntities := range left {
		rightEntities, exists := right[targetID]
		if !exists || len(leftEntities) != len(rightEntities) {
			return false
		}
		for i := range leftEntities {
			if leftEntities[i] != rightEntities[i] {
				return false
			}
		}
	}
	return true
}

func revisionConflict(resource string, expected, actual int64) error {
	return &statusError{
		Status: http.StatusConflict, Code: "revision_conflict", Message: resource + " changed since it was loaded",
		Fields: map[string]string{"expected_revision": fmt.Sprint(expected), "actual_revision": fmt.Sprint(actual)},
	}
}

func instanceToResponse(loaded loadedProblemInstance, problem rules.ProblemDefinition) problemInstanceResponse {
	response := problemInstanceResponse{
		ID:                  string(loaded.Instance.ID),
		ProblemDefinitionID: string(loaded.Instance.ProblemDefinitionID),
		DisplayName:         loaded.Instance.DisplayName,
		BindingRevision:     loaded.Instance.BindingRevision,
		Bindings:            make([]problemTargetBindingDTO, 0, len(problem.Targets)),
		StateRevision:       loaded.StateRevision,
		CreatedAt:           loaded.Instance.CreatedAt,
		UpdatedAt:           loaded.Instance.UpdatedAt,
	}
	if loaded.Entity.Key != "" {
		key := loaded.Entity.Key
		response.Key = &key
	}
	targets := append([]rules.ProblemTargetDefinition(nil), problem.Targets...)
	sort.Slice(targets, func(i, j int) bool { return targets[i].Position < targets[j].Position })
	for _, target := range targets {
		response.Bindings = append(response.Bindings, problemTargetBindingDTO{
			TargetDefinitionID: string(target.ID), EntityIDs: idsToStrings(loaded.Instance.Bindings[target.ID]),
		})
	}
	return response
}
