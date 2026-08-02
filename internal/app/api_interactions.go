package app

import (
	"encoding/json"
	"time"
)

type saveInteractionRequest struct {
	ID                             string   `json:"id,omitempty"`
	Present                        bool     `json:"present,omitempty"`
	ExpectedRevision               *int64   `json:"expected_revision,omitempty"`
	Title                          *string  `json:"title,omitempty"`
	Prompt                         string   `json:"prompt"`
	PrivateNotes                   *string  `json:"private_notes,omitempty"`
	AudienceMembershipIDs          []string `json:"audience_membership_ids,omitempty"`
	EligibleResponderMembershipIDs []string `json:"eligible_responder_membership_ids"`
	EntityIDs                      []string `json:"entity_ids"`
}

type interactionLifecycleRequest struct {
	ExpectedRevision *int64 `json:"expected_revision"`
}

type createInteractionActionRequest struct {
	Text             string  `json:"text"`
	ActingEntityID   *string `json:"acting_entity_id,omitempty"`
	ExpectedRevision *int64  `json:"expected_revision"`
}

type withdrawInteractionActionRequest struct {
	ExpectedRevision *int64 `json:"expected_revision,omitempty"`
}

type concreteEffectDTO struct {
	ID              string         `json:"id,omitempty"`
	Type            string         `json:"type"`
	EntityIDs       []string       `json:"entity_ids"`
	StateVariableID string         `json:"state_variable_id"`
	Value           *stateValueDTO `json:"value,omitempty"`
	Amount          *json.Number   `json:"amount,omitempty"`
}

type adjudicateInteractionRequest struct {
	ExpectedRevision *int64              `json:"expected_revision"`
	IdempotencyKey   string              `json:"idempotency_key,omitempty"`
	SelectedActionID *string             `json:"selected_action_id,omitempty"`
	ActionSummary    *string             `json:"action_summary,omitempty"`
	Narrative        string              `json:"narrative"`
	PrivateNotes     *string             `json:"private_notes,omitempty"`
	Effects          []concreteEffectDTO `json:"effects"`
}

type interactionActionResponse struct {
	ID                      string    `json:"id"`
	InteractionID           string    `json:"interaction_id"`
	SubmittedByMembershipID string    `json:"submitted_by_membership_id"`
	SubmittedByUserID       string    `json:"submitted_by_user_id"`
	SubmittedByName         string    `json:"submitted_by_name"`
	ActingEntityID          *string   `json:"acting_entity_id,omitempty"`
	ActingEntityName        *string   `json:"acting_entity_name,omitempty"`
	Text                    string    `json:"text"`
	Status                  string    `json:"status"`
	Revision                int64     `json:"revision"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

type concreteAppliedEffectResponse struct {
	EffectID        string         `json:"effect_id"`
	EntityID        string         `json:"entity_id"`
	StateVariableID string         `json:"state_variable_id"`
	Before          *stateValueDTO `json:"before,omitempty"`
	After           *stateValueDTO `json:"after,omitempty"`
	Changed         bool           `json:"changed"`
}

type interactionResolutionResponse struct {
	ID                     string                          `json:"id"`
	SelectedActionID       *string                         `json:"selected_action_id,omitempty"`
	ActionSummary          *string                         `json:"action_summary,omitempty"`
	Narrative              string                          `json:"narrative"`
	PrivateNotes           *string                         `json:"private_notes,omitempty"`
	ResolvedByMembershipID string                          `json:"resolved_by_membership_id"`
	Effects                []concreteEffectDTO             `json:"effects"`
	AppliedEffects         []concreteAppliedEffectResponse `json:"applied_effects"`
	ResolvedAt             time.Time                       `json:"resolved_at"`
}

type interactionResponse struct {
	ID                             string                         `json:"id"`
	GameID                         string                         `json:"game_id"`
	Title                          *string                        `json:"title,omitempty"`
	Prompt                         string                         `json:"prompt"`
	PrivateNotes                   *string                        `json:"private_notes,omitempty"`
	Status                         string                         `json:"status"`
	Revision                       int64                          `json:"revision"`
	CreatedByMembershipID          string                         `json:"created_by_membership_id"`
	AudienceMembershipIDs          []string                       `json:"audience_membership_ids"`
	EligibleResponderMembershipIDs []string                       `json:"eligible_responder_membership_ids"`
	EntityIDs                      []string                       `json:"entity_ids"`
	Actions                        []interactionActionResponse    `json:"actions"`
	Resolution                     *interactionResolutionResponse `json:"resolution,omitempty"`
	PresentedAt                    *time.Time                     `json:"presented_at,omitempty"`
	ResolvedAt                     *time.Time                     `json:"resolved_at,omitempty"`
	CancelledAt                    *time.Time                     `json:"cancelled_at,omitempty"`
	CreatedAt                      time.Time                      `json:"created_at"`
	UpdatedAt                      time.Time                      `json:"updated_at"`
}

type interactionResolutionResultResponse struct {
	Preview             bool                            `json:"preview,omitempty"`
	Replayed            bool                            `json:"replayed,omitempty"`
	InteractionID       string                          `json:"interaction_id"`
	InteractionRevision int64                           `json:"interaction_revision"`
	Narrative           string                          `json:"narrative"`
	AppliedEffects      []concreteAppliedEffectResponse `json:"applied_effects"`
	State               resolutionStateDTO              `json:"state"`
}

type gameEventResponse struct {
	ID                int64     `json:"id"`
	Type              string    `json:"type"`
	InteractionID     *string   `json:"interaction_id,omitempty"`
	SubmissionID      *string   `json:"submission_id,omitempty"`
	ResolutionID      *string   `json:"resolution_id,omitempty"`
	ActorMembershipID *string   `json:"actor_membership_id,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

type gameEventBatchResponse struct {
	Events     []gameEventResponse `json:"events"`
	NextCursor int64               `json:"next_cursor"`
}
