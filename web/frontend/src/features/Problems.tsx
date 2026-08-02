import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type {
  ChoiceDefinition,
  ChoiceOutcome,
  ConditionInvocation,
  ConditionSet,
  Entity,
  OwnerSchema,
  ProblemDefinition,
  ProblemTargetDefinition,
  StateEffect,
  StateVariableDefinition,
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
import { duplicateChoiceDefinition } from "../domain/problemDrafts";
import {
  compatibleEffectOperations,
  defaultScalar,
  defaultStateValue,
  effectOperationLabels,
  slugify,
} from "../domain/options";
import { useCollection } from "../hooks/useCollection";
import { useDraft } from "../hooks/useDraft";

function makeOutcome(label: string): ChoiceOutcome {
  return {
    id: crypto.randomUUID(),
    label,
    consequences: { id: crypto.randomUUID(), effects: [] },
  };
}
function makeChoice(): ChoiceDefinition {
  return {
    id: crypto.randomUUID(),
    key: "",
    name: "",
    description: "",
    resolution: { type: "automatic", outcome: makeOutcome("Outcome") },
  };
}
function newProblem(): ProblemDefinition {
  return {
    id: "",
    key: "",
    name: "",
    description: "",
    instance_owner_schema_ids: [],
    targets: [],
    choices: [makeChoice()],
    archived: false,
  };
}
function newTarget(): ProblemTargetDefinition {
  return {
    id: crypto.randomUUID(),
    key: "",
    label: "",
    description: "",
    cardinality: "one",
    minimum_bindings: 1,
    maximum_bindings: 1,
    binding_source: "supplied",
    required_owner_schema_ids: [],
  };
}

export function Problems({ ruleSetId }: { ruleSetId: string }) {
  const collection = useCollection<ProblemDefinition>(
    ruleSetPath(ruleSetId, "problem-definitions"),
  );
  const schemas = useCollection<OwnerSchema>(
    ruleSetPath(ruleSetId, "owner-schemas"),
  );
  const variables = useCollection<StateVariableDefinition>(
    ruleSetPath(ruleSetId, "state-variable-definitions"),
  );
  const conditions = useCollection<ConditionSet>(
    ruleSetPath(ruleSetId, "condition-sets"),
  );
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const [selected, setSelected] = useState<ProblemDefinition | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Define / 04"
        title="Problems and choices"
        description="Declare target slots, map reusable conditions, and order every consequence without assuming a privileged actor."
      />
      <ResourceWorkspace
        title="Problem library"
        items={collection.items}
        selectedId={selected?.id ?? null}
        getId={(item) => item.id}
        getTitle={(item) => item.name}
        getMeta={(item) =>
          `${item.targets.length} targets · ${item.choices.length} choices`
        }
        isArchived={(item) => item.archived}
        loading={collection.loading}
        error={collection.error}
        onRetry={collection.reload}
        onSelect={setSelected}
        onCreate={() => setSelected(newProblem())}
        createLabel="Problem"
        emptyTitle="No problem definitions"
        emptyDescription="Compose a reusable transition context with explicit targets and at least one choice."
      >
        {selected === null ? (
          <EmptyState
            title="Choose a problem"
            description="Select a definition or create one to configure targets, availability, choices, outcomes, and effects."
          />
        ) : (
          <ProblemEditor
            key={selected.id || "new"}
            source={selected}
            ruleSetId={ruleSetId}
            schemas={schemas.items}
            variables={variables.items}
            conditions={conditions.items}
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

function ProblemEditor({
  source,
  ruleSetId,
  schemas,
  variables,
  conditions,
  entities,
  onSaved,
}: {
  source: ProblemDefinition;
  ruleSetId: string;
  schemas: OwnerSchema[];
  variables: StateVariableDefinition[];
  conditions: ConditionSet[];
  entities: Entity[];
  onSaved: (value: ProblemDefinition) => void;
}) {
  const editor = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const draft = editor.draft;
  const existing = draft.id !== "";
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<ProblemDefinition>(
        existing
          ? ruleSetPath(ruleSetId, `problem-definitions/${draft.id}`)
          : ruleSetPath(ruleSetId, "problem-definitions"),
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
          : new ApiError(0, "unknown", "Could not save this problem."),
      );
    } finally {
      setSaving(false);
    }
  }
  async function duplicate() {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await api<ProblemDefinition>(
          ruleSetPath(ruleSetId, `problem-definitions/${draft.id}/duplicate`),
          { method: "POST" },
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not duplicate this problem."),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="editor-stack">
      <Panel
        title={
          existing ? draft.name || "Untitled problem" : "New problem definition"
        }
        description="Definition edits affect future resolution for every existing instance."
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
        <CheckPicker
          legend="Instance owner-schema template"
          help="These memberships are copied only when a new instance entity is created. Empty is valid."
          options={schemas.map((schema) => ({
            id: schema.id,
            label: schema.label,
            description: schema.key,
            disabled:
              schema.archived &&
              !draft.instance_owner_schema_ids.includes(schema.id),
          }))}
          selected={draft.instance_owner_schema_ids}
          onChange={(instance_owner_schema_ids) =>
            editor.setDraft({ ...draft, instance_owner_schema_ids })
          }
        />
      </Panel>
      <Panel
        title="Target definitions"
        description="Targets name the explicit entity slots conditions read and effects change."
      >
        <div className="collection-stack">
          {draft.targets.map((target, index) => (
            <TargetEditor
              key={target.id}
              target={target}
              index={index}
              count={draft.targets.length}
              schemas={schemas}
              instanceSchemas={draft.instance_owner_schema_ids}
              hasInstanceTarget={draft.targets.some(
                (item) =>
                  item.binding_source === "problem-instance" &&
                  item.id !== target.id,
              )}
              onChange={(next) =>
                editor.setDraft({
                  ...draft,
                  targets: draft.targets.map((item) =>
                    item.id === target.id ? next : item,
                  ),
                })
              }
              onMove={(direction) =>
                editor.setDraft({
                  ...draft,
                  targets: moveItem(draft.targets, index, direction),
                })
              }
              onRemove={() =>
                editor.setDraft({
                  ...draft,
                  targets: draft.targets.filter(
                    (item) => item.id !== target.id,
                  ),
                })
              }
            />
          ))}
        </div>
        {draft.targets.length === 0 ? (
          <p className="quiet-empty">
            Add explicit targets before mapping conditions or effects.
          </p>
        ) : null}
        <button
          className="button-secondary"
          type="button"
          onClick={() =>
            editor.setDraft({
              ...draft,
              targets: [...draft.targets, newTarget()],
            })
          }
        >
          + Add target
        </button>
      </Panel>
      <Panel
        title="Problem availability"
        description="Availability answers whether any choice may be selected. Unknown state makes the problem incomplete."
      >
        <InvocationEditor
          label="Problem is available"
          invocation={draft.available_when}
          conditions={conditions}
          targets={draft.targets}
          onChange={(available_when) =>
            editor.setDraft({ ...draft, available_when })
          }
        />
      </Panel>
      <Panel
        title="Choices"
        description="Availability and resolution are deliberately separate: a fallible attempt can remain selectable."
      >
        <div className="collection-stack">
          {draft.choices.map((choice, index) => (
            <ChoiceEditor
              key={choice.id}
              choice={choice}
              index={index}
              count={draft.choices.length}
              targets={draft.targets}
              conditions={conditions}
              variables={variables}
              entities={entities}
              onChange={(next) =>
                editor.setDraft({
                  ...draft,
                  choices: draft.choices.map((item) =>
                    item.id === choice.id ? next : item,
                  ),
                })
              }
              onMove={(direction) =>
                editor.setDraft({
                  ...draft,
                  choices: moveItem(draft.choices, index, direction),
                })
              }
              onDuplicate={() => {
                const choices = [...draft.choices];
                choices.splice(
                  index + 1,
                  0,
                  duplicateChoiceDefinition(choice, draft.choices),
                );
                editor.setDraft({ ...draft, choices });
              }}
              onRemove={() =>
                editor.setDraft({
                  ...draft,
                  choices: draft.choices.filter(
                    (item) => item.id !== choice.id,
                  ),
                })
              }
            />
          ))}
        </div>
        <button
          className="button-secondary"
          type="button"
          onClick={() =>
            editor.setDraft({
              ...draft,
              choices: [...draft.choices, makeChoice()],
            })
          }
        >
          + Add choice
        </button>
      </Panel>
      <Panel title="Lifecycle">
        <ModeGroup
          legend="Problem status"
          value={draft.archived ? "archived" : "active"}
          options={[
            {
              value: "active",
              label: "Active",
              description: "May create new problem instances.",
            },
            {
              value: "archived",
              label: "Archived",
              description: "Existing instances remain valid.",
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
        noun="problem changes"
      />
    </div>
  );
}

function TargetEditor({
  target,
  index,
  count,
  schemas,
  instanceSchemas,
  hasInstanceTarget,
  onChange,
  onMove,
  onRemove,
}: {
  target: ProblemTargetDefinition;
  index: number;
  count: number;
  schemas: OwnerSchema[];
  instanceSchemas: string[];
  hasInstanceTarget: boolean;
  onChange: (target: ProblemTargetDefinition) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="nested-card">
      <div className="nested-card-head">
        <div>
          <span className="eyebrow">Target {index + 1}</span>
          <h3>{target.label || "Untitled target"}</h3>
        </div>
        <OrderedActions
          index={index}
          count={count}
          label={`target ${index + 1}`}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <div className="form-grid">
        <Field label="Label" required>
          <input
            value={target.label}
            onChange={(event) =>
              onChange({ ...target, label: event.currentTarget.value })
            }
          />
        </Field>
        <Field label="Stable key" required>
          <input
            value={target.key}
            onChange={(event) =>
              onChange({ ...target, key: event.currentTarget.value })
            }
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          value={target.description ?? ""}
          onChange={(event) =>
            onChange({ ...target, description: event.currentTarget.value })
          }
        />
      </Field>
      <ModeGroup
        legend="Binding source"
        value={target.binding_source}
        options={[
          {
            value: "supplied",
            label: "Supplied explicitly",
            description: "Authors choose concrete entities on each instance.",
          },
          {
            value: "problem-instance",
            label: "Problem instance itself",
            description:
              "Automatically binds this target to the instance entity.",
            disabled: hasInstanceTarget,
          },
        ]}
        onChange={(binding_source) =>
          onChange(
            binding_source === "problem-instance"
              ? {
                  ...target,
                  binding_source,
                  cardinality: "one",
                  minimum_bindings: 1,
                  maximum_bindings: 1,
                  required_owner_schema_ids:
                    target.required_owner_schema_ids.filter((id) =>
                      instanceSchemas.includes(id),
                    ),
                }
              : { ...target, binding_source },
          )
        }
      />
      <ModeGroup
        legend="Target cardinality"
        value={target.cardinality}
        options={[
          {
            value: "one",
            label: "One entity",
            description: "At most one binding.",
          },
          {
            value: "many",
            label: "Many entities",
            description: "An ordered set of distinct bindings.",
            disabled: target.binding_source === "problem-instance",
          },
        ]}
        onChange={(cardinality) =>
          onChange(
            cardinality === "one"
              ? {
                  ...target,
                  cardinality,
                  minimum_bindings: Math.min(target.minimum_bindings, 1),
                  maximum_bindings: 1,
                }
              : { ...target, cardinality, maximum_bindings: undefined },
          )
        }
      />
      <div className="constraint-grid">
        <Field label="Minimum bindings">
          <input
            type="number"
            min={0}
            max={target.cardinality === "one" ? 1 : undefined}
            value={target.minimum_bindings}
            onChange={(event) =>
              onChange({
                ...target,
                minimum_bindings: event.currentTarget.valueAsNumber || 0,
              })
            }
          />
        </Field>
        <ModeGroup
          legend="Maximum bindings"
          value={
            target.maximum_bindings === undefined ? "unlimited" : "limited"
          }
          options={[
            {
              value: "unlimited",
              label: "No maximum",
              disabled: target.cardinality === "one",
            },
            { value: "limited", label: "Limit to N" },
          ]}
          onChange={(value) =>
            onChange({
              ...target,
              maximum_bindings:
                value === "unlimited"
                  ? undefined
                  : Math.max(
                      target.minimum_bindings,
                      target.maximum_bindings ?? 1,
                    ),
            })
          }
        />
        {target.maximum_bindings === undefined ? null : (
          <Field label="Maximum count">
            <input
              type="number"
              min={target.minimum_bindings}
              max={target.cardinality === "one" ? 1 : undefined}
              value={target.maximum_bindings}
              onChange={(event) =>
                onChange({
                  ...target,
                  maximum_bindings:
                    event.currentTarget.valueAsNumber ||
                    target.minimum_bindings,
                })
              }
            />
          </Field>
        )}
      </div>
      <CheckPicker
        legend="Required owner schemas"
        help="Every bound entity must implement all selected schemas. A target needs at least one before a condition or effect may use it."
        options={schemas.map((schema) => ({
          id: schema.id,
          label: schema.label,
          description:
            target.binding_source === "problem-instance" &&
            !instanceSchemas.includes(schema.id)
              ? "Not in the instance template"
              : schema.key,
          disabled:
            (schema.archived &&
              !target.required_owner_schema_ids.includes(schema.id)) ||
            (target.binding_source === "problem-instance" &&
              !instanceSchemas.includes(schema.id)),
        }))}
        selected={target.required_owner_schema_ids}
        onChange={(required_owner_schema_ids) =>
          onChange({ ...target, required_owner_schema_ids })
        }
      />
    </div>
  );
}

function InvocationEditor({
  label,
  invocation,
  conditions,
  targets,
  onChange,
}: {
  label: string;
  invocation: ConditionInvocation | undefined;
  conditions: ConditionSet[];
  targets: ProblemTargetDefinition[];
  onChange: (value: ConditionInvocation | undefined) => void;
}) {
  const condition =
    conditions.find((item) => item.id === invocation?.condition_set_id) ??
    conditions.find((item) => !item.archived);
  function selectCondition(conditionId: string) {
    const next = conditions.find((item) => item.id === conditionId);
    if (next === undefined) return;
    onChange({
      id: invocation?.id ?? crypto.randomUUID(),
      condition_set_id: next.id,
      arguments: next.parameters.map((parameter) => ({
        parameter_id: parameter.id,
        target_definition_id:
          compatibleTargets(parameter, targets)[0]?.id ?? "",
      })),
    });
  }
  return (
    <div className="invocation-editor">
      <ModeGroup
        legend={label}
        value={invocation === undefined ? "always" : "condition"}
        options={[
          {
            value: "always",
            label: "Always",
            description: "No prerequisite condition.",
          },
          {
            value: "condition",
            label: "Use a condition",
            description:
              "Met permits the action; unmet blocks it; unknown is incomplete.",
            disabled: conditions.filter((item) => !item.archived).length === 0,
          },
        ]}
        onChange={(value) => {
          if (value === "always") onChange(undefined);
          else {
            const first = conditions.find((item) => !item.archived);
            if (first !== undefined) selectCondition(first.id);
          }
        }}
      />
      {invocation === undefined ? null : (
        <>
          <Field label="Condition set">
            <select
              value={invocation.condition_set_id}
              onChange={(event) => selectCondition(event.currentTarget.value)}
            >
              {conditions
                .filter(
                  (item) =>
                    !item.archived || item.id === invocation.condition_set_id,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </Field>
          {condition?.parameters.map((parameter) => {
            const argument = invocation.arguments.find(
              (item) => item.parameter_id === parameter.id,
            );
            const compatible = compatibleTargets(parameter, targets);
            return (
              <Field
                key={parameter.id}
                label={`Map “${parameter.label}” to`}
                hint={`${parameter.cardinality}; requires every declared schema`}
              >
                <select
                  value={argument?.target_definition_id ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...invocation,
                      arguments: invocation.arguments.map((item) =>
                        item.parameter_id === parameter.id
                          ? {
                              ...item,
                              target_definition_id: event.currentTarget.value,
                            }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="">Choose a compatible target</option>
                  {compatible.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label || target.key}
                    </option>
                  ))}
                </select>
              </Field>
            );
          })}
        </>
      )}
    </div>
  );
}

function compatibleTargets(
  parameter: ConditionSet["parameters"][number],
  targets: ProblemTargetDefinition[],
) {
  return targets.filter(
    (target) =>
      target.cardinality === parameter.cardinality &&
      parameter.required_owner_schema_ids.every((id) =>
        target.required_owner_schema_ids.includes(id),
      ),
  );
}

function ChoiceEditor({
  choice,
  index,
  count,
  targets,
  conditions,
  variables,
  entities,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  choice: ChoiceDefinition;
  index: number;
  count: number;
  targets: ProblemTargetDefinition[];
  conditions: ConditionSet[];
  variables: StateVariableDefinition[];
  entities: Entity[];
  onChange: (value: ChoiceDefinition) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="choice-card">
      <div className="nested-card-head">
        <div>
          <span className="eyebrow">Choice {index + 1}</span>
          <h3>{choice.name || "Untitled choice"}</h3>
        </div>
        <div className="compact-actions">
          <button
            className="button-secondary"
            type="button"
            onClick={onDuplicate}
          >
            Duplicate choice
          </button>
          <OrderedActions
            index={index}
            count={count}
            label={`choice ${index + 1}`}
            onMove={onMove}
            onRemove={onRemove}
          />
        </div>
      </div>
      <div className="form-grid">
        <Field label="Choice name" required>
          <input
            value={choice.name}
            onChange={(event) =>
              onChange({ ...choice, name: event.currentTarget.value })
            }
          />
        </Field>
        <Field label="Stable key" required>
          <input
            value={choice.key}
            onChange={(event) =>
              onChange({ ...choice, key: event.currentTarget.value })
            }
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          value={choice.description ?? ""}
          onChange={(event) =>
            onChange({ ...choice, description: event.currentTarget.value })
          }
        />
      </Field>
      <div className="semantic-split">
        <div>
          <h4>Available when</h4>
          <p>Controls whether this choice can be selected.</p>
          <InvocationEditor
            label="Choice availability"
            invocation={choice.available_when}
            conditions={conditions}
            targets={targets}
            onChange={(available_when) =>
              onChange({ ...choice, available_when })
            }
          />
        </div>
        <div>
          <h4>When chosen, resolve</h4>
          <p>Selects the outcome after an available choice is selected.</p>
          <ModeGroup
            legend="Resolution mode"
            value={choice.resolution.type}
            options={[
              {
                value: "automatic",
                label: "Automatic outcome",
                description: "Always selects the single configured outcome.",
              },
              {
                value: "condition",
                label: "Test a condition",
                description: "Met and unmet select explicit separate outcomes.",
              },
            ]}
            onChange={(type) =>
              onChange({
                ...choice,
                resolution:
                  type === "automatic"
                    ? { type: "automatic", outcome: makeOutcome("Outcome") }
                    : {
                        type: "condition",
                        invocation: emptyInvocation(conditions, targets),
                        met: makeOutcome("Met outcome"),
                        unmet: makeOutcome("Unmet outcome"),
                      },
              })
            }
          />
        </div>
      </div>
      {choice.resolution.type === "automatic" ? (
        <OutcomeEditor
          branch="Automatic outcome"
          outcome={choice.resolution.outcome}
          targets={targets}
          variables={variables}
          entities={entities}
          onChange={(outcome) =>
            onChange({ ...choice, resolution: { type: "automatic", outcome } })
          }
        />
      ) : (
        <>
          <Panel className="inset-panel" title="When chosen, test">
            <InvocationEditor
              label="Resolution condition"
              invocation={choice.resolution.invocation}
              conditions={conditions}
              targets={targets}
              onChange={(invocation) => {
                if (
                  invocation !== undefined &&
                  choice.resolution.type === "condition"
                )
                  onChange({
                    ...choice,
                    resolution: { ...choice.resolution, invocation },
                  });
              }}
            />
          </Panel>
          <div className="outcome-grid">
            <OutcomeEditor
              branch="Met outcome"
              outcome={choice.resolution.met}
              targets={targets}
              variables={variables}
              entities={entities}
              onChange={(met) => {
                if (choice.resolution.type === "condition")
                  onChange({
                    ...choice,
                    resolution: { ...choice.resolution, met },
                  });
              }}
            />
            <OutcomeEditor
              branch="Unmet outcome"
              outcome={choice.resolution.unmet}
              targets={targets}
              variables={variables}
              entities={entities}
              onChange={(unmet) => {
                if (choice.resolution.type === "condition")
                  onChange({
                    ...choice,
                    resolution: { ...choice.resolution, unmet },
                  });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function emptyInvocation(
  conditions: ConditionSet[],
  targets: ProblemTargetDefinition[],
): ConditionInvocation {
  const condition = conditions.find((item) => !item.archived);
  return {
    id: crypto.randomUUID(),
    condition_set_id: condition?.id ?? "",
    arguments:
      condition?.parameters.map((parameter) => ({
        parameter_id: parameter.id,
        target_definition_id:
          compatibleTargets(parameter, targets)[0]?.id ?? "",
      })) ?? [],
  };
}

function OutcomeEditor({
  branch,
  outcome,
  targets,
  variables,
  entities,
  onChange,
}: {
  branch: string;
  outcome: ChoiceOutcome;
  targets: ProblemTargetDefinition[];
  variables: StateVariableDefinition[];
  entities: Entity[];
  onChange: (value: ChoiceOutcome) => void;
}) {
  const effectSeed = targets
    .map((target) => ({
      target,
      variable: compatibleVariablesForTarget(target, variables)[0],
    }))
    .find((candidate) => candidate.variable !== undefined);
  return (
    <div className="outcome-card">
      <div className="outcome-head">
        <span className="eyebrow">{branch}</span>
        <Field label="Outcome label">
          <input
            value={outcome.label}
            onChange={(event) =>
              onChange({ ...outcome, label: event.currentTarget.value })
            }
          />
        </Field>
      </div>
      <h4>Ordered effects</h4>
      {outcome.consequences.effects.length === 0 ? (
        <p className="quiet-empty">This is an explicit no-effect outcome.</p>
      ) : null}
      <div className="collection-stack">
        {outcome.consequences.effects.map((effect, index) => (
          <EffectEditor
            key={effect.id}
            effect={effect}
            index={index}
            count={outcome.consequences.effects.length}
            targets={targets}
            variables={variables}
            entities={entities}
            onChange={(next) =>
              onChange({
                ...outcome,
                consequences: {
                  ...outcome.consequences,
                  effects: outcome.consequences.effects.map((item) =>
                    item.id === effect.id ? next : item,
                  ),
                },
              })
            }
            onMove={(direction) =>
              onChange({
                ...outcome,
                consequences: {
                  ...outcome.consequences,
                  effects: moveItem(
                    outcome.consequences.effects,
                    index,
                    direction,
                  ),
                },
              })
            }
            onRemove={() =>
              onChange({
                ...outcome,
                consequences: {
                  ...outcome.consequences,
                  effects: outcome.consequences.effects.filter(
                    (item) => item.id !== effect.id,
                  ),
                },
              })
            }
          />
        ))}
      </div>
      <button
        className="button-secondary"
        type="button"
        disabled={effectSeed === undefined}
        onClick={() => {
          const target = effectSeed?.target;
          const variable = effectSeed?.variable;
          if (target === undefined || variable === undefined) return;
          const effect = makeInitialEffect(target.id, variable);
          if (effect === undefined) return;
          onChange({
            ...outcome,
            consequences: {
              ...outcome.consequences,
              effects: [...outcome.consequences.effects, effect],
            },
          });
        }}
      >
        + Add effect
      </button>
      {targets.length > 0 &&
      targets.every(
        (item) => compatibleVariablesForTarget(item, variables).length === 0,
      ) ? (
        <p className="form-error">
          No target currently guarantees eligibility for an active variable with
          enabled effects.
        </p>
      ) : null}
    </div>
  );
}

function compatibleVariablesForTarget(
  target: ProblemTargetDefinition | undefined,
  variables: StateVariableDefinition[],
  retainedVariableId?: string,
) {
  if (target === undefined || target.required_owner_schema_ids.length === 0)
    return [];
  return variables.filter(
    (variable) =>
      (!variable.archived || variable.id === retainedVariableId) &&
      enabledEffectOperations(variable).length > 0 &&
      target.required_owner_schema_ids.some((id) =>
        variable.owner_schema_ids.includes(id),
      ),
  );
}

function enabledEffectOperations(
  variable: StateVariableDefinition,
): StateEffect["type"][] {
  return compatibleEffectOperations(
    variable.value_schema.kind,
    variable.cardinality,
  ).filter((operation) =>
    variable.allowed_effect_operations.includes(operation),
  );
}

function makeInitialEffect(
  targetId: string,
  variable: StateVariableDefinition,
  id?: string,
): StateEffect | undefined {
  const operation = enabledEffectOperations(variable)[0];
  return operation === undefined
    ? undefined
    : makeEffect(operation, targetId, variable, id);
}

function makeEffect(
  operation: StateEffect["type"],
  targetId: string,
  variable: StateVariableDefinition,
  id: string = crypto.randomUUID(),
): StateEffect {
  const base = {
    id,
    target_definition_id: targetId,
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

function EffectEditor({
  effect,
  index,
  count,
  targets,
  variables,
  entities,
  onChange,
  onMove,
  onRemove,
}: {
  effect: StateEffect;
  index: number;
  count: number;
  targets: ProblemTargetDefinition[];
  variables: StateVariableDefinition[];
  entities: Entity[];
  onChange: (value: StateEffect) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const target =
    targets.find((item) => item.id === effect.target_definition_id) ??
    targets[0];
  const compatible = compatibleVariablesForTarget(
    target,
    variables,
    effect.state_variable_id,
  );
  const variable =
    compatible.find((item) => item.id === effect.state_variable_id) ??
    compatible[0];
  const operations =
    variable === undefined ? [] : enabledEffectOperations(variable);
  return (
    <div className="effect-card">
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
      <div className="criterion-grid">
        <Field label="Target">
          <select
            value={target?.id ?? ""}
            onChange={(event) => {
              const nextTarget = targets.find(
                (item) => item.id === event.currentTarget.value,
              );
              const nextVariable = compatibleVariablesForTarget(
                nextTarget,
                variables,
              )[0];
              if (nextTarget !== undefined && nextVariable !== undefined) {
                const nextEffect = makeInitialEffect(
                  nextTarget.id,
                  nextVariable,
                  effect.id,
                );
                if (nextEffect !== undefined) onChange(nextEffect);
              }
            }}
          >
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || item.key}
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
              if (target !== undefined && next !== undefined) {
                const nextEffect = makeInitialEffect(
                  target.id,
                  next,
                  effect.id,
                );
                if (nextEffect !== undefined) onChange(nextEffect);
              }
            }}
          >
            {compatible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Operation">
          <select
            value={effect.type}
            onChange={(event) => {
              if (target !== undefined && variable !== undefined)
                onChange(
                  makeEffect(
                    event.currentTarget.value as StateEffect["type"],
                    target.id,
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
      {variable === undefined ? (
        <p className="form-error">
          Select a target with a compatible variable.
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
