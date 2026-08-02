import type {
  ConditionExpression,
  ConditionParameter,
  Predicate,
  StateVariableDefinition,
} from "../api/types";

const numberOperators: Record<
  Extract<Predicate, { kind: "number" }>["operator"],
  string
> = {
  eq: "equals",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
};

function numberOperand(
  value: number,
  variable: StateVariableDefinition,
): string {
  const unit =
    variable.value_schema.kind === "number"
      ? variable.value_schema.unit?.trim()
      : undefined;
  return `${value}${unit === undefined || unit === "" ? "" : ` ${unit}`}`;
}

function choiceLabel(key: string, variable: StateVariableDefinition): string {
  if (variable.value_schema.kind !== "choice") return key || "an option";
  return (
    variable.value_schema.options.find((option) => option.key === key)?.label ??
    (key || "an option")
  );
}

function summarizePredicate(
  predicate: Predicate,
  variable: StateVariableDefinition,
): string {
  switch (predicate.kind) {
    case "number":
      return `${numberOperators[predicate.operator]} ${numberOperand(predicate.value, variable)}`;
    case "number-range":
      return `is between ${numberOperand(predicate.minimum, variable)} and ${numberOperand(predicate.maximum, variable)}`;
    case "boolean":
      return `is ${predicate.value ? "true" : "false"}`;
    case "choice":
      return `is ${choiceLabel(predicate.value, variable)}`;
    case "choice-set": {
      const labels = predicate.values.map((value) =>
        choiceLabel(value, variable),
      );
      return labels.length === 0
        ? "is one of no selected options"
        : `is one of ${labels.join(", ")}`;
    }
  }
}

function quantifierPrefix(
  expression: Extract<ConditionExpression, { type: "criterion" }>,
): string {
  switch (expression.quantifier) {
    case "single":
      return "for";
    case "any":
      return "for any";
    case "all":
      return "for every";
    case "at-least":
      return `for at least ${expression.count ?? 1}`;
  }
}

export function summarizeCondition(
  node: ConditionExpression,
  parameters: ConditionParameter[],
  variables: StateVariableDefinition[],
): string {
  if (node.type === "criterion") {
    const authoredParameter = parameters.find(
      (item) => item.id === node.parameter_id,
    )?.label;
    const parameter =
      authoredParameter === undefined || authoredParameter.trim() === ""
        ? "an input"
        : authoredParameter;
    const variable = variables.find(
      (item) => item.id === node.state_variable_id,
    );
    if (variable === undefined)
      return `${quantifierPrefix(node)} ${parameter}, an unselected value must match`;
    const variableLabel =
      variable.label.trim() === "" ? "a value" : variable.label;
    return `${quantifierPrefix(node)} ${parameter}, ${variableLabel} ${summarizePredicate(node.predicate, variable)}`;
  }

  const children = node.children.map((child) =>
    summarizeCondition(child, parameters, variables),
  );
  if (children.length === 0) return "This group is empty.";
  if (node.type === "at-least")
    return `at least ${node.count} must hold: ${children.join("; ")}`;
  const join = node.type === "all" ? " and " : " or ";
  return `(${children.join(join)})`;
}
