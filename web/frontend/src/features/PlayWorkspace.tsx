import { worldPath } from "../api/client";
import type { AuthenticatedSession, User, World } from "../api/types";
import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";
import { useResource } from "../hooks/useResource";
import type { Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import { WorldPlay } from "./WorldPlay";

export function PlayWorkspace({
  worldId,
  user,
  navigate,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  worldId: string;
  user: User;
  navigate: Navigate;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const resource = useResource<World>(worldPath(worldId));
  const world = resource.value;

  if (resource.loading && world === null)
    return (
      <main className="play-app play-app-boot">
        <LoadingState label="Loading world" />
      </main>
    );
  if (resource.error !== null)
    return (
      <main className="boot-failure">
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
        <button
          className="button button-quiet"
          type="button"
          onClick={() => navigate("/play")}
        >
          Back to Play
        </button>
      </main>
    );
  if (world === null) return null;

  return (
    <div className="play-app world-section-play">
      <a className="skip-link" href="#play-content">
        Skip to content
      </a>
      <header className="play-app-bar">
        <button
          className="play-brand-button"
          type="button"
          onClick={() => navigate("/")}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <button
          className="play-world-return"
          type="button"
          onClick={() => navigate("/play")}
        >
          <span aria-hidden="true">←</span>
          <span>
            <small>All worlds</small>
            <strong>{world.name}</strong>
          </span>
        </button>
        <div className="play-app-account">
          <RolePill role={world.role} />
          <Avatar name={user.display_name} size="small" />
          <span className="play-account-name">
            <strong>{user.display_name}</strong>
            <small>@{user.username}</small>
          </span>
          <AccountControls
            user={user}
            onLogout={onLogout}
            onLogoutAll={onLogoutAll}
            onSessionChanged={onSessionChanged}
          />
        </div>
      </header>
      <main id="play-content" tabIndex={-1}>
        <WorldPlay world={world} user={user} onWorldChanged={resource.reload} />
      </main>
    </div>
  );
}
