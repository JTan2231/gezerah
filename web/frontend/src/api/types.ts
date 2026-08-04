export type WorldRole = "owner" | "editor" | "player" | "spectator";
type WorldStatus = "active" | "archived";

export interface World {
  id: string;
  name: string;
  description?: string | undefined;
  status: WorldStatus;
  revision: number;
  role: WorldRole;
  membership_id: string;
  table_revision: number;
  member_count: number;
  capacity_count: number;
  capability_count: number;
  character_field_count: number;
  play_status: PlayStatus;
  created_at: string;
  updated_at: string;
  last_interaction_at?: string | undefined;
}

export interface WorldMember {
  id: string;
  user_id: string;
  display_name: string;
  role: WorldRole;
  status: "active" | "left";
  play_status: PlayStatus;
  revision: number;
  controlled_entity_ids: string[];
  joined_at?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface WorldInvite {
  id: string;
  role: Exclude<WorldRole, "owner">;
  created_by_display_name: string;
  expires_at: string;
  revoked_at?: string | undefined;
  use_count: number;
  created_at: string;
  join_path?: string | undefined;
}

export interface WorldInvitePreview {
  world_id: string;
  world_name: string;
  world_description?: string | undefined;
  role: Exclude<WorldRole, "owner">;
  invited_by_display_name: string;
  expires_at: string;
}

export type MechanicKind = "capacity" | "capability";
export type MechanicMode = "score" | "pool" | "binary" | "rating";

export interface WorldMechanic {
  id: string;
  kind: MechanicKind;
  mode: MechanicMode;
  name: string;
  description?: string | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  step?: number | undefined;
  default_number?: number | undefined;
  unit?: string | undefined;
  mutable_during_play: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorldEntity {
  id: string;
  display_name: string;
  archived: boolean;
  state_revision: number;
  state: StateRecordResponse;
  character_status: CharacterStatus;
  required_field_count: number;
  completed_field_count: number;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  display_name: string;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export type PlayStatus =
  "waiting-for-character" | "setup-required" | "ready" | "unavailable";

export type CharacterStatus = "not-controlled" | "setup-required" | "ready";

export type StateValue =
  { kind: "number"; value: number } | { kind: "boolean"; value: boolean };

export type ConcreteEffect =
  | {
      id?: string | undefined;
      type: "set";
      entity_ids: string[];
      mechanic_id: string;
      value: StateValue;
    }
  | {
      id?: string | undefined;
      type: "adjust-number";
      entity_ids: string[];
      mechanic_id: string;
      amount: number;
    };

type InteractionStatus =
  "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
type InteractionActionStatus =
  "submitted" | "withdrawn" | "selected" | "declined";

export interface InteractionAction {
  id: string;
  interaction_id?: string | undefined;
  submitted_by_membership_id: string;
  submitted_by_user_id?: string | undefined;
  submitted_by_name?: string | undefined;
  acting_entity_id?: string | undefined;
  acting_entity_name?: string | undefined;
  text: string;
  status: InteractionActionStatus;
  revision: number;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export type EntityProfileVisibility = "table" | "controllers-and-facilitators";

export interface WorldCharacterField {
  id: string;
  label: string;
  help_text?: string | undefined;
  visibility: EntityProfileVisibility;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorldCharacterFieldSet {
  revision: number;
  fields: WorldCharacterField[];
  created_at: string;
  updated_at: string;
}

export interface EntityProfile {
  entity_id: string;
  revision: number;
  character_fields_revision: number;
  character_status: CharacterStatus;
  required_field_count: number;
  completed_field_count: number;
  missing_field_ids?: string[] | undefined;
  can_edit: boolean;
  fields: EntityProfileField[];
  updated_by_user_id?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface EntityProfileField {
  id: string;
  label: string;
  help_text?: string | undefined;
  visibility: EntityProfileVisibility;
  value?: string | undefined;
  updated_by_user_id?: string | undefined;
  updated_at?: string | undefined;
}

interface ConcreteAppliedEffect {
  effect_id: string;
  entity_id: string;
  mechanic_id: string;
  before?: StateValue | undefined;
  after?: StateValue | undefined;
  changed: boolean;
}

interface InteractionResolution {
  id: string;
  selected_action_id?: string | undefined;
  action_summary?: string | undefined;
  narrative: string;
  private_notes?: string | undefined;
  resolved_by_membership_id: string;
  effects: ConcreteEffect[];
  applied_effects: ConcreteAppliedEffect[];
  resolved_at?: string | undefined;
}

export interface Interaction {
  id: string;
  world_id: string;
  title?: string | undefined;
  prompt: string;
  private_notes?: string | undefined;
  status: InteractionStatus;
  revision: number;
  created_by_membership_id: string;
  audience_membership_ids: string[];
  entity_ids: string[];
  eligible_responder_membership_ids: string[];
  actions: InteractionAction[];
  resolution?: InteractionResolution | undefined;
  presented_at?: string | undefined;
  resolved_at?: string | undefined;
  cancelled_at?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface InteractionResolutionResult {
  preview?: boolean | undefined;
  replayed?: boolean | undefined;
  interaction_id: string;
  interaction_revision: number;
  narrative: string;
  applied_effects: ConcreteAppliedEffect[];
  state: { records: Record<string, StateRecordResponse> };
}

interface StateRecordResponse {
  entity_id: string;
  revision: number;
  values: Record<string, StateValue>;
  defaulted_mechanic_ids: string[];
  updated_at: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string> | undefined;
  };
}
