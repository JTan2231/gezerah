import type { ReactNode } from "react";

import {
  Avatar,
  Brand,
  EmptyState,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";

interface PlayLibraryIssue {
  kind: "connection" | "request";
  message: string;
}

interface PlayLibraryWorld {
  id: string;
  name: string;
  description: string;
  role: "owner" | "editor" | "player" | "spectator";
  roleLabel: string;
  status: "active" | "archived";
  readiness: string;
  memberCount: number;
  lastActive: string;
}

interface PlayLibraryViewModel {
  account: {
    displayName: string;
    username: string;
  };
  worlds: readonly PlayLibraryWorld[];
  loading: boolean;
  issue: PlayLibraryIssue | null;
}

export function PlayLibraryView({
  model,
  accountControls,
  onReturnHome,
  onOpenWorld,
  onRetry,
}: {
  model: PlayLibraryViewModel;
  accountControls: ReactNode;
  onReturnHome: () => void;
  onOpenWorld: (worldID: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="library-page play-library-page">
      <header className="library-topbar">
        <button
          className="library-brand-button"
          type="button"
          onClick={onReturnHome}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <div className="account-menu">
          <Avatar name={model.account.displayName} size="small" />
          <span className="account-copy">
            <strong>{model.account.displayName}</strong>
            <small>@{model.account.username}</small>
          </span>
          {accountControls}
        </div>
      </header>

      <main className="library-main">
        <header className="library-heading">
          <div>
            <h1>Worlds</h1>
            <p>Worlds you can play in.</p>
          </div>
        </header>

        {model.loading ? <LoadingState label="Loading worlds" /> : null}
        {model.issue === null ? null : (
          <ErrorMessage error={model.issue} onRetry={onRetry} />
        )}
        {!model.loading && model.issue === null && model.worlds.length === 0 ? (
          <EmptyState
            title="No worlds"
            description="Use an invitation link to join a world."
          />
        ) : null}

        <div className="world-grid">
          {model.worlds.map((world) => (
            <article className="world-card play-world-card" key={world.id}>
              <header>
                <RolePill role={world.role} />
                <span
                  className={
                    world.status === "active"
                      ? "world-status"
                      : "world-status world-status-archived"
                  }
                >
                  {world.status}
                </span>
              </header>
              <button
                className="world-card-title"
                type="button"
                onClick={() => onOpenWorld(world.id)}
              >
                <span>
                  <strong>{world.name}</strong>
                  <small>{world.description}</small>
                </span>
              </button>
              <dl className="world-stats play-world-stats">
                <div>
                  <dt>Play role</dt>
                  <dd>{world.roleLabel}</dd>
                </div>
                <div>
                  <dt>Readiness</dt>
                  <dd>{world.readiness}</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{world.memberCount}</dd>
                </div>
              </dl>
              <footer>
                <span>Active {world.lastActive}</span>
                <div>
                  <button
                    className="button button-play"
                    type="button"
                    onClick={() => onOpenWorld(world.id)}
                  >
                    Open
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
