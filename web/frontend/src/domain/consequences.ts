import type {
  ConcreteEffect,
  DecimalText,
  InlineStatus,
  StateValue,
  StatusModifierInput,
} from "../api/types";
import { canonicalDecimalText } from "./decimal";

export interface StatusModifierDraft extends StatusModifierInput {
  id: string;
}

interface InlineStatusDraft {
  name: string;
  description: string;
  modifiers: StatusModifierDraft[];
}

export type EffectDraft =
  | {
      id: string;
      kind: "mechanic";
      entityId: string;
      mechanicId: string;
      valueKind: StateValue["kind"];
      operation: "adjust-number" | "set";
      amount: DecimalText;
      booleanValue: boolean;
    }
  | {
      id: string;
      kind: "apply-status";
      entityIds: string[];
      status: InlineStatusDraft;
    }
  | {
      id: string;
      kind: "remove-status";
      targets: {
        entityId: string;
        statusInstanceId: string;
        statusName: string;
      }[];
    };

export function effectToAPI(effect: EffectDraft): ConcreteEffect {
  if (effect.kind === "apply-status") {
    const status: InlineStatus = {
      name: effect.status.name,
      description: effect.status.description || undefined,
      modifiers: effect.status.modifiers.map((modifier) => ({
        id: modifier.id,
        mechanic_id: modifier.mechanic_id,
        operation: modifier.operation,
        value: canonicalStateValue(modifier.value),
        priority: modifier.priority,
      })),
    };
    return {
      id: effect.id,
      type: "apply-status",
      targets: effect.entityIds.map((entityId) => ({
        entity_id: entityId,
      })),
      status,
    };
  }
  if (effect.kind === "remove-status")
    return {
      id: effect.id,
      type: "remove-status",
      targets: effect.targets.map((target) => ({
        entity_id: target.entityId,
        status_instance_id: target.statusInstanceId,
      })),
    };
  if (effect.valueKind === "boolean")
    return {
      id: effect.id,
      type: "set",
      entity_ids: [effect.entityId],
      mechanic_id: effect.mechanicId,
      value: { kind: "boolean", value: effect.booleanValue },
    };
  if (effect.operation === "set")
    return {
      id: effect.id,
      type: "set",
      entity_ids: [effect.entityId],
      mechanic_id: effect.mechanicId,
      value: {
        kind: "number",
        value: canonicalDecimalText(effect.amount) ?? effect.amount,
      },
    };
  return {
    id: effect.id,
    type: "adjust-number",
    entity_ids: [effect.entityId],
    mechanic_id: effect.mechanicId,
    amount: canonicalDecimalText(effect.amount) ?? effect.amount,
  };
}

function canonicalStateValue(value: StateValue): StateValue {
  if (value.kind === "boolean") return value;
  return {
    kind: "number",
    value: canonicalDecimalText(value.value) ?? value.value,
  };
}
