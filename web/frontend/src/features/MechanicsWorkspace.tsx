import { useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  MechanicKind,
  MechanicMode,
  World,
  WorldMechanic,
} from "../api/types";
import {
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";
import { humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { useDraft } from "../hooks/useDraft";
import { worldURL } from "../worldRoutes";

export function MechanicsWorkspace({
  world,
  kind,
  selectedId,
  navigate,
  onWorldChanged,
}: {
  world: World;
  kind: MechanicKind;
  selectedId?: string | undefined;
  navigate: (path: string) => void;
  onWorldChanged: () => void;
}) {
  const plural = kind === "capacity" ? "capacities" : "capabilities";
  const items = useCollection<WorldMechanic>(
    worldPath(world.id, `mechanics?kind=${kind}`),
  );
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const selected =
    selectedId === "new"
      ? newMechanic(kind)
      : items.items.find((item) => item.id === selectedId);
  const filtered = items.items.filter((item) => {
    if (!showArchived && item.archived) return false;
    const query = search.trim().toLowerCase();
    return (
      query === "" ||
      item.name.toLowerCase().includes(query) ||
      (item.description ?? "").toLowerCase().includes(query)
    );
  });

  function select(id?: string) {
    navigate(worldURL(world.id, plural, id));
  }

  return (
    <section className="mechanics-page">
      <PageIntro
        eyebrow="Static world configuration"
        title={kind === "capacity" ? "Capacities" : "Capabilities"}
        description={
          kind === "capacity"
            ? "The values and resources every entity can carry into play."
            : "The skills and proficiencies that describe what an entity can do."
        }
        actions={
          <button
            className="button button-primary"
            type="button"
            onClick={() => select("new")}
          >
            <span aria-hidden="true">＋</span> New {kind}
          </button>
        }
      />
      <div className="resource-studio">
        <aside
          className="resource-catalog"
          aria-label={`${humanize(plural)} catalog`}
        >
          <div className="catalog-tools">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search {plural}</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder={`Search ${plural}`}
              />
            </label>
            <label className="archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) =>
                  setShowArchived(event.currentTarget.checked)
                }
              />
              <span>Show archived</span>
            </label>
          </div>
          {items.loading && items.items.length === 0 ? (
            <LoadingState label={`Loading ${plural}`} />
          ) : null}
          {items.error === null ? null : (
            <ErrorMessage error={items.error} onRetry={items.reload} />
          )}
          <div className="catalog-list">
            {filtered.map((item) => (
              <button
                type="button"
                key={item.id}
                className={
                  item.id === selectedId
                    ? "catalog-item active"
                    : "catalog-item"
                }
                onClick={() => select(item.id)}
              >
                <span
                  className={`catalog-glyph glyph-${kind}`}
                  aria-hidden="true"
                >
                  {kind === "capacity" ? "◇" : "✦"}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{mechanicSummary(item)}</small>
                </span>
                {item.archived ? (
                  <em>Archived</em>
                ) : (
                  <b aria-hidden="true">›</b>
                )}
              </button>
            ))}
          </div>
          {!items.loading && filtered.length === 0 ? (
            <div className="catalog-empty">
              <span aria-hidden="true">{search === "" ? "—" : "⌕"}</span>
              <p>
                {search === ""
                  ? `No ${plural} yet.`
                  : "Nothing matches that search."}
              </p>
            </div>
          ) : null}
        </aside>

        <div className="resource-editor-shell">
          {selected === undefined ? (
            <EmptyState
              symbol={kind === "capacity" ? "◇" : "✦"}
              title={
                items.items.length === 0
                  ? `Define your first ${kind}`
                  : `Choose a ${kind}`
              }
              description={
                kind === "capacity"
                  ? "Start with one value the table needs to see or change during play."
                  : "Start with one skill or proficiency that matters when players act."
              }
              action={
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => select("new")}
                >
                  Create {kind}
                </button>
              }
            />
          ) : (
            <MechanicEditor
              key={selected.id}
              world={world}
              source={selected}
              creating={selectedId === "new"}
              onSaved={(saved) => {
                items.replaceItem(saved, (item) => item.id);
                onWorldChanged();
                select(saved.id);
              }}
              onArchived={(saved) => {
                items.replaceItem(saved, (item) => item.id);
                onWorldChanged();
              }}
              onCancel={() => select()}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function MechanicEditor({
  world,
  source,
  creating,
  onSaved,
  onArchived,
  onCancel,
}: {
  world: World;
  source: WorldMechanic;
  creating: boolean;
  onSaved: (mechanic: WorldMechanic) => void;
  onArchived: (mechanic: WorldMechanic) => void;
  onCancel: () => void;
}) {
  const draft = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const item = draft.draft;
  const numeric = !(item.kind === "capability" && item.mode === "binary");
  const previewName = item.name.trim();
  const previewDescription = item.description?.trim();

  function patch(values: Partial<WorldMechanic>) {
    draft.setDraft((current) => ({ ...current, ...values }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const path = creating
        ? worldPath(world.id, "mechanics")
        : worldPath(world.id, `mechanics/${item.id}`);
      const saved = await api<WorldMechanic>(path, {
        method: creating ? "POST" : "PUT",
        ...jsonBody(mechanicPayload(item, creating)),
      });
      draft.accept(saved);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this mechanic."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (
      !window.confirm(
        `Archive ${item.name}? Existing entity sheets and history will retain it.`,
      )
    )
      return;
    setArchiving(true);
    setError(null);
    try {
      const saved = await api<WorldMechanic>(
        worldPath(world.id, `mechanics/${item.id}/archive`),
        { method: "POST" },
      );
      draft.accept(saved);
      onArchived(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not archive this mechanic."),
      );
    } finally {
      setArchiving(false);
    }
  }

  return (
    <form className="mechanic-editor" onSubmit={(event) => void save(event)}>
      <header className="editor-titlebar">
        <div>
          <p className="eyebrow">{creating ? `New ${item.kind}` : item.kind}</p>
          <h2>{item.name.trim() || `Untitled ${item.kind}`}</h2>
          <p>
            {item.kind === "capacity"
              ? "A value an entity carries."
              : "A skill or proficiency an entity may possess."}
          </p>
        </div>
        {item.archived ? (
          <span className="archived-label">Archived</span>
        ) : null}
      </header>

      <div className="editor-columns">
        <div className="editor-form-column">
          <section className="form-section">
            <div className="section-heading">
              <span>01</span>
              <div>
                <h3>Identity</h3>
                <p>Use language your table will recognize immediately.</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Name" error={error?.fields["name"]}>
                <input
                  value={item.name}
                  onChange={(event) =>
                    patch({ name: event.currentTarget.value })
                  }
                  maxLength={200}
                  placeholder={
                    item.kind === "capacity" ? "Strength" : "Climbing"
                  }
                />
              </Field>
              <Field
                label="Description"
                hint="Appears as help text on entity sheets."
              >
                <textarea
                  value={item.description ?? ""}
                  onChange={(event) =>
                    patch({
                      description: event.currentTarget.value || undefined,
                    })
                  }
                  rows={3}
                  placeholder="What does this mean at the table?"
                />
              </Field>
            </div>
          </section>

          <section className="form-section">
            <div className="section-heading">
              <span>02</span>
              <div>
                <h3>How it behaves</h3>
                <p>Choose the simplest representation that tells the truth.</p>
              </div>
            </div>
            <div
              className="mode-cards"
              role="radiogroup"
              aria-label={`${humanize(item.kind)} representation`}
            >
              {(item.kind === "capacity"
                ? ["score", "pool"]
                : ["binary", "rating"]
              ).map((mode) => (
                <label
                  key={mode}
                  className={
                    item.mode === mode ? "mode-card selected" : "mode-card"
                  }
                >
                  <input
                    type="radio"
                    name="mode"
                    value={mode}
                    checked={item.mode === mode}
                    onChange={() =>
                      patch({
                        mode: mode as MechanicMode,
                        minimum: mode === "binary" ? undefined : item.minimum,
                        maximum: mode === "binary" ? undefined : item.maximum,
                        step: mode === "binary" ? undefined : (item.step ?? 1),
                        default_number:
                          mode === "binary"
                            ? undefined
                            : (item.default_number ?? 0),
                        unit: mode === "binary" ? undefined : item.unit,
                      })
                    }
                  />
                  <span aria-hidden="true">
                    {mode === "score" || mode === "rating"
                      ? "12"
                      : mode === "pool"
                        ? "12 / 20"
                        : "✓"}
                  </span>
                  <strong>{humanize(mode)}</strong>
                  <small>{modeDescription(mode)}</small>
                </label>
              ))}
            </div>

            {numeric ? (
              <div className="numeric-settings">
                <div className="numeric-row">
                  <Field
                    label="Default"
                    error={error?.fields["default_number"]}
                  >
                    <input
                      type="number"
                      value={item.default_number ?? 0}
                      onChange={(event) =>
                        patch({
                          default_number: optionalNumber(
                            event.currentTarget.value,
                          ),
                        })
                      }
                      step="any"
                    />
                  </Field>
                  <Field label="Minimum" error={error?.fields["minimum"]}>
                    <input
                      type="number"
                      value={item.minimum ?? ""}
                      onChange={(event) =>
                        patch({
                          minimum: optionalNumber(event.currentTarget.value),
                        })
                      }
                      step="any"
                      placeholder="None"
                    />
                  </Field>
                  <Field label="Maximum" error={error?.fields["maximum"]}>
                    <input
                      type="number"
                      value={item.maximum ?? ""}
                      onChange={(event) =>
                        patch({
                          maximum: optionalNumber(event.currentTarget.value),
                        })
                      }
                      step="any"
                      placeholder="None"
                    />
                  </Field>
                </div>
                <div className="numeric-row numeric-row-short">
                  <Field label="Step">
                    <input
                      type="number"
                      min="0"
                      value={item.step ?? ""}
                      onChange={(event) =>
                        patch({
                          step: optionalNumber(event.currentTarget.value),
                        })
                      }
                      step="any"
                      placeholder="Any"
                    />
                  </Field>
                  <Field label="Unit" hint="Optional, such as HP or points.">
                    <input
                      value={item.unit ?? ""}
                      onChange={(event) =>
                        patch({ unit: event.currentTarget.value || undefined })
                      }
                      placeholder="points"
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            <label className="switch-row">
              <span>
                <strong>May change during play</strong>
                <small>
                  Dungeon Masters can include this in a ruling’s effects.
                </small>
              </span>
              <input
                aria-label="May change during play"
                type="checkbox"
                checked={item.mutable_during_play}
                onChange={(event) =>
                  patch({ mutable_during_play: event.currentTarget.checked })
                }
              />
              <i aria-hidden="true" />
            </label>
          </section>

          {!creating && !item.archived ? (
            <section className="form-section lifecycle-section">
              <div>
                <h3>Retire this mechanic</h3>
                <p>
                  Archive it when new entities should stop using it. Existing
                  state and resolution history remain readable.
                </p>
              </div>
              <button
                className="button button-danger-quiet"
                type="button"
                onClick={() => void archive()}
                disabled={archiving}
              >
                {archiving ? "Archiving…" : `Archive ${item.kind}`}
              </button>
            </section>
          ) : null}
        </div>

        <aside className="sheet-preview">
          <p className="eyebrow">Entity sheet preview</p>
          <div className={`preview-card preview-${item.kind}`}>
            <span className="preview-icon" aria-hidden="true">
              {item.kind === "capacity" ? "◇" : "✦"}
            </span>
            <div>
              <strong>
                {previewName === "" ? `Untitled ${item.kind}` : previewName}
              </strong>
              <small>
                {previewDescription === undefined || previewDescription === ""
                  ? modeDescription(item.mode)
                  : previewDescription}
              </small>
            </div>
            <PreviewValue mechanic={item} />
          </div>
          <p>
            Every entity in this world receives this configured definition.
            Values can be adjusted when the roster is prepared or through a DM
            ruling.
          </p>
        </aside>
      </div>

      {error === null ? null : (
        <div className="editor-error">
          <ErrorMessage error={error} />
        </div>
      )}
      <footer className="save-dock">
        <span
          className={draft.dirty ? "dirty-indicator active" : "dirty-indicator"}
        >
          <i aria-hidden="true" />
          {draft.dirty
            ? "Unsaved changes"
            : creating
              ? "New draft"
              : "All changes saved"}
        </span>
        <div>
          {creating ? (
            <button
              className="button button-quiet"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : null}
          {!creating && draft.dirty ? (
            <button
              className="button button-quiet"
              type="button"
              onClick={draft.reset}
            >
              Reset
            </button>
          ) : null}
          <button
            className="button button-primary"
            type="submit"
            disabled={
              saving || item.name.trim() === "" || (!creating && !draft.dirty)
            }
          >
            {saving
              ? "Saving…"
              : creating
                ? `Create ${item.kind}`
                : "Save changes"}
          </button>
        </div>
      </footer>
    </form>
  );
}

function PreviewValue({ mechanic }: { mechanic: WorldMechanic }) {
  if (mechanic.mode === "binary")
    return <span className="preview-check">Not trained</span>;
  const value = mechanic.default_number ?? 0;
  if (mechanic.mode === "pool" && mechanic.maximum !== undefined)
    return (
      <span className="preview-number">
        <b>{value}</b>
        <small>
          / {mechanic.maximum}
          {mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}
        </small>
      </span>
    );
  return (
    <span className="preview-number">
      <b>{value}</b>
      <small>{mechanic.unit ?? ""}</small>
    </span>
  );
}

function newMechanic(kind: MechanicKind): WorldMechanic {
  return {
    id: "new",
    kind,
    mode: kind === "capacity" ? "score" : "binary",
    name: "",
    description: undefined,
    step: kind === "capacity" ? 1 : undefined,
    default_number: kind === "capacity" ? 0 : undefined,
    mutable_during_play: true,
    archived: false,
    created_at: "",
    updated_at: "",
  };
}

function mechanicPayload(item: WorldMechanic, creating: boolean) {
  return {
    id: creating ? undefined : item.id,
    kind: item.kind,
    mode: item.mode,
    name: item.name.trim(),
    description:
      item.description === undefined || item.description.trim() === ""
        ? undefined
        : item.description.trim(),
    minimum: item.minimum,
    maximum: item.maximum,
    step: item.step,
    default_number: item.default_number,
    unit:
      item.unit === undefined || item.unit.trim() === ""
        ? undefined
        : item.unit.trim(),
    mutable_during_play: item.mutable_during_play,
    archived: item.archived,
  };
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mechanicSummary(item: WorldMechanic): string {
  if (item.mode === "binary") return "Possessed or not";
  const bounds =
    item.minimum === undefined && item.maximum === undefined
      ? "Open scale"
      : `${item.minimum ?? "−∞"}–${item.maximum ?? "∞"}`;
  return `${humanize(item.mode)} · ${bounds}${item.unit === undefined ? "" : ` ${item.unit}`}`;
}

function modeDescription(mode: string): string {
  switch (mode) {
    case "score":
      return "A single attribute value.";
    case "pool":
      return "A resource that is spent and restored.";
    case "binary":
      return "An entity has it or does not.";
    case "rating":
      return "A capability with a numeric rank.";
    default:
      return "";
  }
}
