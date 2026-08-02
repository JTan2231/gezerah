package app

import (
	"context"
	"net/http"
	"time"

	"dnd/internal/rules"

	"github.com/jackc/pgx/v5"
)

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func loadOwnerSchemasDomain(ctx context.Context, db queryer, ruleSetID string) (map[rules.ID]rules.OwnerSchema, error) {
	rows, err := db.Query(ctx, `
		select id::text, key, label, description, archived, created_at, updated_at
		from state_owner_schemas where rule_set_id = $1 order by id`, ruleSetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[rules.ID]rules.OwnerSchema)
	for rows.Next() {
		var id, key, label string
		var description *string
		var archived bool
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &key, &label, &description, &archived, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		item := rules.OwnerSchema{
			ID:        rules.ID(id),
			RuleSetID: rules.ID(ruleSetID),
			Key:       key,
			Label:     label,
			Archived:  archived,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		}
		if description != nil {
			item.Description = *description
		}
		result[item.ID] = item
	}
	return result, rows.Err()
}

func loadEntitiesDomain(ctx context.Context, db queryer, ruleSetID string) (map[rules.ID]rules.Entity, error) {
	rows, err := db.Query(ctx, `
		select e.id::text, e.key, e.display_name, e.archived, e.created_at, e.updated_at,
			coalesce(array_agg(eos.owner_schema_id::text order by eos.owner_schema_id)
				filter (where eos.owner_schema_id is not null), '{}'::text[])
		from entities e
		left join entity_owner_schemas eos on eos.rule_set_id = e.rule_set_id and eos.entity_id = e.id
		where e.rule_set_id = $1
		group by e.id order by e.id`, ruleSetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[rules.ID]rules.Entity)
	for rows.Next() {
		var id, displayName string
		var key *string
		var archived bool
		var createdAt, updatedAt time.Time
		var schemaIDs []string
		if err := rows.Scan(&id, &key, &displayName, &archived, &createdAt, &updatedAt, &schemaIDs); err != nil {
			return nil, err
		}
		item := rules.Entity{
			ID:             rules.ID(id),
			RuleSetID:      rules.ID(ruleSetID),
			DisplayName:    displayName,
			OwnerSchemaIDs: stringIDs(schemaIDs),
			Archived:       archived,
			CreatedAt:      createdAt,
			UpdatedAt:      updatedAt,
		}
		if key != nil {
			item.Key = *key
		}
		result[item.ID] = item
	}
	return result, rows.Err()
}

func stringIDs(values []string) []rules.ID {
	result := make([]rules.ID, len(values))
	for index, value := range values {
		result[index] = rules.ID(value)
	}
	return result
}

func idsToStrings(values []rules.ID) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = string(value)
	}
	return result
}

func validationStatus(message string, validationErrors rules.ValidationErrors) *statusError {
	fields := make(map[string]string, len(validationErrors))
	for _, item := range validationErrors {
		fields[item.Path] = item.Message
	}
	return &statusError{
		Status:  http.StatusUnprocessableEntity,
		Code:    "validation_failed",
		Message: message,
		Fields:  fields,
	}
}
