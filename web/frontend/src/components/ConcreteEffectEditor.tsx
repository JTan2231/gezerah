import type {
  ConcreteEffect,
  EffectOperation,
  Entity,
  StateVariableDefinition,
} from "../api/types";
import { moveItem } from "../domain/collections";
import {
  eligibleVariablesForEntities,
  enabledEffectOperations,
  initialConcreteEffect,
  makeConcreteEffect,
} from "../domain/play";
import { effectOperationLabels } from "../domain/options";
import { StateValueEditor } from "./StateValueEditor";
import { CheckPicker, Field, OrderedActions } from "./ui";

export function ConcreteEffectListEditor({
  effects,
  entities,
  variables,
  onChange,
}: {
  effects: ConcreteEffect[];
  entities: Entity[];
  variables: StateVariableDefinition[];
  onChange: (effects: ConcreteEffect[]) => void;
}) {
  const seed = initialConcreteEffect(entities, variables);
  return (
    <div className="concrete-effects-editor">
      {effects.length === 0 ? (
        <p className="quiet-empty">
          Narrative-only rulings are valid. Add an effect when world state also
          changes.
        </p>
      ) : null}
      <div className="collection-stack">
        {effects.map((effect, index) => (
          <ConcreteEffectEditor
            key={effect.id ?? `effect-${index}`}
            effect={effect}
            index={index}
            count={effects.length}
            entities={entities}
            variables={variables}
            onChange={(next) =>
              onChange(
                effects.map((item, itemIndex) =>
                  itemIndex === index ? next : item,
                ),
              )
            }
            onMove={(direction) =>
              onChange(moveItem(effects, index, direction))
            }
            onRemove={() =>
              onChange(effects.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        ))}
      </div>
      <button
        className="button-secondary"
        type="button"
        disabled={seed === undefined}
        onClick={() => {
          if (seed !== undefined) onChange([...effects, seed]);
        }}
      >
        + Add state effect
      </button>
      {seed === undefined && entities.length > 0 ? (
        <p className="form-error">
          No game entity currently owns an active variable with an enabled
          effect operation.
        </p>
      ) : null}
    </div>
  );
}

function ConcreteEffectEditor({
  effect,
  index,
  count,
  entities,
  variables,
  onChange,
  onMove,
  onRemove,
}: {
  effect: ConcreteEffect;
  index: number;
  count: number;
  entities: Entity[];
  variables: StateVariableDefinition[];
  onChange: (effect: ConcreteEffect) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const eligibleVariables = eligibleVariablesForEntities(
    effect.entity_ids,
    entities,
    variables,
    effect.state_variable_id,
  );
  const variable =
    eligibleVariables.find((item) => item.id === effect.state_variable_id) ??
    eligibleVariables[0];
  const operations =
    variable === undefined ? [] : enabledEffectOperations(variable);

  function selectEntities(entityIds: string[]) {
    const compatible = eligibleVariablesForEntities(
      entityIds,
      entities,
      variables,
      effect.state_variable_id,
    );
    const nextVariable =
      compatible.find((item) => item.id === effect.state_variable_id) ??
      compatible[0];
    if (nextVariable === undefined) {
      onChange({ ...effect, entity_ids: entityIds });
      return;
    }
    const nextOperation = enabledEffectOperations(nextVariable).includes(
      effect.type,
    )
      ? effect.type
      : enabledEffectOperations(nextVariable)[0];
    if (nextOperation !== undefined)
      onChange(
        makeConcreteEffect(nextOperation, entityIds, nextVariable, effect.id),
      );
  }

  return (
    <div className="effect-card concrete-effect-card">
      <div className="nested-card-head">
        <span className="eyebrow">Effect {index + 1}</span>
        <OrderedActions
          index={index}
          count={count}
          label={`effect ${index + 1}`}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <CheckPicker
        legend="Affected game entities"
        help="The same operation is applied to every selected entity in this order."
        options={entities.map((entity) => ({
          id: entity.id,
          label: entity.display_name,
          description: entity.archived ? "Archived" : entity.key,
          disabled: entity.archived && !effect.entity_ids.includes(entity.id),
        }))}
        selected={effect.entity_ids}
        onChange={selectEntities}
        emptyLabel="Associate world entities with this game before adding effects."
      />
      <div className="form-grid live-effect-controls">
        <Field label="State variable">
          <select
            value={variable?.id ?? ""}
            onChange={(event) => {
              const next = eligibleVariables.find(
                (item) => item.id === event.currentTarget.value,
              );
              const operation =
                next === undefined
                  ? undefined
                  : enabledEffectOperations(next)[0];
              if (next !== undefined && operation !== undefined)
                onChange(
                  makeConcreteEffect(
                    operation,
                    effect.entity_ids,
                    next,
                    effect.id,
                  ),
                );
            }}
          >
            <option value="">Choose a compatible variable</option>
            {eligibleVariables.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Operation">
          <select
            value={effect.type}
            disabled={variable === undefined}
            onChange={(event) => {
              if (variable !== undefined)
                onChange(
                  makeConcreteEffect(
                    event.currentTarget.value as EffectOperation,
                    effect.entity_ids,
                    variable,
                    effect.id,
                  ),
                );
            }}
          >
            {operations.map((operation) => (
              <option key={operation} value={operation}>
                {effectOperationLabels[operation]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {effect.entity_ids.length === 0 ? (
        <p className="form-error">Select at least one concrete entity.</p>
      ) : variable === undefined ? (
        <p className="form-error">
          The selected entities do not share a compatible state variable.
        </p>
      ) : effect.type === "set" ? (
        <StateValueEditor
          label="Replacement value"
          schema={variable.value_schema}
          cardinality={variable.cardinality}
          value={effect.value}
          entities={entities}
          control={variable.presentation?.control}
          onChange={(value) => onChange({ ...effect, value })}
        />
      ) : effect.type === "adjust-number" ? (
        <Field
          label="Adjustment amount"
          hint="May be positive, zero, or negative."
        >
          <input
            type="number"
            value={effect.amount}
            onChange={(event) =>
              onChange({
                ...effect,
                amount: event.currentTarget.valueAsNumber || 0,
              })
            }
          />
        </Field>
      ) : effect.type === "add-value" || effect.type === "remove-value" ? (
        <StateValueEditor
          label={
            effect.type === "add-value" ? "Value to add" : "Value to remove"
          }
          schema={variable.value_schema}
          cardinality="one"
          value={effect.value}
          entities={entities}
          control={variable.presentation?.control}
          onChange={(value) => {
            if (!Array.isArray(value)) onChange({ ...effect, value });
          }}
        />
      ) : (
        <p className="quiet-note">
          Clear removes stored rows; the variable becomes its configured default
          or unknown.
        </p>
      )}
    </div>
  );
}
