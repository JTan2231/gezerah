package app

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func loadRulesRevision(ctx context.Context, db queryer, worldID string) (int64, error) {
	var revision int64
	err := db.QueryRow(ctx, `select revision from world_rule_sets where world_id = $1`, worldID).Scan(&revision)
	return revision, err
}

func requireRulesRevision(ctx context.Context, db queryer, worldID string, expected *int64) (int64, error) {
	if expected == nil {
		return 0, &statusError{
			Status:  http.StatusUnprocessableEntity,
			Code:    "validation_failed",
			Message: "rules revision is required",
			Fields:  map[string]string{"expected_rules_revision": "is required"},
		}
	}
	actual, err := loadRulesRevision(ctx, db, worldID)
	if err != nil {
		return 0, err
	}
	if actual != *expected {
		return actual, rulesRevisionConflict(*expected, actual)
	}
	return actual, nil
}

func lockRulesRevision(ctx context.Context, tx pgx.Tx, worldID string, expected *int64) (int64, error) {
	if expected == nil {
		return 0, &statusError{
			Status:  http.StatusUnprocessableEntity,
			Code:    "validation_failed",
			Message: "rules revision is required",
			Fields:  map[string]string{"expected_rules_revision": "is required"},
		}
	}
	var actual int64
	if err := tx.QueryRow(ctx, `select revision from world_rule_sets where world_id = $1 for update`, worldID).Scan(&actual); err != nil {
		return 0, err
	}
	if actual != *expected {
		return actual, rulesRevisionConflict(*expected, actual)
	}
	return actual, nil
}

func rulesRevisionConflict(expected, actual int64) error {
	return &statusError{
		Status:  http.StatusConflict,
		Code:    "revision_conflict",
		Message: "world rules changed since they were loaded",
		Fields: map[string]string{
			"expected_rules_revision": fmt.Sprint(expected),
			"actual_rules_revision":   fmt.Sprint(actual),
		},
	}
}
