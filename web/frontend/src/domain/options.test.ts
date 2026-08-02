import { describe, expect, test } from "bun:test";

import {
  compatibleEffectOperations,
  compatiblePresentationControls,
  defaultPredicate,
  defaultStateValue,
  isConditionAddressable,
} from "./options";

describe("schema-driven UI options", () => {
  test("derives presentation controls for every value kind", () => {
    expect(compatiblePresentationControls("text")).toEqual([
      "short-text",
      "long-text",
    ]);
    expect(compatiblePresentationControls("choice")).toEqual(["select"]);
    expect(compatiblePresentationControls("measurement")).toEqual([
      "measurement",
    ]);
    expect(compatiblePresentationControls("number")).toEqual(["number"]);
    expect(compatiblePresentationControls("boolean")).toEqual(["checkbox"]);
    expect(compatiblePresentationControls("reference")).toEqual([
      "reference-picker",
    ]);
  });

  test("only offers structurally compatible effect operations", () => {
    expect(compatibleEffectOperations("number", "one")).toEqual([
      "set",
      "clear",
      "adjust-number",
    ]);
    expect(compatibleEffectOperations("text", "many")).toEqual([
      "set",
      "clear",
      "add-value",
      "remove-value",
    ]);
    expect(compatibleEffectOperations("reference", "one")).toEqual([
      "set",
      "clear",
    ]);
  });

  test("condition addressability follows initial predicate support", () => {
    expect(isConditionAddressable("number", "one")).toBe(true);
    expect(isConditionAddressable("boolean", "one")).toBe(true);
    expect(isConditionAddressable("choice", "one")).toBe(true);
    expect(isConditionAddressable("text", "one")).toBe(false);
    expect(isConditionAddressable("number", "many")).toBe(false);
  });

  test("many-valued defaults start as an explicit empty set", () => {
    expect(defaultStateValue({ kind: "text" }, "many")).toEqual([]);
  });

  test("predicate controls derive a valid initial operand", () => {
    expect(defaultPredicate({ kind: "number", minimum: 4 })).toEqual({
      kind: "number",
      operator: "eq",
      value: 4,
    });
    expect(defaultPredicate({ kind: "boolean" })).toEqual({
      kind: "boolean",
      operator: "is",
      value: true,
    });
    expect(
      defaultPredicate({
        kind: "choice",
        options: [{ id: "id", key: "open", label: "Open" }],
      }),
    ).toEqual({ kind: "choice", operator: "is", value: "open" });
  });
});
