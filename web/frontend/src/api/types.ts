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
  primary_game_id: string;
  member_count: number;
  capacity_count: number;
  capability_count: number;
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
  revision: number;
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
  key?: string | undefined;
  archived: boolean;
  state_revision: number;
  state: StateRecordResponse;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  display_name: string;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

type GameRole = "facilitator" | "player" | "spectator";
type GameMembershipStatus = "invited" | "active" | "left";
type GameStatus = "active" | "archived";

export interface GameMembership {
  id: string;
  game_id?: string | undefined;
  user_id: string;
  role: GameRole;
  status: GameMembershipStatus;
  revision: number;
  display_name?: string | undefined;
  user?: User | undefined;
  joined_at?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface Game {
  id: string;
  rule_set_id: string;
  name: string;
  status: GameStatus;
  revision: number;
  memberships: GameMembership[];
  entity_ids: string[];
  created_by_user_id?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export type StateScalarValue =
  | { kind: "text"; value: string }
  | { kind: "choice"; value: string }
  | { kind: "measurement"; amount: number; unit: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | {
      kind: "reference";
      entity_id: string;
      fallback_name?: string | undefined;
    };

export type StateValue = StateScalarValue | StateScalarValue[];

export type ConcreteEffect =
  | {
      id?: string | undefined;
      type: "set";
      entity_ids: string[];
      state_variable_id: string;
      value: StateValue;
    }
  | {
      id?: string | undefined;
      type: "clear";
      entity_ids: string[];
      state_variable_id: string;
    }
  | {
      id?: string | undefined;
      type: "adjust-number";
      entity_ids: string[];
      state_variable_id: string;
      amount: number;
    }
  | {
      id?: string | undefined;
      type: "add-value" | "remove-value";
      entity_ids: string[];
      state_variable_id: string;
      value: StateScalarValue;
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
  text: string;
  status: InteractionActionStatus;
  revision: number;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

interface ConcreteAppliedEffect {
  effect_id: string;
  entity_id: string;
  state_variable_id: string;
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
  game_id: string;
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
  owner_entity_id: string;
  revision: number;
  values: Record<string, StateValue>;
  defaulted_definition_ids: string[];
  unknown_definition_ids: string[];
  updated_at: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string> | undefined;
  };
}
