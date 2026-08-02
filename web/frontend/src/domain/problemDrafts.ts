import type {
  ChoiceDefinition,
  ChoiceOutcome,
  ConditionInvocation,
  StateEffect,
  StateScalarValue,
  StateValue,
} from "../api/types";

function cloneScalar(value: StateScalarValue): StateScalarValue {
  return { ...value };
}

function cloneStateValue(value: StateValue): StateValue {
  return Array.isArray(value) ? value.map(cloneScalar) : cloneScalar(value);
}

function duplicateInvocation(
  invocation: ConditionInvocation | undefined,
): ConditionInvocation | undefined {
  if (invocation === undefined) return undefined;
  return {
    id: crypto.randomUUID(),
    condition_set_id: invocation.condition_set_id,
    arguments: invocation.arguments.map((argument) => ({ ...argument })),
  };
}

function duplicateEffect(effect: StateEffect): StateEffect {
  switch (effect.type) {
    case "set":
      return {
        ...effect,
        id: crypto.randomUUID(),
        value: cloneStateValue(effect.value),
      };
    case "clear":
    case "adjust-number":
      return { ...effect, id: crypto.randomUUID() };
    case "add-value":
    case "remove-value":
      return {
        ...effect,
        id: crypto.randomUUID(),
        value: cloneScalar(effect.value),
      };
  }
}

function duplicateOutcome(outcome: ChoiceOutcome): ChoiceOutcome {
  return {
    ...outcome,
    id: crypto.randomUUID(),
    consequences: {
      id: crypto.randomUUID(),
      effects: outcome.consequences.effects.map(duplicateEffect),
    },
  };
}

function availableCopyKey(
  sourceKey: string,
  choices: ChoiceDefinition[],
): string {
  const used = new Set(choices.map((choice) => choice.key));
  const base = sourceKey.trim() === "" ? "choice-copy" : `${sourceKey}-copy`;
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1)
    candidate = `${base}-${suffix}`;
  return candidate;
}

export function duplicateChoiceDefinition(
  source: ChoiceDefinition,
  choices: ChoiceDefinition[],
): ChoiceDefinition {
  const availableWhen = duplicateInvocation(source.available_when);
  return {
    ...source,
    id: crypto.randomUUID(),
    key: availableCopyKey(source.key, choices),
    name: source.name.trim() === "" ? "Choice copy" : `${source.name} copy`,
    ...(availableWhen === undefined
      ? { available_when: undefined }
      : { available_when: availableWhen }),
    resolution:
      source.resolution.type === "automatic"
        ? {
            type: "automatic",
            outcome: duplicateOutcome(source.resolution.outcome),
          }
        : {
            type: "condition",
            invocation: duplicateInvocation(source.resolution.invocation)!,
            met: duplicateOutcome(source.resolution.met),
            unmet: duplicateOutcome(source.resolution.unmet),
          },
  };
}
