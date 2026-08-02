import type {
  Cardinality,
  EffectOperation,
  Predicate,
  StateScalarValue,
  StateValue,
  ValueKind,
  ValueSchema,
} from "../api/types";

export const valueKinds: Array<{
  value: ValueKind;
  label: string;
  description: string;
}> = [
  {
    value: "text",
    label: "Text",
    description: "A short or long authored string.",
  },
  {
    value: "choice",
    label: "Choice",
    description: "One of an ordered set of configured options.",
  },
  {
    value: "measurement",
    label: "Measurement",
    description: "A precise amount paired with a configured unit.",
  },
  {
    value: "number",
    label: "Number",
    description:
      "A precise numeric value with optional bounds and display unit.",
  },
  {
    value: "boolean",
    label: "Boolean",
    description: "An explicit true or false value.",
  },
  {
    value: "reference",
    label: "Entity reference",
    description: "A reference to another entity in this ruleset.",
  },
];

export const effectOperationLabels: Record<EffectOperation, string> = {
  set: "Set the complete value",
  clear: "Clear to missing behavior",
  "adjust-number": "Adjust number",
  "add-value": "Add one value",
  "remove-value": "Remove one value",
};

export function compatiblePresentationControls(kind: ValueKind): string[] {
  switch (kind) {
    case "text":
      return ["short-text", "long-text"];
    case "choice":
      return ["select"];
    case "measurement":
      return ["measurement"];
    case "number":
      return ["number"];
    case "boolean":
      return ["checkbox"];
    case "reference":
      return ["reference-picker"];
  }
}

export function compatibleEffectOperations(
  kind: ValueKind,
  cardinality: Cardinality,
): EffectOperation[] {
  const operations: EffectOperation[] = ["set", "clear"];
  if (kind === "number" && cardinality === "one")
    operations.push("adjust-number");
  if (cardinality === "many") operations.push("add-value", "remove-value");
  return operations;
}

export function isConditionAddressable(
  kind: ValueKind,
  cardinality: Cardinality,
): boolean {
  return (
    cardinality === "one" &&
    (kind === "number" || kind === "boolean" || kind === "choice")
  );
}

export function defaultValueSchema(kind: ValueKind): ValueSchema {
  switch (kind) {
    case "text":
      return { kind: "text" };
    case "choice":
      return {
        kind: "choice",
        options: [{ id: crypto.randomUUID(), key: "", label: "" }],
      };
    case "measurement":
      return {
        kind: "measurement",
        units: [{ id: crypto.randomUUID(), unit: "" }],
      };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "reference":
      return { kind: "reference", target_owner_schema_ids: [] };
  }
}

export function defaultScalar(schema: ValueSchema): StateScalarValue {
  switch (schema.kind) {
    case "text":
      return { kind: "text", value: "" };
    case "choice":
      return { kind: "choice", value: schema.options[0]?.key ?? "" };
    case "measurement":
      return {
        kind: "measurement",
        amount: 0,
        unit: schema.units[0]?.unit ?? "",
      };
    case "number":
      return { kind: "number", value: schema.minimum ?? 0 };
    case "boolean":
      return { kind: "boolean", value: false };
    case "reference":
      return { kind: "reference", entity_id: "" };
  }
}

export function defaultStateValue(
  schema: ValueSchema,
  cardinality: Cardinality,
): StateValue {
  return cardinality === "many" ? [] : defaultScalar(schema);
}

export function defaultPredicate(schema: ValueSchema): Predicate {
  switch (schema.kind) {
    case "number":
      return { kind: "number", operator: "eq", value: schema.minimum ?? 0 };
    case "boolean":
      return { kind: "boolean", operator: "is", value: true };
    case "choice":
      return {
        kind: "choice",
        operator: "is",
        value: schema.options[0]?.key ?? "",
      };
    default:
      return { kind: "boolean", operator: "is", value: true };
  }
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
