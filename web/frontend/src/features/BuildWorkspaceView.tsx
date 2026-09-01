import type { ReactNode } from "react";

import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
  type ErrorNotice,
} from "../components/StudioUI";

type BuildViewSection =
  | "capacities"
  | "capabilities"
  | "character-fields"
  | "roster"
  | "members"
  | "settings";

interface BuildWorkspaceViewModel {
  section: BuildViewSection;
  worldName: string;
  role: "owner" | "editor";
  capacityCount: number;
  capabilityCount: number;
  characterFieldCount: number;
  memberCount: number;
  user: { displayName: string; username: string };
}

interface BuildWorkspaceViewActions {
  openHome: () => void;
  openWorldLibrary: () => void;
  selectSection: (section: BuildViewSection) => void;
}

export function BuildWorkspaceView({
  model,
  actions,
  desktopAccountControls,
  mobileAccountControls,
  children,
}: {
  model: BuildWorkspaceViewModel;
  actions: BuildWorkspaceViewActions;
  desktopAccountControls: ReactNode;
  mobileAccountControls: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`world-workspace build-workspace build-section-${model.section}`}
    >
      <a className="skip-link" href="#world-content">
        Skip to world content
      </a>
      <aside className="world-sidebar">
        <button
          className="sidebar-brand-button"
          type="button"
          onClick={actions.openHome}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <div className="world-identity">
          <button type="button" onClick={actions.openWorldLibrary}>
            <span>
              <strong>{model.worldName}</strong>
              <small>Worlds</small>
            </span>
          </button>
          <RolePill role={model.role} />
        </div>

        <nav aria-label="Build navigation">
          <p>Mechanics</p>
          <BuildNavigationButton
            active={model.section === "capacities"}
            label="Capacities"
            count={model.capacityCount}
            onClick={() => actions.selectSection("capacities")}
          />
          <BuildNavigationButton
            active={model.section === "capabilities"}
            label="Capabilities"
            count={model.capabilityCount}
            onClick={() => actions.selectSection("capabilities")}
          />
          <p>World</p>
          <BuildNavigationButton
            active={model.section === "character-fields"}
            label="Character fields"
            count={model.characterFieldCount}
            onClick={() => actions.selectSection("character-fields")}
          />
          <BuildNavigationButton
            active={model.section === "roster"}
            label="Roster & sheets"
            onClick={() => actions.selectSection("roster")}
          />
          <BuildNavigationButton
            active={model.section === "members"}
            label="Members & invites"
            count={model.memberCount}
            onClick={() => actions.selectSection("members")}
          />
          <BuildNavigationButton
            active={model.section === "settings"}
            label="Settings"
            onClick={() => actions.selectSection("settings")}
          />
        </nav>
        <div className="sidebar-user">
          <Avatar name={model.user.displayName} size="small" />
          <span className="sidebar-account-copy">
            <strong>{model.user.displayName}</strong>
            <small>@{model.user.username}</small>
          </span>
          {desktopAccountControls}
        </div>
      </aside>

      <div className="world-mobile-bar">
        <button
          type="button"
          onClick={actions.openWorldLibrary}
          aria-label="Build worlds"
        >
          ←
        </button>
        <strong>{model.worldName}</strong>
        <select
          value={model.section}
          onChange={(event) =>
            actions.selectSection(event.currentTarget.value as BuildViewSection)
          }
          aria-label="Build section"
        >
          <option value="capacities">Capacities</option>
          <option value="capabilities">Capabilities</option>
          <option value="character-fields">Character fields</option>
          <option value="roster">Roster & sheets</option>
          <option value="members">Members</option>
          <option value="settings">Settings</option>
        </select>
        <div className="mobile-account-controls">{mobileAccountControls}</div>
      </div>

      <main id="world-content" className="world-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function BuildNavigationButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number | undefined;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      <span>
        <strong>{label}</strong>
      </span>
      {count === undefined ? null : <em>{count}</em>}
    </button>
  );
}

export function BuildWorkspaceLoadingView() {
  return <LoadingState label="Opening Build" />;
}

export function BuildWorkspaceFailureView({
  error,
  onRetry,
  onBack,
}: {
  error: ErrorNotice;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <main className="boot-failure">
      <ErrorMessage error={error} onRetry={onRetry} />
      <button className="button button-quiet" type="button" onClick={onBack}>
        Back to Build
      </button>
    </main>
  );
}

export function BuildAccessDeniedView({
  onBack,
  onOpenPlay,
}: {
  onBack: () => void;
  onOpenPlay: () => void;
}) {
  return (
    <main className="boot-failure">
      <Brand />
      <div className="notice" role="alert">
        <div>
          <strong>Build access is not available</strong>
          <p>Only world owners and editors can open Build.</p>
        </div>
      </div>
      <div className="access-actions">
        <button className="button button-quiet" type="button" onClick={onBack}>
          Back to Build
        </button>
        <button
          className="button button-ink"
          type="button"
          onClick={onOpenPlay}
        >
          Open in Play
        </button>
      </div>
    </main>
  );
}
