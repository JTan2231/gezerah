package app

import (
	"encoding/json"
	"time"
)

type worldResponse struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	Description       *string    `json:"description,omitempty"`
	Status            string     `json:"status"`
	Revision          int64      `json:"revision"`
	Role              string     `json:"role"`
	MembershipID      string     `json:"membership_id"`
	PrimaryGameID     string     `json:"primary_game_id"`
	MemberCount       int        `json:"member_count"`
	CapacityCount     int        `json:"capacity_count"`
	CapabilityCount   int        `json:"capability_count"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	LastInteractionAt *time.Time `json:"last_interaction_at,omitempty"`
}

type createWorldRequest struct {
	ID          string  `json:"id,omitempty"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

type updateWorldRequest struct {
	Name             *string `json:"name,omitempty"`
	Description      *string `json:"description,omitempty"`
	ExpectedRevision *int64  `json:"expected_revision"`
}

type archiveWorldRequest struct {
	ExpectedRevision *int64 `json:"expected_revision"`
}

type worldMemberResponse struct {
	ID          string     `json:"id"`
	UserID      string     `json:"user_id"`
	DisplayName string     `json:"display_name"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	Revision    int64      `json:"revision"`
	JoinedAt    *time.Time `json:"joined_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type createWorldInviteRequest struct {
	Role          string `json:"role"`
	ExpiresInDays int    `json:"expires_in_days,omitempty"`
}

type worldInviteResponse struct {
	ID                   string     `json:"id"`
	Role                 string     `json:"role"`
	CreatedByDisplayName string     `json:"created_by_display_name"`
	ExpiresAt            time.Time  `json:"expires_at"`
	RevokedAt            *time.Time `json:"revoked_at,omitempty"`
	UseCount             int        `json:"use_count"`
	CreatedAt            time.Time  `json:"created_at"`
	JoinPath             *string    `json:"join_path,omitempty"`
}

type worldInvitePreviewResponse struct {
	WorldID              string    `json:"world_id"`
	WorldName            string    `json:"world_name"`
	WorldDescription     *string   `json:"world_description,omitempty"`
	Role                 string    `json:"role"`
	InvitedByDisplayName string    `json:"invited_by_display_name"`
	ExpiresAt            time.Time `json:"expires_at"`
}

type worldMechanicResponse struct {
	ID                string       `json:"id"`
	Kind              string       `json:"kind"`
	Mode              string       `json:"mode"`
	Name              string       `json:"name"`
	Description       *string      `json:"description,omitempty"`
	Minimum           *json.Number `json:"minimum,omitempty"`
	Maximum           *json.Number `json:"maximum,omitempty"`
	Step              *json.Number `json:"step,omitempty"`
	DefaultNumber     *json.Number `json:"default_number,omitempty"`
	Unit              *string      `json:"unit,omitempty"`
	MutableDuringPlay bool         `json:"mutable_during_play"`
	Archived          bool         `json:"archived"`
	CreatedAt         time.Time    `json:"created_at"`
	UpdatedAt         time.Time    `json:"updated_at"`
}

type saveWorldMechanicRequest struct {
	ID                string       `json:"id,omitempty"`
	Kind              string       `json:"kind"`
	Mode              string       `json:"mode"`
	Name              string       `json:"name"`
	Description       *string      `json:"description,omitempty"`
	Minimum           *json.Number `json:"minimum,omitempty"`
	Maximum           *json.Number `json:"maximum,omitempty"`
	Step              *json.Number `json:"step,omitempty"`
	DefaultNumber     *json.Number `json:"default_number,omitempty"`
	Unit              *string      `json:"unit,omitempty"`
	MutableDuringPlay bool         `json:"mutable_during_play"`
	Archived          bool         `json:"archived"`
}

type createWorldEntityRequest struct {
	ID          string  `json:"id,omitempty"`
	DisplayName string  `json:"display_name"`
	Key         *string `json:"key,omitempty"`
}

type worldEntityResponse struct {
	ID            string              `json:"id"`
	DisplayName   string              `json:"display_name"`
	Key           *string             `json:"key,omitempty"`
	Archived      bool                `json:"archived"`
	StateRevision int64               `json:"state_revision"`
	State         stateRecordResponse `json:"state"`
	CreatedAt     time.Time           `json:"created_at"`
	UpdatedAt     time.Time           `json:"updated_at"`
}
