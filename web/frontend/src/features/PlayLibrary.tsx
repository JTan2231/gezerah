import type { AuthenticatedSession, User, World } from "../api/types";
import { toErrorNotice } from "../api/client";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { playWorldURL, type Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import { PlayLibraryView } from "./PlayLibraryView";

export function PlayLibrary({
  user,
  navigate,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  user: User;
  navigate: Navigate;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const worlds = useCollection<World>("/api/worlds");

  return (
    <PlayLibraryView
      model={{
        account: {
          displayName: user.display_name,
          username: user.username,
        },
        worlds: worlds.items.map((world) => ({
          id: world.id,
          name: world.name,
          description: world.description ?? "No description",
          role: world.role,
          roleLabel: humanize(world.role),
          status: world.status,
          readiness: playStatus(world),
          memberCount: world.member_count,
          lastActive: formatRelativeDate(
            world.last_interaction_at ?? world.updated_at,
          ),
        })),
        loading: worlds.loading,
        issue: worlds.error === null ? null : toErrorNotice(worlds.error),
      }}
      accountControls={
        <AccountControls
          user={user}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
      onReturnHome={() => navigate("/")}
      onOpenWorld={(worldID) => navigate(playWorldURL(worldID))}
      onRetry={worlds.reload}
    />
  );
}

function playStatus(world: World): string {
  if (world.status === "archived") return "Read only";
  if (world.role !== "player") return "Ready";
  switch (world.play_status) {
    case "waiting-for-character":
      return "Waiting";
    case "setup-required":
      return "Setup";
    case "ready":
      return "Ready";
    case "unavailable":
      return "Unavailable";
  }
}
