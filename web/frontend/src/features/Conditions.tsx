import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type {
  ConditionEvaluation,
  ConditionExpression,
  ConditionParameter,
  ConditionSet,
  Entity,
  OwnerSchema,
  Predicate,
  StateVariableDefinition,
} from "../api/types";
import { ResourceWorkspace } from "../components/ResourceWorkspace";
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
import { summarizeCondition } from "../domain/conditionSummary";
import { defaultPredicate, slugify } from "../domain/options";
import { useCollection } from "../hooks/useCollection";
import { useDraft } from "../hooks/useDraft";

function newCondition(): ConditionSet {
  return {
    id: "",
    key: "",
    name: "",
    description: "",
    parameters: [],
    root: { id: crypto.randomUUID(), type: "all", children: [] },
    archived: false,
  };
}

export function Conditions({ ruleSetId }: { ruleSetId: string }) {
  const collection = useCollection<ConditionSet>(
    ruleSetPath(ruleSetId, "condition-sets"),
  );
  const schemas = useCollection<OwnerSchema>(
    ruleSetPath(ruleSetId, "owner-schemas"),
  );
  const variables = useCollection<StateVariableDefinition>(
    ruleSetPath(ruleSetId, "state-variable-definitions"),
  );
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const [selected, setSelected] = useState<ConditionSet | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Define / 03"
        title="Conditions"
        description="Compose reusable, parameterized expression trees with deterministic three-valued explanations."
      />
      <ResourceWorkspace
        title="Condition library"
        items={collection.items}
        selectedId={selected?.id ?? null}
        getId={(item) => item.id}
        getTitle={(item) => item.name}
        getMeta={(item) =>
          `${item.parameters.length} parameter${item.parameters.length === 1 ? "" : "s"} · ${item.key}`
        }
        isArchived={(item) => item.archived}
        loading={collection.loading}
        error={collection.error}
        onRetry={collection.reload}
        onSelect={setSelected}
        onCreate={() => setSelected(newCondition())}
        createLabel="Condition"
        emptyTitle="No reusable conditions"
        emptyDescription="Start with declared inputs, then compose a readable tree over compatible state variables."
      >
        {selected === null ? (
          <EmptyState
            title="Choose a condition"
            description="Select a shared condition or create one to edit its parameters and tree."
          />
        ) : (
          <ConditionEditor
            key={selected.id || "new"}
            source={selected}
            ruleSetId={ruleSetId}
            schemas={schemas.items}
            variables={variables.items}
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

function ConditionEditor({
  source,
  ruleSetId,
  schemas,
  variables,
  entities,
  onSaved,
}: {
  source: ConditionSet;
  ruleSetId: string;
  schemas: OwnerSchema[];
  variables: StateVariableDefinition[];
  entities: Entity[];
  onSaved: (value: ConditionSet) => void;
}) {
  const editor = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [evaluation, setEvaluation] = useState<ConditionEvaluation | null>(
    null,
  );
  const [evaluationError, setEvaluationError] = useState<ApiError | null>(null);
  const [bindings, setBindings] = useState<Record<string, string[]>>({});
  const draft = editor.draft;
  const existing = draft.id !== "";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<ConditionSet>(
        existing
          ? ruleSetPath(ruleSetId, `condition-sets/${draft.id}`)
          : ruleSetPath(ruleSetId, "condition-sets"),
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
          : new ApiError(0, "unknown", "Could not save this condition."),
      );
    } finally {
      setSaving(false);
    }
  }
  async function evaluate() {
    if (!existing) return;
    setEvaluationError(null);
    setEvaluation(null);
    try {
      setEvaluation(
        await api<ConditionEvaluation>(
          ruleSetPath(ruleSetId, `condition-sets/${draft.id}/evaluate`),
          {
            method: "POST",
            ...jsonBody({
              arguments: draft.parameters.map((parameter) => ({
                parameter_id: parameter.id,
                entity_ids: bindings[parameter.id] ?? [],
              })),
            }),
          },
        ),
      );
    } catch (reason) {
      setEvaluationError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not evaluate this condition."),
      );
    }
  }

  async function duplicate() {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await api<ConditionSet>(
          ruleSetPath(ruleSetId, `condition-sets/${draft.id}/duplicate`),
          {
            method: "POST",
          },
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not duplicate this condition."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor-stack">
      <Panel
        title={
          existing ? draft.name || "Untitled condition" : "New condition set"
        }
        description="Editing a shared set changes every future invocation that references it."
        actions={
          <>
            <StatusBadge tone={draft.archived ? "neutral" : "good"}>
              {draft.archived ? "Archived" : "Active"}
            </StatusBadge>
            {existing ? (
              <button
                className="button-secondary"
                type="button"
                disabled={saving}
                onClick={() => void duplicate()}
              >
                Duplicate
              </button>
            ) : null}
          </>
        }
      >
        <div className="form-grid">
          <Field label="Name" required>
            <input
              value={draft.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                editor.setDraft({
                  ...draft,
                  name,
                  key:
                    draft.key === slugify(draft.name)
                      ? slugify(name)
                      : draft.key,
                });
              }}
            />
          </Field>
          <Field label="Stable key" required>
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
      </Panel>
      <Panel
        title="Parameters"
        description="A reusable condition reads declared singular or plural inputs. Bound entities must implement every required schema."
      >
        <div className="collection-stack">
          {draft.parameters.map((parameter, index) => (
            <div className="nested-card" key={parameter.id}>
              <div className="nested-card-head">
                <h3>Parameter {index + 1}</h3>
                <OrderedActions
                  index={index}
                  count={draft.parameters.length}
                  label={`parameter ${index + 1}`}
                  onMove={(direction) =>
                    editor.setDraft({
                      ...draft,
                      parameters: moveItem(draft.parameters, index, direction),
                    })
                  }
                  onRemove={() =>
                    editor.setDraft({
                      ...draft,
                      parameters: draft.parameters.filter(
                        (item) => item.id !== parameter.id,
                      ),
                    })
                  }
                />
              </div>
              <div className="form-grid">
                <Field label="Label" required>
                  <input
                    value={parameter.label}
                    onChange={(event) =>
                      updateParameter(editor.setDraft, draft, parameter.id, {
                        label: event.currentTarget.value,
                      })
                    }
                  />
                </Field>
                <Field label="Stable key" required>
                  <input
                    value={parameter.key}
                    onChange={(event) =>
                      updateParameter(editor.setDraft, draft, parameter.id, {
                        key: event.currentTarget.value,
                      })
                    }
                  />
                </Field>
              </div>
              <ModeGroup
                legend="Parameter cardinality"
                value={parameter.cardinality}
                options={[
                  {
                    value: "one",
                    label: "One entity",
                    description: "Criteria use singular quantification.",
                  },
                  {
                    value: "many",
                    label: "Many entities",
                    description:
                      "Every criterion chooses any, all, or at least.",
                  },
                ]}
                onChange={(cardinality) =>
                  updateParameter(editor.setDraft, draft, parameter.id, {
                    cardinality,
                  })
                }
              />
              <CheckPicker
                legend="Required owner schemas"
                help="Every bound entity must implement all selected schemas."
                options={schemas.map((schema) => ({
                  id: schema.id,
                  label: schema.label,
                  description: schema.key,
                  disabled:
                    schema.archived &&
                    !parameter.required_owner_schema_ids.includes(schema.id),
                }))}
                selected={parameter.required_owner_schema_ids}
                onChange={(required_owner_schema_ids) =>
                  updateParameter(editor.setDraft, draft, parameter.id, {
                    required_owner_schema_ids,
                  })
                }
              />
            </div>
          ))}
        </div>
        {draft.parameters.length === 0 ? (
          <p className="quiet-empty">
            Add at least one parameter before creating criteria.
          </p>
        ) : null}
        <button
          className="button-secondary"
          type="button"
          onClick={() =>
            editor.setDraft({
              ...draft,
              parameters: [
                ...draft.parameters,
                {
                  id: crypto.randomUUID(),
                  key: "",
                  label: "",
                  cardinality: "one",
                  required_owner_schema_ids: [],
                },
              ],
            })
          }
        >
          + Add parameter
        </button>
      </Panel>
      <Panel
        title="Expression tree"
        description="Groups preserve authored order. Node IDs remain stable through movement and reordering."
      >
        <ConditionNodeEditor
          node={draft.root}
          parameters={draft.parameters}
          variables={variables}
          onChange={(root) => editor.setDraft({ ...draft, root })}
          root
        />
        <div className="summary-block">
          <p className="eyebrow">Readable summary</p>
          <p>{summarizeCondition(draft.root, draft.parameters, variables)}</p>
        </div>
      </Panel>
      <Panel
        title="Try this condition"
        description="Evaluation is read-only and binds every parameter directly to concrete entities."
      >
        {!existing ? (
          <p className="quiet-note">
            Save the condition once before evaluating it.
          </p>
        ) : (
          draft.parameters.map((parameter) => {
            const eligible = entities.filter((entity) =>
              parameter.required_owner_schema_ids.every((id) =>
                entity.owner_schema_ids.includes(id),
              ),
            );
            return (
              <CheckPicker
                key={parameter.id}
                legend={parameter.label || "Untitled parameter"}
                help={
                  parameter.cardinality === "one"
                    ? "Select exactly one eligible entity."
                    : "Select an ordered set of eligible entities."
                }
                options={eligible.map((entity) => ({
                  id: entity.id,
                  label: entity.display_name,
                  description: entity.key,
                }))}
                selected={bindings[parameter.id] ?? []}
                onChange={(ids) =>
                  setBindings({
                    ...bindings,
                    [parameter.id]:
                      parameter.cardinality === "one" ? ids.slice(-1) : ids,
                  })
                }
              />
            );
          })
        )}
        {existing ? (
          <button type="button" onClick={() => void evaluate()}>
            Evaluate current state
          </button>
        ) : null}
        {evaluationError === null ? null : (
          <p className="form-error" role="alert">
            {evaluationError.message}
          </p>
        )}
        {evaluation === null ? null : (
          <EvaluationResult evaluation={evaluation} />
        )}
      </Panel>
      <Panel title="Lifecycle">
        <ModeGroup
          legend="Condition status"
          value={draft.archived ? "archived" : "active"}
          options={[
            {
              value: "active",
              label: "Active",
              description: "May be selected for new invocations.",
            },
            {
              value: "archived",
              label: "Archived",
              description: "Existing invocations remain valid.",
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
        noun="condition changes"
      />
    </div>
  );
}

function updateParameter(
  setDraft: (value: ConditionSet) => void,
  draft: ConditionSet,
  id: string,
  update: Partial<ConditionParameter>,
) {
  setDraft({
    ...draft,
    parameters: draft.parameters.map((item) =>
      item.id === id ? { ...item, ...update } : item,
    ),
  });
}

function ConditionNodeEditor({
  node,
  parameters,
  variables,
  onChange,
  onRemove,
  root = false,
}: {
  node: ConditionExpression;
  parameters: ConditionParameter[];
  variables: StateVariableDefinition[];
  onChange: (node: ConditionExpression) => void;
  onRemove?: (() => void) | undefined;
  root?: boolean | undefined;
}) {
  if (node.type === "criterion")
    return (
      <CriterionEditor
        node={node}
        parameters={parameters}
        variables={variables}
        onChange={onChange}
        onRemove={onRemove}
        root={root}
      />
    );
  const children = node.children;
  const criterionSeed = parameters
    .map((parameter) => ({
      parameter,
      variable: compatibleVariables(parameter, variables)[0],
    }))
    .find((candidate) => candidate.variable !== undefined);
  return (
    <div className={`condition-node group-node ${root ? "root-node" : ""}`}>
      <div className="node-head">
        <span className="node-kind">{root ? "Root group" : "Group"}</span>
        <select
          aria-label="Group operator"
          value={node.type}
          onChange={(event) => {
            const type = event.currentTarget.value as
              "all" | "any" | "at-least";
            onChange(
              type === "at-least"
                ? { id: node.id, type, count: 1, children }
                : { id: node.id, type, children },
            );
          }}
        >
          <option value="all">All conditions</option>
          <option value="any">Any condition</option>
          <option value="at-least">At least N</option>
        </select>
        {node.type === "at-least" ? (
          <label className="compact-input">
            Count
            <input
              type="number"
              min={1}
              max={Math.max(1, children.length)}
              value={node.count}
              onChange={(event) =>
                onChange({
                  ...node,
                  count: event.currentTarget.valueAsNumber || 1,
                })
              }
            />
          </label>
        ) : null}
        {root || onRemove === undefined ? null : (
          <button
            className="icon-button danger-text"
            type="button"
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <div className="node-children">
        {children.map((child, index) => (
          <div className="node-child" key={child.id}>
            <ConditionNodeEditor
              node={child}
              parameters={parameters}
              variables={variables}
              onChange={(next) =>
                onChange({
                  ...node,
                  children: children.map((item, itemIndex) =>
                    itemIndex === index ? next : item,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...node,
                  children: children.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            />
            <OrderedActions
              index={index}
              count={children.length}
              label={`condition ${index + 1}`}
              onMove={(direction) =>
                onChange({
                  ...node,
                  children: moveItem(children, index, direction),
                })
              }
              onRemove={() =>
                onChange({
                  ...node,
                  children: children.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                })
              }
            />
          </div>
        ))}
      </div>
      {children.length === 0 ? (
        <p className="quiet-empty">
          Groups need at least one child before saving.
        </p>
      ) : null}
      <div className="compact-actions">
        <button
          className="button-secondary"
          type="button"
          disabled={criterionSeed === undefined}
          onClick={() => {
            const parameter = criterionSeed?.parameter;
            const variable = criterionSeed?.variable;
            if (parameter === undefined || variable === undefined) return;
            onChange({
              ...node,
              children: [
                ...children,
                {
                  id: crypto.randomUUID(),
                  type: "criterion",
                  parameter_id: parameter.id,
                  quantifier:
                    parameter.cardinality === "one" ? "single" : "any",
                  state_variable_id: variable.id,
                  predicate: defaultPredicate(variable.value_schema),
                },
              ],
            });
          }}
        >
          + Criterion
        </button>
        <button
          className="button-secondary"
          type="button"
          onClick={() =>
            onChange({
              ...node,
              children: [
                ...children,
                { id: crypto.randomUUID(), type: "all", children: [] },
              ],
            })
          }
        >
          + Group
        </button>
      </div>
    </div>
  );
}

function CriterionEditor({
  node,
  parameters,
  variables,
  onChange,
  onRemove,
  root,
}: {
  node: Extract<ConditionExpression, { type: "criterion" }>;
  parameters: ConditionParameter[];
  variables: StateVariableDefinition[];
  onChange: (node: ConditionExpression) => void;
  onRemove?: (() => void) | undefined;
  root: boolean;
}) {
  const parameter =
    parameters.find((item) => item.id === node.parameter_id) ?? parameters[0];
  const compatible = compatibleVariables(
    parameter,
    variables,
    node.state_variable_id,
  );
  const variable =
    compatible.find((item) => item.id === node.state_variable_id) ??
    compatible[0];
  return (
    <div className={`condition-node criterion-node ${root ? "root-node" : ""}`}>
      <div className="node-head">
        <span className="node-kind">Criterion</span>
        {root || onRemove === undefined ? null : (
          <button
            className="icon-button danger-text"
            type="button"
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <div className="criterion-grid">
        <Field label="Parameter">
          <select
            value={parameter?.id ?? ""}
            onChange={(event) => {
              const nextParameter = parameters.find(
                (item) => item.id === event.currentTarget.value,
              );
              const nextVariable = compatibleVariables(
                nextParameter,
                variables,
              )[0];
              if (nextParameter === undefined || nextVariable === undefined)
                return;
              onChange({
                id: node.id,
                type: "criterion",
                parameter_id: nextParameter.id,
                quantifier:
                  nextParameter.cardinality === "one" ? "single" : "any",
                state_variable_id: nextVariable.id,
                predicate: defaultPredicate(nextVariable.value_schema),
              });
            }}
          >
            {parameters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || item.key || "Untitled"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="State variable">
          <select
            value={variable?.id ?? ""}
            onChange={(event) => {
              const next = variables.find(
                (item) => item.id === event.currentTarget.value,
              );
              if (next !== undefined)
                onChange({
                  ...node,
                  state_variable_id: next.id,
                  predicate: defaultPredicate(next.value_schema),
                });
            }}
          >
            {compatible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        {parameter?.cardinality === "many" ? (
          <Field label="Quantifier">
            <select
              value={node.quantifier}
              onChange={(event) => {
                const quantifier = event.currentTarget.value as
                  "any" | "all" | "at-least";
                if (quantifier === "at-least")
                  onChange({ ...node, quantifier, count: node.count ?? 1 });
                else {
                  onChange({
                    id: node.id,
                    type: "criterion",
                    parameter_id: node.parameter_id,
                    quantifier,
                    state_variable_id: node.state_variable_id,
                    predicate: node.predicate,
                  });
                }
              }}
            >
              <option value="any">Any entity</option>
              <option value="all">All entities</option>
              <option value="at-least">At least N entities</option>
            </select>
          </Field>
        ) : (
          <Field label="Quantifier">
            <input value="Single entity" readOnly />
          </Field>
        )}
        {node.quantifier === "at-least" ? (
          <Field label="Required count">
            <input
              type="number"
              min={1}
              value={node.count ?? 1}
              onChange={(event) =>
                onChange({
                  ...node,
                  count: event.currentTarget.valueAsNumber || 1,
                })
              }
            />
          </Field>
        ) : null}
      </div>
      {variable === undefined ? (
        <p className="form-error">
          No condition-addressable variable is compatible with this parameter.
        </p>
      ) : (
        <PredicateEditor
          predicate={node.predicate}
          variable={variable}
          onChange={(predicate) => onChange({ ...node, predicate })}
        />
      )}
    </div>
  );
}

function compatibleVariables(
  parameter: ConditionParameter | undefined,
  variables: StateVariableDefinition[],
  retainedVariableId?: string,
) {
  if (parameter === undefined) return [];
  return variables.filter(
    (variable) =>
      (!variable.archived || variable.id === retainedVariableId) &&
      variable.condition_addressable &&
      variable.cardinality === "one" &&
      parameter.required_owner_schema_ids.some((id) =>
        variable.owner_schema_ids.includes(id),
      ),
  );
}

function PredicateEditor({
  predicate,
  variable,
  onChange,
}: {
  predicate: Predicate;
  variable: StateVariableDefinition;
  onChange: (value: Predicate) => void;
}) {
  if (variable.value_schema.kind === "number") {
    const operator =
      predicate.kind === "number-range"
        ? "between"
        : predicate.kind === "number"
          ? predicate.operator
          : "eq";
    return (
      <fieldset className="predicate-editor">
        <legend>Number predicate</legend>
        <Field label="Operator">
          <select
            value={operator}
            onChange={(event) => {
              const next = event.currentTarget.value;
              onChange(
                next === "between"
                  ? {
                      kind: "number-range",
                      operator: "between",
                      minimum: 0,
                      maximum: 0,
                    }
                  : {
                      kind: "number",
                      operator: next as "eq" | "gt" | "gte" | "lt" | "lte",
                      value: 0,
                    },
              );
            }}
          >
            <option value="eq">Equals</option>
            <option value="gt">Greater than</option>
            <option value="gte">At least</option>
            <option value="lt">Less than</option>
            <option value="lte">At most</option>
            <option value="between">Between, inclusive</option>
          </select>
        </Field>
        {predicate.kind === "number-range" ? (
          <div className="form-grid">
            <Field label="Minimum">
              <input
                type="number"
                value={predicate.minimum}
                onChange={(event) =>
                  onChange({
                    ...predicate,
                    minimum: event.currentTarget.valueAsNumber || 0,
                  })
                }
              />
            </Field>
            <Field label="Maximum">
              <input
                type="number"
                value={predicate.maximum}
                onChange={(event) =>
                  onChange({
                    ...predicate,
                    maximum: event.currentTarget.valueAsNumber || 0,
                  })
                }
              />
            </Field>
          </div>
        ) : (
          <Field label="Operand">
            <input
              type="number"
              value={predicate.kind === "number" ? predicate.value : 0}
              onChange={(event) =>
                onChange({
                  kind: "number",
                  operator:
                    predicate.kind === "number" ? predicate.operator : "eq",
                  value: event.currentTarget.valueAsNumber || 0,
                })
              }
            />
          </Field>
        )}
      </fieldset>
    );
  }
  if (variable.value_schema.kind === "boolean")
    return (
      <ModeGroup
        legend={`Require ${variable.label}`}
        value={
          predicate.kind === "boolean" && predicate.value ? "true" : "false"
        }
        options={[
          { value: "true", label: "True" },
          { value: "false", label: "False" },
        ]}
        onChange={(value) =>
          onChange({ kind: "boolean", operator: "is", value: value === "true" })
        }
      />
    );
  if (variable.value_schema.kind === "choice") {
    const many = predicate.kind === "choice-set";
    return (
      <fieldset className="predicate-editor">
        <legend>Choice predicate</legend>
        <ModeGroup
          legend="Match mode"
          value={many ? "one-of" : "is"}
          options={[
            { value: "is", label: "Is one option" },
            { value: "one-of", label: "Is one of several" },
          ]}
          onChange={(value) =>
            onChange(
              value === "is"
                ? {
                    kind: "choice",
                    operator: "is",
                    value:
                      variable.value_schema.kind === "choice"
                        ? (variable.value_schema.options[0]?.key ?? "")
                        : "",
                  }
                : { kind: "choice-set", operator: "one-of", values: [] },
            )
          }
        />
        {many ? (
          <CheckPicker
            legend="Accepted options"
            options={variable.value_schema.options.map((option) => ({
              id: option.key,
              label: option.label,
              description: option.key,
            }))}
            selected={predicate.values}
            onChange={(values) => onChange({ ...predicate, values })}
          />
        ) : (
          <Field label="Required option">
            <select
              value={predicate.kind === "choice" ? predicate.value : ""}
              onChange={(event) =>
                onChange({
                  kind: "choice",
                  operator: "is",
                  value: event.currentTarget.value,
                })
              }
            >
              {variable.value_schema.options.map((option) => (
                <option key={option.id} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </fieldset>
    );
  }
  return null;
}

function EvaluationResult({ evaluation }: { evaluation: ConditionEvaluation }) {
  const tone =
    evaluation.status === "met"
      ? "good"
      : evaluation.status === "unknown"
        ? "warn"
        : "bad";
  return (
    <div className="evaluation-result">
      <StatusBadge tone={tone}>{evaluation.status}</StatusBadge>
      <p>{evaluation.root.message}</p>
      {evaluation.missing_values.length === 0 ? null : (
        <p className="field-hint">
          {evaluation.missing_values.length} missing state address
          {evaluation.missing_values.length === 1 ? "" : "es"} made this
          evaluation incomplete.
        </p>
      )}
    </div>
  );
}
