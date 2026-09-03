import { toErrorNotice, worldPath } from "../api/client";
import type { AuthenticatedSession, User, World } from "../api/types";
import { humanize } from "../domain/display";
import { useResource } from "../hooks/useResource";
import { homeURL, playLibraryURL, type Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import {
  PlayWorkspaceFailureView,
  PlayWorkspaceLoadingView,
  PlayWorkspaceView,
} from "./PlayWorkspaceView";
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

  if (resource.loading && world === null) return <PlayWorkspaceLoadingView />;
  if (resource.error !== null)
    return (
      <PlayWorkspaceFailureView
        error={toErrorNotice(resource.error)}
        onRetry={resource.reload}
        onBack={() => navigate(playLibraryURL())}
      />
    );
  if (world === null) return null;

  return (
    <PlayWorkspaceView
      worldName={world.name}
      agentMode={world.facilitator.source === "agent"}
      currentPlayRoleLabel={
        world.current_play_role === "facilitator"
          ? "Facilitator"
          : humanize(world.current_play_role)
      }
      user={{ displayName: user.display_name, username: user.username }}
      accountControls={
        <AccountControls
          user={user}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
      onHome={() => navigate(homeURL())}
      onWorldLibrary={() => navigate(playLibraryURL())}
    >
      <WorldPlay world={world} user={user} onWorldChanged={resource.reload} />
    </PlayWorkspaceView>
  );
}
