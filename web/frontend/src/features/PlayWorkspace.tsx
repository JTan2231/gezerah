import { selectUserId, worldPath } from "../api/client";
import type { User, World } from "../api/types";
import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";
import { useResource } from "../hooks/useResource";
import type { Navigate } from "../worldRoutes";
import { WorldPlay } from "./WorldPlay";

export function PlayWorkspace({
  worldId,
  user,
  navigate,
  onSwitchProfile,
}: {
  worldId: string;
  user: User;
  navigate: Navigate;
  onSwitchProfile: () => void;
}) {
  const resource = useResource<World>(worldPath(worldId));
  const world = resource.value;

  if (resource.loading && world === null)
    return (
      <main className="play-app play-app-boot">
        <LoadingState label="Opening the table" />
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
          Back to your tables
        </button>
      </main>
    );
  if (world === null) return null;

  return (
    <div className="play-app world-section-play">
      <a className="skip-link" href="#play-content">
        Skip to table
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
            <small>All tables</small>
            <strong>{world.name}</strong>
          </span>
        </button>
        <div className="play-app-account">
          <RolePill role={world.role} />
          <Avatar name={user.display_name} size="small" />
          <button
            className="text-button"
            type="button"
            onClick={() => {
              selectUserId("");
              onSwitchProfile();
            }}
          >
            Switch profile
          </button>
        </div>
      </header>
      <main id="play-content" tabIndex={-1}>
        <WorldPlay world={world} user={user} onWorldChanged={resource.reload} />
      </main>
    </div>
  );
}
