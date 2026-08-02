import { describe, expect, test } from "bun:test";

import type { ChoiceDefinition, StateEffect } from "../api/types";
import { duplicateChoiceDefinition } from "./problemDrafts";

const setEffect: StateEffect = {
  id: "set-effect",
  type: "set",
  target_definition_id: "target",
  state_variable_id: "variable",
  value: { kind: "number", value: 3 },
};

const source: ChoiceDefinition = {
  id: "choice",
  key: "attempt",
  name: "Attempt",
  description: "Try it",
  available_when: {
    id: "availability",
    condition_set_id: "available-condition",
    arguments: [
      { parameter_id: "available-parameter", target_definition_id: "target" },
    ],
  },
  resolution: {
    type: "condition",
    invocation: {
      id: "resolution-invocation",
      condition_set_id: "resolution-condition",
      arguments: [
        {
          parameter_id: "resolution-parameter",
          target_definition_id: "target",
        },
      ],
    },
    met: {
      id: "met",
      label: "Success",
      consequences: { id: "met-consequences", effects: [setEffect] },
    },
    unmet: {
      id: "unmet",
      label: "Failure",
      consequences: {
        id: "unmet-consequences",
        effects: [{ ...setEffect, id: "unmet-effect" }],
      },
    },
  },
};

describe("choice draft duplication", () => {
  test("regenerates every owned ID and preserves semantic references", () => {
    const copy = duplicateChoiceDefinition(source, [source]);
    expect(copy.id).not.toBe(source.id);
    expect(copy.key).toBe("attempt-copy");
    expect(copy.name).toBe("Attempt copy");
    expect(copy.available_when?.id).not.toBe(source.available_when?.id);
    expect(copy.available_when?.condition_set_id).toBe("available-condition");
    expect(copy.available_when?.arguments).toEqual(
      source.available_when?.arguments,
    );

    expect(copy.resolution.type).toBe("condition");
    if (
      copy.resolution.type !== "condition" ||
      source.resolution.type !== "condition"
    )
      throw new Error("expected conditional choices");
    expect(copy.resolution.invocation.id).not.toBe(
      source.resolution.invocation.id,
    );
    expect(copy.resolution.invocation.condition_set_id).toBe(
      source.resolution.invocation.condition_set_id,
    );
    expect(copy.resolution.invocation.arguments).toEqual(
      source.resolution.invocation.arguments,
    );
    expect(copy.resolution.met.id).not.toBe(source.resolution.met.id);
    expect(copy.resolution.met.consequences.id).not.toBe(
      source.resolution.met.consequences.id,
    );
    expect(copy.resolution.met.consequences.effects[0]?.id).not.toBe(
      source.resolution.met.consequences.effects[0]?.id,
    );
    expect(copy.resolution.met.consequences.effects[0]).toMatchObject({
      target_definition_id: "target",
      state_variable_id: "variable",
      value: { kind: "number", value: 3 },
    });
    expect(copy.resolution.unmet.id).not.toBe(source.resolution.unmet.id);
    expect(copy.resolution.unmet.consequences.id).not.toBe(
      source.resolution.unmet.consequences.id,
    );
    expect(copy.resolution.unmet.consequences.effects[0]?.id).not.toBe(
      source.resolution.unmet.consequences.effects[0]?.id,
    );
  });

  test("avoids copy-key collisions and duplicates automatic outcomes", () => {
    const automatic: ChoiceDefinition = {
      id: "automatic",
      key: "wait",
      name: "Wait",
      resolution: {
        type: "automatic",
        outcome: {
          id: "outcome",
          label: "Waited",
          consequences: { id: "consequences", effects: [] },
        },
      },
    };
    const copy = duplicateChoiceDefinition(automatic, [
      automatic,
      { ...automatic, id: "existing-copy", key: "wait-copy" },
    ]);
    expect(copy.key).toBe("wait-copy-2");
    expect(copy.resolution.type).toBe("automatic");
    if (copy.resolution.type !== "automatic")
      throw new Error("expected automatic choice");
    expect(copy.resolution.outcome.id).not.toBe("outcome");
    expect(copy.resolution.outcome.consequences.id).not.toBe("consequences");
  });
});
