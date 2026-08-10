import type {
  MechanicExpression,
  MechanicMode,
  WorldMechanic,
} from "../api/types";

type MechanicModeState = Pick<
  WorldMechanic,
  | "mode"
  | "source_kind"
  | "minimum"
  | "maximum"
  | "step"
  | "default_number"
  | "unit"
  | "expression"
>;

type MechanicModePatch = Pick<
  WorldMechanic,
  | "mode"
  | "minimum"
  | "maximum"
  | "step"
  | "default_number"
  | "unit"
  | "expression"
>;

export function changeMechanicMode(
  item: MechanicModeState,
  mode: MechanicMode,
): MechanicModePatch {
  const input = item.source_kind === "input";
  const wasNumeric = item.mode !== "binary";
  const numeric = mode !== "binary";

  return {
    mode,
    minimum: input && numeric ? item.minimum : undefined,
    maximum: input && numeric ? item.maximum : undefined,
    step: input && numeric ? (item.step ?? "1") : undefined,
    default_number: input && numeric ? (item.default_number ?? "0") : undefined,
    unit: numeric && wasNumeric ? item.unit : undefined,
    expression:
      item.source_kind === "derived"
        ? wasNumeric === numeric && item.expression !== undefined
          ? item.expression
          : literalExpression(numeric ? "number" : "boolean")
        : undefined,
  };
}

function literalExpression(kind: "number" | "boolean"): MechanicExpression {
  return {
    operation: "literal",
    value:
      kind === "boolean"
        ? { kind: "boolean", value: false }
        : { kind: "number", value: "0" },
  };
}
