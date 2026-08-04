import { useMemo, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  StateValue,
  World,
  WorldEntity,
  WorldMechanic,
} from "../api/types";
import { ErrorMessage } from "../components/StudioUI";
import { EntityProfilePanel } from "./EntityProfilePanel";

export function EntityDetail({
  entity,
  mechanics,
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
            onClick={() => setTab("story")}
          >
            Character
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sheet"}
            className={tab === "sheet" ? "active" : ""}
            onClick={() => setTab("sheet")}
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
  editable,
  world,
  onSaved,
}: {
  entity: WorldEntity;
  mechanics: WorldMechanic[];
  editable: boolean;
  world: World;
  onSaved: () => void;
}) {
  const activeMechanics = mechanics.filter((mechanic) => !mechanic.archived);
  const initial = useMemo(
    () =>
      Object.fromEntries(
        activeMechanics.map((mechanic) => [
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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const stateValues = { ...entity.state.values };
    for (const mechanic of activeMechanics) {
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
          values: stateValues,
        }),
      });
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
        <span className="entity-portrait" aria-hidden="true">
          {entity.display_name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">Entity sheet</p>
          <h2>{entity.display_name}</h2>
          <span>state r{entity.state.revision}</span>
        </div>
      </header>
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
              <label
                key={mechanic.id}
                className={`sheet-field sheet-${mechanic.mode}`}
              >
                <span>
                  <strong>{mechanic.name}</strong>
                  {mechanic.description === undefined ? null : (
                    <small>{mechanic.description}</small>
                  )}
                </span>
                {mechanic.mode === "binary" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(values[mechanic.id])}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setValues((current) => ({
                        ...current,
                        [mechanic.id]: checked,
                      }));
                    }}
                    disabled={!editable}
                  />
                ) : (
                  <span className="sheet-number">
                    <input
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
                      disabled={!editable}
                    />
                    <em>
                      {mechanic.mode === "pool" &&
                      mechanic.maximum !== undefined
                        ? `/ ${mechanic.maximum}`
                        : (mechanic.unit ?? "")}
                    </em>
                  </span>
                )}
              </label>
            ))}
          </section>
        );
      })}
      {error === null ? null : <ErrorMessage error={error} />}
      {editable && activeMechanics.length > 0 ? (
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
