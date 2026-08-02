import type {
  Entity,
  StateScalarValue,
  StateValue,
  ValueSchema,
} from "../api/types";
import { defaultScalar } from "../domain/options";
import { moveItem } from "../domain/collections";
import { Field, OrderedActions } from "./ui";

export function StateValueEditor({
  schema,
  cardinality,
  value,
  entities,
  onChange,
  label = "Value",
  control,
}: {
  schema: ValueSchema;
  cardinality: "one" | "many";
  value: StateValue;
  entities: Entity[];
  onChange: (value: StateValue) => void;
  label?: string;
  control?: string | undefined;
}) {
  if (cardinality === "one") {
    const scalar = Array.isArray(value) ? defaultScalar(schema) : value;
    return (
      <ScalarEditor
        label={label}
        schema={schema}
        value={scalar}
        entities={entities}
        control={control}
        onChange={onChange}
      />
    );
  }
  const values = Array.isArray(value) ? value : [value];
  return (
    <fieldset className="collection-field">
      <legend>{label}</legend>
      <p className="field-hint">
        Set semantics: normalized duplicates are not allowed. Order is retained
        only for editing.
      </p>
      <div className="collection-stack">
        {values.map((item, index) => (
          <div className="collection-row" key={`${item.kind}-${index}`}>
            <ScalarEditor
              label={`Value ${index + 1}`}
              schema={schema}
              value={item}
              entities={entities}
              control={control}
              onChange={(next) =>
                onChange(
                  values.map((current, currentIndex) =>
                    currentIndex === index ? next : current,
                  ),
                )
              }
            />
            <OrderedActions
              index={index}
              count={values.length}
              label={`value ${index + 1}`}
              onMove={(direction) =>
                onChange(moveItem(values, index, direction))
              }
              onRemove={() =>
                onChange(
                  values.filter((_, currentIndex) => currentIndex !== index),
                )
              }
            />
          </div>
        ))}
      </div>
      {values.length === 0 ? (
        <p className="quiet-empty">This is an explicit empty set.</p>
      ) : null}
      <button
        className="button-secondary"
        type="button"
        onClick={() => onChange([...values, defaultScalar(schema)])}
      >
        + Add value
      </button>
    </fieldset>
  );
}

function ScalarEditor({
  schema,
  value,
  entities,
  onChange,
  label,
  control,
}: {
  schema: ValueSchema;
  value: StateScalarValue;
  entities: Entity[];
  onChange: (value: StateScalarValue) => void;
  label: string;
  control?: string | undefined;
}) {
  switch (schema.kind) {
    case "text":
      return (
        <Field label={label}>
          {control === "long-text" ? (
            <textarea
              value={value.kind === "text" ? value.value : ""}
              onChange={(event) =>
                onChange({ kind: "text", value: event.currentTarget.value })
              }
            />
          ) : (
            <input
              value={value.kind === "text" ? value.value : ""}
              onChange={(event) =>
                onChange({ kind: "text", value: event.currentTarget.value })
              }
            />
          )}
        </Field>
      );
    case "number":
      return (
        <Field
          label={label}
          hint={[
            schema.minimum === undefined ? null : `min ${schema.minimum}`,
            schema.maximum === undefined ? null : `max ${schema.maximum}`,
            schema.step === undefined ? null : `step ${schema.step}`,
            schema.unit,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <input
            type="number"
            min={schema.minimum}
            max={schema.maximum}
            step={schema.step ?? "any"}
            value={value.kind === "number" ? value.value : 0}
            onChange={(event) =>
              onChange({
                kind: "number",
                value: event.currentTarget.valueAsNumber || 0,
              })
            }
          />
        </Field>
      );
    case "boolean":
      return (
        <fieldset className="inline-choice">
          <legend>{label}</legend>
          <label>
            <input
              type="radio"
              checked={value.kind === "boolean" && value.value}
              onChange={() => onChange({ kind: "boolean", value: true })}
            />{" "}
            True
          </label>
          <label>
            <input
              type="radio"
              checked={value.kind === "boolean" && !value.value}
              onChange={() => onChange({ kind: "boolean", value: false })}
            />{" "}
            False
          </label>
        </fieldset>
      );
    case "choice":
      return (
        <Field label={label}>
          <select
            value={value.kind === "choice" ? value.value : ""}
            onChange={(event) =>
              onChange({ kind: "choice", value: event.currentTarget.value })
            }
          >
            <option value="">Choose an option</option>
            {schema.options.map((option) => (
              <option key={option.id} value={option.key}>
                {option.label || option.key || "Untitled option"}
              </option>
            ))}
          </select>
        </Field>
      );
    case "measurement":
      return (
        <div className="measurement-editor">
          <Field label={`${label} amount`}>
            <input
              type="number"
              min={schema.minimum}
              max={schema.maximum}
              step={schema.step ?? "any"}
              value={value.kind === "measurement" ? value.amount : 0}
              onChange={(event) =>
                onChange({
                  kind: "measurement",
                  amount: event.currentTarget.valueAsNumber || 0,
                  unit:
                    value.kind === "measurement"
                      ? value.unit
                      : (schema.units[0]?.unit ?? ""),
                })
              }
            />
          </Field>
          <Field label="Unit">
            <select
              value={value.kind === "measurement" ? value.unit : ""}
              onChange={(event) =>
                onChange({
                  kind: "measurement",
                  amount: value.kind === "measurement" ? value.amount : 0,
                  unit: event.currentTarget.value,
                })
              }
            >
              <option value="">Choose a unit</option>
              {schema.units.map((unit) => (
                <option key={unit.id} value={unit.unit}>
                  {unit.unit || "Untitled unit"}
                </option>
              ))}
            </select>
          </Field>
        </div>
      );
    case "reference": {
      const selected =
        value.kind === "reference"
          ? value
          : { kind: "reference" as const, entity_id: "" };
      const eligibleEntities = entities.filter(
        (entity) =>
          schema.target_owner_schema_ids.length === 0 ||
          schema.target_owner_schema_ids.some((id) =>
            entity.owner_schema_ids.includes(id),
          ),
      );
      return (
        <div className="reference-editor">
          <Field label={label}>
            <select
              value={selected.entity_id}
              onChange={(event) =>
                onChange({
                  kind: "reference",
                  entity_id: event.currentTarget.value,
                })
              }
            >
              <option value="">Choose an entity</option>
              {eligibleEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Fallback name"
            hint="Optional display text if the reference later cannot be resolved."
          >
            <input
              value={selected.fallback_name ?? ""}
              onChange={(event) =>
                onChange({
                  ...selected,
                  fallback_name: event.currentTarget.value,
                })
              }
            />
          </Field>
        </div>
      );
    }
  }
}
