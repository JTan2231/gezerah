import { describe, expect, test } from "bun:test";

import type { Entity, StateVariableDefinition } from "../api/types";
import {
  eligibleVariablesForEntities,
  enabledEffectOperations,
  makeConcreteEffect,
} from "./play";

const entities: Entity[] = [
  {
    id: "hero",
    display_name: "Hero",
    owner_schema_ids: ["living", "speaker"],
    archived: false,
    state_revision: 0,
  },
  {
    id: "guard",
    display_name: "Guard",
    owner_schema_ids: ["living"],
    archived: false,
    state_revision: 0,
  },
];

const health: StateVariableDefinition = {
  id: "health",
  key: "core-health",
  label: "Health",
  owner_schema_ids: ["living"],
  cardinality: "one",
  value_schema: { kind: "number", minimum: 0, maximum: 10 },
  missing_value: { kind: "unknown" },
  condition_addressable: true,
  allowed_effect_operations: ["set", "adjust-number"],
  display_order: 0,
  archived: false,
};
const voice: StateVariableDefinition = {
  ...health,
  id: "voice",
  key: "core-voice",
  label: "Voice",
  owner_schema_ids: ["speaker"],
  value_schema: { kind: "text" },
  allowed_effect_operations: ["set"],
};

describe("live effect eligibility", () => {
  test("requires every concrete entity to own the variable", () => {
    expect(
      eligibleVariablesForEntities(["hero", "guard"], entities, [
        health,
        voice,
      ]).map((item) => item.id),
    ).toEqual(["health"]);
  });

  test("intersects configured and structurally compatible operations", () => {
    expect(enabledEffectOperations(health)).toEqual(["set", "adjust-number"]);
  });

  test("initializes a concrete adjustment without a target definition", () => {
    expect(
      makeConcreteEffect("adjust-number", ["hero"], health, "effect-1"),
    ).toEqual({
      id: "effect-1",
      type: "adjust-number",
      entity_ids: ["hero"],
      state_variable_id: "health",
      amount: 0,
    });
  });
});
