export type MembershipRole = "owner" | "editor" | "player" | "spectator";
type WorldStatus = "active" | "archived";
export type CurrentPlayRole = "facilitator" | "player" | "spectator";
export type FacilitatorSource = "human" | "terra" | "agent";

export interface WorldFacilitator {
  source: FacilitatorSource;
  membership_id?: string | undefined;
  display_name?: string | undefined;
}

export interface World {
  id: string;
  name: string;
  description?: string | undefined;
  status: WorldStatus;
  revision: number;
  role: MembershipRole;
  membership_id: string;
  facilitator: WorldFacilitator;
  current_play_role: CurrentPlayRole;
  roster_revision: number;
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

export interface WorldTemplate {
  id: string;
  name: string;
  description: string;
  setting: string;
  character_count: number;
  version: number;
}

export interface WorldMember {
  id: string;
  user_id: string;
  display_name: string;
  role: MembershipRole;
  status: "active" | "left";
  play_status: PlayStatus;
  current_play_role: CurrentPlayRole;
  revision: number;
  controlled_entity_ids: string[];
  joined_at?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface WorldInvite {
  id: string;
  role: Exclude<MembershipRole, "owner">;
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
  role: Exclude<MembershipRole, "owner">;
  invited_by_display_name: string;
  expires_at: string;
}

export type MechanicKind = "capacity" | "capability";
export type MechanicMode = "score" | "pool" | "binary" | "rating";
export type MechanicSourceKind = "input" | "derived";
export type DecimalText = string;

export type MechanicExpression =
  | { operation: "literal"; value: MechanicValue }
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

type StatusModifierOperation = "set" | "add-number" | "multiply-number";

interface StatusModifier {
  id: string;
  mechanic_id: string;
  operation: StatusModifierOperation;
  value: MechanicValue;
  priority: number;
  position: number;
}

interface StatusModifierInput {
  id?: string | undefined;
  mechanic_id: string;
  operation: StatusModifierOperation;
  value: MechanicValue;
  priority: number;
}

interface InlineStatus {
  name: string;
  description?: string | undefined;
  modifiers: StatusModifierInput[];
}

export interface WorldEntity {
  id: string;
  display_name: string;
  archived: boolean;
  sheet: EntitySheet;
  character_status: CharacterStatus;
  required_field_count: number;
  completed_field_count: number;
  created_at: string;
  updated_at: string;
}

export interface AvailableEntity {
  id: string;
  display_name: string;
  profile_summary?: string | undefined;
}

export interface AvailableEntities {
  roster_revision: number;
  entities: AvailableEntity[];
}

export interface EntityClaimResult {
  entity_id: string;
  controller_world_membership_ids: string[];
  roster_revision: number;
  play_status: PlayStatus;
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

export type MechanicValue =
  { kind: "number"; value: DecimalText } | { kind: "boolean"; value: boolean };

export type ConcreteEffect =
  | {
      id?: string | undefined;
      type: "set";
      entity_ids: string[];
      mechanic_id: string;
      value: MechanicValue;
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

type CharacterFieldVisibility = "world" | "restricted";

export interface WorldCharacterField {
  id: string;
  label: string;
  help_text?: string | undefined;
  visibility: CharacterFieldVisibility;
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
  character_field_set_revision: number;
  character_status: CharacterStatus;
  required_field_count: number;
  completed_field_count: number;
  missing_field_ids?: string[] | undefined;
  can_edit: boolean;
  fields: EntityProfileCharacterField[];
  updated_by_user_id?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface EntityProfileCharacterField {
  id: string;
  label: string;
  help_text?: string | undefined;
  visibility: CharacterFieldVisibility;
  value?: string | undefined;
  updated_by_user_id?: string | undefined;
  updated_at?: string | undefined;
}

interface ScalarApplicationFields {
  effect_id: string;
  entity_id: string;
  mechanic_id: string;
  before: MechanicValue;
  after: MechanicValue;
  changed: boolean;
}

interface StatusApplicationFields {
  effect_id: string;
  entity_id: string;
  status_instance_id: string;
  status_name: string;
  active_before: boolean;
  active_after: boolean;
  changed: boolean;
}

type EffectApplication =
  | (ScalarApplicationFields & { type: "set" })
  | (ScalarApplicationFields & { type: "adjust-number" })
  | (StatusApplicationFields & { type: "apply-status" })
  | (StatusApplicationFields & { type: "remove-status" });

interface InteractionResolution {
  id: string;
  selected_action_id?: string | undefined;
  action_summary?: string | undefined;
  narrative: string;
  private_notes?: string | undefined;
  facilitator_source: FacilitatorSource;
  resolved_by_membership_id?: string | undefined;
  rules_revision: number;
  effects: ConcreteEffect[];
  applications: EffectApplication[];
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
  facilitator_source: FacilitatorSource;
  created_by_membership_id?: string | undefined;
  audience_membership_ids: string[];
  context_entity_ids: string[];
  eligible_responder_membership_ids: string[];
  actions: InteractionAction[];
  resolution?: InteractionResolution | undefined;
  presented_at?: string | undefined;
  resolved_at?: string | undefined;
  cancelled_at?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

interface ConsequenceApplicationResult {
  interaction_id: string;
  interaction_revision: number;
  rules_revision: number;
  narrative: string;
  applications: EffectApplication[];
  effective_changes: EffectiveChange[];
  entity_sheets: Record<string, EntitySheet>;
}

export interface ConsequencePreviewResult extends ConsequenceApplicationResult {
  preview?: boolean | undefined;
}

export interface InteractionResolutionResult extends ConsequenceApplicationResult {
  replayed?: boolean | undefined;
}

export interface ConsequenceCompilation {
  narrative: string;
  selected_action_id?: string | undefined;
  action_summary?: string | undefined;
  effects: ConcreteEffect[];
  preview: ConsequencePreviewResult;
}

export interface StatusInstance {
  id: string;
  name: string;
  description?: string | undefined;
  source_interaction_id: string;
  // A Status instance projected only in preview has no committed Resolution yet.
  source_resolution_id?: string | undefined;
  source_effect_id: string;
  applied_order: number;
  resolved_at: string;
  modifiers: StatusModifier[];
}

interface AppliedModifier {
  status_instance_id: string;
  status_name: string;
  modifier_id: string;
  operation: StatusModifierOperation;
  priority: number;
  operand: MechanicValue;
  before: MechanicValue;
  after: MechanicValue;
}

interface EvaluatedMechanic {
  source_kind: MechanicSourceKind;
  presence: "stored-override" | "authored-default" | "derived";
  intrinsic: MechanicValue;
  effective: MechanicValue;
  modifiers: AppliedModifier[];
}

interface EffectiveChange {
  entity_id: string;
  mechanic_id: string;
  before: MechanicValue;
  after: MechanicValue;
}

export interface EntitySheet {
  entity_id: string;
  logical_state_revision: number;
  status_set_revision: number;
  rules_revision: number;
  logical_input_values: Record<string, MechanicValue>;
  effective_values: Record<string, MechanicValue>;
  evaluations: Record<string, EvaluatedMechanic>;
  active_status_instances: StatusInstance[];
  authored_default_input_mechanic_ids: string[];
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string> | undefined;
  };
}
