export type Cardinality = "one" | "many";
export type ValueKind =
  "text" | "choice" | "measurement" | "number" | "boolean" | "reference";
export type EffectOperation =
  "set" | "clear" | "adjust-number" | "add-value" | "remove-value";
export type ConditionStatus = "met" | "unmet" | "unknown";

export interface RuleSet {
  id: string;
  key: string;
  name: string;
  description?: string | undefined;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface OwnerSchema {
  id: string;
  key: string;
  label: string;
  description?: string | undefined;
  archived: boolean;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface Entity {
  id: string;
  key?: string | undefined;
  display_name: string;
  owner_schema_ids: string[];
  archived: boolean;
  state_revision: number;
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

export interface ChoiceOption {
  id: string;
  key: string;
  label: string;
}

export interface MeasurementUnit {
  id: string;
  unit: string;
}

export type ValueSchema =
  | { kind: "text" }
  | { kind: "choice"; options: ChoiceOption[] }
  | {
      kind: "measurement";
      units: MeasurementUnit[];
      minimum?: number | undefined;
      maximum?: number | undefined;
      step?: number | undefined;
    }
  | {
      kind: "number";
      minimum?: number | undefined;
      maximum?: number | undefined;
      step?: number | undefined;
      unit?: string | undefined;
    }
  | { kind: "boolean" }
  | { kind: "reference"; target_owner_schema_ids: string[] };

export type MissingValueSemantics =
  | { kind: "unknown" }
  | { kind: "default"; value: StateValue; omit_when_stored: boolean };

export interface PresentationHints {
  group?: string | undefined;
  control?: string | undefined;
  help_text?: string | undefined;
}

export interface StateVariableDefinition {
  id: string;
  key: string;
  label: string;
  description?: string | undefined;
  owner_schema_ids: string[];
  cardinality: Cardinality;
  value_schema: ValueSchema;
  missing_value: MissingValueSemantics;
  presentation?: PresentationHints | undefined;
  condition_addressable: boolean;
  allowed_effect_operations: EffectOperation[];
  display_order: number;
  archived: boolean;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface ConditionParameter {
  id: string;
  key: string;
  label: string;
  cardinality: Cardinality;
  required_owner_schema_ids: string[];
}

export type Predicate =
  | {
      kind: "number";
      operator: "eq" | "gt" | "gte" | "lt" | "lte";
      value: number;
    }
  | {
      kind: "number-range";
      operator: "between";
      minimum: number;
      maximum: number;
    }
  | { kind: "boolean"; operator: "is"; value: boolean }
  | { kind: "choice"; operator: "is"; value: string }
  | { kind: "choice-set"; operator: "one-of"; values: string[] };

export type ConditionExpression =
  | { id: string; type: "all" | "any"; children: ConditionExpression[] }
  | {
      id: string;
      type: "at-least";
      count: number;
      children: ConditionExpression[];
    }
  | {
      id: string;
      type: "criterion";
      parameter_id: string;
      quantifier: "single" | "any" | "all" | "at-least";
      count?: number | undefined;
      state_variable_id: string;
      predicate: Predicate;
    };

export interface ConditionSet {
  id: string;
  key: string;
  name: string;
  description?: string | undefined;
  parameters: ConditionParameter[];
  root: ConditionExpression;
  archived: boolean;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface ProblemTargetDefinition {
  id: string;
  key: string;
  label: string;
  description?: string | undefined;
  cardinality: Cardinality;
  minimum_bindings: number;
  maximum_bindings?: number | undefined;
  binding_source: "supplied" | "problem-instance";
  required_owner_schema_ids: string[];
}

export interface ConditionInvocation {
  id: string;
  condition_set_id: string;
  arguments: Array<{ parameter_id: string; target_definition_id: string }>;
}

export type StateEffect =
  | {
      id: string;
      type: "set";
      target_definition_id: string;
      state_variable_id: string;
      value: StateValue;
    }
  | {
      id: string;
      type: "clear";
      target_definition_id: string;
      state_variable_id: string;
    }
  | {
      id: string;
      type: "adjust-number";
      target_definition_id: string;
      state_variable_id: string;
      amount: number;
    }
  | {
      id: string;
      type: "add-value" | "remove-value";
      target_definition_id: string;
      state_variable_id: string;
      value: StateScalarValue;
    };

export interface ConsequenceSet {
  id: string;
  effects: StateEffect[];
}

export interface ChoiceOutcome {
  id: string;
  label: string;
  consequences: ConsequenceSet;
}

export type ChoiceResolution =
  | { type: "automatic"; outcome: ChoiceOutcome }
  | {
      type: "condition";
      invocation: ConditionInvocation;
      met: ChoiceOutcome;
      unmet: ChoiceOutcome;
    };

export interface ChoiceDefinition {
  id: string;
  key: string;
  name: string;
  description?: string | undefined;
  available_when?: ConditionInvocation | undefined;
  resolution: ChoiceResolution;
}

export interface ProblemDefinition {
  id: string;
  key: string;
  name: string;
  description?: string | undefined;
  instance_owner_schema_ids: string[];
  targets: ProblemTargetDefinition[];
  available_when?: ConditionInvocation | undefined;
  choices: ChoiceDefinition[];
  archived: boolean;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface ProblemTargetBinding {
  target_definition_id: string;
  entity_ids: string[];
}

export interface ProblemInstance {
  id: string;
  problem_definition_id: string;
  key?: string | undefined;
  display_name: string;
  binding_revision: number;
  bindings: ProblemTargetBinding[];
  state_revision: number;
  created_at?: string | undefined;
  updated_at?: string | undefined;
}

export interface StateRecordResponse {
  owner_entity_id: string;
  revision: number;
  values: Record<string, StateValue>;
  defaulted_definition_ids: string[];
  unknown_definition_ids: string[];
  updated_at: string;
}

export interface ConditionEvaluationNode {
  expression_id: string;
  status: ConditionStatus;
  message: string;
  parameter_id?: string | undefined;
  entity_results?:
    | Array<{
        entity_id: string;
        status: ConditionStatus;
        address: { entity_id: string; state_variable_id: string };
        actual?: StateValue | undefined;
      }>
    | undefined;
  children?: ConditionEvaluationNode[] | undefined;
}

export interface ConditionEvaluation {
  condition_set_id: string;
  status: ConditionStatus;
  root: ConditionEvaluationNode;
  missing_values: Array<{ entity_id: string; state_variable_id: string }>;
}

export interface AppliedEffect {
  effect_id: string;
  target_definition_id: string;
  entity_id: string;
  state_variable_id: string;
  before?: StateValue | undefined;
  after?: StateValue | undefined;
  changed: boolean;
}

export type ChoiceResolutionResult =
  | {
      status: "applied";
      preview?: boolean | undefined;
      problem_definition_id: string;
      problem_instance_id: string;
      choice_id: string;
      outcome_id: string;
      binding_revision: number;
      availability_evaluations: ConditionEvaluation[];
      resolution_evaluation?: ConditionEvaluation | undefined;
      applied_effects: AppliedEffect[];
      state: { records: Record<string, StateRecordResponse> };
    }
  | {
      status: "unavailable";
      preview?: boolean | undefined;
      problem_definition_id: string;
      problem_instance_id: string;
      choice_id: string;
      availability_evaluations: ConditionEvaluation[];
    }
  | {
      status: "incomplete";
      preview?: boolean | undefined;
      problem_definition_id: string;
      problem_instance_id: string;
      choice_id: string;
      evaluations: ConditionEvaluation[];
    };

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string> | undefined;
  };
}
