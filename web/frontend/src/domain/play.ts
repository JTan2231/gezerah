import type {
  ConcreteEffect,
  EffectOperation,
  Entity,
  StateVariableDefinition,
} from "../api/types";
import {
  compatibleEffectOperations,
  defaultScalar,
  defaultStateValue,
} from "./options";

export function enabledEffectOperations(
  variable: StateVariableDefinition,
): EffectOperation[] {
  return compatibleEffectOperations(
    variable.value_schema.kind,
    variable.cardinality,
  ).filter((operation) =>
    variable.allowed_effect_operations.includes(operation),
  );
}

function entityCanOwnVariable(
  entity: Entity,
  variable: StateVariableDefinition,
): boolean {
  return variable.owner_schema_ids.some((schemaId) =>
    entity.owner_schema_ids.includes(schemaId),
  );
}

export function eligibleVariablesForEntities(
  entityIds: string[],
  entities: Entity[],
  variables: StateVariableDefinition[],
  retainedVariableId?: string,
): StateVariableDefinition[] {
  if (entityIds.length === 0) return [];
  const selected = entityIds.map((id) =>
    entities.find((entity) => entity.id === id),
  );
  if (selected.some((entity) => entity === undefined)) return [];
  return variables.filter(
    (variable) =>
      (!variable.archived || variable.id === retainedVariableId) &&
      enabledEffectOperations(variable).length > 0 &&
      selected.every(
        (entity) =>
          entity !== undefined && entityCanOwnVariable(entity, variable),
      ),
  );
}

export function makeConcreteEffect(
  operation: EffectOperation,
  entityIds: string[],
  variable: StateVariableDefinition,
  id: string = crypto.randomUUID(),
): ConcreteEffect {
  const base = {
    id,
    entity_ids: entityIds,
    state_variable_id: variable.id,
  };
  if (operation === "clear") return { ...base, type: "clear" };
  if (operation === "adjust-number")
    return { ...base, type: "adjust-number", amount: 0 };
  if (operation === "add-value" || operation === "remove-value")
    return {
      ...base,
      type: operation,
      value: defaultScalar(variable.value_schema),
    };
  return {
    ...base,
    type: "set",
    value: defaultStateValue(variable.value_schema, variable.cardinality),
  };
}

export function initialConcreteEffect(
  entities: Entity[],
  variables: StateVariableDefinition[],
): ConcreteEffect | undefined {
  for (const entity of entities) {
    if (entity.archived) continue;
    const variable = eligibleVariablesForEntities(
      [entity.id],
      entities,
      variables,
    )[0];
    if (variable === undefined) continue;
    const operation = enabledEffectOperations(variable)[0];
    if (operation !== undefined)
      return makeConcreteEffect(operation, [entity.id], variable);
  }
  return undefined;
}
