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
  rules_revision: number;
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
export type MechanicSourceKind = "input" | "derived";
export type DecimalText = string;

export type MechanicExpression =
  | { operation: "literal"; value: StateValue }
  | { operation: "mechanic-reference"; mechanic_id: string }
  | {
      operation:
        | "add-number"
        | "subtract-number"
        | "multiply-number"
        | "min-number"
        | "max-number"
        | "equal"
        | "less-than"
        | "less-than-or-equal"
        | "greater-than"
        | "greater-than-or-equal"
        | "and"
        | "or"
        | "if";
      operands: MechanicExpression[];
    }
  | {
      operation: "negate-number" | "not";
      operands: [MechanicExpression];
    };

export interface WorldMechanic {
  id: string;
  kind: MechanicKind;
  mode: MechanicMode;
  source_kind: MechanicSourceKind;
  name: string;
  description?: string | undefined;
  minimum?: DecimalText | undefined;
  maximum?: DecimalText | undefined;
  step?: DecimalText | undefined;
  default_number?: DecimalText | undefined;
  unit?: string | undefined;
  mutable_during_play: boolean;
  expression?: MechanicExpression | undefined;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorldMechanicCollection {
  revision: number;
  mechanics: WorldMechanic[];
}

export interface WorldMechanicMutation {
  revision: number;
  mechanic: WorldMechanic;
}

export type StatusModifierOperation = "set" | "add-number" | "multiply-number";

interface StatusModifier {
  id: string;
  mechanic_id: string;
  operation: StatusModifierOperation;
  value: StateValue;
  priority: number;
  position: number;
}

export interface StatusModifierInput {
  id?: string | undefined;
  mechanic_id: string;
  operation: StatusModifierOperation;
  value: StateValue;
  priority: number;
}

export interface InlineStatus {
  name: string;
  description?: string | undefined;
  modifiers: StatusModifierInput[];
}

export interface WorldEntity {
  id: string;
  display_name: string;
  archived: boolean;
  state_revision: number;
  status_revision: number;
  state: StateRecordResponse;
  character_status: CharacterStatus;
  required_field_count: number;
  completed_field_count: number;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface AuthenticatedSession {
  user: User;
  csrf_token: string;
}

export type PlayStatus =
  "waiting-for-character" | "setup-required" | "ready" | "unavailable";

export type CharacterStatus = "not-controlled" | "setup-required" | "ready";

export type StateValue =
  { kind: "number"; value: DecimalText } | { kind: "boolean"; value: boolean };

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
      amount: DecimalText;
    }
  | {
      id?: string | undefined;
      type: "apply-status";
      targets: { entity_id: string }[];
      status: InlineStatus;
    }
  | {
      id?: string | undefined;
      type: "remove-status";
      targets: { entity_id: string; status_instance_id: string }[];
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

interface ScalarAppliedEffect {
  effect_id: string;
  entity_id: string;
  mechanic_id: string;
  before: StateValue;
  after: StateValue;
  changed: boolean;
}

interface StatusAppliedEffect {
  effect_id: string;
  entity_id: string;
  status_instance_id: string;
  status_name: string;
  active_before: boolean;
  active_after: boolean;
  changed: boolean;
}

export type ConcreteAppliedEffect =
  | (ScalarAppliedEffect & { type: "set" })
  | (ScalarAppliedEffect & { type: "adjust-number" })
  | (StatusAppliedEffect & { type: "apply-status" })
  | (StatusAppliedEffect & { type: "remove-status" });

interface InteractionResolution {
  id: string;
  selected_action_id?: string | undefined;
  action_summary?: string | undefined;
  narrative: string;
  private_notes?: string | undefined;
  resolved_by_membership_id: string;
  rules_revision: number;
  effects: ConcreteEffect[];
  applied_effects: ConcreteAppliedEffect[];
  effective_changes: EffectiveChange[];
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
  rules_revision: number;
  narrative: string;
  applied_effects: ConcreteAppliedEffect[];
  effective_changes: EffectiveChange[];
  state: { records: Record<string, StateRecordResponse> };
}

export interface ActiveStatus {
  id: string;
  name: string;
  description?: string | undefined;
  source_interaction_id: string;
  // A hypothetical status in a preview has not acquired a durable resolution yet.
  source_resolution_id?: string | undefined;
  source_effect_id: string;
  applied_order: number;
  applied_at: string;
  modifiers: StatusModifier[];
}

interface AppliedModifier {
  status_instance_id: string;
  status_name: string;
  modifier_id: string;
  operation: StatusModifierOperation;
  priority: number;
  operand: StateValue;
  before: StateValue;
  after: StateValue;
}

interface EvaluatedMechanic {
  source_kind: MechanicSourceKind;
  presence: "stored" | "defaulted" | "derived";
  intrinsic: StateValue;
  effective: StateValue;
  modifiers: AppliedModifier[];
}

export interface EffectiveChange {
  entity_id: string;
  mechanic_id: string;
  before: StateValue;
  after: StateValue;
}

export interface StateRecordResponse {
  entity_id: string;
  revision: number;
  status_revision: number;
  rules_revision: number;
  values: Record<string, StateValue>;
  effective_values: Record<string, StateValue>;
  evaluations: Record<string, EvaluatedMechanic>;
  active_statuses: ActiveStatus[];
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
