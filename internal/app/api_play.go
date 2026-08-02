package app

import "time"

type playUserResponse struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type gameMembershipResponse struct {
	ID          string            `json:"id"`
	GameID      string            `json:"game_id"`
	UserID      string            `json:"user_id"`
	Role        string            `json:"role"`
	Status      string            `json:"status"`
	Revision    int64             `json:"revision"`
	DisplayName string            `json:"display_name"`
	User        *playUserResponse `json:"user,omitempty"`
	JoinedAt    *time.Time        `json:"joined_at,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

type gameResponse struct {
	ID              string                   `json:"id"`
	RuleSetID       string                   `json:"rule_set_id"`
	Name            string                   `json:"name"`
	Status          string                   `json:"status"`
	Revision        int64                    `json:"revision"`
	Memberships     []gameMembershipResponse `json:"memberships"`
	EntityIDs       []string                 `json:"entity_ids"`
	CreatedByUserID string                   `json:"created_by_user_id"`
	CreatedAt       time.Time                `json:"created_at"`
	UpdatedAt       time.Time                `json:"updated_at"`
}

type createPlayUserRequest struct {
	ID          string `json:"id,omitempty"`
	DisplayName string `json:"display_name"`
}

type createGameRequest struct {
	ID        string   `json:"id,omitempty"`
	RuleSetID string   `json:"rule_set_id"`
	Name      string   `json:"name"`
	EntityIDs []string `json:"entity_ids"`
}

type createGameMembershipRequest struct {
	ID     string `json:"id,omitempty"`
	UserID string `json:"user_id"`
	Role   string `json:"role"`
	Status string `json:"status,omitempty"`
}

type updateGameMembershipRequest struct {
	ID               string  `json:"id,omitempty"`
	Role             *string `json:"role,omitempty"`
	Status           *string `json:"status,omitempty"`
	ExpectedRevision *int64  `json:"expected_revision,omitempty"`
}

type replaceGameEntitiesRequest struct {
	EntityIDs        []string `json:"entity_ids"`
	ExpectedRevision *int64   `json:"expected_revision"`
}

type archiveGameRequest struct {
	ExpectedRevision *int64 `json:"expected_revision"`
}
