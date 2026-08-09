import { useMemo, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  ActiveStatus,
  StateValue,
  World,
  WorldEntity,
  WorldMechanic,
} from "../api/types";
import { ErrorMessage } from "../components/StudioUI";
import { formatRelativeDate } from "../domain/display";
import { confirmDiscardDraft, useDirtyGuard } from "../hooks/useDraft";
import { EntityProfilePanel } from "./EntityProfilePanel";

export function EntityDetail({
  entity,
  mechanics,
  rulesRevision,
  mechanicsEditable,
  controlledByCurrentMember,
  facilitator,
  world,
  profileRefreshToken,
  onManageControllers,
  onProfileChanged,
  onSaved,
}: {
  entity: WorldEntity;
  mechanics: WorldMechanic[];
  rulesRevision: number;
  mechanicsEditable: boolean;
  controlledByCurrentMember: boolean;
  facilitator: boolean;
  world: World;
  profileRefreshToken: number;
  onManageControllers: () => void;
  onProfileChanged: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"story" | "sheet">(
    controlledByCurrentMember && !facilitator ? "story" : "sheet",
  );

  function selectTab(nextTab: "story" | "sheet") {
    if (nextTab === tab || !confirmDiscardDraft()) return;
    setTab(nextTab);
  }

  return (
    <div className="entity-detail">
      <div className="entity-detail-toolbar">
        <div
          className="entity-detail-tabs"
          role="tablist"
          aria-label="Entity detail"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "story"}
            className={tab === "story" ? "active" : ""}
            onClick={() => selectTab("story")}
          >
            Character
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sheet"}
            className={tab === "sheet" ? "active" : ""}
            onClick={() => selectTab("sheet")}
          >
            Sheet
          </button>
        </div>
        {facilitator && world.status === "active" ? (
          <button
            className="text-button"
            type="button"
            onClick={onManageControllers}
          >
            Controllers
          </button>
        ) : null}
      </div>
      {tab === "story" ? (
        <EntityProfilePanel
          world={world}
          entity={entity}
          refreshToken={profileRefreshToken}
          onChanged={onProfileChanged}
          editable={controlledByCurrentMember || facilitator}
        />
      ) : (
        <EntitySheet
          entity={entity}
          mechanics={mechanics}
          rulesRevision={rulesRevision}
          editable={mechanicsEditable}
          world={world}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function EntitySheet({
  entity,
  mechanics,
  rulesRevision,
  editable,
  world,
  onSaved,
}: {
  entity: WorldEntity;
  mechanics: WorldMechanic[];
  rulesRevision: number;
  editable: boolean;
  world: World;
  onSaved: () => void;
}) {
  const activeMechanics = mechanics.filter((mechanic) => !mechanic.archived);
  const inputMechanics = mechanics.filter(
    (mechanic) => mechanic.source_kind === "input",
  );
  const initial = useMemo(
    () =>
      Object.fromEntries(
        activeMechanics
          .filter((mechanic) => mechanic.source_kind === "input")
          .map((mechanic) => [
            mechanic.id,
            mechanicValue(entity.state.values[mechanic.id], mechanic),
          ]),
      ),
    [activeMechanics, entity],
  );
  const [values, setValues] =
    useState<Record<string, number | boolean>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const clearDirtyGuard = useDirtyGuard(dirty);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const stateValues: Record<string, StateValue> = {};
    for (const mechanic of inputMechanics) {
      const current = entity.state.values[mechanic.id];
      if (current !== undefined) stateValues[mechanic.id] = current;
    }
    for (const mechanic of activeMechanics.filter(
      (candidate) => candidate.source_kind === "input",
    )) {
      const value = values[mechanic.id];
      stateValues[mechanic.id] =
        mechanic.mode === "binary"
          ? { kind: "boolean", value: Boolean(value) }
          : { kind: "number", value: Number(value ?? 0) };
    }
    try {
      await api(worldPath(world.id, `entities/${entity.id}/state`), {
        method: "PUT",
        ...jsonBody({
          expected_revision: entity.state.revision,
          expected_rules_revision: rulesRevision,
          values: stateValues,
        }),
      });
      clearDirtyGuard();
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this sheet."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="entity-sheet" onSubmit={(event) => void save(event)}>
      <header>
        <div>
          <h2>{entity.display_name}</h2>
          <span>
            Entity sheet · state r{entity.state.revision} · statuses r
            {entity.state.status_revision} · rules r{rulesRevision}
          </span>
        </div>
      </header>
      {entity.state.active_statuses.length > 0 ? (
        <section className="active-statuses" aria-label="Active statuses">
          <h3>Active statuses</h3>
          <div>
            {entity.state.active_statuses.map((status) => (
              <span
                className="active-status-chip"
                key={status.id}
                title={activeStatusDetails(status)}
                aria-label={`${status.name}. ${activeStatusDetails(status)}`}
              >
                <span>
                  <strong>{status.name}</strong>
                  <small>{activeStatusDetails(status)}</small>
                </span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {activeMechanics.length === 0 ? (
        <p className="sheet-empty">
          Configure a capacity or capability to generate this sheet.
        </p>
      ) : null}
      {(["capacity", "capability"] as const).map((kind) => {
        const group = activeMechanics.filter(
          (mechanic) => mechanic.kind === kind,
        );
        if (group.length === 0) return null;
        return (
          <section className="sheet-group" key={kind}>
            <h3>{kind === "capacity" ? "Capacities" : "Capabilities"}</h3>
            {group.map((mechanic) => (
              <div
                key={mechanic.id}
                className={`sheet-field sheet-${mechanic.mode} sheet-source-${mechanic.source_kind}`}
              >
                <span>
                  <strong>
                    {mechanic.name}
                    <small className="mechanic-source-pill">
                      {mechanic.source_kind === "derived"
                        ? "Calculated"
                        : "Input"}
                    </small>
                  </strong>
                  {mechanic.description === undefined ? null : (
                    <small>{mechanic.description}</small>
                  )}
                </span>
                {mechanic.source_kind === "input" &&
                editable &&
                mechanic.mode === "binary" ? (
                  <input
                    aria-label={mechanic.name}
                    type="checkbox"
                    checked={Boolean(values[mechanic.id])}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setValues((current) => ({
                        ...current,
                        [mechanic.id]: checked,
                      }));
                    }}
                  />
                ) : mechanic.source_kind === "input" && editable ? (
                  <span className="sheet-number">
                    <input
                      aria-label={mechanic.name}
                      type="number"
                      value={Number(values[mechanic.id] ?? 0)}
                      min={mechanic.minimum}
                      max={mechanic.maximum}
                      step={mechanic.step ?? "any"}
                      onChange={(event) => {
                        const value = event.currentTarget.valueAsNumber || 0;
                        setValues((current) => ({
                          ...current,
                          [mechanic.id]: value,
                        }));
                      }}
                    />
                    <em>
                      {mechanic.mode === "pool" &&
                      mechanic.maximum !== undefined
                        ? `/ ${mechanic.maximum}`
                        : (mechanic.unit ?? "")}
                    </em>
                  </span>
                ) : (
                  <output
                    className="sheet-effective-value"
                    aria-label={`${mechanic.name} effective value`}
                  >
                    {formatMechanicValue(
                      entity.state.effective_values[mechanic.id] ??
                        entity.state.evaluations[mechanic.id]?.effective ??
                        entity.state.values[mechanic.id],
                      mechanic,
                    )}
                  </output>
                )}
                {mechanic.source_kind === "input" && editable ? (
                  <span className="sheet-effective-summary">
                    Effective:{" "}
                    <strong>
                      {formatMechanicValue(
                        entity.state.effective_values[mechanic.id] ??
                          entity.state.evaluations[mechanic.id]?.effective ??
                          entity.state.values[mechanic.id],
                        mechanic,
                      )}
                    </strong>
                  </span>
                ) : null}
                {(entity.state.evaluations[mechanic.id]?.modifiers.length ??
                  0) > 0 ? (
                  <ol className="modifier-explanation">
                    {entity.state.evaluations[mechanic.id]?.modifiers.map(
                      (modifier) => (
                        <li
                          key={`${modifier.status_instance_id}:${modifier.modifier_id}`}
                        >
                          <span>{modifier.status_name}</span>
                          <small>
                            {modifierOperationLabel(modifier.operation)}{" "}
                            {formatStateValue(modifier.operand)} ·{" "}
                            {formatStateValue(modifier.before)} →{" "}
                            {formatStateValue(modifier.after)}
                          </small>
                        </li>
                      ),
                    )}
                  </ol>
                ) : null}
              </div>
            ))}
          </section>
        );
      })}
      {error === null ? null : <ErrorMessage error={error} />}
      {editable &&
      activeMechanics.some((mechanic) => mechanic.source_kind === "input") ? (
        <footer>
          <span>Direct setup edit</span>
          <button className="button button-ink" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save sheet"}
          </button>
        </footer>
      ) : null}
    </form>
  );
}

function mechanicValue(
  value: StateValue | undefined,
  mechanic: WorldMechanic,
): number | boolean {
  if (value === undefined)
    return mechanic.mode === "binary" ? false : (mechanic.default_number ?? 0);
  if (value.kind === "boolean") return value.value;
  if (value.kind === "number") return value.value;
  return mechanic.mode === "binary" ? false : (mechanic.default_number ?? 0);
}

function formatMechanicValue(
  value: StateValue | undefined,
  mechanic: WorldMechanic,
): string {
  const rendered = formatStateValue(value);
  if (value?.kind !== "number") return rendered;
  if (mechanic.mode === "pool" && mechanic.maximum !== undefined)
    return `${rendered} / ${mechanic.maximum}${mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}`;
  return `${rendered}${mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}`;
}

function formatStateValue(value: StateValue | undefined): string {
  if (value === undefined) return "Unavailable";
  return value.kind === "number"
    ? String(value.value)
    : value.value
      ? "Yes"
      : "No";
}

function modifierOperationLabel(operation: string): string {
  switch (operation) {
    case "add-number":
      return "add";
    case "multiply-number":
      return "multiply by";
    default:
      return "set to";
  }
}

function activeStatusDetails(status: ActiveStatus): string {
  const description =
    status.description === undefined ? "" : `${status.description} · `;
  return `${description}Problem ${shortID(status.source_interaction_id)} · applied ${formatRelativeDate(status.applied_at)} · instance ${shortID(status.id)}`;
}

function shortID(id: string): string {
  return id.slice(0, 8);
}
