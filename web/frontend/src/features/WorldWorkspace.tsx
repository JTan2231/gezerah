import type { User, World } from "../api/types";
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
import type { WorldSection } from "../worldRoutes";
import { worldURL } from "../worldRoutes";
import { MechanicsWorkspace } from "./MechanicsWorkspace";
import { PeopleWorkspace } from "./PeopleWorkspace";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { WorldPlay } from "./WorldPlay";

export function WorldWorkspace({
  worldId,
  section,
  resourceId,
  user,
  navigate,
}: {
  worldId: string;
  section: WorldSection;
  resourceId?: string | undefined;
  user: User;
  navigate: (path: string) => void;
}) {
  const resource = useResource<World>(worldPath(worldId));
  const world = resource.value;
  const canEdit = world?.role === "owner" || world?.role === "editor";

  function go(next: WorldSection, selected?: string) {
    if (!confirmDiscardDraft()) return;
    navigate(worldURL(worldId, next, selected));
  }

  if (resource.loading && world === null)
    return <LoadingState label="Opening the world" />;
  if (resource.error !== null)
    return (
      <main className="boot-failure">
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
        <button
          className="button button-quiet"
          type="button"
          onClick={() => navigate("/worlds")}
        >
          Back to your worlds
        </button>
      </main>
    );
  if (world === null) return null;

  const effectiveSection = !canEdit && section !== "play" ? "play" : section;
  return (
    <div className={`world-workspace world-section-${effectiveSection}`}>
      <a className="skip-link" href="#world-content">
        Skip to world content
      </a>
      <aside className="world-sidebar">
        <button
          className="sidebar-brand-button"
          type="button"
          onClick={() => navigate("/worlds")}
          aria-label="Return to your worlds"
        >
          <Brand compact />
        </button>
        <div className="world-identity">
          <button type="button" onClick={() => navigate("/worlds")}>
            <span className="world-avatar" aria-hidden="true">
              {world.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{world.name}</strong>
              <small>
                All worlds <b aria-hidden="true">↗</b>
              </small>
            </span>
          </button>
          <RolePill role={world.role} />
        </div>

        {canEdit ? (
          <nav aria-label="World configuration">
            <p>Mechanics</p>
            <button
              className={effectiveSection === "capacities" ? "active" : ""}
              type="button"
              onClick={() => go("capacities")}
            >
              <span className="nav-symbol" aria-hidden="true">
                ◇
              </span>
              <span>
                <strong>Capacities</strong>
                <small>Values & resources</small>
              </span>
              <em>{world.capacity_count}</em>
            </button>
            <button
              className={effectiveSection === "capabilities" ? "active" : ""}
              type="button"
              onClick={() => go("capabilities")}
            >
              <span className="nav-symbol" aria-hidden="true">
                ✦
              </span>
              <span>
                <strong>Capabilities</strong>
                <small>Skills & proficiencies</small>
              </span>
              <em>{world.capability_count}</em>
            </button>
            <p>World</p>
            <button
              className={effectiveSection === "people" ? "active" : ""}
              type="button"
              onClick={() => go("people")}
            >
              <span className="nav-symbol" aria-hidden="true">
                ○
              </span>
              <span>
                <strong>People & invites</strong>
                <small>{world.member_count} at the table</small>
              </span>
            </button>
            <button
              className={effectiveSection === "settings" ? "active" : ""}
              type="button"
              onClick={() => go("settings")}
            >
              <span className="nav-symbol" aria-hidden="true">
                ⌁
              </span>
              <span>
                <strong>Settings</strong>
                <small>Details & lifecycle</small>
              </span>
            </button>
          </nav>
        ) : (
          <div className="player-sidebar-note">
            <p className="eyebrow">Your place</p>
            <strong>{world.role === "player" ? "Player" : "Spectator"}</strong>
            <span>The authors manage this world’s mechanics.</span>
          </div>
        )}

        <button
          className={
            effectiveSection === "play" ? "enter-play active" : "enter-play"
          }
          type="button"
          onClick={() => go("play")}
        >
          <span className="play-pulse" aria-hidden="true" />
          <span>
            <strong>Enter play</strong>
            <small>Problems happen here</small>
          </span>
          <b aria-hidden="true">→</b>
        </button>
        <div className="sidebar-user">
          <Avatar name={user.display_name} size="small" />
          <span>
            <strong>{user.display_name}</strong>
            <small>Local profile</small>
          </span>
        </div>
      </aside>

      <div className="world-mobile-bar">
        <button
          type="button"
          onClick={() => navigate("/worlds")}
          aria-label="All worlds"
        >
          ←
        </button>
        <strong>{world.name}</strong>
        <select
          value={effectiveSection}
          onChange={(event) => go(event.currentTarget.value as WorldSection)}
          aria-label="World section"
        >
          {canEdit ? <option value="capacities">Capacities</option> : null}
          {canEdit ? <option value="capabilities">Capabilities</option> : null}
          {canEdit ? <option value="people">People</option> : null}
          {canEdit ? <option value="settings">Settings</option> : null}
          <option value="play">Play</option>
        </select>
      </div>

      <main id="world-content" className="world-content" tabIndex={-1}>
        {effectiveSection === "capacities" ? (
          <MechanicsWorkspace
            world={world}
            kind="capacity"
            selectedId={resourceId}
            navigate={navigate}
            onWorldChanged={resource.reload}
          />
        ) : null}
        {effectiveSection === "capabilities" ? (
          <MechanicsWorkspace
            world={world}
            kind="capability"
            selectedId={resourceId}
            navigate={navigate}
            onWorldChanged={resource.reload}
          />
        ) : null}
        {effectiveSection === "people" ? (
          <PeopleWorkspace world={world} />
        ) : null}
        {effectiveSection === "settings" ? (
          <SettingsWorkspace
            world={world}
            navigate={navigate}
            onWorldChanged={resource.reload}
          />
        ) : null}
        {effectiveSection === "play" ? (
          <WorldPlay world={world} user={user} />
        ) : null}
      </main>
    </div>
  );
}
