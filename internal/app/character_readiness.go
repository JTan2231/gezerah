package app

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

const (
	characterStatusNotControlled = "not-controlled"
	characterStatusSetupRequired = "setup-required"
	characterStatusReady         = "ready"

	playStatusWaitingForCharacter = "waiting-for-character"
	playStatusSetupRequired       = "setup-required"
	playStatusReady               = "ready"
	playStatusUnavailable         = "unavailable"
)

type entityCharacterReadiness struct {
	Status              string
	RequiredFieldCount  int
	CompletedFieldCount int
}

func loadEntityCharacterReadiness(
	ctx context.Context,
	db queryer,
	gameID, entityID string,
) (entityCharacterReadiness, error) {
	var result entityCharacterReadiness
	var archived, controlled bool
	err := db.QueryRow(ctx, `
		select entity.archived,
			exists(
				select 1
				from game_membership_entity_controls control
				join game_memberships membership
					on membership.game_id = control.game_id
					and membership.id = control.membership_id
				where control.game_id = assignment.game_id
					and control.entity_id = assignment.entity_id
					and membership.role = 'player'
					and membership.status = 'active'
			),
			(select count(*)::integer
			 from world_character_fields field
			 where field.rule_set_id = assignment.rule_set_id and not field.archived),
			(select count(*)::integer
			 from world_character_fields field
			 join entity_profile_field_values value
				on value.field_id = field.id
				and value.rule_set_id = field.rule_set_id
				and value.entity_id = assignment.entity_id
			 where field.rule_set_id = assignment.rule_set_id and not field.archived)
		from game_entities assignment
		join entities entity
			on entity.id = assignment.entity_id
			and entity.rule_set_id = assignment.rule_set_id
		where assignment.game_id = $1 and assignment.entity_id = $2`, gameID, entityID,
	).Scan(
		&archived, &controlled, &result.RequiredFieldCount, &result.CompletedFieldCount,
	)
	if err != nil {
		return result, err
	}
	switch {
	case archived || !controlled:
		result.Status = characterStatusNotControlled
	case result.CompletedFieldCount == result.RequiredFieldCount:
		result.Status = characterStatusReady
	default:
		result.Status = characterStatusSetupRequired
	}
	return result, nil
}

func loadGameMembershipPlayStatus(
	ctx context.Context,
	db queryer,
	gameID, membershipID, role, status string,
) (string, error) {
	if status != "active" {
		return playStatusUnavailable, nil
	}
	if role != "player" {
		return playStatusReady, nil
	}
	var worldBacked bool
	if err := db.QueryRow(ctx, `
		select exists(select 1 from world_profiles where primary_game_id = $1)`, gameID,
	).Scan(&worldBacked); err != nil {
		return "", err
	}
	if !worldBacked {
		return playStatusReady, nil
	}
	var controlledCount, readyCount int
	if err := db.QueryRow(ctx, `
		select
			count(*)::integer,
			count(*) filter (
				where not exists (
					select 1
					from world_character_fields field
					where field.rule_set_id = assignment.rule_set_id
						and not field.archived
						and not exists (
							select 1 from entity_profile_field_values value
							where value.entity_id = control.entity_id
								and value.field_id = field.id
								and value.rule_set_id = field.rule_set_id
						)
				)
			)::integer
		from game_membership_entity_controls control
		join game_entities assignment
			on assignment.game_id = control.game_id
			and assignment.entity_id = control.entity_id
		join entities entity
			on entity.id = assignment.entity_id
			and entity.rule_set_id = assignment.rule_set_id
		where control.game_id = $1 and control.membership_id = $2
			and not entity.archived`, gameID, membershipID,
	).Scan(&controlledCount, &readyCount); err != nil {
		return "", err
	}
	if controlledCount == 0 {
		return playStatusWaitingForCharacter, nil
	}
	if readyCount > 0 {
		return playStatusReady, nil
	}
	return playStatusSetupRequired, nil
}

func loadWorldMemberPlayStatus(
	ctx context.Context,
	db queryer,
	gameID, userID, role, status string,
) (string, error) {
	if status != "active" {
		return playStatusUnavailable, nil
	}
	if role != "player" {
		return playStatusReady, nil
	}
	var membershipID, gameRole, gameStatus string
	err := db.QueryRow(ctx, `
		select id::text, role, status from game_memberships
		where game_id = $1 and user_id = $2`, gameID, userID,
	).Scan(&membershipID, &gameRole, &gameStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return playStatusWaitingForCharacter, nil
	}
	if err != nil {
		return "", err
	}
	return loadGameMembershipPlayStatus(ctx, db, gameID, membershipID, gameRole, gameStatus)
}

func requirePlayReadyGameMember(
	ctx context.Context,
	db queryer,
	gameID, userID string,
) (authorizedGameMember, error) {
	member, err := requireActiveGameMember(ctx, db, gameID, userID)
	if err != nil {
		return member, err
	}
	if member.Role != "player" {
		member.PlayStatus = playStatusReady
		return member, nil
	}
	member.PlayStatus, err = loadGameMembershipPlayStatus(
		ctx, db, gameID, member.ID, member.Role, member.Status,
	)
	if err != nil {
		return member, err
	}
	if member.PlayStatus != playStatusReady {
		return member, &statusError{
			Status: http.StatusForbidden, Code: "character_setup_required",
			Message: "complete a controlled character before entering live play",
			Fields:  map[string]string{"play_status": member.PlayStatus},
		}
	}
	return member, nil
}

func worldPlayerControlsEntity(
	ctx context.Context,
	db queryer,
	gameID, userID, entityID string,
) (bool, error) {
	var controlled bool
	err := db.QueryRow(ctx, `
		select exists(
			select 1
			from game_memberships membership
			join game_membership_entity_controls control
				on control.game_id = membership.game_id
				and control.membership_id = membership.id
			where membership.game_id = $1
				and membership.user_id = $2
				and membership.role = 'player'
				and membership.status = 'active'
				and control.entity_id = $3
		)`, gameID, userID, entityID,
	).Scan(&controlled)
	return controlled, err
}

func requireWorldEntityReadAccess(
	ctx context.Context,
	db queryer,
	member authorizedWorldMember,
	entityID string,
) error {
	if member.Role != "player" {
		return nil
	}
	playStatus, err := loadWorldMemberPlayStatus(
		ctx, db, member.PrimaryGameID, member.UserID, member.Role, member.Status,
	)
	if err != nil {
		return err
	}
	if playStatus == playStatusReady {
		return nil
	}
	controlled, err := worldPlayerControlsEntity(
		ctx, db, member.PrimaryGameID, member.UserID, entityID,
	)
	if err != nil {
		return err
	}
	if controlled {
		return nil
	}
	return &statusError{
		Status: http.StatusForbidden, Code: "character_setup_required",
		Message: "only controlled character setup is available before entering live play",
		Fields:  map[string]string{"play_status": playStatus},
	}
}
