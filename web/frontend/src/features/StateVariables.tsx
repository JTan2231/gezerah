import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type {
  Cardinality,
  EffectOperation,
  Entity,
  OwnerSchema,
  StateVariableDefinition,
  ValueKind,
  ValueSchema,
} from "../api/types";
import { ResourceWorkspace } from "../components/ResourceWorkspace";
import { StateValueEditor } from "../components/StateValueEditor";
import {
  CheckPicker,
  EmptyState,
  Field,
  ModeGroup,
  OrderedActions,
  PageHeader,
  Panel,
  SaveBar,
  StatusBadge,
} from "../components/ui";
import { moveItem } from "../domain/collections";
import {
  compatibleEffectOperations,
  compatiblePresentationControls,
  defaultStateValue,
  defaultValueSchema,
  effectOperationLabels,
  isConditionAddressable,
  slugify,
  valueKinds,
} from "../domain/options";
import { useCollection } from "../hooks/useCollection";
import { useDraft } from "../hooks/useDraft";

function newVariable(displayOrder: number): StateVariableDefinition {
  return {
    id: "",
    key: "",
    label: "",
    description: "",
    owner_schema_ids: [],
    cardinality: "one",
    value_schema: { kind: "text" },
    missing_value: { kind: "unknown" },
    presentation: {},
    condition_addressable: false,
    allowed_effect_operations: [],
    display_order: displayOrder,
    archived: false,
  };
}

export function StateVariables({ ruleSetId }: { ruleSetId: string }) {
  const collection = useCollection<StateVariableDefinition>(
    ruleSetPath(ruleSetId, "state-variable-definitions"),
  );
  const schemas = useCollection<OwnerSchema>(
    ruleSetPath(ruleSetId, "owner-schemas"),
  );
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const [selected, setSelected] = useState<StateVariableDefinition | null>(
    null,
  );
  return (
    <>
      <PageHeader
        eyebrow="Define / 02"
        title="State variables"
        description="Declare typed state with explicit ownership, missing-value behavior, presentation, and transition permissions."
      />
      <ResourceWorkspace
        title="Variable catalog"
        items={[...collection.items].sort((a, b) => {
          const aGroup = a.presentation?.group?.trim() ?? "";
          const bGroup = b.presentation?.group?.trim() ?? "";
          const groupOrder = aGroup.localeCompare(bGroup);
          return groupOrder === 0
            ? a.display_order - b.display_order ||
                a.label.localeCompare(b.label)
            : groupOrder;
        })}
        selectedId={selected?.id ?? null}
        getId={(item) => item.id}
        getTitle={(item) => item.label}
        getMeta={(item) =>
          `${item.value_schema.kind} · ${item.cardinality} · order ${item.display_order}`
        }
        getGroup={(item) => {
          const group = item.presentation?.group?.trim();
          return group === undefined || group === "" ? "Ungrouped" : group;
        }}
        isArchived={(item) => item.archived}
        loading={collection.loading}
        error={collection.error}
        onRetry={collection.reload}
        onSelect={setSelected}
        onCreate={() => setSelected(newVariable(collection.items.length))}
        createLabel="Variable"
        emptyTitle="No state vocabulary yet"
        emptyDescription="Create the first authored state variable. There is no required built-in catalog."
      >
        {selected === null ? (
          <EmptyState
            title="Choose a variable"
            description="Select an existing definition or create one to configure every semantic and presentation option."
          />
        ) : (
          <VariableEditor
            key={selected.id || "new"}
            source={selected}
            ruleSetId={ruleSetId}
            schemas={schemas.items}
            entities={entities.items}
            onSaved={(saved) => {
              collection.replaceItem(saved, (item) => item.id);
              setSelected(saved);
            }}
          />
        )}
      </ResourceWorkspace>
    </>
  );
}

function VariableEditor({
  source,
  ruleSetId,
  schemas,
  entities,
  onSaved,
}: {
  source: StateVariableDefinition;
  ruleSetId: string;
  schemas: OwnerSchema[];
  entities: Entity[];
  onSaved: (value: StateVariableDefinition) => void;
}) {
  const editor = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const draft = editor.draft;
  const existing = draft.id !== "";
  const kind = draft.value_schema.kind;
  const controls = compatiblePresentationControls(kind);
  const compatibleOps = compatibleEffectOperations(kind, draft.cardinality);

  function setKind(nextKind: ValueKind) {
    const value_schema = defaultValueSchema(nextKind);
    editor.setDraft({
      ...draft,
      value_schema,
      missing_value:
        draft.missing_value.kind === "unknown"
          ? draft.missing_value
          : {
              kind: "default",
              value: defaultStateValue(value_schema, draft.cardinality),
              omit_when_stored: draft.missing_value.omit_when_stored,
            },
      presentation: { ...draft.presentation, control: undefined },
      condition_addressable: false,
      allowed_effect_operations: draft.allowed_effect_operations.filter(
        (operation) =>
          compatibleEffectOperations(nextKind, draft.cardinality).includes(
            operation,
          ),
      ),
    });
  }
  function setCardinality(cardinality: Cardinality) {
    editor.setDraft({
      ...draft,
      cardinality,
      missing_value:
        draft.missing_value.kind === "unknown"
          ? draft.missing_value
          : {
              ...draft.missing_value,
              value: defaultStateValue(draft.value_schema, cardinality),
            },
      condition_addressable:
        cardinality === "one" ? draft.condition_addressable : false,
      allowed_effect_operations: draft.allowed_effect_operations.filter(
        (operation) =>
          compatibleEffectOperations(kind, cardinality).includes(operation),
      ),
    });
  }
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<StateVariableDefinition>(
        existing
          ? ruleSetPath(ruleSetId, `state-variable-definitions/${draft.id}`)
          : ruleSetPath(ruleSetId, "state-variable-definitions"),
        {
          method: existing ? "PUT" : "POST",
          ...jsonBody({
            ...draft,
            ...(existing ? {} : { id: undefined }),
            created_at: undefined,
            updated_at: undefined,
          }),
        },
      );
      editor.accept(saved);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this variable."),
      );
    } finally {
      setSaving(false);
    }
  }

  function setDefaultValue(value: import("../api/types").StateValue) {
    const missing = draft.missing_value;
    if (missing.kind !== "default") return;
    editor.setDraft({
      ...draft,
      missing_value: {
        kind: "default",
        value,
        omit_when_stored: missing.omit_when_stored,
      },
    });
  }

  function setDefaultStorage(omit_when_stored: boolean) {
    const missing = draft.missing_value;
    if (missing.kind !== "default") return;
    editor.setDraft({
      ...draft,
      missing_value: {
        kind: "default",
        value: missing.value,
        omit_when_stored,
      },
    });
  }

  return (
    <div className="editor-stack">
      <Panel
        title={
          existing ? draft.label || "Untitled variable" : "New state variable"
        }
        description="Semantic fields become immutable after the definition is used. Duplicate to make a replacement later."
        actions={
          <StatusBadge tone={draft.archived ? "neutral" : "good"}>
            {draft.archived ? "Archived" : "Active"}
          </StatusBadge>
        }
      >
        <div className="form-grid">
          <Field label="Label" required>
            <input
              value={draft.label}
              onChange={(event) => {
                const label = event.currentTarget.value;
                editor.setDraft({
                  ...draft,
                  label,
                  key:
                    draft.key === slugify(draft.label)
                      ? slugify(label)
                      : draft.key,
                });
              }}
            />
          </Field>
          <Field
            label="Stable namespaced key"
            required
            hint="For example: core-health"
          >
            <input
              value={draft.key}
              onChange={(event) =>
                editor.setDraft({ ...draft, key: event.currentTarget.value })
              }
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            value={draft.description ?? ""}
            onChange={(event) =>
              editor.setDraft({
                ...draft,
                description: event.currentTarget.value,
              })
            }
          />
        </Field>
        <CheckPicker
          legend="Eligible owner schemas"
          help="Required. An entity may own this variable when it implements any selected schema."
          options={schemas.map((schema) => ({
            id: schema.id,
            label: schema.label,
            description: schema.key,
            disabled:
              schema.archived && !draft.owner_schema_ids.includes(schema.id),
          }))}
          selected={draft.owner_schema_ids}
          onChange={(owner_schema_ids) =>
            editor.setDraft({ ...draft, owner_schema_ids })
          }
        />
      </Panel>
      <Panel
        title="Value shape"
        description="Kind and cardinality determine storage, controls, predicates, and effects."
      >
        <ModeGroup
          legend="Scalar kind"
          value={kind}
          columns={3}
          options={valueKinds}
          onChange={setKind}
        />
        <ModeGroup
          legend="Cardinality"
          value={draft.cardinality}
          options={[
            {
              value: "one",
              label: "One value",
              description: "Exactly one scalar when known.",
            },
            {
              value: "many",
              label: "Many values",
              description:
                "A duplicate-free set. Order has no semantic meaning.",
            },
          ]}
          onChange={setCardinality}
        />
        <KindSchemaEditor
          schema={draft.value_schema}
          ownerSchemas={schemas}
          onChange={(value_schema) =>
            editor.setDraft({ ...draft, value_schema })
          }
        />
      </Panel>
      <Panel
        title="Missing-value behavior"
        description="Absence is never confused with false, zero, or an empty string."
      >
        <ModeGroup
          legend="When no value is stored"
          value={draft.missing_value.kind}
          options={[
            {
              value: "unknown",
              label: "Unknown",
              description:
                "Evaluation reports incomplete when this value is needed.",
            },
            {
              value: "default",
              label: "Use a default",
              description:
                "Materialize the configured logical value on every read.",
            },
          ]}
          onChange={(value) =>
            editor.setDraft({
              ...draft,
              missing_value:
                value === "unknown"
                  ? { kind: "unknown" }
                  : {
                      kind: "default",
                      value: defaultStateValue(
                        draft.value_schema,
                        draft.cardinality,
                      ),
                      omit_when_stored: false,
                    },
            })
          }
        />
        {draft.missing_value.kind === "default" ? (
          <>
            <StateValueEditor
              schema={draft.value_schema}
              cardinality={draft.cardinality}
              value={draft.missing_value.value}
              entities={entities}
              label="Default value"
              control={draft.presentation?.control}
              onChange={setDefaultValue}
            />
            <ModeGroup
              legend="Store values equal to this default"
              value={draft.missing_value.omit_when_stored ? "omit" : "store"}
              options={[
                {
                  value: "omit",
                  label: "Omit them",
                  description: "Normalize equal values out of persistence.",
                },
                {
                  value: "store",
                  label: "Store them",
                  description: "Keep an explicit persisted row.",
                },
              ]}
              onChange={(value) => setDefaultStorage(value === "omit")}
            />
          </>
        ) : null}
      </Panel>
      <Panel
        title="Presentation"
        description="Hints shape metadata-driven editors but do not add domain behavior."
      >
        <div className="form-grid">
          <Field
            label="Presentation group"
            hint="Leave blank for no authored group."
          >
            <input
              value={draft.presentation?.group ?? ""}
              onChange={(event) =>
                editor.setDraft({
                  ...draft,
                  presentation: {
                    ...draft.presentation,
                    group: event.currentTarget.value || undefined,
                  },
                })
              }
            />
          </Field>
          <Field label="Display order">
            <input
              type="number"
              min={0}
              step={1}
              value={draft.display_order}
              onChange={(event) =>
                editor.setDraft({
                  ...draft,
                  display_order: event.currentTarget.valueAsNumber || 0,
                })
              }
            />
          </Field>
        </div>
        <Field label="Preferred control">
          <select
            value={draft.presentation?.control ?? ""}
            onChange={(event) =>
              editor.setDraft({
                ...draft,
                presentation: {
                  ...draft.presentation,
                  control: event.currentTarget.value || undefined,
                },
              })
            }
          >
            <option value="">Automatic (recommended)</option>
            {controls.map((control) => (
              <option key={control} value={control}>
                {control}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Help text">
          <textarea
            value={draft.presentation?.help_text ?? ""}
            onChange={(event) =>
              editor.setDraft({
                ...draft,
                presentation: {
                  ...draft.presentation,
                  help_text: event.currentTarget.value || undefined,
                },
              })
            }
          />
        </Field>
      </Panel>
      <Panel
        title="Condition and effect permissions"
        description="Opt into each way authored rules may read or mutate this state."
      >
        <ModeGroup
          legend="Use in new conditions"
          value={draft.condition_addressable ? "on" : "off"}
          options={[
            {
              value: "off",
              label: "Not addressable",
              description: "Hide from new criterion variable menus.",
            },
            {
              value: "on",
              label: "Condition-addressable",
              description: isConditionAddressable(kind, draft.cardinality)
                ? "Available to compatible condition parameters."
                : "Initial predicates support only singular number, Boolean, and choice values.",
              disabled: !isConditionAddressable(kind, draft.cardinality),
            },
          ]}
          onChange={(value) =>
            editor.setDraft({ ...draft, condition_addressable: value === "on" })
          }
        />
        <CheckPicker
          legend="Allowed effect operations"
          help="No operation is enabled implicitly."
          options={compatibleOps.map((operation) => ({
            id: operation,
            label: effectOperationLabels[operation],
          }))}
          selected={draft.allowed_effect_operations}
          onChange={(ids) =>
            editor.setDraft({
              ...draft,
              allowed_effect_operations: ids as EffectOperation[],
            })
          }
        />
      </Panel>
      <Panel title="Lifecycle">
        <ModeGroup
          legend="Definition status"
          value={draft.archived ? "archived" : "active"}
          options={[
            {
              value: "active",
              label: "Active",
              description: "Available in new criteria and effects.",
            },
            {
              value: "archived",
              label: "Archived",
              description: "Existing state and rules continue to read it.",
            },
          ]}
          onChange={(value) =>
            editor.setDraft({ ...draft, archived: value === "archived" })
          }
        />
      </Panel>
      <SaveBar
        dirty={editor.dirty}
        saving={saving}
        error={error}
        onReset={editor.reset}
        onSave={() => void save()}
        noun="variable changes"
      />
    </div>
  );
}

function KindSchemaEditor({
  schema,
  ownerSchemas,
  onChange,
}: {
  schema: ValueSchema;
  ownerSchemas: OwnerSchema[];
  onChange: (schema: ValueSchema) => void;
}) {
  const firstActiveOwnerSchema = ownerSchemas.find((owner) => !owner.archived);
  if (schema.kind === "choice")
    return (
      <fieldset className="subeditor">
        <legend>Choice options</legend>
        <p className="field-hint">
          Keys are stored values; labels are current display text.
        </p>
        {schema.options.map((option, index) => (
          <div className="ordered-form-row" key={option.id}>
            <Field label={`Option ${index + 1} key`}>
              <input
                value={option.key}
                onChange={(event) =>
                  onChange({
                    ...schema,
                    options: schema.options.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, key: event.currentTarget.value }
                        : item,
                    ),
                  })
                }
              />
            </Field>
            <Field label="Label">
              <input
                value={option.label}
                onChange={(event) =>
                  onChange({
                    ...schema,
                    options: schema.options.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, label: event.currentTarget.value }
                        : item,
                    ),
                  })
                }
              />
            </Field>
            <OrderedActions
              index={index}
              count={schema.options.length}
              label={`option ${index + 1}`}
              onMove={(direction) =>
                onChange({
                  ...schema,
                  options: moveItem(schema.options, index, direction),
                })
              }
              onRemove={() =>
                onChange({
                  ...schema,
                  options: schema.options.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            />
          </div>
        ))}
        <button
          className="button-secondary"
          type="button"
          onClick={() =>
            onChange({
              ...schema,
              options: [
                ...schema.options,
                { id: crypto.randomUUID(), key: "", label: "" },
              ],
            })
          }
        >
          + Add option
        </button>
      </fieldset>
    );
  if (schema.kind === "measurement")
    return (
      <fieldset className="subeditor">
        <legend>Measurement schema</legend>
        <div className="constraint-grid">
          <OptionalNumber
            label="Minimum"
            value={schema.minimum}
            onChange={(minimum) => onChange({ ...schema, minimum })}
          />
          <OptionalNumber
            label="Maximum"
            value={schema.maximum}
            onChange={(maximum) => onChange({ ...schema, maximum })}
          />
          <OptionalNumber
            label="Step"
            value={schema.step}
            positive
            onChange={(step) => onChange({ ...schema, step })}
          />
        </div>
        <h3>Units</h3>
        {schema.units.map((unit, index) => (
          <div className="ordered-form-row compact-row" key={unit.id}>
            <Field label={`Unit ${index + 1}`}>
              <input
                value={unit.unit}
                onChange={(event) =>
                  onChange({
                    ...schema,
                    units: schema.units.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, unit: event.currentTarget.value }
                        : item,
                    ),
                  })
                }
              />
            </Field>
            <OrderedActions
              index={index}
              count={schema.units.length}
              label={`unit ${index + 1}`}
              onMove={(direction) =>
                onChange({
                  ...schema,
                  units: moveItem(schema.units, index, direction),
                })
              }
              onRemove={() =>
                onChange({
                  ...schema,
                  units: schema.units.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            />
          </div>
        ))}
        <button
          className="button-secondary"
          type="button"
          onClick={() =>
            onChange({
              ...schema,
              units: [...schema.units, { id: crypto.randomUUID(), unit: "" }],
            })
          }
        >
          + Add unit
        </button>
      </fieldset>
    );
  if (schema.kind === "number")
    return (
      <fieldset className="subeditor">
        <legend>Number schema</legend>
        <div className="constraint-grid">
          <OptionalNumber
            label="Minimum"
            value={schema.minimum}
            onChange={(minimum) => onChange({ ...schema, minimum })}
          />
          <OptionalNumber
            label="Maximum"
            value={schema.maximum}
            onChange={(maximum) => onChange({ ...schema, maximum })}
          />
          <OptionalNumber
            label="Step"
            value={schema.step}
            positive
            onChange={(step) => onChange({ ...schema, step })}
          />
          <Field label="Display unit" hint="Optional text only.">
            <input
              value={schema.unit ?? ""}
              onChange={(event) =>
                onChange({
                  ...schema,
                  unit: event.currentTarget.value || undefined,
                })
              }
            />
          </Field>
        </div>
      </fieldset>
    );
  if (schema.kind === "reference")
    return (
      <fieldset className="subeditor">
        <legend>Reference target eligibility</legend>
        <ModeGroup
          legend="Entities this variable may reference"
          value={
            schema.target_owner_schema_ids.length === 0 ? "any" : "restricted"
          }
          options={[
            {
              value: "any",
              label: "Any entity",
              description: "Any entity in this ruleset is eligible.",
            },
            {
              value: "restricted",
              label: "Restricted by schema",
              description: "The entity must implement any selected schema.",
              disabled: firstActiveOwnerSchema === undefined,
            },
          ]}
          onChange={(value) =>
            onChange({
              ...schema,
              target_owner_schema_ids:
                value === "any"
                  ? []
                  : schema.target_owner_schema_ids.length > 0
                    ? schema.target_owner_schema_ids
                    : firstActiveOwnerSchema === undefined
                      ? []
                      : [firstActiveOwnerSchema.id],
            })
          }
        />
        {schema.target_owner_schema_ids.length === 0 ? null : (
          <CheckPicker
            legend="Accepted target schemas"
            help="A referenced entity needs any one of these capabilities."
            options={ownerSchemas.map((owner) => ({
              id: owner.id,
              label: owner.label,
              description: owner.key,
              disabled:
                owner.archived &&
                !schema.target_owner_schema_ids.includes(owner.id),
            }))}
            selected={schema.target_owner_schema_ids}
            onChange={(target_owner_schema_ids) =>
              onChange({ ...schema, target_owner_schema_ids })
            }
          />
        )}
        {schema.target_owner_schema_ids.length === 0 ? (
          <button
            className="button-secondary"
            type="button"
            onClick={() =>
              onChange({
                ...schema,
                target_owner_schema_ids:
                  firstActiveOwnerSchema === undefined
                    ? []
                    : [firstActiveOwnerSchema.id],
              })
            }
          >
            Choose restricted schemas
          </button>
        ) : null}
      </fieldset>
    );
  return (
    <p className="quiet-note">
      {schema.kind === "boolean"
        ? "Boolean values use an explicit true/false control."
        : "Text has no additional value constraints in the initial model."}
    </p>
  );
}

function OptionalNumber({
  label,
  value,
  positive = false,
  onChange,
}: {
  label: string;
  value: number | undefined;
  positive?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="optional-number">
      <label className="check-line">
        <input
          type="checkbox"
          checked={value !== undefined}
          onChange={(event) =>
            onChange(
              event.currentTarget.checked ? (positive ? 1 : 0) : undefined,
            )
          }
        />{" "}
        Set {label.toLowerCase()}
      </label>
      {value === undefined ? (
        <span className="field-hint">No {label.toLowerCase()}</span>
      ) : (
        <Field label={label}>
          <input
            type="number"
            min={positive ? Number.MIN_VALUE : undefined}
            value={value}
            onChange={(event) =>
              onChange(event.currentTarget.valueAsNumber || 0)
            }
          />
        </Field>
      )}
    </div>
  );
}
