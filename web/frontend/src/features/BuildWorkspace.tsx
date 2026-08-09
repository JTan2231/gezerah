import type { AuthenticatedSession, User, World } from "../api/types";
import { worldPath } from "../api/client";
import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";
import { confirmDiscardDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import { buildWorldURL, playWorldURL } from "../worldRoutes";
import type { BuildSection, Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
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

  if (resource.loading && world === null)
    return <LoadingState label="Opening Build" />;
  if (resource.error !== null)
    return (
      <main className="boot-failure">
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
        <button
          className="button button-quiet"
          type="button"
          onClick={() => navigate("/build")}
        >
          Back to Build
        </button>
      </main>
    );
  if (world === null) return null;

  if (!canEdit)
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
          <button
            className="button button-quiet"
            type="button"
            onClick={() => navigate("/build")}
          >
            Back to Build
          </button>
          <button
            className="button button-ink"
            type="button"
            onClick={() => navigate(playWorldURL(world.id))}
          >
            Open in Play
          </button>
        </div>
      </main>
    );

  return (
    <div className={`world-workspace build-workspace build-section-${section}`}>
      <a className="skip-link" href="#world-content">
        Skip to world content
      </a>
      <aside className="world-sidebar">
        <button
          className="sidebar-brand-button"
          type="button"
          onClick={() => guardedNavigate("/")}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <div className="world-identity">
          <button type="button" onClick={() => guardedNavigate("/build")}>
            <span>
              <strong>{world.name}</strong>
              <small>Worlds</small>
            </span>
          </button>
          <RolePill role={world.role} />
        </div>

        <nav aria-label="Build navigation">
          <p>Mechanics</p>
          <button
            className={section === "capacities" ? "active" : ""}
            type="button"
            onClick={() => go("capacities")}
          >
            <span>
              <strong>Capacities</strong>
            </span>
            <em>{world.capacity_count}</em>
          </button>
          <button
            className={section === "capabilities" ? "active" : ""}
            type="button"
            onClick={() => go("capabilities")}
          >
            <span>
              <strong>Capabilities</strong>
            </span>
            <em>{world.capability_count}</em>
          </button>
          <p>World</p>
          <button
            className={section === "character-fields" ? "active" : ""}
            type="button"
            onClick={() => go("character-fields")}
          >
            <span>
              <strong>Character fields</strong>
            </span>
            <em>{world.character_field_count}</em>
          </button>
          <button
            className={section === "roster" ? "active" : ""}
            type="button"
            onClick={() => go("roster")}
          >
            <span>
              <strong>Roster & sheets</strong>
            </span>
          </button>
          <button
            className={section === "people" ? "active" : ""}
            type="button"
            onClick={() => go("people")}
          >
            <span>
              <strong>People & invites</strong>
            </span>
            <em>{world.member_count}</em>
          </button>
          <button
            className={section === "settings" ? "active" : ""}
            type="button"
            onClick={() => go("settings")}
          >
            <span>
              <strong>Settings</strong>
            </span>
          </button>
        </nav>
        <div className="sidebar-user">
          <Avatar name={user.display_name} size="small" />
          <span className="sidebar-account-copy">
            <strong>{user.display_name}</strong>
            <small>@{user.username}</small>
          </span>
          <AccountControls
            user={user}
            onLogout={guardedLogout}
            onLogoutAll={guardedLogoutAll}
            onSessionChanged={onSessionChanged}
          />
        </div>
      </aside>

      <div className="world-mobile-bar">
        <button
          type="button"
          onClick={() => guardedNavigate("/build")}
          aria-label="Build worlds"
        >
          ←
        </button>
        <strong>{world.name}</strong>
        <select
          value={section}
          onChange={(event) => go(event.currentTarget.value as BuildSection)}
          aria-label="Build section"
        >
          <option value="capacities">Capacities</option>
          <option value="capabilities">Capabilities</option>
          <option value="character-fields">Character fields</option>
          <option value="roster">Roster & sheets</option>
          <option value="people">People</option>
          <option value="settings">Settings</option>
        </select>
        <div className="mobile-account-controls">
          <AccountControls
            user={user}
            onLogout={guardedLogout}
            onLogoutAll={guardedLogoutAll}
            onSessionChanged={onSessionChanged}
          />
        </div>
      </div>

      <main id="world-content" className="world-content" tabIndex={-1}>
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
      </main>
    </div>
  );
}
