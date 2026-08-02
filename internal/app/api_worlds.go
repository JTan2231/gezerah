package app

import (
	"encoding/json"
	"time"
)

type worldResponse struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	Description         *string    `json:"description,omitempty"`
	Status              string     `json:"status"`
	Revision            int64      `json:"revision"`
	Role                string     `json:"role"`
	MembershipID        string     `json:"membership_id"`
	PrimaryGameID       string     `json:"primary_game_id"`
	MemberCount         int        `json:"member_count"`
	CapacityCount       int        `json:"capacity_count"`
	CapabilityCount     int        `json:"capability_count"`
	CharacterFieldCount int        `json:"character_field_count"`
	PlayStatus          string     `json:"play_status"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	LastInteractionAt   *time.Time `json:"last_interaction_at,omitempty"`
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
	PlayStatus  string     `json:"play_status"`
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
	ID                           string   `json:"id,omitempty"`
	DisplayName                  string   `json:"display_name"`
	Key                          *string  `json:"key,omitempty"`
	ControllerWorldMembershipIDs []string `json:"controller_world_membership_ids,omitempty"`
}

type worldEntityResponse struct {
	ID                  string              `json:"id"`
	DisplayName         string              `json:"display_name"`
	Key                 *string             `json:"key,omitempty"`
	Archived            bool                `json:"archived"`
	StateRevision       int64               `json:"state_revision"`
	State               stateRecordResponse `json:"state"`
	CharacterStatus     string              `json:"character_status"`
	RequiredFieldCount  int                 `json:"required_field_count"`
	CompletedFieldCount int                 `json:"completed_field_count"`
	CreatedAt           time.Time           `json:"created_at"`
	UpdatedAt           time.Time           `json:"updated_at"`
}

type replaceWorldEntityControllersRequest struct {
	ExpectedGameRevision         *int64   `json:"expected_game_revision"`
	ControllerWorldMembershipIDs []string `json:"controller_world_membership_ids"`
}

type worldEntityControllersResponse struct {
	EntityID                     string   `json:"entity_id"`
	ControllerWorldMembershipIDs []string `json:"controller_world_membership_ids"`
	GameRevision                 int64    `json:"game_revision"`
}

type saveWorldCharacterFieldRequest struct {
	ID         string  `json:"id,omitempty"`
	Label      string  `json:"label"`
	HelpText   *string `json:"help_text,omitempty"`
	Visibility string  `json:"visibility"`
}

type replaceWorldCharacterFieldsRequest struct {
	ExpectedRevision *int64                           `json:"expected_revision"`
	Fields           []saveWorldCharacterFieldRequest `json:"fields"`
}

type worldCharacterFieldResponse struct {
	ID              string    `json:"id"`
	Label           string    `json:"label"`
	HelpText        *string   `json:"help_text,omitempty"`
	Visibility      string    `json:"visibility"`
	CreatedByUserID string    `json:"created_by_user_id"`
	UpdatedByUserID string    `json:"updated_by_user_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type worldCharacterFieldSetResponse struct {
	Revision  int64                         `json:"revision"`
	Fields    []worldCharacterFieldResponse `json:"fields"`
	CreatedAt time.Time                     `json:"created_at"`
	UpdatedAt time.Time                     `json:"updated_at"`
}

type saveEntityProfileFieldValueRequest struct {
	FieldID string `json:"field_id"`
	Value   string `json:"value"`
}

type replaceEntityProfileRequest struct {
	ExpectedRevision                *int64                               `json:"expected_revision"`
	ExpectedCharacterFieldsRevision *int64                               `json:"expected_character_fields_revision"`
	Values                          []saveEntityProfileFieldValueRequest `json:"values"`
}

type entityProfileSectionResponse struct {
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	Body            string    `json:"body"`
	Visibility      string    `json:"visibility"`
	CreatedByUserID string    `json:"created_by_user_id"`
	UpdatedByUserID string    `json:"updated_by_user_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type entityProfileResponse struct {
	EntityID                string                         `json:"entity_id"`
	Revision                int64                          `json:"revision"`
	CharacterFieldsRevision int64                          `json:"character_fields_revision"`
	CharacterStatus         string                         `json:"character_status"`
	RequiredFieldCount      int                            `json:"required_field_count"`
	CompletedFieldCount     int                            `json:"completed_field_count"`
	MissingFieldIDs         []string                       `json:"missing_field_ids,omitempty"`
	CanEdit                 bool                           `json:"can_edit"`
	Fields                  []entityProfileFieldResponse   `json:"fields"`
	LegacySections          []entityProfileSectionResponse `json:"legacy_sections,omitempty"`
	UpdatedByUserID         *string                        `json:"updated_by_user_id,omitempty"`
	CreatedAt               *time.Time                     `json:"created_at,omitempty"`
	UpdatedAt               *time.Time                     `json:"updated_at,omitempty"`
}

type entityProfileFieldResponse struct {
	ID              string     `json:"id"`
	Label           string     `json:"label"`
	HelpText        *string    `json:"help_text,omitempty"`
	Visibility      string     `json:"visibility"`
	Value           *string    `json:"value,omitempty"`
	UpdatedByUserID *string    `json:"updated_by_user_id,omitempty"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}
