import { describe, expect, test } from "bun:test";

import type {
  ConditionExpression,
  ConditionParameter,
  StateVariableDefinition,
} from "../api/types";
import { summarizeCondition } from "./conditionSummary";

const parameter: ConditionParameter = {
  id: "parameter",
  key: "actor",
  label: "Actor",
  cardinality: "one",
  required_owner_schema_ids: [],
};

function variable(
  valueSchema: StateVariableDefinition["value_schema"],
): StateVariableDefinition {
  return {
    id: "variable",
    key: "state",
    label: "State",
    owner_schema_ids: [],
    cardinality: "one",
    value_schema: valueSchema,
    missing_value: { kind: "unknown" },
    condition_addressable: true,
    allowed_effect_operations: [],
    display_order: 0,
    archived: false,
  };
}

function criterion(
  predicate: Extract<ConditionExpression, { type: "criterion" }>["predicate"],
): ConditionExpression {
  return {
    id: "criterion",
    type: "criterion",
    parameter_id: parameter.id,
    quantifier: "single",
    state_variable_id: "variable",
    predicate,
  };
}

describe("readable condition summaries", () => {
  test("includes numeric operators, operands, and authored units", () => {
    expect(
      summarizeCondition(
        criterion({ kind: "number", operator: "gte", value: 10 }),
        [parameter],
        [variable({ kind: "number", unit: "HP" })],
      ),
    ).toBe("for Actor, State is at least 10 HP");

    expect(
      summarizeCondition(
        criterion({
          kind: "number-range",
          operator: "between",
          minimum: 2,
          maximum: 5,
        }),
        [parameter],
        [variable({ kind: "number" })],
      ),
    ).toBe("for Actor, State is between 2 and 5");
  });

  test("uses authored labels for choice operands", () => {
    expect(
      summarizeCondition(
        criterion({ kind: "choice", operator: "is", value: "open" }),
        [parameter],
        [
          variable({
            kind: "choice",
            options: [{ id: "option", key: "open", label: "Open" }],
          }),
        ],
      ),
    ).toBe("for Actor, State is Open");
  });

  test("renders Boolean and multi-option operands explicitly", () => {
    expect(
      summarizeCondition(
        criterion({ kind: "boolean", operator: "is", value: false }),
        [parameter],
        [variable({ kind: "boolean" })],
      ),
    ).toBe("for Actor, State is false");

    expect(
      summarizeCondition(
        criterion({
          kind: "choice-set",
          operator: "one-of",
          values: ["open", "locked"],
        }),
        [parameter],
        [
          variable({
            kind: "choice",
            options: [
              { id: "open", key: "open", label: "Open" },
              { id: "locked", key: "locked", label: "Locked" },
            ],
          }),
        ],
      ),
    ).toBe("for Actor, State is one of Open, Locked");
  });
});
