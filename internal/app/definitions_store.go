package app

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

func loadDefinitionsDomain(ctx context.Context, db queryer, ruleSetID string) (map[rules.ID]rules.StateVariableDefinition, error) {
	rows, err := db.Query(ctx, `
		select id::text from state_variable_definitions
		where rule_set_id = $1 order by display_order, lower(label), id`, ruleSetID)
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

	result := make(map[rules.ID]rules.StateVariableDefinition, len(ids))
	for _, id := range ids {
		definition, err := loadDefinitionDomain(ctx, db, ruleSetID, id)
		if err != nil {
			return nil, err
		}
		result[definition.ID] = definition
	}
	return result, nil
}

func loadDefinitionDomain(ctx context.Context, db queryer, ruleSetID, definitionID string) (rules.StateVariableDefinition, error) {
	var definition rules.StateVariableDefinition
	var id, key, label, valueKind, cardinality, missingKind string
	var description, presentationGroup, presentationControl, presentationHelpText *string
	var numberMinimum, numberMaximum, numberStep, numberUnit *string
	var measurementMinimum, measurementMaximum, measurementStep *string
	err := db.QueryRow(ctx, `
		select id::text, key, label, description, presentation_group, value_kind, cardinality,
			missing_kind, omit_default_when_stored, condition_addressable, display_order,
			presentation_control, presentation_help_text,
			number_minimum::text, number_maximum::text, number_step::text, number_unit,
			measurement_minimum::text, measurement_maximum::text, measurement_step::text,
			archived, created_at, updated_at
		from state_variable_definitions where rule_set_id = $1 and id = $2`, ruleSetID, definitionID,
	).Scan(
		&id, &key, &label, &description, &presentationGroup, &valueKind, &cardinality,
		&missingKind, &definition.OmitDefaultWhenStored, &definition.ConditionAddressable, &definition.DisplayOrder,
		&presentationControl, &presentationHelpText,
		&numberMinimum, &numberMaximum, &numberStep, &numberUnit,
		&measurementMinimum, &measurementMaximum, &measurementStep,
		&definition.Archived, &definition.CreatedAt, &definition.UpdatedAt,
	)
	if err != nil {
		return definition, err
	}
	definition.ID, definition.RuleSetID = rules.ID(id), rules.ID(ruleSetID)
	definition.Key, definition.Label = key, label
	definition.ValueKind, definition.Cardinality = rules.ValueKind(valueKind), rules.Cardinality(cardinality)
	definition.MissingKind = rules.MissingKind(missingKind)
	if description != nil {
		definition.Description = *description
	}
	if presentationGroup != nil {
		definition.PresentationGroup = *presentationGroup
	}
	if presentationControl != nil {
		definition.PresentationControl = rules.PresentationControl(*presentationControl)
	}
	if presentationHelpText != nil {
		definition.PresentationHelpText = *presentationHelpText
	}
	if numberUnit != nil {
		definition.NumberUnit = *numberUnit
	}
	if definition.NumberMinimum, err = parseNullableDecimal(numberMinimum); err != nil {
		return definition, err
	}
	if definition.NumberMaximum, err = parseNullableDecimal(numberMaximum); err != nil {
		return definition, err
	}
	if definition.NumberStep, err = parseNullableDecimal(numberStep); err != nil {
		return definition, err
	}
	if definition.MeasurementMinimum, err = parseNullableDecimal(measurementMinimum); err != nil {
		return definition, err
	}
	if definition.MeasurementMaximum, err = parseNullableDecimal(measurementMaximum); err != nil {
		return definition, err
	}
	if definition.MeasurementStep, err = parseNullableDecimal(measurementStep); err != nil {
		return definition, err
	}

	definition.OwnerSchemaIDs, err = loadIDColumn(ctx, db, `
		select owner_schema_id::text from state_variable_owner_schemas
		where rule_set_id = $1 and state_variable_id = $2 order by owner_schema_id`, ruleSetID, definitionID)
	if err != nil {
		return definition, err
	}
	definition.ReferenceTargetOwnerSchemaIDs, err = loadIDColumn(ctx, db, `
		select owner_schema_id::text from state_variable_reference_target_schemas
		where rule_set_id = $1 and state_variable_id = $2 order by owner_schema_id`, ruleSetID, definitionID)
	if err != nil {
		return definition, err
	}

	rows, err := db.Query(ctx, `
		select id::text, key, label, position from state_variable_choice_options
		where state_variable_id = $1 order by position`, definitionID)
	if err != nil {
		return definition, err
	}
	for rows.Next() {
		var option rules.ChoiceOption
		var optionID string
		if err := rows.Scan(&optionID, &option.Key, &option.Label, &option.Position); err != nil {
			rows.Close()
			return definition, err
		}
		option.ID = rules.ID(optionID)
		definition.ChoiceOptions = append(definition.ChoiceOptions, option)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return definition, err
	}
	rows.Close()

	rows, err = db.Query(ctx, `
		select id::text, unit, position from state_variable_measurement_units
		where state_variable_id = $1 order by position`, definitionID)
	if err != nil {
		return definition, err
	}
	for rows.Next() {
		var unit rules.MeasurementUnit
		var unitID string
		if err := rows.Scan(&unitID, &unit.Unit, &unit.Position); err != nil {
			rows.Close()
			return definition, err
		}
		unit.ID = rules.ID(unitID)
		definition.MeasurementUnits = append(definition.MeasurementUnits, unit)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return definition, err
	}
	rows.Close()

	rows, err = db.Query(ctx, `
		select operation from state_variable_effect_operations
		where state_variable_id = $1 order by operation`, definitionID)
	if err != nil {
		return definition, err
	}
	for rows.Next() {
		var operation string
		if err := rows.Scan(&operation); err != nil {
			rows.Close()
			return definition, err
		}
		definition.AllowedEffectOperations = append(definition.AllowedEffectOperations, rules.EffectOperation(operation))
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return definition, err
	}
	rows.Close()

	rows, err = db.Query(ctx, `
		select value_kind, text_value, number_value::text, boolean_value, choice_option_id::text,
			measurement_amount::text, measurement_unit_id::text, referenced_entity_id::text, fallback_name
		from state_variable_default_values
		where rule_set_id = $1 and state_variable_id = $2 order by position`, ruleSetID, definitionID)
	if err != nil {
		return definition, err
	}
	defaultValue := rules.StateValue{Cardinality: definition.Cardinality, Values: []rules.ScalarValue{}}
	for rows.Next() {
		scalar, err := scanScalar(rows)
		if err != nil {
			rows.Close()
			return definition, err
		}
		defaultValue.Values = append(defaultValue.Values, scalar)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return definition, err
	}
	rows.Close()
	if definition.MissingKind == rules.MissingDefault {
		definition.DefaultValue = &defaultValue
	}
	return definition, nil
}

func loadIDColumn(ctx context.Context, db queryer, query string, args ...any) ([]rules.ID, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]rules.ID, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		result = append(result, rules.ID(value))
	}
	return result, rows.Err()
}

type scanner interface {
	Scan(...any) error
}

func scanScalar(row scanner) (rules.ScalarValue, error) {
	var kind string
	var textValue, numberValue, choiceOptionID, measurementAmount, measurementUnitID, referencedEntityID, fallbackName *string
	var booleanValue *bool
	if err := row.Scan(
		&kind, &textValue, &numberValue, &booleanValue, &choiceOptionID,
		&measurementAmount, &measurementUnitID, &referencedEntityID, &fallbackName,
	); err != nil {
		return rules.ScalarValue{}, err
	}
	return scalarFromColumns(kind, textValue, numberValue, booleanValue, choiceOptionID, measurementAmount, measurementUnitID, referencedEntityID, fallbackName)
}

func scalarFromColumns(kind string, textValue, numberValue *string, booleanValue *bool, choiceOptionID, measurementAmount, measurementUnitID, referencedEntityID, fallbackName *string) (rules.ScalarValue, error) {
	switch rules.ValueKind(kind) {
	case rules.ValueText:
		if textValue == nil {
			return rules.ScalarValue{}, fmt.Errorf("stored text value is malformed")
		}
		return rules.NewTextValue(*textValue), nil
	case rules.ValueNumber:
		if numberValue == nil {
			return rules.ScalarValue{}, fmt.Errorf("stored number value is malformed")
		}
		value, err := rules.ParseDecimal(*numberValue)
		if err != nil {
			return rules.ScalarValue{}, err
		}
		return rules.NewNumberValue(value), nil
	case rules.ValueBoolean:
		if booleanValue == nil {
			return rules.ScalarValue{}, fmt.Errorf("stored boolean value is malformed")
		}
		return rules.NewBooleanValue(*booleanValue), nil
	case rules.ValueChoice:
		if choiceOptionID == nil {
			return rules.ScalarValue{}, fmt.Errorf("stored choice value is malformed")
		}
		return rules.NewChoiceValue(rules.ID(*choiceOptionID)), nil
	case rules.ValueMeasurement:
		if measurementAmount == nil || measurementUnitID == nil {
			return rules.ScalarValue{}, fmt.Errorf("stored measurement value is malformed")
		}
		amount, err := rules.ParseDecimal(*measurementAmount)
		if err != nil {
			return rules.ScalarValue{}, err
		}
		return rules.NewMeasurementValue(amount, rules.ID(*measurementUnitID)), nil
	case rules.ValueReference:
		if referencedEntityID == nil {
			return rules.ScalarValue{}, fmt.Errorf("stored reference value is malformed")
		}
		return rules.NewReferenceValue(rules.ID(*referencedEntityID), fallbackName), nil
	default:
		return rules.ScalarValue{}, fmt.Errorf("stored value kind %q is unsupported", kind)
	}
}

func parseNullableDecimal(value *string) (*rules.Decimal, error) {
	if value == nil {
		return nil, nil
	}
	decimal, err := rules.ParseDecimal(*value)
	if err != nil {
		return nil, err
	}
	return &decimal, nil
}

func saveDefinitionDomain(ctx context.Context, db *Server, ruleSetID, definitionID string, proposed rules.StateVariableDefinition) (rules.StateVariableDefinition, error) {
	tx, err := db.db.Begin(ctx)
	if err != nil {
		return rules.StateVariableDefinition{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for _, schemaID := range definitionSchemaIDs(proposed) {
		var locked string
		if err := tx.QueryRow(ctx, `
			select id::text from state_owner_schemas
			where rule_set_id = $1 and id = $2 for share`, ruleSetID, schemaID).Scan(&locked); err != nil {
			return rules.StateVariableDefinition{}, err
		}
	}

	creating := definitionID == ""
	var current rules.StateVariableDefinition
	if creating {
		definitionID = string(proposed.ID)
		_, err = tx.Exec(ctx, `
			insert into state_variable_definitions (
				id, rule_set_id, key, label, description, presentation_group, value_kind, cardinality,
				missing_kind, omit_default_when_stored, condition_addressable, display_order,
				presentation_control, presentation_help_text,
				number_minimum, number_maximum, number_step, number_unit,
				measurement_minimum, measurement_maximum, measurement_step, archived
			) values (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
				$15, $16, $17, $18, $19, $20, $21, false
			)`, definitionRootArgs(proposed)...)
		if err != nil {
			return rules.StateVariableDefinition{}, err
		}
	} else {
		if _, lockErr := tx.Exec(ctx, `
			select 1 from state_variable_definitions
			where rule_set_id = $1 and id = $2 for update`, ruleSetID, definitionID); lockErr != nil {
			return rules.StateVariableDefinition{}, lockErr
		}
		var loadErr error
		current, loadErr = loadDefinitionDomain(ctx, tx, ruleSetID, definitionID)
		if loadErr != nil {
			return rules.StateVariableDefinition{}, loadErr
		}
	}

	if err := lockDefinitionReferenceEntities(ctx, tx, ruleSetID, proposed); err != nil {
		return rules.StateVariableDefinition{}, err
	}
	schemas, err := loadOwnerSchemasDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.StateVariableDefinition{}, err
	}
	entities, err := loadEntitiesDomain(ctx, tx, ruleSetID)
	if err != nil {
		return rules.StateVariableDefinition{}, err
	}
	if fields := archivedDefinitionReferenceFields(proposed, current, schemas); len(fields) > 0 {
		return rules.StateVariableDefinition{}, &statusError{
			Status: 422, Code: "archived_reference",
			Message: "archived owner schemas cannot receive new definition references", Fields: fields,
		}
	}
	if validation := rules.ValidateStateVariableDefinition(proposed, schemas, entities); len(validation) > 0 {
		return rules.StateVariableDefinition{}, validationStatus("state variable is invalid against current dependencies", validation)
	}

	if !creating {
		var used bool
		if err = tx.QueryRow(ctx, `
			select exists(select 1 from state_values where rule_set_id = $1 and state_variable_id = $2)
				or exists(select 1 from condition_criteria where rule_set_id = $1 and state_variable_id = $2)
				or exists(select 1 from effects where rule_set_id = $1 and state_variable_id = $2)
				or exists(
					select 1 from interaction_resolution_effects
					where rule_set_id = $1 and state_variable_id = $2
				)`,
			ruleSetID, definitionID).Scan(&used); err != nil {
			return rules.StateVariableDefinition{}, err
		}
		if used && !definitionSemanticsEqual(current, proposed) {
			return rules.StateVariableDefinition{}, &statusError{
				Status: 409, Code: "definition_in_use", Message: "used state-variable semantics cannot change; duplicate it to create a replacement",
			}
		}
		_, err = tx.Exec(ctx, `
			update state_variable_definitions set
				key = $3, label = $4, description = $5, presentation_group = $6,
				value_kind = $7, cardinality = $8, missing_kind = $9, omit_default_when_stored = $10,
				condition_addressable = $11, display_order = $12, presentation_control = $13,
				presentation_help_text = $14, number_minimum = $15, number_maximum = $16,
				number_step = $17, number_unit = $18, measurement_minimum = $19,
				measurement_maximum = $20, measurement_step = $21, archived = $22
			where id = $1 and rule_set_id = $2`, append(definitionRootArgs(proposed), proposed.Archived)...)
		if err != nil {
			return rules.StateVariableDefinition{}, err
		}
		if used {
			if err = tx.Commit(ctx); err != nil {
				return rules.StateVariableDefinition{}, err
			}
			return loadDefinitionSnapshot(ctx, db, ruleSetID, definitionID)
		}
		if err = clearDefinitionChildren(ctx, tx, ruleSetID, definitionID); err != nil {
			return rules.StateVariableDefinition{}, err
		}
	}

	if err = insertDefinitionChildren(ctx, tx, proposed); err != nil {
		return rules.StateVariableDefinition{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return rules.StateVariableDefinition{}, err
	}
	return loadDefinitionSnapshot(ctx, db, ruleSetID, definitionID)
}

func definitionSchemaIDs(definition rules.StateVariableDefinition) []rules.ID {
	set := make(map[rules.ID]struct{}, len(definition.OwnerSchemaIDs)+len(definition.ReferenceTargetOwnerSchemaIDs))
	for _, id := range definition.OwnerSchemaIDs {
		set[id] = struct{}{}
	}
	for _, id := range definition.ReferenceTargetOwnerSchemaIDs {
		set[id] = struct{}{}
	}
	result := make([]rules.ID, 0, len(set))
	for id := range set {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func lockDefinitionReferenceEntities(ctx context.Context, tx pgx.Tx, ruleSetID string, definition rules.StateVariableDefinition) error {
	if definition.DefaultValue == nil {
		return nil
	}
	set := make(map[rules.ID]struct{})
	for _, scalar := range definition.DefaultValue.Values {
		if scalar.Kind == rules.ValueReference {
			set[scalar.ReferencedEntityID] = struct{}{}
		}
	}
	return lockEntityAndStateRoots(ctx, tx, ruleSetID, sortedRuleIDs(set))
}

func loadDefinitionSnapshot(ctx context.Context, server *Server, ruleSetID, definitionID string) (rules.StateVariableDefinition, error) {
	return readProblemSnapshot(ctx, server, func(tx pgx.Tx) (rules.StateVariableDefinition, error) {
		return loadDefinitionDomain(ctx, tx, ruleSetID, definitionID)
	})
}

func definitionRootArgs(definition rules.StateVariableDefinition) []any {
	return []any{
		string(definition.ID), string(definition.RuleSetID), definition.Key, definition.Label,
		nullableString(definition.Description), nullableString(definition.PresentationGroup),
		string(definition.ValueKind), string(definition.Cardinality), string(definition.MissingKind),
		definition.OmitDefaultWhenStored, definition.ConditionAddressable, definition.DisplayOrder,
		nullableString(string(definition.PresentationControl)), nullableString(definition.PresentationHelpText),
		decimalDatabase(definition.NumberMinimum), decimalDatabase(definition.NumberMaximum), decimalDatabase(definition.NumberStep), nullableString(definition.NumberUnit),
		decimalDatabase(definition.MeasurementMinimum), decimalDatabase(definition.MeasurementMaximum), decimalDatabase(definition.MeasurementStep),
	}
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func decimalDatabase(value *rules.Decimal) any {
	if value == nil {
		return nil
	}
	return value.String()
}

func definitionSemanticsEqual(left, right rules.StateVariableDefinition) bool {
	left.Label, right.Label = "", ""
	left.Description, right.Description = "", ""
	left.PresentationGroup, right.PresentationGroup = "", ""
	left.PresentationControl, right.PresentationControl = "", ""
	left.PresentationHelpText, right.PresentationHelpText = "", ""
	left.DisplayOrder, right.DisplayOrder = 0, 0
	left.Archived, right.Archived = false, false
	left.CreatedAt = right.CreatedAt
	left.UpdatedAt = right.UpdatedAt
	return reflect.DeepEqual(left, right)
}

func clearDefinitionChildren(ctx context.Context, tx pgx.Tx, ruleSetID, definitionID string) error {
	statements := []string{
		`delete from state_variable_default_values where rule_set_id = $1 and state_variable_id = $2`,
		`delete from state_variable_effect_operations where state_variable_id = $2`,
		`delete from state_variable_reference_target_schemas where rule_set_id = $1 and state_variable_id = $2`,
		`delete from state_variable_owner_schemas where rule_set_id = $1 and state_variable_id = $2`,
		`delete from state_variable_choice_options where state_variable_id = $2`,
		`delete from state_variable_measurement_units where state_variable_id = $2`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, ruleSetID, definitionID); err != nil {
			return err
		}
	}
	return nil
}

func insertDefinitionChildren(ctx context.Context, tx pgx.Tx, definition rules.StateVariableDefinition) error {
	for _, schemaID := range definition.OwnerSchemaIDs {
		if _, err := tx.Exec(ctx, `
			insert into state_variable_owner_schemas (state_variable_id, rule_set_id, owner_schema_id)
			values ($1, $2, $3)`, definition.ID, definition.RuleSetID, schemaID); err != nil {
			return err
		}
	}
	for _, option := range definition.ChoiceOptions {
		if _, err := tx.Exec(ctx, `
			insert into state_variable_choice_options (id, state_variable_id, key, label, position)
			values ($1, $2, $3, $4, $5)`, option.ID, definition.ID, option.Key, option.Label, option.Position); err != nil {
			return err
		}
	}
	for _, unit := range definition.MeasurementUnits {
		if _, err := tx.Exec(ctx, `
			insert into state_variable_measurement_units (id, state_variable_id, unit, position)
			values ($1, $2, $3, $4)`, unit.ID, definition.ID, unit.Unit, unit.Position); err != nil {
			return err
		}
	}
	for _, schemaID := range definition.ReferenceTargetOwnerSchemaIDs {
		if _, err := tx.Exec(ctx, `
			insert into state_variable_reference_target_schemas (state_variable_id, rule_set_id, owner_schema_id)
			values ($1, $2, $3)`, definition.ID, definition.RuleSetID, schemaID); err != nil {
			return err
		}
	}
	for _, operation := range definition.AllowedEffectOperations {
		if _, err := tx.Exec(ctx, `
			insert into state_variable_effect_operations (state_variable_id, operation)
			values ($1, $2)`, definition.ID, operation); err != nil {
			return err
		}
	}
	if definition.DefaultValue != nil {
		for position, value := range definition.DefaultValue.Values {
			if err := insertDefaultScalar(ctx, tx, definition, position, value); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertDefaultScalar(ctx context.Context, tx pgx.Tx, definition rules.StateVariableDefinition, position int, value rules.ScalarValue) error {
	columns := scalarDatabaseColumns(value)
	_, err := tx.Exec(ctx, `
		insert into state_variable_default_values (
			id, rule_set_id, state_variable_id, value_kind, cardinality, position,
			text_value, number_value, boolean_value, choice_option_id,
			measurement_amount, measurement_unit_id, referenced_entity_id, fallback_name
		) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		definition.RuleSetID, definition.ID, value.Kind, definition.Cardinality, position,
		columns.Text, columns.Number, columns.Boolean, columns.ChoiceOptionID,
		columns.MeasurementAmount, columns.MeasurementUnitID, columns.ReferencedEntityID, columns.FallbackName,
	)
	return err
}

type scalarColumns struct {
	Text, Number, Boolean, ChoiceOptionID, MeasurementAmount, MeasurementUnitID, ReferencedEntityID, FallbackName any
}

func scalarDatabaseColumns(value rules.ScalarValue) scalarColumns {
	var result scalarColumns
	switch value.Kind {
	case rules.ValueText:
		result.Text = *value.Text
	case rules.ValueNumber:
		result.Number = value.Number.String()
	case rules.ValueBoolean:
		result.Boolean = *value.Boolean
	case rules.ValueChoice:
		result.ChoiceOptionID = string(value.ChoiceOptionID)
	case rules.ValueMeasurement:
		result.MeasurementAmount = value.MeasurementAmount.String()
		result.MeasurementUnitID = string(value.MeasurementUnitID)
	case rules.ValueReference:
		result.ReferencedEntityID = string(value.ReferencedEntityID)
		if value.FallbackName != nil {
			result.FallbackName = *value.FallbackName
		}
	}
	return result
}

func sortedDefinitionSlice(definitions map[rules.ID]rules.StateVariableDefinition) []rules.StateVariableDefinition {
	result := make([]rules.StateVariableDefinition, 0, len(definitions))
	for _, definition := range definitions {
		result = append(result, definition)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DisplayOrder != result[j].DisplayOrder {
			return result[i].DisplayOrder < result[j].DisplayOrder
		}
		if strings.ToLower(result[i].Label) != strings.ToLower(result[j].Label) {
			return strings.ToLower(result[i].Label) < strings.ToLower(result[j].Label)
		}
		return result[i].ID < result[j].ID
	})
	return result
}
