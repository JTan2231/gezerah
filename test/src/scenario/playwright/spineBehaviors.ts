import {
  defineBehavior,
  defineOutcomeContract,
  implementBehavior,
  outcome,
  shape,
  type AnyBehaviorModule,
} from "../core/behavior";
import { defineValidator } from "../core/validator";
import { BehaviorCatalog } from "../catalog/behaviorCatalog";
import type { ScenarioId } from "../catalog/scenarioTraces";

export interface SpineBehaviorInput {
  readonly perform: () => Promise<void>;
}

interface SpineOutcomeEvidence {
  readonly validate: () => Promise<void>;
}

export interface SpineValidationContext {
  readonly validateOutcome: typeof validateOutcome;
  readonly evidence: SpineOutcomeEvidence;
}

export interface SpineBehaviorSpec {
  readonly id: string;
  readonly actorIds: readonly string[];
  readonly scenarioIds: readonly ScenarioId[];
}

const SPECS = [
  spec("identity.enter-builder", ["owner"], ["IDN-001", "IDN-004", "NAV-001"]),
  spec("world.create", ["owner"], ["WRL-001", "WRL-V01"]),
  spec("mechanics.publish", ["owner"], ["MEC-001", "MEC-002", "MEC-003"]),
  spec("character-fields.publish", ["owner"], ["CHF-002"]),
  spec("entity.create-sheet", ["owner"], ["MEC-005", "RST-001", "RST-002"]),
  spec(
    "invites.create-and-redeem",
    ["owner", "editor", "player", "spectator"],
    ["IDN-003", "WRL-002", "INV-001", "INV-002", "INV-003", "AUT-001"],
  ),
  spec("onboarding.wait", ["player"], ["RST-V01"]),
  spec("controllers.assign", ["owner", "player"], ["RST-003"]),
  spec("profile.save-partial", ["player"], ["RST-004", "RST-V02"]),
  spec("profile.complete", ["player"], ["RST-005"]),
  spec("world.edit", ["editor"], ["WRL-003"]),
  spec("mechanic.edit", ["editor", "owner"], ["MEC-006"]),
  spec("editor.authority", ["editor"], ["AUT-002"]),
  spec("profile.project-visibility", ["spectator", "player"], ["AUT-003"]),
  spec(
    "problem.present",
    ["editor", "player", "spectator"],
    ["PLY-001", "PLY-002", "PLY-003"],
  ),
  spec("spectator.project-table", ["spectator"], ["AUT-006"]),
  spec("action.offer", ["player", "editor"], ["PLY-004", "AUT-005"]),
  spec(
    "problem.adjudicate",
    ["editor", "player", "spectator"],
    ["PLY-006", "PLY-V05", "AUT-004"],
  ),
  spec("consequence.preview", ["editor"], ["CON-001", "CON-V01"]),
  spec("world.archive-blocked", ["owner"], ["LFC-V03"]),
  spec(
    "consequence.resolve",
    ["editor", "player", "spectator"],
    ["CON-003", "PLY-008", "AUT-008"],
  ),
  spec("status.apply", ["editor", "player"], ["CON-004", "CON-005"]),
  spec("status.keep-same-name-distinct", ["editor"], ["CON-006"]),
  spec(
    "status.remove-exact",
    ["editor", "player", "spectator"],
    ["CON-007", "CON-008"],
  ),
  spec(
    "world.archive",
    ["owner", "editor", "player", "spectator"],
    ["LFC-004", "LFC-005"],
  ),
] as const satisfies readonly SpineBehaviorSpec[];

export type SpineBehaviorId = (typeof SPECS)[number]["id"];

const validateOutcome = defineValidator<SpineOutcomeEvidence>({
  id: "spine.ui-outcome",
  description:
    "Run the behavior-specific visible and authoritative outcome assertions.",
  surface: "ui",
  sensitivity: "sensitive",
  async validate(input) {
    await input.validate();
  },
});

export function spineValidationContext(
  validate: () => Promise<void>,
): SpineValidationContext {
  return Object.freeze({
    validateOutcome,
    evidence: Object.freeze({ validate }),
  });
}

const modules: AnyBehaviorModule<unknown, SpineValidationContext>[] = SPECS.map(
  (behaviorSpec) => {
    const definition = defineBehavior({
      id: behaviorSpec.id,
      version: 1,
      scenarios: behaviorSpec.scenarioIds,
      input: shape<SpineBehaviorInput>(),
      outcomes: { completed: outcome<Record<string, never>>() },
    });
    return implementBehavior(definition, {
      driver: {
        async perform(_context, input) {
          await input.perform();
        },
      },
      contracts: {
        completed: defineOutcomeContract({
          id: `${behaviorSpec.id}.completed`,
          version: 1,
          validatorIds: [validateOutcome.id],
          async validate({ input, validation }) {
            await validation.validateOutcome.validate(validation.evidence);
            return Object.freeze({});
          },
        }),
      },
    });
  },
);

export const SPINE_BEHAVIOR_SPECS: readonly SpineBehaviorSpec[] = Object.freeze(
  [...SPECS],
);

export const SPINE_BEHAVIOR_CATALOG = new BehaviorCatalog({
  modules,
  validators: [validateOutcome],
});

export function spineBehaviorSpec(id: string): SpineBehaviorSpec {
  const behaviorSpec = SPINE_BEHAVIOR_SPECS.find(
    (candidate) => candidate.id === id,
  );
  if (behaviorSpec === undefined) {
    throw new Error(`unknown lifecycle behavior ${id}`);
  }
  return behaviorSpec;
}

function spec<const Id extends string>(
  id: Id,
  actorIds: readonly string[],
  scenarioIds: readonly ScenarioId[],
): Readonly<{
  id: Id;
  actorIds: readonly string[];
  scenarioIds: readonly ScenarioId[];
}> {
  return Object.freeze({
    id,
    actorIds: Object.freeze([...actorIds]),
    scenarioIds: Object.freeze([...scenarioIds]),
  });
}
