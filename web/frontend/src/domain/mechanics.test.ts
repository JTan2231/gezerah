import { describe, expect, test } from "bun:test";

import type { MechanicExpression } from "../api/types";
import { changeMechanicMode } from "./mechanics";

describe("mechanic draft mode changes", () => {
  test("keeps derived numeric fields unset and preserves a numeric expression", () => {
    const expression: MechanicExpression = {
      operation: "add-number",
      operands: [
        { operation: "literal", value: { kind: "number", value: "2" } },
        { operation: "literal", value: { kind: "number", value: "3" } },
      ],
    };

    const changed = changeMechanicMode(
      {
        mode: "score",
        source_kind: "derived",
        minimum: "-5",
        maximum: "10",
        step: "1",
        default_number: "4",
        unit: "points",
        expression,
      },
      "pool",
    );

    expect(changed).toEqual({
      mode: "pool",
      minimum: undefined,
      maximum: undefined,
      step: undefined,
      default_number: undefined,
      unit: "points",
      expression,
    });
  });

  test("resets a derived expression when its result type changes", () => {
    const changed = changeMechanicMode(
      {
        mode: "binary",
        source_kind: "derived",
        minimum: undefined,
        maximum: undefined,
        step: undefined,
        default_number: undefined,
        unit: "not valid for a binary value",
        expression: {
          operation: "literal",
          value: { kind: "boolean", value: true },
        },
      },
      "rating",
    );

    expect(changed).toEqual({
      mode: "rating",
      minimum: undefined,
      maximum: undefined,
      step: undefined,
      default_number: undefined,
      unit: undefined,
      expression: {
        operation: "literal",
        value: { kind: "number", value: "0" },
      },
    });
  });
});
