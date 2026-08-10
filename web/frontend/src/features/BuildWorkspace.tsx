import type { AuthenticatedSession, User, World } from "../api/types";
import { toErrorNotice, worldPath } from "../api/client";
import { confirmDiscardDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import { buildWorldURL, playWorldURL } from "../worldRoutes";
import type { BuildSection, Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import {
  BuildAccessDeniedView,
  BuildWorkspaceFailureView,
  BuildWorkspaceLoadingView,
  BuildWorkspaceView,
} from "./BuildWorkspaceView";
import { MechanicsWorkspace } from "./MechanicsWorkspace";
import { CharacterFieldsWorkspace } from "./CharacterFieldsWorkspace";
import { PeopleWorkspace } from "./PeopleWorkspace";
import { RosterWorkspace } from "./RosterWorkspace";
import { SettingsWorkspace } from "./SettingsWorkspace";

export function BuildWorkspace({
  worldId,
  section,
  resourceId,
  user,
  navigate,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  worldId: string;
  section: BuildSection;
  resourceId?: string | undefined;
  user: User;
  navigate: Navigate;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const resource = useResource<World>(worldPath(worldId));
  const world = resource.value;
  const canEdit = world?.role === "owner" || world?.role === "editor";

  const guardedNavigate: Navigate = (path, options) => {
    if (!confirmDiscardDraft()) return;
    navigate(path, options);
  };

  function go(next: BuildSection, selected?: string) {
    guardedNavigate(buildWorldURL(worldId, next, selected));
  }

  async function guardedLogout() {
    if (!confirmDiscardDraft()) return;
    await onLogout();
  }

  async function guardedLogoutAll() {
    if (!confirmDiscardDraft()) return;
    await onLogoutAll();
  }

  if (resource.loading && world === null) return <BuildWorkspaceLoadingView />;
  if (resource.error !== null)
    return (
      <BuildWorkspaceFailureView
        error={toErrorNotice(resource.error)}
        onRetry={resource.reload}
        onBack={() => navigate("/build")}
      />
    );
  if (world === null) return null;

  if (!canEdit)
    return (
      <BuildAccessDeniedView
        onBack={() => navigate("/build")}
        onOpenPlay={() => navigate(playWorldURL(world.id))}
      />
    );
  const editableRole = world.role === "owner" ? "owner" : "editor";

  return (
    <BuildWorkspaceView
      model={{
        section,
        worldName: world.name,
        role: editableRole,
        capacityCount: world.capacity_count,
        capabilityCount: world.capability_count,
        characterFieldCount: world.character_field_count,
        memberCount: world.member_count,
        user: { displayName: user.display_name, username: user.username },
      }}
      actions={{
        openHome: () => guardedNavigate("/"),
        openWorldLibrary: () => guardedNavigate("/build"),
        selectSection: (next) => go(next),
      }}
      desktopAccountControls={
        <AccountControls
          user={user}
          onLogout={guardedLogout}
          onLogoutAll={guardedLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
      mobileAccountControls={
        <AccountControls
          user={user}
          onLogout={guardedLogout}
          onLogoutAll={guardedLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
    >
      {section === "capacities" ? (
        <MechanicsWorkspace
          world={world}
          kind="capacity"
          selectedId={resourceId}
          navigate={guardedNavigate}
          onWorldChanged={resource.reload}
        />
      ) : null}
      {section === "capabilities" ? (
        <MechanicsWorkspace
          world={world}
          kind="capability"
          selectedId={resourceId}
          navigate={guardedNavigate}
          onWorldChanged={resource.reload}
        />
      ) : null}
      {section === "character-fields" ? (
        <CharacterFieldsWorkspace
          world={world}
          onWorldChanged={resource.reload}
        />
      ) : null}
      {section === "roster" ? (
        <RosterWorkspace world={world} onWorldChanged={resource.reload} />
      ) : null}
      {section === "people" ? <PeopleWorkspace world={world} /> : null}
      {section === "settings" ? (
        <SettingsWorkspace
          world={world}
          navigate={guardedNavigate}
          onWorldChanged={resource.reload}
        />
      ) : null}
    </BuildWorkspaceView>
  );
}
