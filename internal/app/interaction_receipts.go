package app

import (
	"context"
	"fmt"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func insertInteractionResolutionReceipt(
	ctx context.Context,
	tx pgx.Tx,
	gameID, ruleSetID, interactionID, actorMembershipID string,
	request adjudicateInteractionRequest,
	plan rules.TransitionPlan,
	result rules.TransitionResult,
) (string, error) {
	var resolutionID string
	if err := tx.QueryRow(ctx, `
		insert into interaction_resolutions (
			interaction_id, game_id, rule_set_id, selected_submission_id,
			action_summary, public_narrative, private_notes, status,
			created_by_membership_id
		) values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
		returning id::text`, interactionID, gameID, ruleSetID, request.SelectedActionID,
		request.ActionSummary, request.Narrative, request.PrivateNotes, actorMembershipID,
	).Scan(&resolutionID); err != nil {
		return "", err
	}

	definitions, err := loadDefinitionsDomain(ctx, tx, ruleSetID)
	if err != nil {
		return "", err
	}
	for _, effect := range plan.Effects {
		definition, exists := definitions[effect.StateVariableID]
		if !exists {
			return "", fmt.Errorf("transition receipt references missing definition %s", effect.StateVariableID)
		}
		var adjustment any
		if effect.AdjustmentAmount != nil {
			adjustment = effect.AdjustmentAmount.String()
		}
		if _, err := tx.Exec(ctx, `
			insert into interaction_resolution_effects (
				id, resolution_id, game_id, rule_set_id, position, operation,
				state_variable_id, adjustment_amount
			) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			effect.ID, resolutionID, gameID, ruleSetID, effect.Position,
			effect.Operation, effect.StateVariableID, adjustment); err != nil {
			return "", err
		}
		for position, entityID := range effect.EntityIDs {
			if _, err := tx.Exec(ctx, `
				insert into interaction_resolution_effect_targets (effect_id, game_id, entity_id, position)
				values ($1, $2, $3, $4)`, effect.ID, gameID, entityID, position); err != nil {
				return "", err
			}
		}
		if effect.Operand != nil {
			for position, scalar := range effect.Operand.Values {
				columns := scalarDatabaseColumns(scalar)
				if _, err := tx.Exec(ctx, `
					insert into interaction_resolution_effect_operands (
						effect_id, resolution_id, game_id, rule_set_id, state_variable_id,
						value_kind, cardinality, position, text_value, number_value,
						boolean_value, choice_option_id, measurement_amount,
						measurement_unit_id, referenced_entity_id, fallback_name
					) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
					effect.ID, resolutionID, gameID, ruleSetID, effect.StateVariableID,
					scalar.Kind, definition.Cardinality, position, columns.Text, columns.Number,
					columns.Boolean, columns.ChoiceOptionID, columns.MeasurementAmount,
					columns.MeasurementUnitID, columns.ReferencedEntityID, columns.FallbackName); err != nil {
					return "", err
				}
			}
		}
	}

	for position, application := range result.AppliedEffects {
		applicationID, err := newID()
		if err != nil {
			return "", err
		}
		if _, err := tx.Exec(ctx, `
			insert into interaction_resolution_effect_applications (
				id, resolution_id, effect_id, game_id, rule_set_id,
				state_variable_id, entity_id, position, changed
			) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, applicationID, resolutionID,
			application.EffectID, gameID, ruleSetID, application.StateVariableID,
			application.EntityID, position, application.Changed); err != nil {
			return "", err
		}
		definition, exists := definitions[application.StateVariableID]
		if !exists {
			return "", fmt.Errorf("transition application references missing definition %s", application.StateVariableID)
		}
		if err := insertApplicationValueSet(ctx, tx, applicationID, "before", gameID, ruleSetID, definition, application.Before); err != nil {
			return "", err
		}
		if err := insertApplicationValueSet(ctx, tx, applicationID, "after", gameID, ruleSetID, definition, application.After); err != nil {
			return "", err
		}
	}

	if request.SelectedActionID != nil {
		if _, err := tx.Exec(ctx, `
			update interaction_action_submissions set status = 'selected', revision = revision + 1
			where game_id = $1 and interaction_id = $2 and id = $3 and status = 'submitted'`,
			gameID, interactionID, *request.SelectedActionID); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `
		update interaction_action_submissions set status = 'declined', revision = revision + 1
		where game_id = $1 and interaction_id = $2 and status = 'submitted'
			and ($3::uuid is null or id <> $3::uuid)`, gameID, interactionID, request.SelectedActionID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		update interaction_resolutions
		set status = 'applied', resolved_by_membership_id = $2,
			idempotency_key = $3, applied_at = now()
		where id = $1`, resolutionID, actorMembershipID, request.IdempotencyKey); err != nil {
		return "", err
	}
	return resolutionID, nil
}

func insertApplicationValueSet(ctx context.Context, tx pgx.Tx, applicationID, phase, gameID, ruleSetID string, definition rules.StateVariableDefinition, value *rules.StateValue) error {
	if value == nil {
		_, err := tx.Exec(ctx, `
			insert into interaction_resolution_application_value_sets (
				application_id, phase, game_id, rule_set_id, state_variable_id, known, cardinality
			) values ($1,$2,$3,$4,$5,false,null)`, applicationID, phase, gameID, ruleSetID, definition.ID)
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into interaction_resolution_application_value_sets (
			application_id, phase, game_id, rule_set_id, state_variable_id, known, cardinality
		) values ($1,$2,$3,$4,$5,true,$6)`, applicationID, phase, gameID, ruleSetID, definition.ID, value.Cardinality); err != nil {
		return err
	}
	for position, scalar := range value.Values {
		columns := scalarDatabaseColumns(scalar)
		if _, err := tx.Exec(ctx, `
			insert into interaction_resolution_application_values (
				application_id, phase, game_id, rule_set_id, state_variable_id,
				value_kind, cardinality, position, text_value, number_value,
				boolean_value, choice_option_id, measurement_amount,
				measurement_unit_id, referenced_entity_id, fallback_name
			) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			applicationID, phase, gameID, ruleSetID, definition.ID, scalar.Kind,
			value.Cardinality, position, columns.Text, columns.Number, columns.Boolean,
			columns.ChoiceOptionID, columns.MeasurementAmount, columns.MeasurementUnitID,
			columns.ReferencedEntityID, columns.FallbackName); err != nil {
			return err
		}
	}
	return nil
}

func loadInteractionResolutionResponse(ctx context.Context, db queryer, gameID, interactionID string, definitions map[rules.ID]rules.StateVariableDefinition, includePrivate bool) (*interactionResolutionResponse, error) {
	var response interactionResolutionResponse
	var selectedActionID, actionSummary, privateNotes *string
	if err := db.QueryRow(ctx, `
		select id::text, selected_submission_id::text, action_summary, public_narrative,
			private_notes, resolved_by_membership_id::text, applied_at
		from interaction_resolutions
		where game_id = $1 and interaction_id = $2 and status = 'applied'`, gameID, interactionID,
	).Scan(&response.ID, &selectedActionID, &actionSummary, &response.Narrative,
		&privateNotes, &response.ResolvedByMembershipID, &response.ResolvedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	response.SelectedActionID, response.ActionSummary = selectedActionID, actionSummary
	if includePrivate {
		response.PrivateNotes = privateNotes
	}
	response.Effects = make([]concreteEffectDTO, 0)
	rows, err := db.Query(ctx, `
		select id::text, operation, state_variable_id::text, adjustment_amount::text
		from interaction_resolution_effects where resolution_id = $1 order by position`, response.ID)
	if err != nil {
		return nil, err
	}
	type storedEffectRow struct {
		Item       concreteEffectDTO
		Adjustment *string
	}
	storedEffects := make([]storedEffectRow, 0)
	for rows.Next() {
		var stored storedEffectRow
		if err := rows.Scan(&stored.Item.ID, &stored.Item.Type, &stored.Item.StateVariableID, &stored.Adjustment); err != nil {
			rows.Close()
			return nil, err
		}
		storedEffects = append(storedEffects, stored)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, stored := range storedEffects {
		item, adjustment := stored.Item, stored.Adjustment
		definition, exists := definitions[rules.ID(item.StateVariableID)]
		if !exists {
			return nil, fmt.Errorf("receipt effect references missing definition %s", item.StateVariableID)
		}
		item.EntityIDs, err = loadStringColumn(ctx, db, `
			select entity_id::text from interaction_resolution_effect_targets
			where effect_id = $1 order by position`, item.ID)
		if err != nil {
			return nil, err
		}
		if adjustment != nil {
			parsed, parseErr := rules.ParseDecimal(*adjustment)
			if parseErr != nil {
				return nil, parseErr
			}
			item.Amount = decimalJSON(&parsed)
		}
		operand, loadErr := loadInteractionEffectOperand(ctx, db, item.ID, definition, rules.EffectOperation(item.Type))
		if loadErr != nil {
			return nil, loadErr
		}
		if operand != nil {
			value := stateValueDomainToDTO(*operand, definition)
			item.Value = &value
		}
		response.Effects = append(response.Effects, item)
	}

	response.AppliedEffects = make([]concreteAppliedEffectResponse, 0)
	rows, err = db.Query(ctx, `
		select id::text, effect_id::text, entity_id::text, state_variable_id::text, changed
		from interaction_resolution_effect_applications
		where resolution_id = $1 order by position`, response.ID)
	if err != nil {
		return nil, err
	}
	type storedApplicationRow struct {
		ID   string
		Item concreteAppliedEffectResponse
	}
	storedApplications := make([]storedApplicationRow, 0)
	for rows.Next() {
		var stored storedApplicationRow
		if err := rows.Scan(&stored.ID, &stored.Item.EffectID, &stored.Item.EntityID, &stored.Item.StateVariableID, &stored.Item.Changed); err != nil {
			rows.Close()
			return nil, err
		}
		storedApplications = append(storedApplications, stored)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, stored := range storedApplications {
		item := stored.Item
		definition, exists := definitions[rules.ID(item.StateVariableID)]
		if !exists {
			return nil, fmt.Errorf("receipt application references missing definition %s", item.StateVariableID)
		}
		before, loadErr := loadApplicationValueSet(ctx, db, stored.ID, "before", definition)
		if loadErr != nil {
			return nil, loadErr
		}
		after, loadErr := loadApplicationValueSet(ctx, db, stored.ID, "after", definition)
		if loadErr != nil {
			return nil, loadErr
		}
		if before != nil {
			value := stateValueDomainToDTO(*before, definition)
			item.Before = &value
		}
		if after != nil {
			value := stateValueDomainToDTO(*after, definition)
			item.After = &value
		}
		response.AppliedEffects = append(response.AppliedEffects, item)
	}
	return &response, nil
}

func loadInteractionEffectOperand(ctx context.Context, db queryer, effectID string, definition rules.StateVariableDefinition, operation rules.EffectOperation) (*rules.StateValue, error) {
	values, err := loadTypedScalars(ctx, db, `
		select value_kind, text_value, number_value::text, boolean_value,
			choice_option_id::text, measurement_amount::text, measurement_unit_id::text,
			referenced_entity_id::text, fallback_name
		from interaction_resolution_effect_operands where effect_id = $1 order by position`, effectID)
	if err != nil {
		return nil, err
	}
	if len(values) == 0 {
		switch operation {
		case rules.EffectSet:
			if definition.Cardinality == rules.CardinalityMany {
				return &rules.StateValue{Cardinality: rules.CardinalityMany, Values: []rules.ScalarValue{}}, nil
			}
			return nil, fmt.Errorf("stored set effect has no operand")
		case rules.EffectAddValue, rules.EffectRemoveValue:
			return nil, fmt.Errorf("stored %s effect has no operand", operation)
		default:
			return nil, nil
		}
	}
	if operation == rules.EffectClear || operation == rules.EffectAdjustNumber {
		return nil, fmt.Errorf("stored %s effect has an unexpected operand", operation)
	}
	cardinality := definition.Cardinality
	if operation == rules.EffectAddValue || operation == rules.EffectRemoveValue {
		if len(values) != 1 {
			return nil, fmt.Errorf("stored %s effect must have exactly one operand", operation)
		}
		cardinality = rules.CardinalityOne
	} else if definition.Cardinality == rules.CardinalityOne && len(values) != 1 {
		return nil, fmt.Errorf("stored set effect must have exactly one operand")
	}
	value := rules.StateValue{Cardinality: cardinality, Values: values}
	return &value, nil
}

func loadApplicationValueSet(ctx context.Context, db queryer, applicationID, phase string, definition rules.StateVariableDefinition) (*rules.StateValue, error) {
	var known bool
	var cardinality *string
	if err := db.QueryRow(ctx, `
		select known, cardinality from interaction_resolution_application_value_sets
		where application_id = $1 and phase = $2`, applicationID, phase).Scan(&known, &cardinality); err != nil {
		return nil, err
	}
	if !known {
		return nil, nil
	}
	values, err := loadTypedScalars(ctx, db, `
		select value_kind, text_value, number_value::text, boolean_value,
			choice_option_id::text, measurement_amount::text, measurement_unit_id::text,
			referenced_entity_id::text, fallback_name
		from interaction_resolution_application_values
		where application_id = $1 and phase = $2 order by position`, applicationID, phase)
	if err != nil {
		return nil, err
	}
	if cardinality == nil {
		return nil, fmt.Errorf("known receipt value has no cardinality")
	}
	value := rules.StateValue{Cardinality: rules.Cardinality(*cardinality), Values: values}
	_ = definition
	return &value, nil
}

func loadTypedScalars(ctx context.Context, db queryer, query string, args ...any) ([]rules.ScalarValue, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]rules.ScalarValue, 0)
	for rows.Next() {
		scalar, err := scanScalar(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, scalar)
	}
	return values, rows.Err()
}

func loadStringColumn(ctx context.Context, db queryer, query string, args ...any) ([]string, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}
