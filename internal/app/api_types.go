package app

import "time"

type ruleSetResponse struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ownerSchemaResponse struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Label       string    `json:"label"`
	Description *string   `json:"description,omitempty"`
	Archived    bool      `json:"archived"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type entityResponse struct {
	ID             string    `json:"id"`
	Key            *string   `json:"key,omitempty"`
	DisplayName    string    `json:"display_name"`
	OwnerSchemaIDs []string  `json:"owner_schema_ids"`
	Archived       bool      `json:"archived"`
	StateRevision  int64     `json:"state_revision"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type createRuleSetRequest struct {
	ID          string  `json:"id,omitempty"`
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

type patchRuleSetRequest struct {
	ID          string  `json:"id,omitempty"`
	Key         *string `json:"key,omitempty"`
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

type saveOwnerSchemaRequest struct {
	ID          string  `json:"id,omitempty"`
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	Description *string `json:"description,omitempty"`
	Archived    bool    `json:"archived"`
}

type saveEntityRequest struct {
	ID             string   `json:"id,omitempty"`
	Key            *string  `json:"key,omitempty"`
	DisplayName    string   `json:"display_name"`
	OwnerSchemaIDs []string `json:"owner_schema_ids"`
	Archived       bool     `json:"archived"`
}
