package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type statusError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
}

func (e *statusError) Error() string { return e.Message }

func handleAppError(w http.ResponseWriter, err error) {
	var status *statusError
	if errors.As(err, &status) {
		writeError(w, status.Status, status.Code, status.Message, status.Fields)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "resource not found", nil)
		return
	}
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) {
		switch databaseError.Code {
		case "23505":
			writeError(w, http.StatusConflict, "conflict", "the requested change conflicts with current data", nil)
		case "23503":
			writeError(w, http.StatusUnprocessableEntity, "invalid_reference", "a referenced world resource does not exist", nil)
		case "23514", "22P02", "22003":
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", "resource violates a data constraint", nil)
		default:
			writeError(w, http.StatusInternalServerError, "database_error", "database operation failed", nil)
		}
		return
	}
	writeError(w, http.StatusInternalServerError, "internal_error", "internal server error", nil)
}

func rollbackTx(ctx context.Context, tx pgx.Tx) {
	rollbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := tx.Rollback(rollbackCtx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		slog.Error("rollback transaction", "error", err)
	}
}

func validID(value string) bool { return uuidPattern.MatchString(value) }

func newID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}

func cleanOptional(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func validateRequired(fields map[string]string, path, value string, maximum int) {
	value = strings.TrimSpace(value)
	if value == "" {
		fields[path] = "is required"
	} else if len([]rune(value)) > maximum {
		fields[path] = fmt.Sprintf("must be at most %d characters", maximum)
	}
}

func uniqueSorted(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func uniqueInOrder(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func nullableOptionalString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func revisionConflict(resource string, expected, actual int64) error {
	return &statusError{
		Status: http.StatusConflict, Code: "revision_conflict", Message: resource + " changed since it was loaded",
		Fields: map[string]string{"expected_revision": fmt.Sprint(expected), "actual_revision": fmt.Sprint(actual)},
	}
}

func requireKnownActor(_ context.Context, _ queryer, r *http.Request) (string, error) {
	actor, ok := actorFromRequest(r)
	if !ok {
		return "", authenticationRequired()
	}
	return actor.User.ID, nil
}

type authorizedWorldMember struct {
	ID          string
	WorldID     string
	UserID      string
	Role        string
	Status      string
	WorldStatus string
	Facilitator bool
}

func requireActiveWorldMember(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	var member authorizedWorldMember
	if !validID(worldID) {
		return member, &statusError{Status: http.StatusBadRequest, Code: "invalid_id", Message: "world ID is malformed"}
	}
	userID, err := requireKnownActor(ctx, db, r)
	if err != nil {
		return member, err
	}
	err = db.QueryRow(ctx, `
		select membership.id::text, membership.world_id::text, membership.user_id::text,
			membership.role, membership.status, world.status,
			world.facilitator_source = 'human' and world.facilitator_membership_id = membership.id
		from world_memberships membership
		join worlds world on world.id = membership.world_id
		where membership.world_id = $1 and membership.user_id = $2`, worldID, userID,
	).Scan(
		&member.ID, &member.WorldID, &member.UserID, &member.Role, &member.Status,
		&member.WorldStatus, &member.Facilitator,
	)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && member.Status != "active") {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_forbidden", Message: "active world membership is required"}
	}
	return member, err
}

func requireWorldEditor(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if member.Role != "owner" && member.Role != "editor" {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_editor_required", Message: "world editing permission is required"}
	}
	if member.WorldStatus != "active" {
		return member, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"}
	}
	return member, nil
}

func requireWorldOwner(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if member.Role != "owner" {
		return member, &statusError{Status: http.StatusForbidden, Code: "world_owner_required", Message: "world owner permission is required"}
	}
	return member, nil
}

func requireFacilitator(ctx context.Context, db queryer, r *http.Request, worldID string) (authorizedWorldMember, error) {
	member, err := requireActiveWorldMember(ctx, db, r, worldID)
	if err != nil {
		return member, err
	}
	if !member.Facilitator {
		return member, &statusError{Status: http.StatusForbidden, Code: "facilitator_required", Message: "facilitator authority is required"}
	}
	if member.WorldStatus != "active" {
		return member, &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"}
	}
	return member, nil
}

func requireTerraFacilitator(ctx context.Context, db queryer, worldID string) error {
	return requireFacilitatorSource(ctx, db, worldID, terraFacilitatorSource, "Terra")
}

func requireAgentFacilitator(ctx context.Context, db queryer, worldID string) error {
	return requireFacilitatorSource(ctx, db, worldID, agentFacilitatorSource, "the agent")
}

func requireFacilitatorSource(
	ctx context.Context,
	db queryer,
	worldID, expectedSource, label string,
) error {
	if !validID(worldID) {
		return &statusError{Status: http.StatusBadRequest, Code: "invalid_id", Message: "world ID is malformed"}
	}
	var source, status string
	var facilitatorMembershipID *string
	if err := db.QueryRow(ctx, `
		select facilitator_source, status, facilitator_membership_id::text
		from worlds where id = $1`, worldID,
	).Scan(&source, &status, &facilitatorMembershipID); err != nil {
		return err
	}
	if status != "active" {
		return &statusError{Status: http.StatusConflict, Code: "world_archived", Message: "archived worlds cannot be changed"}
	}
	if source != expectedSource || facilitatorMembershipID != nil {
		return &statusError{
			Status: http.StatusForbidden, Code: "facilitator_required",
			Message: label + " is not the current facilitator",
		}
	}
	return nil
}

func currentPlayRole(membershipRole string, facilitator bool) string {
	if facilitator {
		return "facilitator"
	}
	if membershipRole == "spectator" {
		return "spectator"
	}
	return "player"
}

func membershipPlayStatus(ctx context.Context, db queryer, worldID, membershipID, role, status string) (string, error) {
	if status != "active" {
		return "unavailable", nil
	}
	if role == "spectator" {
		return "ready", nil
	}
	var controlled, incomplete int
	err := db.QueryRow(ctx, `
		select count(distinct control.entity_id)::int,
			count(distinct case when missing.entity_id is not null then control.entity_id end)::int
		from world_membership_entity_controls control
		join entities entity on entity.id = control.entity_id and entity.world_id = control.world_id and not entity.archived
		left join lateral (
			select entity.id as entity_id
			where exists (
				select 1 from world_character_fields field
				where field.world_id = entity.world_id and not field.archived
				and not exists (
					select 1 from entity_profile_values value
					where value.entity_id = entity.id and value.field_id = field.id and btrim(value.body) <> ''
				)
			)
		) missing on true
		where control.world_id = $1 and control.membership_id = $2`, worldID, membershipID,
	).Scan(&controlled, &incomplete)
	if err != nil {
		return "", err
	}
	if controlled == 0 {
		return "waiting-for-character", nil
	}
	if incomplete > 0 {
		return "setup-required", nil
	}
	return "ready", nil
}

func entityCharacterStatus(ctx context.Context, db queryer, worldID, entityID string) (string, int, int, error) {
	var controllers, required, completed int
	err := db.QueryRow(ctx, `
		select
			(select count(*)::int from world_membership_entity_controls control
			 join world_memberships membership on membership.id = control.membership_id
			 where control.world_id = $1 and control.entity_id = $2
				 and membership.status = 'active' and membership.role <> 'spectator'),
			(select count(*)::int from world_character_fields
			 where world_id = $1 and not archived),
			(select count(*)::int from entity_profile_values value
			 join world_character_fields field on field.id = value.field_id and field.world_id = value.world_id
			 where value.world_id = $1 and value.entity_id = $2 and not field.archived and btrim(value.body) <> '')`,
		worldID, entityID,
	).Scan(&controllers, &required, &completed)
	if err != nil {
		return "", 0, 0, err
	}
	if controllers == 0 {
		return "not-controlled", required, completed, nil
	}
	if completed < required {
		return "setup-required", required, completed, nil
	}
	return "ready", required, completed, nil
}
