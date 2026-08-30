import { useId, type KeyboardEvent, type ReactNode } from "react";

import { ErrorMessage } from "../components/StudioUI";

type EntityDetailTab = "profile" | "sheet";

export interface EntitySheetIssue {
  kind: "connection" | "request";
  message: string;
}

interface StatusInstanceViewModel {
  id: string;
  name: string;
  details: string;
}

interface EntityModifierViewModel {
  id: string;
  statusName: string;
  summary: string;
}

interface EntitySheetMechanicViewModel {
  id: string;
  kind: "capacity" | "capability";
  mode: "score" | "pool" | "binary" | "rating";
  sourceKind: "input" | "derived";
  name: string;
  description?: string | undefined;
  maximum?: string | undefined;
  unit?: string | undefined;
  effectiveValue: string;
  modifiers: EntityModifierViewModel[];
}

export function EntityDetailView({
  tab,
  showControllers,
  profilePanel,
  sheetPanel,
  onSelectTab,
  onManageControllers,
}: {
  tab: EntityDetailTab;
  showControllers: boolean;
  profilePanel: ReactNode;
  sheetPanel: ReactNode;
  onSelectTab: (tab: EntityDetailTab) => void;
  onManageControllers: () => void;
}) {
  const tabsID = useId();
  const profileTabID = `${tabsID}-profile-tab`;
  const profilePanelID = `${tabsID}-profile-panel`;
  const sheetTabID = `${tabsID}-sheet-tab`;
  const sheetPanelID = `${tabsID}-sheet-panel`;

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextTab: EntityDetailTab | undefined;
    if (event.key === "ArrowLeft" || event.key === "Home") nextTab = "profile";
    if (event.key === "ArrowRight" || event.key === "End") nextTab = "sheet";
    if (nextTab === undefined) return;
    event.preventDefault();
    const tabList = event.currentTarget.parentElement;
    onSelectTab(nextTab);
    window.requestAnimationFrame(() => {
      tabList
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus();
    });
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
            id={profileTabID}
            role="tab"
            aria-selected={tab === "profile"}
            aria-controls={profilePanelID}
            tabIndex={tab === "profile" ? 0 : -1}
            className={tab === "profile" ? "active" : ""}
            onClick={() => onSelectTab("profile")}
            onKeyDown={handleTabKeyDown}
          >
            Profile
          </button>
          <button
            type="button"
            id={sheetTabID}
            role="tab"
            aria-selected={tab === "sheet"}
            aria-controls={sheetPanelID}
            tabIndex={tab === "sheet" ? 0 : -1}
            className={tab === "sheet" ? "active" : ""}
            onClick={() => onSelectTab("sheet")}
            onKeyDown={handleTabKeyDown}
          >
            Sheet
          </button>
        </div>
        {showControllers ? (
          <button
            className="text-button"
            type="button"
            onClick={onManageControllers}
          >
            Controllers
          </button>
        ) : null}
      </div>
      <div
        id={tab === "profile" ? profilePanelID : sheetPanelID}
        role="tabpanel"
        aria-labelledby={tab === "profile" ? profileTabID : sheetTabID}
      >
        {tab === "profile" ? profilePanel : sheetPanel}
      </div>
    </div>
  );
}

export function EntitySheetView({
  displayName,
  metadata,
  statusInstances,
  mechanics,
  editable,
  logicalInputValues,
  saving,
  issue,
  onValueChange,
  onSubmit,
}: {
  displayName: string;
  metadata: string;
  statusInstances: StatusInstanceViewModel[];
  mechanics: EntitySheetMechanicViewModel[];
  editable: boolean;
  logicalInputValues: Record<string, string | boolean>;
  saving: boolean;
  issue: EntitySheetIssue | null;
  onValueChange: (mechanicId: string, value: string | boolean) => void;
  onSubmit: () => void;
}) {
  const hasEditableInputs = mechanics.some(
    (mechanic) => mechanic.sourceKind === "input",
  );

  return (
    <form
      className="entity-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <header>
        <div>
          <h2>{displayName}</h2>
          <span>{metadata}</span>
        </div>
      </header>
      {statusInstances.length > 0 ? (
        <section
          className="status-instances"
          aria-label="Active status instances"
        >
          <h3>Active status instances</h3>
          <div>
            {statusInstances.map((status) => (
              <span
                className="status-instance-chip"
                key={status.id}
                title={status.details}
                aria-label={`${status.name}. ${status.details}`}
              >
                <span>
                  <strong>{status.name}</strong>
                  <small>{status.details}</small>
                </span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
      {mechanics.length === 0 ? (
        <p className="sheet-empty">
          Configure a capacity or capability to generate this sheet.
        </p>
      ) : null}
      {(["capacity", "capability"] as const).map((kind) => {
        const group = mechanics.filter((mechanic) => mechanic.kind === kind);
        if (group.length === 0) return null;
        return (
          <section className="sheet-group" key={kind}>
            <h3>{kind === "capacity" ? "Capacities" : "Capabilities"}</h3>
            {group.map((mechanic) => (
              <div
                key={mechanic.id}
                className={`sheet-field sheet-${mechanic.mode} sheet-source-${mechanic.sourceKind}`}
              >
                <span>
                  <strong>
                    {mechanic.name}
                    <small className="mechanic-source-pill">
                      {mechanic.sourceKind === "derived" ? "Derived" : "Input"}
                    </small>
                  </strong>
                  {mechanic.description === undefined ? null : (
                    <small>{mechanic.description}</small>
                  )}
                </span>
                {mechanic.sourceKind === "input" &&
                editable &&
                mechanic.mode === "binary" ? (
                  <input
                    aria-label={mechanic.name}
                    type="checkbox"
                    checked={Boolean(logicalInputValues[mechanic.id])}
                    onChange={(event) =>
                      onValueChange(mechanic.id, event.currentTarget.checked)
                    }
                  />
                ) : mechanic.sourceKind === "input" && editable ? (
                  <span className="sheet-number">
                    <input
                      aria-label={mechanic.name}
                      type="text"
                      inputMode="decimal"
                      value={decimalInputValue(logicalInputValues[mechanic.id])}
                      required
                      onChange={(event) =>
                        onValueChange(mechanic.id, event.currentTarget.value)
                      }
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
                    {mechanic.effectiveValue}
                  </output>
                )}
                {mechanic.sourceKind === "input" && editable ? (
                  <span className="sheet-effective-summary">
                    Effective: <strong>{mechanic.effectiveValue}</strong>
                  </span>
                ) : null}
                {mechanic.modifiers.length > 0 ? (
                  <ol className="modifier-explanation">
                    {mechanic.modifiers.map((modifier) => (
                      <li key={modifier.id}>
                        <span>{modifier.statusName}</span>
                        <small>{modifier.summary}</small>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ))}
          </section>
        );
      })}
      {issue === null ? null : <ErrorMessage error={issue} />}
      {editable && hasEditableInputs ? (
        <footer>
          <span>Logical input values</span>
          <button className="button button-ink" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save logical state"}
          </button>
        </footer>
      ) : null}
    </form>
  );
}

function decimalInputValue(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "0";
}
