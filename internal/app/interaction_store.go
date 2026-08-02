package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type interactionAudience struct {
	AudienceIDs  []string
	ResponderIDs []string
	EntityIDs    []string
}

func loadInteractionResponse(ctx context.Context, db queryer, gameID, interactionID string, includePrivate bool) (interactionResponse, error) {
	var result interactionResponse
	var privateNotes *string
	if err := db.QueryRow(ctx, `
		select id::text, game_id::text, title, prompt, private_notes, status, revision,
			created_by_membership_id::text, presented_at, resolved_at, cancelled_at,
			created_at, updated_at
		from interactions where game_id = $1 and id = $2`, gameID, interactionID,
	).Scan(
		&result.ID, &result.GameID, &result.Title, &result.Prompt, &privateNotes,
		&result.Status, &result.Revision, &result.CreatedByMembershipID,
		&result.PresentedAt, &result.ResolvedAt, &result.CancelledAt,
		&result.CreatedAt, &result.UpdatedAt,
	); err != nil {
		return result, err
	}
	if includePrivate {
		result.PrivateNotes = privateNotes
	}
	var err error
	result.AudienceMembershipIDs, err = loadStringColumn(ctx, db, `
		select membership_id::text from interaction_audience_members
		where interaction_id = $1 order by membership_id`, interactionID)
	if err != nil {
		return result, err
	}
	result.EligibleResponderMembershipIDs, err = loadStringColumn(ctx, db, `
		select membership_id::text from interaction_eligible_responders
		where interaction_id = $1 order by membership_id`, interactionID)
	if err != nil {
		return result, err
	}
	result.EntityIDs, err = loadStringColumn(ctx, db, `
		select entity_id::text from interaction_context_entities
		where interaction_id = $1 and ($2 or visibility = 'public') order by position`, interactionID, includePrivate)
	if err != nil {
		return result, err
	}
	result.Actions, err = loadInteractionActions(ctx, db, gameID, interactionID)
	if err != nil {
		return result, err
	}
	if result.Status == "resolved" {
		var ruleSetID string
		if err := db.QueryRow(ctx, `select rule_set_id::text from games where id = $1`, gameID).Scan(&ruleSetID); err != nil {
			return result, err
		}
		definitions, err := loadDefinitionsDomain(ctx, db, ruleSetID)
		if err != nil {
			return result, err
		}
		result.Resolution, err = loadInteractionResolutionResponse(ctx, db, gameID, interactionID, definitions, includePrivate)
		if err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s *Server) loadInteractionResponseSnapshot(ctx context.Context, gameID, interactionID string, includePrivate bool) (interactionResponse, error) {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return interactionResponse{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	item, err := loadInteractionResponse(ctx, tx, gameID, interactionID, includePrivate)
	if err != nil {
		return interactionResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return interactionResponse{}, err
	}
	return item, nil
}

func loadInteractionActions(ctx context.Context, db queryer, gameID, interactionID string) ([]interactionActionResponse, error) {
	rows, err := db.Query(ctx, `
		select action.id::text, action.interaction_id::text,
			action.submitted_by_membership_id::text, membership.user_id::text,
			app_user.display_name, action.text, action.status, action.revision,
			action.created_at, action.updated_at
		from interaction_action_submissions action
		join game_memberships membership
			on membership.game_id = action.game_id and membership.id = action.submitted_by_membership_id
		join users app_user on app_user.id = membership.user_id
		where action.game_id = $1 and action.interaction_id = $2
		order by action.created_at, action.id`, gameID, interactionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]interactionActionResponse, 0)
	for rows.Next() {
		var item interactionActionResponse
		if err := rows.Scan(
			&item.ID, &item.InteractionID, &item.SubmittedByMembershipID,
			&item.SubmittedByUserID, &item.SubmittedByName, &item.Text,
			&item.Status, &item.Revision, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func loadInteractionAction(ctx context.Context, db queryer, gameID, interactionID, actionID string) (interactionActionResponse, error) {
	var item interactionActionResponse
	err := db.QueryRow(ctx, `
		select action.id::text, action.interaction_id::text,
			action.submitted_by_membership_id::text, membership.user_id::text,
			app_user.display_name, action.text, action.status, action.revision,
			action.created_at, action.updated_at
		from interaction_action_submissions action
		join game_memberships membership
			on membership.game_id = action.game_id and membership.id = action.submitted_by_membership_id
		join users app_user on app_user.id = membership.user_id
		where action.game_id = $1 and action.interaction_id = $2 and action.id = $3`,
		gameID, interactionID, actionID,
	).Scan(
		&item.ID, &item.InteractionID, &item.SubmittedByMembershipID,
		&item.SubmittedByUserID, &item.SubmittedByName, &item.Text,
		&item.Status, &item.Revision, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func validateInteractionRequest(ctx context.Context, tx pgx.Tx, gameID, ruleSetID string, request *saveInteractionRequest, requireRevision bool) (interactionAudience, map[string]string, error) {
	fields := make(map[string]string)
	if request.ID != "" && !validID(request.ID) {
		fields["id"] = "must be a UUID"
	}
	if requireRevision && (request.ExpectedRevision == nil || *request.ExpectedRevision < 0) {
		fields["expected_revision"] = "a non-negative expected revision is required"
	} else if request.ExpectedRevision != nil && *request.ExpectedRevision < 0 {
		fields["expected_revision"] = "cannot be negative"
	}
	request.Title = cleanOptional(request.Title)
	request.PrivateNotes = cleanOptional(request.PrivateNotes)
	request.Prompt = strings.TrimSpace(request.Prompt)
	validateRequired(fields, "prompt", request.Prompt, 10000)
	if request.Title != nil && len(*request.Title) > 200 {
		fields["title"] = "must be 200 characters or fewer"
	}
	if request.PrivateNotes != nil && len(*request.PrivateNotes) > 20000 {
		fields["private_notes"] = "must be 20000 characters or fewer"
	}
	request.AudienceMembershipIDs = uniqueSorted(request.AudienceMembershipIDs)
	request.EligibleResponderMembershipIDs = uniqueSorted(request.EligibleResponderMembershipIDs)
	request.EntityIDs = uniqueInOrder(request.EntityIDs)
	for path, values := range map[string][]string{
		"audience_membership_ids":           request.AudienceMembershipIDs,
		"eligible_responder_membership_ids": request.EligibleResponderMembershipIDs,
		"entity_ids":                        request.EntityIDs,
	} {
		for index, id := range values {
			if !validID(id) {
				fields[fmt.Sprintf("%s[%d]", path, index)] = "must be a UUID"
			}
		}
	}
	if len(fields) > 0 {
		return interactionAudience{}, fields, nil
	}

	memberRoles := make(map[string]string)
	rows, err := tx.Query(ctx, `
		select id::text, role from game_memberships
		where game_id = $1 and status = 'active' order by id for share`, gameID)
	if err != nil {
		return interactionAudience{}, nil, err
	}
	for rows.Next() {
		var membershipID, role string
		if err := rows.Scan(&membershipID, &role); err != nil {
			rows.Close()
			return interactionAudience{}, nil, err
		}
		memberRoles[membershipID] = role
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return interactionAudience{}, nil, err
	}
	rows.Close()
	if len(request.AudienceMembershipIDs) == 0 {
		request.AudienceMembershipIDs = make([]string, 0, len(memberRoles))
		for membershipID := range memberRoles {
			request.AudienceMembershipIDs = append(request.AudienceMembershipIDs, membershipID)
		}
		sort.Strings(request.AudienceMembershipIDs)
	}
	audience := make(map[string]struct{}, len(request.AudienceMembershipIDs))
	for index, membershipID := range request.AudienceMembershipIDs {
		if _, exists := memberRoles[membershipID]; !exists {
			fields[fmt.Sprintf("audience_membership_ids[%d]", index)] = "active membership does not exist in this game"
		}
		audience[membershipID] = struct{}{}
	}
	for index, membershipID := range request.EligibleResponderMembershipIDs {
		role, exists := memberRoles[membershipID]
		if !exists || role != "player" {
			fields[fmt.Sprintf("eligible_responder_membership_ids[%d]", index)] = "active player membership is required"
			continue
		}
		if _, visible := audience[membershipID]; !visible {
			fields[fmt.Sprintf("eligible_responder_membership_ids[%d]", index)] = "eligible responder must also be in the audience"
		}
	}
	for index, entityID := range request.EntityIDs {
		var archived bool
		err := tx.QueryRow(ctx, `
			select entity.archived
			from game_entities assignment
			join entities entity on entity.id = assignment.entity_id and entity.rule_set_id = assignment.rule_set_id
			where assignment.game_id = $1 and assignment.rule_set_id = $2 and assignment.entity_id = $3
			for share of entity`, gameID, ruleSetID, entityID).Scan(&archived)
		if errors.Is(err, pgx.ErrNoRows) {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "entity is not assigned to this game"
			continue
		}
		if err != nil {
			return interactionAudience{}, nil, err
		}
		if archived {
			fields[fmt.Sprintf("entity_ids[%d]", index)] = "archived entity cannot be added to a new interaction"
		}
	}
	return interactionAudience{
		AudienceIDs: request.AudienceMembershipIDs, ResponderIDs: request.EligibleResponderMembershipIDs,
		EntityIDs: request.EntityIDs,
	}, fields, nil
}

func replaceInteractionChildren(ctx context.Context, tx pgx.Tx, interactionID, gameID string, related interactionAudience) error {
	if _, err := tx.Exec(ctx, `delete from interaction_audience_members where interaction_id = $1`, interactionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from interaction_eligible_responders where interaction_id = $1`, interactionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from interaction_context_entities where interaction_id = $1`, interactionID); err != nil {
		return err
	}
	for _, membershipID := range related.AudienceIDs {
		if _, err := tx.Exec(ctx, `
			insert into interaction_audience_members (interaction_id, game_id, membership_id)
			values ($1, $2, $3)`, interactionID, gameID, membershipID); err != nil {
			return err
		}
	}
	for _, membershipID := range related.ResponderIDs {
		if _, err := tx.Exec(ctx, `
			insert into interaction_eligible_responders (interaction_id, game_id, membership_id)
			values ($1, $2, $3)`, interactionID, gameID, membershipID); err != nil {
			return err
		}
	}
	for position, entityID := range related.EntityIDs {
		if _, err := tx.Exec(ctx, `
			insert into interaction_context_entities (
				interaction_id, game_id, entity_id, visibility, position
			) values ($1, $2, $3, 'public', $4)`, interactionID, gameID, entityID, position); err != nil {
			return err
		}
	}
	return nil
}

func appendInteractionGameEvent(ctx context.Context, tx pgx.Tx, gameID, eventType, actorMembershipID, interactionID string, submissionID *string) error {
	_, err := tx.Exec(ctx, `
		insert into game_events (
			game_id, event_type, actor_membership_id, interaction_id, submission_id
		) values ($1, $2, $3, $4, $5)`, gameID, eventType, actorMembershipID, interactionID, submissionID)
	return err
}

func loadVisibleGameEvents(ctx context.Context, db queryer, gameID string, member authorizedGameMember, after int64) ([]gameEventResponse, error) {
	rows, err := db.Query(ctx, `
		select event.id, event.event_type, event.interaction_id::text,
			event.submission_id::text, event.resolution_id::text,
			event.actor_membership_id::text, event.created_at
		from game_events event
		left join interactions interaction
			on interaction.game_id = event.game_id and interaction.id = event.interaction_id
		where event.game_id = $1 and event.id > $2
			and (
				event.interaction_id is null
				or $3 = 'facilitator'
				or (
					event.event_type not in ('interaction-created', 'interaction-updated')
					and interaction.presented_at is not null
					and exists (
						select 1 from interaction_audience_members audience
						where audience.interaction_id = event.interaction_id
							and audience.game_id = event.game_id
							and audience.membership_id = $4
					)
				)
			)
		order by event.id limit 100`, gameID, after, member.Role, member.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]gameEventResponse, 0)
	for rows.Next() {
		var item gameEventResponse
		if err := rows.Scan(
			&item.ID, &item.Type, &item.InteractionID, &item.SubmissionID,
			&item.ResolutionID, &item.ActorMembershipID, &item.CreatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func interactionConflict(expected, actual int64) error {
	return &statusError{
		Status: http.StatusConflict, Code: "revision_conflict", Message: "interaction changed since it was loaded",
		Fields: map[string]string{"expected_revision": fmt.Sprint(expected), "actual_revision": fmt.Sprint(actual)},
	}
}

func nullableOptionalString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// Context entity order is authored presentation state. Remove repeated IDs
// without sorting so the persisted position continues to reflect the request.
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

func eventPollInterval() time.Duration { return 1500 * time.Millisecond }
