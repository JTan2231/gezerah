import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type {
  Entity,
  ProblemDefinition,
  ProblemInstance,
  ProblemTargetBinding,
  ProblemTargetDefinition,
} from "../api/types";
import { ResourceWorkspace } from "../components/ResourceWorkspace";
import {
  EmptyState,
  Field,
  OrderedActions,
  PageHeader,
  Panel,
  SaveBar,
  StatusBadge,
} from "../components/ui";
import { moveItem } from "../domain/collections";
import { useCollection } from "../hooks/useCollection";
import { useDraft } from "../hooks/useDraft";

function newInstance(problem: ProblemDefinition | undefined): ProblemInstance {
  return {
    id: "",
    problem_definition_id: problem?.id ?? "",
    key: "",
    display_name: "",
    binding_revision: 0,
    state_revision: 0,
    bindings:
      problem?.targets
        .filter((target) => target.binding_source === "supplied")
        .map((target) => ({
          target_definition_id: target.id,
          entity_ids: [],
        })) ?? [],
  };
}

export function Instances({ ruleSetId }: { ruleSetId: string }) {
  const collection = useCollection<ProblemInstance>(
    ruleSetPath(ruleSetId, "problem-instances"),
  );
  const problems = useCollection<ProblemDefinition>(
    ruleSetPath(ruleSetId, "problem-definitions"),
  );
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const [selected, setSelected] = useState<ProblemInstance | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Run / 01"
        title="Problem instances"
        description="Create a named occurrence and explicitly bind every supplied target to concrete entities."
      />
      <ResourceWorkspace
        title="Instance list"
        items={collection.items}
        selectedId={selected?.id ?? null}
        getId={(item) => item.id}
        getTitle={(item) => item.display_name}
        getMeta={(item) => `bindings r${item.binding_revision}`}
        loading={collection.loading}
        error={collection.error}
        onRetry={collection.reload}
        onSelect={setSelected}
        onCreate={() =>
          setSelected(
            newInstance(problems.items.find((item) => !item.archived)),
          )
        }
        createLabel="Instance"
        emptyTitle="No bound problem instances"
        emptyDescription="Create an instance from an active definition, then supply each target explicitly."
      >
        {selected === null ? (
          <EmptyState
            title="Choose an instance"
            description="Select an existing binding context or create a new one."
          />
        ) : (
          <InstanceEditor
            key={selected.id || "new"}
            source={selected}
            ruleSetId={ruleSetId}
            problems={problems.items}
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

function InstanceEditor({
  source,
  ruleSetId,
  problems,
  entities,
  onSaved,
}: {
  source: ProblemInstance;
  ruleSetId: string;
  problems: ProblemDefinition[];
  entities: Entity[];
  onSaved: (value: ProblemInstance) => void;
}) {
  const editor = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const draft = editor.draft;
  const existing = draft.id !== "";
  const problem = problems.find(
    (item) => item.id === draft.problem_definition_id,
  );
  function selectProblem(id: string) {
    const selected = problems.find((item) => item.id === id);
    editor.setDraft({
      ...draft,
      problem_definition_id: id,
      bindings:
        selected?.targets
          .filter((target) => target.binding_source === "supplied")
          .map((target) => ({
            target_definition_id: target.id,
            entity_ids: [],
          })) ?? [],
    });
  }
  async function save() {
    if (problem === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api<ProblemInstance>(
        existing
          ? ruleSetPath(ruleSetId, `problem-instances/${draft.id}/bindings`)
          : ruleSetPath(ruleSetId, "problem-instances"),
        {
          method: existing ? "PUT" : "POST",
          ...jsonBody(
            existing
              ? {
                  expected_binding_revision: draft.binding_revision,
                  bindings: draft.bindings.filter(
                    (binding) =>
                      problem.targets.find(
                        (target) => target.id === binding.target_definition_id,
                      )?.binding_source === "supplied",
                  ),
                }
              : {
                  problem_definition_id: draft.problem_definition_id,
                  ...(draft.key?.trim() === "" ? {} : { key: draft.key }),
                  display_name: draft.display_name,
                  bindings: draft.bindings,
                },
          ),
        },
      );
      editor.accept(saved);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save instance bindings."),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="editor-stack">
      <Panel
        title={
          existing
            ? draft.display_name || "Untitled instance"
            : "New problem instance"
        }
        description="The instance is also a generic entity and may own state only through its configured schema template."
        actions={
          existing ? (
            <div className="badge-row">
              <StatusBadge tone="info">
                Bindings r{draft.binding_revision}
              </StatusBadge>
              <StatusBadge>State r{draft.state_revision}</StatusBadge>
            </div>
          ) : undefined
        }
      >
        <Field label="Problem definition" required>
          <select
            value={draft.problem_definition_id}
            disabled={existing}
            onChange={(event) => selectProblem(event.currentTarget.value)}
          >
            <option value="">Choose a definition</option>
            {problems
              .filter(
                (item) =>
                  !item.archived || item.id === draft.problem_definition_id,
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        {existing ? null : (
          <div className="form-grid">
            <Field label="Instance display name" required>
              <input
                value={draft.display_name}
                onChange={(event) =>
                  editor.setDraft({
                    ...draft,
                    display_name: event.currentTarget.value,
                  })
                }
              />
            </Field>
            <Field label="Stable key" hint="Optional.">
              <input
                value={draft.key ?? ""}
                onChange={(event) =>
                  editor.setDraft({ ...draft, key: event.currentTarget.value })
                }
              />
            </Field>
          </div>
        )}
      </Panel>
      <Panel
        title="Target bindings"
        description="Picker filtering assists explicit selection; it never discovers bindings from world relationships."
      >
        {problem === undefined ? (
          <p className="quiet-empty">Choose a problem definition first.</p>
        ) : (
          problem.targets.map((target) => {
            if (target.binding_source === "problem-instance")
              return (
                <div className="binding-card" key={target.id}>
                  <div>
                    <h3>{target.label}</h3>
                    <p>Automatically bound to this problem instance entity.</p>
                  </div>
                  <StatusBadge tone="info">Automatic self-binding</StatusBadge>
                </div>
              );
            const binding = draft.bindings.find(
              (item) => item.target_definition_id === target.id,
            ) ?? { target_definition_id: target.id, entity_ids: [] };
            return (
              <TargetBindingEditor
                key={target.id}
                target={target}
                binding={binding}
                entities={entities}
                onChange={(next) =>
                  editor.setDraft({
                    ...draft,
                    bindings: draft.bindings.some(
                      (item) => item.target_definition_id === target.id,
                    )
                      ? draft.bindings.map((item) =>
                          item.target_definition_id === target.id ? next : item,
                        )
                      : [...draft.bindings, next],
                  })
                }
              />
            );
          })
        )}
      </Panel>
      <SaveBar
        dirty={editor.dirty}
        saving={saving}
        error={error}
        onReset={editor.reset}
        onSave={() => void save()}
        noun="binding changes"
      />
    </div>
  );
}

function TargetBindingEditor({
  target,
  binding,
  entities,
  onChange,
}: {
  target: ProblemTargetDefinition;
  binding: ProblemTargetBinding;
  entities: Entity[];
  onChange: (value: ProblemTargetBinding) => void;
}) {
  const eligible = entities.filter(
    (entity) =>
      !entity.archived &&
      target.required_owner_schema_ids.every((id) =>
        entity.owner_schema_ids.includes(id),
      ),
  );
  const available = eligible.filter(
    (entity) => !binding.entity_ids.includes(entity.id),
  );
  const maximum = target.maximum_bindings ?? Number.POSITIVE_INFINITY;
  return (
    <div className="binding-card">
      <div className="binding-head">
        <div>
          <h3>{target.label || target.key}</h3>
          <p>
            {target.cardinality === "one" ? "Singular" : "Plural"} ·{" "}
            {target.minimum_bindings} minimum ·{" "}
            {target.maximum_bindings === undefined
              ? "no maximum"
              : `${target.maximum_bindings} maximum`}
          </p>
        </div>
        <StatusBadge
          tone={
            binding.entity_ids.length < target.minimum_bindings
              ? "warn"
              : "good"
          }
        >
          {binding.entity_ids.length} bound
        </StatusBadge>
      </div>
      <div className="binding-rows">
        {binding.entity_ids.map((id, index) => {
          const entity = entities.find((item) => item.id === id);
          return (
            <div className="binding-row" key={id}>
              <span>
                <strong>{entity?.display_name ?? id}</strong>
                <small>Position {index + 1}</small>
              </span>
              <OrderedActions
                index={index}
                count={binding.entity_ids.length}
                label={`${target.label} binding ${index + 1}`}
                onMove={(direction) =>
                  onChange({
                    ...binding,
                    entity_ids: moveItem(binding.entity_ids, index, direction),
                  })
                }
                onRemove={() =>
                  onChange({
                    ...binding,
                    entity_ids: binding.entity_ids.filter(
                      (item) => item !== id,
                    ),
                  })
                }
              />
            </div>
          );
        })}
      </div>
      {binding.entity_ids.length < maximum ? (
        <label className="add-binding">
          <span>Add an eligible entity</span>
          <select
            value=""
            onChange={(event) => {
              if (event.currentTarget.value !== "")
                onChange({
                  ...binding,
                  entity_ids:
                    target.cardinality === "one"
                      ? [event.currentTarget.value]
                      : [...binding.entity_ids, event.currentTarget.value],
                });
            }}
          >
            <option value="">Choose an entity</option>
            {available.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.display_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
