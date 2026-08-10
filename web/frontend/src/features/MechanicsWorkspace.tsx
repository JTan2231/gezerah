import { useMemo, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  DecimalText,
  MechanicExpression,
  MechanicKind,
  MechanicMode,
  StateValue,
  World,
  WorldMechanic,
  WorldMechanicCollection,
  WorldMechanicMutation,
} from "../api/types";
import {
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";
import { humanize } from "../domain/display";
import { canonicalDecimalText } from "../domain/decimal";
import { changeMechanicMode } from "../domain/mechanics";
import { useDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import { buildWorldURL, type Navigate } from "../worldRoutes";

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
  navigate: Navigate;
  onWorldChanged: () => void;
}) {
  const plural = kind === "capacity" ? "capacities" : "capabilities";
  const resource = useResource<WorldMechanicCollection>(
    worldPath(world.id, "mechanics"),
  );
  const allMechanics = resource.value?.mechanics ?? [];
  const items = allMechanics.filter((item) => item.kind === kind);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const newItem = useMemo(() => newMechanic(kind), [kind]);
  const selected =
    selectedId === "new"
      ? newItem
      : items.find((item) => item.id === selectedId);
  const filtered = items.filter((item) => {
    if (!showArchived && item.archived) return false;
    const query = search.trim().toLowerCase();
    return (
      query === "" ||
      item.name.toLowerCase().includes(query) ||
      (item.description ?? "").toLowerCase().includes(query)
    );
  });

  function select(id?: string) {
    navigate(buildWorldURL(world.id, plural, id));
  }

  return (
    <section className="mechanics-page">
      <PageIntro
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
            New {kind}
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
          {resource.loading && items.length === 0 ? (
            <LoadingState label={`Loading ${plural}`} />
          ) : null}
          {resource.error === null ? null : (
            <ErrorMessage error={resource.error} onRetry={resource.reload} />
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
                <span>
                  <strong>{item.name}</strong>
                  <small>{mechanicSummary(item)}</small>
                </span>
                {item.archived ? <em>Archived</em> : null}
              </button>
            ))}
          </div>
          {!resource.loading && filtered.length === 0 ? (
            <div className="catalog-empty">
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
              title={
                items.length === 0 ? `No ${plural} yet` : `Select a ${kind}`
              }
              description={
                kind === "capacity"
                  ? "Create a capacity to add a value or resource to entity sheets."
                  : "Create a capability to add a skill or proficiency to entity sheets."
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
              allMechanics={allMechanics}
              rulesRevision={resource.value?.revision ?? world.rules_revision}
              creating={selectedId === "new"}
              onSaved={(saved) => {
                resource.reload();
                onWorldChanged();
                select(saved.mechanic.id);
              }}
              onArchived={() => {
                resource.reload();
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
  allMechanics,
  rulesRevision,
  creating,
  onSaved,
  onArchived,
  onCancel,
}: {
  world: World;
  source: WorldMechanic;
  allMechanics: WorldMechanic[];
  rulesRevision: number;
  creating: boolean;
  onSaved: (mechanic: WorldMechanicMutation) => void;
  onArchived: (mechanic: WorldMechanicMutation) => void;
  onCancel: () => void;
}) {
  const draft = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const item = draft.draft;
  const input = item.source_kind === "input";
  const numericKind = item.mode !== "binary";
  const numeric = input && numericKind;
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
      const saved = await api<WorldMechanicMutation>(path, {
        method: creating ? "POST" : "PUT",
        ...jsonBody(mechanicPayload(item, creating, rulesRevision)),
      });
      draft.accept(saved.mechanic);
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
      const saved = await api<WorldMechanicMutation>(
        worldPath(world.id, `mechanics/${item.id}/archive`),
        {
          method: "POST",
          ...jsonBody({ expected_rules_revision: rulesRevision }),
        },
      );
      draft.accept(saved.mechanic);
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
          <h2>
            {creating
              ? `New ${item.kind}`
              : item.name.trim() || `Untitled ${item.kind}`}
          </h2>
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
              <div>
                <h3>Identity</h3>
                <p>Name and describe this mechanic.</p>
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
                  placeholder={`${humanize(item.kind)} name`}
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
                  placeholder="Mechanic description"
                />
              </Field>
            </div>
          </section>

          <section className="form-section">
            <div className="section-heading">
              <div>
                <h3>Behavior</h3>
                <p>Choose how this mechanic is stored and displayed.</p>
              </div>
            </div>
            <div
              className="source-kind-cards"
              role="radiogroup"
              aria-label={`${humanize(item.kind)} value source`}
            >
              <label
                className={
                  input ? "source-kind-card selected" : "source-kind-card"
                }
              >
                <input
                  type="radio"
                  name="source-kind"
                  value="input"
                  checked={input}
                  onChange={() =>
                    patch({
                      source_kind: "input",
                      expression: undefined,
                      default_number: numericKind
                        ? (item.default_number ?? "0")
                        : undefined,
                      step: numericKind ? (item.step ?? "1") : undefined,
                    })
                  }
                />
                <strong>Input value</strong>
                <small>Stored on each entity and editable during setup.</small>
              </label>
              <label
                className={
                  !input ? "source-kind-card selected" : "source-kind-card"
                }
              >
                <input
                  type="radio"
                  name="source-kind"
                  value="derived"
                  checked={!input}
                  onChange={() =>
                    patch({
                      source_kind: "derived",
                      expression:
                        item.expression ??
                        defaultExpression(mechanicValueKind(item)),
                      minimum: undefined,
                      maximum: undefined,
                      step: undefined,
                      default_number: undefined,
                      mutable_during_play: false,
                    })
                  }
                />
                <strong>Derived value</strong>
                <small>Calculated from other values in this world.</small>
              </label>
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
                      patch(changeMechanicMode(item, mode as MechanicMode))
                    }
                  />
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
                      type="text"
                      inputMode="decimal"
                      value={item.default_number ?? "0"}
                      onChange={(event) =>
                        patch({
                          default_number: optionalDecimalText(
                            event.currentTarget.value,
                          ),
                        })
                      }
                      required
                    />
                  </Field>
                  <Field label="Minimum" error={error?.fields["minimum"]}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.minimum ?? ""}
                      onChange={(event) =>
                        patch({
                          minimum: optionalDecimalText(
                            event.currentTarget.value,
                          ),
                        })
                      }
                      placeholder="None"
                    />
                  </Field>
                  <Field label="Maximum" error={error?.fields["maximum"]}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.maximum ?? ""}
                      onChange={(event) =>
                        patch({
                          maximum: optionalDecimalText(
                            event.currentTarget.value,
                          ),
                        })
                      }
                      placeholder="None"
                    />
                  </Field>
                </div>
                <div className="numeric-row numeric-row-short">
                  <Field label="Step">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.step ?? ""}
                      onChange={(event) =>
                        patch({
                          step: optionalDecimalText(event.currentTarget.value),
                        })
                      }
                      placeholder="Any"
                    />
                  </Field>
                  <Field label="Unit" hint="Optional, such as HP or points.">
                    <input
                      value={item.unit ?? ""}
                      onChange={(event) =>
                        patch({ unit: event.currentTarget.value || undefined })
                      }
                      placeholder="Unit"
                    />
                  </Field>
                </div>
              </div>
            ) : null}

            {!input ? (
              <div className="derived-expression-section">
                <div className="derived-expression-heading">
                  <div>
                    <strong>Calculation</strong>
                    <small>
                      References use stable mechanic identities. The server
                      checks types and rejects dependency cycles when you save.
                    </small>
                  </div>
                  <span>{humanize(mechanicValueKind(item))} result</span>
                </div>
                <ExpressionEditor
                  expression={
                    item.expression ??
                    defaultExpression(mechanicValueKind(item))
                  }
                  expectedKind={mechanicValueKind(item)}
                  mechanics={allMechanics.filter(
                    (mechanic) =>
                      mechanic.id !== item.id &&
                      (!mechanic.archived ||
                        expressionReferences(item.expression).has(mechanic.id)),
                  )}
                  onChange={(expression) => patch({ expression })}
                />
                {numericKind ? (
                  <Field
                    label="Unit"
                    hint="Optional display text, such as HP or points."
                  >
                    <input
                      value={item.unit ?? ""}
                      onChange={(event) =>
                        patch({ unit: event.currentTarget.value || undefined })
                      }
                      placeholder="Unit"
                    />
                  </Field>
                ) : null}
                {expressionFieldError(error) === undefined ? null : (
                  <p className="expression-error" role="alert">
                    {expressionFieldError(error)}
                  </p>
                )}
              </div>
            ) : null}

            <label
              className={
                input ? "switch-row" : "switch-row switch-row-disabled"
              }
            >
              <span>
                <strong>May change during play</strong>
                <small>
                  Facilitators can change this value when resolving a problem.
                </small>
              </span>
              <input
                aria-label="May change during play"
                type="checkbox"
                checked={item.mutable_during_play}
                disabled={!input}
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
                <h3>Archive mechanic</h3>
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
          <h3>Preview</h3>
          <div className={`preview-card preview-${item.kind}`}>
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
            Values can be adjusted during roster setup or problem resolution.
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
  if (mechanic.source_kind === "derived")
    return <span className="preview-check">Calculated</span>;
  if (mechanic.mode === "binary")
    return <span className="preview-check">Not trained</span>;
  const value = mechanic.default_number ?? "0";
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
    source_kind: "input",
    name: "",
    description: undefined,
    step: kind === "capacity" ? "1" : undefined,
    default_number: kind === "capacity" ? "0" : undefined,
    mutable_during_play: true,
    archived: false,
    created_at: "",
    updated_at: "",
  };
}

function mechanicPayload(
  item: WorldMechanic,
  creating: boolean,
  rulesRevision: number,
) {
  return {
    id: creating ? undefined : item.id,
    kind: item.kind,
    mode: item.mode,
    source_kind: item.source_kind,
    name: item.name.trim(),
    description:
      item.description === undefined || item.description.trim() === ""
        ? undefined
        : item.description.trim(),
    minimum: canonicalOrOriginal(item.minimum),
    maximum: canonicalOrOriginal(item.maximum),
    step: canonicalOrOriginal(item.step),
    default_number: canonicalOrOriginal(item.default_number),
    unit:
      item.unit === undefined || item.unit.trim() === ""
        ? undefined
        : item.unit.trim(),
    mutable_during_play: item.mutable_during_play,
    expression:
      item.source_kind === "derived"
        ? canonicalExpression(item.expression)
        : undefined,
    archived: item.archived,
    expected_rules_revision: rulesRevision,
  };
}

type ValueKind = StateValue["kind"];
type ExpressionOperation = MechanicExpression["operation"];

interface ExpressionOperationOption {
  operation: ExpressionOperation;
  label: string;
  result?: ValueKind | undefined;
}

const expressionOperations: ExpressionOperationOption[] = [
  { operation: "mechanic-reference", label: "Value reference" },
  { operation: "literal", label: "Literal value" },
  { operation: "add-number", label: "Add", result: "number" },
  { operation: "subtract-number", label: "Subtract", result: "number" },
  { operation: "multiply-number", label: "Multiply", result: "number" },
  { operation: "min-number", label: "Minimum of", result: "number" },
  { operation: "max-number", label: "Maximum of", result: "number" },
  { operation: "negate-number", label: "Negate", result: "number" },
  { operation: "equal", label: "Equals", result: "boolean" },
  { operation: "less-than", label: "Less than", result: "boolean" },
  {
    operation: "less-than-or-equal",
    label: "Less than or equal",
    result: "boolean",
  },
  { operation: "greater-than", label: "Greater than", result: "boolean" },
  {
    operation: "greater-than-or-equal",
    label: "Greater than or equal",
    result: "boolean",
  },
  { operation: "and", label: "All are true", result: "boolean" },
  { operation: "or", label: "Any is true", result: "boolean" },
  { operation: "not", label: "Not", result: "boolean" },
  { operation: "if", label: "If / then / otherwise" },
];

function ExpressionEditor({
  expression,
  expectedKind,
  mechanics,
  onChange,
  depth = 0,
  label = "Result",
}: {
  expression: MechanicExpression;
  expectedKind?: ValueKind | undefined;
  mechanics: WorldMechanic[];
  onChange: (expression: MechanicExpression) => void;
  depth?: number;
  label?: string;
}) {
  const operationOptions = expressionOperations.filter(
    (option) =>
      expectedKind === undefined ||
      option.result === undefined ||
      option.result === expectedKind,
  );
  const referenceOptions = mechanics.filter(
    (mechanic) =>
      expectedKind === undefined ||
      mechanicValueKind(mechanic) === expectedKind,
  );
  const operands = "operands" in expression ? expression.operands : [];
  const variadic = [
    "add-number",
    "multiply-number",
    "min-number",
    "max-number",
    "and",
    "or",
  ].includes(expression.operation);

  function chooseOperation(operation: ExpressionOperation) {
    onChange(newExpression(operation, expectedKind, referenceOptions));
  }

  return (
    <div className={`expression-node expression-depth-${Math.min(depth, 4)}`}>
      <div className="expression-node-bar">
        <span>{label}</span>
        <select
          aria-label={`${label} calculation`}
          value={expression.operation}
          onChange={(event) =>
            chooseOperation(event.currentTarget.value as ExpressionOperation)
          }
        >
          {operationOptions.map((option) => (
            <option key={option.operation} value={option.operation}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {expression.operation === "literal" ? (
        expression.value.kind === "boolean" ? (
          <select
            aria-label={`${label} literal value`}
            value={String(expression.value.value)}
            onChange={(event) =>
              onChange({
                operation: "literal",
                value: {
                  kind: "boolean",
                  value: event.currentTarget.value === "true",
                },
              })
            }
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        ) : (
          <input
            aria-label={`${label} literal value`}
            type="text"
            inputMode="decimal"
            value={expression.value.value}
            required
            onChange={(event) =>
              onChange({
                operation: "literal",
                value: {
                  kind: "number",
                  value: event.currentTarget.value,
                },
              })
            }
          />
        )
      ) : null}

      {expression.operation === "mechanic-reference" ? (
        referenceOptions.length === 0 ? (
          <p className="expression-empty-reference">
            No saved {expectedKind ?? "compatible"} values are available yet.
          </p>
        ) : (
          <select
            aria-label={`${label} referenced value`}
            value={expression.mechanic_id}
            onChange={(event) =>
              onChange({
                operation: "mechanic-reference",
                mechanic_id: event.currentTarget.value,
              })
            }
          >
            {referenceOptions.map((mechanic) => (
              <option
                key={mechanic.id}
                value={mechanic.id}
                disabled={
                  mechanic.archived && mechanic.id !== expression.mechanic_id
                }
              >
                {mechanic.name} · {humanize(mechanicValueKind(mechanic))}
                {mechanic.archived ? " · archived" : ""}
              </option>
            ))}
          </select>
        )
      ) : null}

      {operands.length > 0 ? (
        <div className="expression-operands">
          {operands.map((operand, index) => {
            const childExpected = operandExpectedKind(
              expression,
              index,
              expectedKind,
              mechanics,
            );
            return (
              <div className="expression-operand" key={index}>
                <ExpressionEditor
                  expression={operand}
                  expectedKind={childExpected}
                  mechanics={mechanics}
                  depth={depth + 1}
                  label={operandLabel(expression.operation, index)}
                  onChange={(next) => {
                    if (!("operands" in expression)) return;
                    const nextOperands = [...expression.operands];
                    nextOperands[index] = next;
                    onChange({
                      ...expression,
                      operands: nextOperands,
                    } as MechanicExpression);
                  }}
                />
                {variadic && operands.length > 2 ? (
                  <button
                    className="expression-remove"
                    type="button"
                    aria-label={`Remove ${operandLabel(expression.operation, index)}`}
                    onClick={() => {
                      if (!("operands" in expression)) return;
                      onChange({
                        ...expression,
                        operands: expression.operands.filter(
                          (_candidate, candidateIndex) =>
                            candidateIndex !== index,
                        ),
                      } as MechanicExpression);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {variadic && "operands" in expression ? (
        <button
          className="expression-add"
          type="button"
          onClick={() => {
            const kind = operandExpectedKind(
              expression,
              expression.operands.length,
              expectedKind,
              mechanics,
            );
            onChange({
              ...expression,
              operands: [
                ...expression.operands,
                defaultExpression(kind ?? "number"),
              ],
            } as MechanicExpression);
          }}
        >
          ＋ Add operand
        </button>
      ) : null}
    </div>
  );
}

function newExpression(
  operation: ExpressionOperation,
  expectedKind: ValueKind | undefined,
  mechanics: WorldMechanic[],
): MechanicExpression {
  if (operation === "literal")
    return defaultExpression(expectedKind ?? "number");
  if (operation === "mechanic-reference")
    return {
      operation,
      mechanic_id:
        mechanics.find(
          (mechanic) =>
            expectedKind === undefined ||
            mechanicValueKind(mechanic) === expectedKind,
        )?.id ?? "",
    };
  const count = operation === "if" ? 3 : unaryOperation(operation) ? 1 : 2;
  const placeholder = {
    operation,
    operands: [],
  } as Extract<MechanicExpression, { operands: MechanicExpression[] }>;
  const operands = Array.from({ length: count }, (_value, index) =>
    defaultExpression(
      operandExpectedKind(placeholder, index, expectedKind, mechanics) ??
        "number",
    ),
  );
  return { operation, operands } as MechanicExpression;
}

function defaultExpression(kind: ValueKind): MechanicExpression {
  return {
    operation: "literal",
    value:
      kind === "boolean"
        ? { kind: "boolean", value: false }
        : { kind: "number", value: "0" },
  };
}

function unaryOperation(operation: ExpressionOperation): boolean {
  return operation === "negate-number" || operation === "not";
}

function mechanicValueKind(mechanic: Pick<WorldMechanic, "mode">): ValueKind {
  return mechanic.mode === "binary" ? "boolean" : "number";
}

function expressionResultKind(
  expression: MechanicExpression,
  mechanics: WorldMechanic[],
): ValueKind | undefined {
  if (expression.operation === "literal") return expression.value.kind;
  if (expression.operation === "mechanic-reference")
    return mechanicValueKind(
      mechanics.find((mechanic) => mechanic.id === expression.mechanic_id) ?? {
        mode: "score",
      },
    );
  if (
    [
      "equal",
      "less-than",
      "less-than-or-equal",
      "greater-than",
      "greater-than-or-equal",
      "and",
      "or",
      "not",
    ].includes(expression.operation)
  )
    return "boolean";
  if (expression.operation === "if")
    return expression.operands[1] === undefined
      ? undefined
      : expressionResultKind(expression.operands[1], mechanics);
  return "number";
}

function operandExpectedKind(
  expression: MechanicExpression,
  index: number,
  resultKind: ValueKind | undefined,
  mechanics: WorldMechanic[],
): ValueKind | undefined {
  switch (expression.operation) {
    case "add-number":
    case "subtract-number":
    case "multiply-number":
    case "min-number":
    case "max-number":
    case "negate-number":
    case "less-than":
    case "less-than-or-equal":
    case "greater-than":
    case "greater-than-or-equal":
      return "number";
    case "and":
    case "or":
    case "not":
      return "boolean";
    case "equal":
      return index === 0
        ? undefined
        : expression.operands[0] === undefined
          ? undefined
          : expressionResultKind(expression.operands[0], mechanics);
    case "if":
      if (index === 0) return "boolean";
      if (index === 1) return resultKind;
      return (
        resultKind ??
        (expression.operands[1] === undefined
          ? undefined
          : expressionResultKind(expression.operands[1], mechanics))
      );
    default:
      return resultKind;
  }
}

function operandLabel(operation: ExpressionOperation, index: number): string {
  if (operation === "if")
    return ["Condition", "Then", "Otherwise"][index] ?? `Value ${index + 1}`;
  if (
    operation === "subtract-number" ||
    operation.includes("than") ||
    operation === "equal"
  )
    return index === 0 ? "Left value" : "Right value";
  if (unaryOperation(operation)) return "Value";
  return `Value ${index + 1}`;
}

function expressionFieldError(error: ApiError | null): string | undefined {
  if (error === null) return undefined;
  return Object.entries(error.fields).find(([path]) =>
    path.includes("expression"),
  )?.[1];
}

function expressionReferences(
  expression: MechanicExpression | undefined,
  result = new Set<string>(),
): Set<string> {
  if (expression === undefined) return result;
  if (expression.operation === "mechanic-reference")
    result.add(expression.mechanic_id);
  if ("operands" in expression)
    for (const operand of expression.operands)
      expressionReferences(operand, result);
  return result;
}

function optionalDecimalText(value: string): DecimalText | undefined {
  if (value.trim() === "") return undefined;
  return value;
}

function canonicalOrOriginal(
  value: DecimalText | undefined,
): DecimalText | undefined {
  if (value === undefined) return undefined;
  return canonicalDecimalText(value) ?? value;
}

function canonicalExpression(
  expression: MechanicExpression | undefined,
): MechanicExpression | undefined {
  if (expression === undefined) return undefined;
  if (expression.operation === "literal")
    return expression.value.kind === "number"
      ? {
          ...expression,
          value: {
            kind: "number",
            value:
              canonicalDecimalText(expression.value.value) ??
              expression.value.value,
          },
        }
      : expression;
  if ("operands" in expression)
    return {
      ...expression,
      operands: expression.operands.map(
        (operand) => canonicalExpression(operand) ?? operand,
      ),
    } as MechanicExpression;
  return expression;
}

function mechanicSummary(item: WorldMechanic): string {
  if (item.source_kind === "derived")
    return `${humanize(item.mode)} · calculated`;
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
