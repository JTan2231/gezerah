import { describe, expect, test } from "bun:test";

import type { WorldMechanic } from "../api/types";
import { effectToAPI, type EffectDraft } from "./consequences";

const numberMechanic: WorldMechanic = {
  id: "resolve",
  kind: "capacity",
  mode: "score",
  source_kind: "input",
  name: "Resolve",
  mutable_during_play: true,
  archived: false,
  created_at: "",
  updated_at: "",
};

describe("consequence transport", () => {
  test("keeps scalar effects on the entity_ids contract", () => {
    const draft: EffectDraft = {
      id: "effect-1",
      kind: "mechanic",
      entityId: "entity-1",
      mechanicId: numberMechanic.id,
      valueKind: "number",
      operation: "adjust-number",
      amount: "-2",
      booleanValue: false,
    };

    expect(effectToAPI(draft)).toEqual({
      id: "effect-1",
      type: "adjust-number",
      entity_ids: ["entity-1"],
      mechanic_id: "resolve",
      amount: "-2",
    });
  });

  test("preserves precise decimal text and canonicalizes it for transport", () => {
    const draft: EffectDraft = {
      id: "effect-precise",
      kind: "mechanic",
      entityId: "entity-1",
      mechanicId: numberMechanic.id,
      valueKind: "number",
      operation: "set",
      amount: "09007199254740993.000000000000000100",
      booleanValue: false,
    };

    expect(effectToAPI(draft)).toEqual({
      id: "effect-precise",
      type: "set",
      entity_ids: ["entity-1"],
      mechanic_id: "resolve",
      value: {
        kind: "number",
        value: "9007199254740993.0000000000000001",
      },
    });
  });

  test("keeps the scalar value kind captured by the draft", () => {
    const draft: EffectDraft = {
      id: "effect-binary",
      kind: "mechanic",
      entityId: "entity-1",
      mechanicId: "hidden",
      valueKind: "boolean",
      operation: "set",
      amount: "0",
      booleanValue: true,
    };

    expect(effectToAPI(draft)).toEqual({
      id: "effect-binary",
      type: "set",
      entity_ids: ["entity-1"],
      mechanic_id: "hidden",
      value: { kind: "boolean", value: true },
    });
  });

  test("sends an inline status and status-only targets", () => {
    const draft: EffectDraft = {
      id: "effect-2",
      kind: "apply-status",
      entityIds: ["entity-1", "entity-2"],
      status: {
        name: "Shaken",
        description: "The fall rattles them.",
        modifiers: [
          {
            id: "modifier-1",
            mechanic_id: "resolve",
            operation: "add-number",
            value: { kind: "number", value: "-2" },
            priority: 10,
          },
        ],
      },
    };

    expect(effectToAPI(draft)).toEqual({
      id: "effect-2",
      type: "apply-status",
      targets: [{ entity_id: "entity-1" }, { entity_id: "entity-2" }],
      status: {
        name: "Shaken",
        description: "The fall rattles them.",
        modifiers: [
          {
            id: "modifier-1",
            mechanic_id: "resolve",
            operation: "add-number",
            value: { kind: "number", value: "-2" },
            priority: 10,
          },
        ],
      },
    });
  });

  test("removes the exact active status instance", () => {
    const draft: EffectDraft = {
      id: "effect-3",
      kind: "remove-status",
      targets: [
        {
          entityId: "entity-1",
          statusInstanceId: "status-instance-1",
          statusName: "Shaken",
        },
      ],
    };

    expect(effectToAPI(draft)).toEqual({
      id: "effect-3",
      type: "remove-status",
      targets: [
        {
          entity_id: "entity-1",
          status_instance_id: "status-instance-1",
        },
      ],
    });
  });
});
