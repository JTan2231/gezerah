package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"
)

type userResponse struct {
	ID          string    `json:"id"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type createUserRequest struct {
	ID          string `json:"id,omitempty"`
	DisplayName string `json:"display_name"`
}

type worldResponse struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	Description         *string    `json:"description,omitempty"`
	Status              string     `json:"status"`
	Revision            int64      `json:"revision"`
	TableRevision       int64      `json:"table_revision"`
	Role                string     `json:"role"`
	MembershipID        string     `json:"membership_id"`
	MemberCount         int        `json:"member_count"`
	CapacityCount       int        `json:"capacity_count"`
	CapabilityCount     int        `json:"capability_count"`
	CharacterFieldCount int        `json:"character_field_count"`
	RulesRevision       int64      `json:"rules_revision"`
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
	ID                  string     `json:"id"`
	UserID              string     `json:"user_id"`
	DisplayName         string     `json:"display_name"`
	Role                string     `json:"role"`
	Status              string     `json:"status"`
	PlayStatus          string     `json:"play_status"`
	Revision            int64      `json:"revision"`
	ControlledEntityIDs []string   `json:"controlled_entity_ids"`
	JoinedAt            *time.Time `json:"joined_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
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
	ID                string         `json:"id"`
	Kind              string         `json:"kind"`
	Mode              string         `json:"mode"`
	SourceKind        string         `json:"source_kind"`
	Name              string         `json:"name"`
	Description       *string        `json:"description,omitempty"`
	Minimum           *json.Number   `json:"minimum,omitempty"`
	Maximum           *json.Number   `json:"maximum,omitempty"`
	Step              *json.Number   `json:"step,omitempty"`
	DefaultNumber     *json.Number   `json:"default_number,omitempty"`
	Unit              *string        `json:"unit,omitempty"`
	MutableDuringPlay bool           `json:"mutable_during_play"`
	Expression        *expressionDTO `json:"expression,omitempty"`
	Archived          bool           `json:"archived"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

type saveWorldMechanicRequest struct {
	ID                    string         `json:"id,omitempty"`
	Kind                  string         `json:"kind"`
	Mode                  string         `json:"mode"`
	SourceKind            string         `json:"source_kind"`
	Name                  string         `json:"name"`
	Description           *string        `json:"description,omitempty"`
	Minimum               *json.Number   `json:"minimum,omitempty"`
	Maximum               *json.Number   `json:"maximum,omitempty"`
	Step                  *json.Number   `json:"step,omitempty"`
	DefaultNumber         *json.Number   `json:"default_number,omitempty"`
	Unit                  *string        `json:"unit,omitempty"`
	MutableDuringPlay     bool           `json:"mutable_during_play"`
	Expression            *expressionDTO `json:"expression,omitempty"`
	Archived              bool           `json:"archived"`
	ExpectedRulesRevision *int64         `json:"expected_rules_revision"`
}

type archiveWorldRuleResourceRequest struct {
	ExpectedRulesRevision *int64 `json:"expected_rules_revision"`
}

type worldMechanicCollectionResponse struct {
	Revision  int64                   `json:"revision"`
	Mechanics []worldMechanicResponse `json:"mechanics"`
}

type worldMechanicMutationResponse struct {
	Revision int64                 `json:"revision"`
	Mechanic worldMechanicResponse `json:"mechanic"`
}

type stateValueDTO struct {
	Kind    string
	Number  *json.Number
	Boolean *bool
}

func (value stateValueDTO) MarshalJSON() ([]byte, error) {
	switch value.Kind {
	case "number":
		if value.Number == nil {
			return nil, errors.New("number value is missing")
		}
		return json.Marshal(struct {
			Kind  string      `json:"kind"`
			Value json.Number `json:"value"`
		}{value.Kind, *value.Number})
	case "boolean":
		if value.Boolean == nil {
			return nil, errors.New("boolean value is missing")
		}
		return json.Marshal(struct {
			Kind  string `json:"kind"`
			Value bool   `json:"value"`
		}{value.Kind, *value.Boolean})
	default:
		return nil, fmt.Errorf("unsupported value kind %q", value.Kind)
	}
}

func (value *stateValueDTO) UnmarshalJSON(data []byte) error {
	var tagged struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(data, &tagged); err != nil {
		return err
	}
	switch tagged.Kind {
	case "number":
		var decoded struct {
			Kind  string       `json:"kind"`
			Value *json.Number `json:"value"`
		}
		if err := decodeStrictBytes(data, &decoded); err != nil {
			return err
		}
		if decoded.Value == nil {
			return errors.New("number value is required")
		}
		*value = stateValueDTO{Kind: tagged.Kind, Number: decoded.Value}
	case "boolean":
		var decoded struct {
			Kind  string `json:"kind"`
			Value *bool  `json:"value"`
		}
		if err := decodeStrictBytes(data, &decoded); err != nil {
			return err
		}
		if decoded.Value == nil {
			return errors.New("boolean value is required")
		}
		*value = stateValueDTO{Kind: tagged.Kind, Boolean: decoded.Value}
	default:
		return fmt.Errorf("unsupported value kind %q", tagged.Kind)
	}
	return nil
}

func decodeStrictBytes(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("value must contain one JSON value")
		}
		return err
	}
	return nil
}

type stateRecordResponse struct {
	EntityID             string                               `json:"entity_id"`
	Revision             int64                                `json:"revision"`
	StatusRevision       int64                                `json:"status_revision"`
	RulesRevision        int64                                `json:"rules_revision"`
	Values               map[string]stateValueDTO             `json:"values"`
	EffectiveValues      map[string]stateValueDTO             `json:"effective_values"`
	Evaluations          map[string]evaluatedMechanicResponse `json:"evaluations"`
	ActiveStatuses       []activeStatusResponse               `json:"active_statuses"`
	DefaultedMechanicIDs []string                             `json:"defaulted_mechanic_ids"`
	UpdatedAt            time.Time                            `json:"updated_at"`
}

type replaceStateRequest struct {
	ExpectedRevision      *int64                   `json:"expected_revision"`
	ExpectedRulesRevision *int64                   `json:"expected_rules_revision"`
	Values                map[string]stateValueDTO `json:"values"`
}

type createWorldEntityRequest struct {
	ID                           string   `json:"id,omitempty"`
	DisplayName                  string   `json:"display_name"`
	ControllerWorldMembershipIDs []string `json:"controller_world_membership_ids,omitempty"`
}

type saveWorldEntityRequest struct {
	ID          string `json:"id,omitempty"`
	DisplayName string `json:"display_name"`
	Archived    bool   `json:"archived"`
}

type worldEntityResponse struct {
	ID                  string              `json:"id"`
	DisplayName         string              `json:"display_name"`
	Archived            bool                `json:"archived"`
	StateRevision       int64               `json:"state_revision"`
	StatusRevision      int64               `json:"status_revision"`
	State               stateRecordResponse `json:"state"`
	CharacterStatus     string              `json:"character_status"`
	RequiredFieldCount  int                 `json:"required_field_count"`
	CompletedFieldCount int                 `json:"completed_field_count"`
	CreatedAt           time.Time           `json:"created_at"`
	UpdatedAt           time.Time           `json:"updated_at"`
}

type replaceWorldEntityControllersRequest struct {
	ExpectedTableRevision        *int64   `json:"expected_table_revision"`
	ControllerWorldMembershipIDs []string `json:"controller_world_membership_ids"`
}

type worldEntityControllersResponse struct {
	EntityID                     string   `json:"entity_id"`
	ControllerWorldMembershipIDs []string `json:"controller_world_membership_ids"`
	TableRevision                int64    `json:"table_revision"`
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

type entityProfileResponse struct {
	EntityID                string                       `json:"entity_id"`
	Revision                int64                        `json:"revision"`
	CharacterFieldsRevision int64                        `json:"character_fields_revision"`
	CharacterStatus         string                       `json:"character_status"`
	RequiredFieldCount      int                          `json:"required_field_count"`
	CompletedFieldCount     int                          `json:"completed_field_count"`
	MissingFieldIDs         []string                     `json:"missing_field_ids,omitempty"`
	CanEdit                 bool                         `json:"can_edit"`
	Fields                  []entityProfileFieldResponse `json:"fields"`
	UpdatedByUserID         *string                      `json:"updated_by_user_id,omitempty"`
	CreatedAt               *time.Time                   `json:"created_at,omitempty"`
	UpdatedAt               *time.Time                   `json:"updated_at,omitempty"`
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
	ExpectedRevision *int64 `json:"expected_revision"`
}

type concreteEffectDTO struct {
	ID         string                  `json:"id,omitempty"`
	Type       string                  `json:"type"`
	EntityIDs  []string                `json:"entity_ids,omitempty"`
	Targets    []statusEffectTargetDTO `json:"targets,omitempty"`
	MechanicID string                  `json:"mechanic_id,omitempty"`
	Status     *statusEffectSpecDTO    `json:"status,omitempty"`
	Value      *stateValueDTO          `json:"value,omitempty"`
	Amount     *json.Number            `json:"amount,omitempty"`
}

type adjudicateInteractionRequest struct {
	ExpectedRevision      *int64              `json:"expected_revision"`
	ExpectedRulesRevision *int64              `json:"expected_rules_revision"`
	IdempotencyKey        string              `json:"idempotency_key,omitempty"`
	SelectedActionID      *string             `json:"selected_action_id,omitempty"`
	ActionSummary         *string             `json:"action_summary,omitempty"`
	Narrative             string              `json:"narrative"`
	PrivateNotes          *string             `json:"private_notes,omitempty"`
	Effects               []concreteEffectDTO `json:"effects"`
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
	Type             string         `json:"type"`
	EffectID         string         `json:"effect_id"`
	EntityID         string         `json:"entity_id"`
	MechanicID       string         `json:"mechanic_id,omitempty"`
	StatusInstanceID string         `json:"status_instance_id,omitempty"`
	StatusName       string         `json:"status_name,omitempty"`
	ActiveBefore     *bool          `json:"active_before,omitempty"`
	ActiveAfter      *bool          `json:"active_after,omitempty"`
	Before           *stateValueDTO `json:"before,omitempty"`
	After            *stateValueDTO `json:"after,omitempty"`
	Changed          bool           `json:"changed"`
}

type interactionResolutionResponse struct {
	ID                     string                          `json:"id"`
	SelectedActionID       *string                         `json:"selected_action_id,omitempty"`
	ActionSummary          *string                         `json:"action_summary,omitempty"`
	Narrative              string                          `json:"narrative"`
	PrivateNotes           *string                         `json:"private_notes,omitempty"`
	ResolvedByMembershipID string                          `json:"resolved_by_membership_id"`
	RulesRevision          int64                           `json:"rules_revision"`
	Effects                []concreteEffectDTO             `json:"effects"`
	AppliedEffects         []concreteAppliedEffectResponse `json:"applied_effects"`
	EffectiveChanges       []effectiveChangeResponse       `json:"effective_changes"`
	ResolvedAt             time.Time                       `json:"resolved_at"`
}

type interactionResponse struct {
	ID                             string                         `json:"id"`
	WorldID                        string                         `json:"world_id"`
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
	RulesRevision       int64                           `json:"rules_revision"`
	Narrative           string                          `json:"narrative"`
	AppliedEffects      []concreteAppliedEffectResponse `json:"applied_effects"`
	EffectiveChanges    []effectiveChangeResponse       `json:"effective_changes"`
	State               transitionStateResponse         `json:"state"`
}

type transitionStateResponse struct {
	Records map[string]stateRecordResponse `json:"records"`
}

type worldEventResponse struct {
	ID                int64     `json:"id"`
	Type              string    `json:"type"`
	InteractionID     *string   `json:"interaction_id,omitempty"`
	SubmissionID      *string   `json:"submission_id,omitempty"`
	ResolutionID      *string   `json:"resolution_id,omitempty"`
	ActorMembershipID *string   `json:"actor_membership_id,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

type worldEventBatchResponse struct {
	Events     []worldEventResponse `json:"events"`
	NextCursor int64                `json:"next_cursor"`
}
