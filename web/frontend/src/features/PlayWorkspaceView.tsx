import type { ReactNode } from "react";

import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
  type ErrorNotice,
} from "../components/StudioUI";

export function PlayWorkspaceView({
  worldName,
  agentMode,
  currentPlayRoleLabel,
  user,
  accountControls,
  onHome,
  onWorldLibrary,
  children,
}: {
  worldName: string;
  agentMode: boolean;
  currentPlayRoleLabel: string;
  user: { displayName: string; username: string };
  accountControls: ReactNode;
  onHome: () => void;
  onWorldLibrary: () => void;
  children: ReactNode;
}) {
  return (
    <div className="play-app world-section-play">
      <a className="skip-link" href="#play-content">
        Skip to content
      </a>
      <header className="play-app-bar">
        {agentMode ? (
          <span className="play-brand-button" aria-label="Wrought">
            <Brand compact />
          </span>
        ) : (
          <button
            className="play-brand-button"
            type="button"
            onClick={onHome}
            aria-label="Return home"
          >
            <Brand compact />
          </button>
        )}
        {agentMode ? (
          <div className="play-world-return">
            <span>
              <small>Attached World</small>
              <strong>{worldName}</strong>
            </span>
          </div>
        ) : (
          <button
            className="play-world-return"
            type="button"
            onClick={onWorldLibrary}
          >
            <span aria-hidden="true">←</span>
            <span>
              <small>All worlds</small>
              <strong>{worldName}</strong>
            </span>
          </button>
        )}
        <div className="play-app-account">
          <RolePill role={currentPlayRoleLabel} />
          <Avatar name={user.displayName} size="small" />
          <span className="play-account-name">
            <strong>{user.displayName}</strong>
            <small>@{user.username}</small>
          </span>
          {accountControls}
        </div>
      </header>
      <main id="play-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

export function PlayWorkspaceLoadingView() {
  return (
    <main className="play-app play-app-boot">
      <LoadingState label="Loading world" />
    </main>
  );
}

export function PlayWorkspaceFailureView({
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
        Back to Play
      </button>
    </main>
  );
}
