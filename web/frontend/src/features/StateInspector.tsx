import { useEffect, useMemo, useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type {
  Entity,
  StateRecordResponse,
  StateValue,
  StateVariableDefinition,
} from "../api/types";
import { StateValueEditor } from "../components/StateValueEditor";
import {
  EmptyState,
  ErrorNotice,
  PageHeader,
  Panel,
  SaveBar,
  StatusBadge,
} from "../components/ui";
import { defaultStateValue } from "../domain/options";
import { useCollection } from "../hooks/useCollection";
import { useDirtyGuard } from "../hooks/useDraft";

type ValueMode = "stored" | "default" | "unknown";

export function StateInspector({ ruleSetId }: { ruleSetId: string }) {
  const entities = useCollection<Entity>(ruleSetPath(ruleSetId, "entities"));
  const variables = useCollection<StateVariableDefinition>(
    ruleSetPath(ruleSetId, "state-variable-definitions"),
  );
  const [entityId, setEntityId] = useState("");
  const [record, setRecord] = useState<StateRecordResponse | null>(null);
  const [values, setValues] = useState<Record<string, StateValue>>({});
  const [modes, setModes] = useState<Record<string, ValueMode>>({});
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const entity = entities.items.find((item) => item.id === entityId);
  const eligible = useMemo(
    () =>
      variables.items.filter(
        (variable) =>
          entity !== undefined &&
          (variable.owner_schema_ids.some((id) =>
            entity.owner_schema_ids.includes(id),
          ) ||
            Object.hasOwn(record?.values ?? {}, variable.id)),
      ),
    [entity, record?.values, variables.items],
  );
  const serialized = JSON.stringify({ values, modes });
  const dirty = record !== null && serialized !== baseline;
  useDirtyGuard(dirty);

  useEffect(() => {
    if (entityId === "") {
      setRecord(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api<StateRecordResponse>(
      ruleSetPath(ruleSetId, `entities/${entityId}/state`),
      { signal: controller.signal },
    )
      .then((next) => {
        const nextModes: Record<string, ValueMode> = {};
        for (const id of next.defaulted_definition_ids)
          nextModes[id] = "default";
        for (const id of next.unknown_definition_ids) nextModes[id] = "unknown";
        for (const id of Object.keys(next.values))
          if (nextModes[id] === undefined) nextModes[id] = "stored";
        const snapshot = JSON.stringify({
          values: next.values,
          modes: nextModes,
        });
        setRecord(next);
        setValues(next.values);
        setModes(nextModes);
        setBaseline(snapshot);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof ApiError
              ? reason
              : new ApiError(0, "unknown", "Could not load state."),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [entityId, ruleSetId]);

  function reset() {
    if (record === null) return;
    const nextModes: Record<string, ValueMode> = {};
    for (const id of record.defaulted_definition_ids) nextModes[id] = "default";
    for (const id of record.unknown_definition_ids) nextModes[id] = "unknown";
    for (const id of Object.keys(record.values))
      if (nextModes[id] === undefined) nextModes[id] = "stored";
    setValues(record.values);
    setModes(nextModes);
  }
  async function save() {
    if (record === null || entity === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const logicalValues: Record<string, StateValue> = {};
      for (const variable of eligible) {
        const mode = modes[variable.id] ?? "unknown";
        if (mode !== "stored") continue;
        logicalValues[variable.id] =
          values[variable.id] ??
          defaultStateValue(variable.value_schema, variable.cardinality);
      }
      const saved = await api<StateRecordResponse>(
        ruleSetPath(ruleSetId, `entities/${entity.id}/state`),
        {
          method: "PUT",
          ...jsonBody({
            expected_revision: record.revision,
            values: logicalValues,
          }),
        },
      );
      const nextModes: Record<string, ValueMode> = {};
      for (const id of saved.defaulted_definition_ids)
        nextModes[id] = "default";
      for (const id of saved.unknown_definition_ids) nextModes[id] = "unknown";
      for (const id of Object.keys(saved.values))
        if (nextModes[id] === undefined) nextModes[id] = "stored";
      setRecord(saved);
      setValues(saved.values);
      setModes(nextModes);
      setBaseline(JSON.stringify({ values: saved.values, modes: nextModes }));
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save state."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="World / 02"
        title="State inspector"
        description="Inspect and correct current entity state with metadata-driven controls and optimistic revision protection."
      />
      <div className="inspector-layout">
        <Panel title="Choose an entity">
          <label className="field">
            <span className="field-label">Entity</span>
            <select
              value={entityId}
              onChange={(event) => setEntityId(event.currentTarget.value)}
            >
              <option value="">Select an entity</option>
              {entities.items
                .filter((item) => !item.archived)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name}
                  </option>
                ))}
            </select>
          </label>
          {entity === undefined ? null : (
            <>
              <div className="badge-row">
                {entity.owner_schema_ids.map((id) => (
                  <StatusBadge key={id}>{id}</StatusBadge>
                ))}
              </div>
              <p className="field-hint">
                Owner schemas determine which variable editors appear.
              </p>
            </>
          )}
        </Panel>
        <div className="editor-stack">
          {error === null ? null : <ErrorNotice error={error} />}
          {loading ? (
            <Panel>
              <p>Loading current state…</p>
            </Panel>
          ) : record === null ? (
            <EmptyState
              title="Select an entity"
              description="Stored, defaulted, and unknown values will remain visibly distinct."
            />
          ) : (
            <>
              <Panel
                title={entity?.display_name ?? "Entity state"}
                description={`Current state revision ${record.revision}`}
                actions={
                  <StatusBadge tone="info">r{record.revision}</StatusBadge>
                }
              >
                {eligible.length === 0 ? (
                  <p className="quiet-empty">
                    This entity is not eligible to own any configured state.
                  </p>
                ) : (
                  <div className="state-fields">
                    {eligible
                      .sort((a, b) => a.display_order - b.display_order)
                      .map((variable) => {
                        const defaultMode =
                          variable.missing_value.kind === "default"
                            ? "default"
                            : "unknown";
                        const mode = modes[variable.id] ?? defaultMode;
                        const value =
                          values[variable.id] ??
                          (variable.missing_value.kind === "default"
                            ? variable.missing_value.value
                            : defaultStateValue(
                                variable.value_schema,
                                variable.cardinality,
                              ));
                        return (
                          <div className="state-field" key={variable.id}>
                            <div className="state-field-head">
                              <div>
                                <h3>{variable.label}</h3>
                                <p>
                                  {variable.presentation?.help_text ??
                                    variable.description}
                                </p>
                              </div>
                              <StatusBadge
                                tone={
                                  mode === "stored"
                                    ? "info"
                                    : mode === "default"
                                      ? "good"
                                      : "warn"
                                }
                              >
                                {mode === "stored"
                                  ? "Stored override"
                                  : mode === "default"
                                    ? "Defaulted"
                                    : "Unknown"}
                              </StatusBadge>
                            </div>
                            <fieldset className="inline-choice">
                              <legend>Value source</legend>
                              <label>
                                <input
                                  type="radio"
                                  checked={mode === "stored"}
                                  onChange={() => {
                                    setModes({
                                      ...modes,
                                      [variable.id]: "stored",
                                    });
                                    setValues({
                                      ...values,
                                      [variable.id]: value,
                                    });
                                  }}
                                />{" "}
                                Override value
                              </label>
                              <label>
                                <input
                                  type="radio"
                                  checked={mode === defaultMode}
                                  onChange={() =>
                                    setModes({
                                      ...modes,
                                      [variable.id]: defaultMode,
                                    })
                                  }
                                />{" "}
                                {defaultMode === "default"
                                  ? "Use default"
                                  : "Leave unknown"}
                              </label>
                            </fieldset>
                            {mode === "stored" ? (
                              <StateValueEditor
                                schema={variable.value_schema}
                                cardinality={variable.cardinality}
                                value={value}
                                entities={entities.items}
                                control={variable.presentation?.control}
                                onChange={(next) =>
                                  setValues({ ...values, [variable.id]: next })
                                }
                              />
                            ) : (
                              <p className="quiet-note">
                                {mode === "default"
                                  ? "The configured default is materialized logically without requiring a stored override."
                                  : "Conditions that need this address will evaluate as unknown."}
                              </p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </Panel>
              <SaveBar
                dirty={dirty}
                saving={saving}
                error={error}
                onReset={reset}
                onSave={() => void save()}
                noun="state changes"
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
