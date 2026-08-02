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
import { buildWorldURL, playWorldURL } from "../worldRoutes";
import type { BuildSection, Navigate } from "../worldRoutes";
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
}: {
  worldId: string;
  section: BuildSection;
  resourceId?: string | undefined;
  user: User;
  navigate: Navigate;
}) {
  const resource = useResource<World>(worldPath(worldId));
  const world = resource.value;
  const canEdit = world?.role === "owner" || world?.role === "editor";

  function go(next: BuildSection, selected?: string) {
    if (!confirmDiscardDraft()) return;
    navigate(buildWorldURL(worldId, next, selected));
  }

  if (resource.loading && world === null)
    return <LoadingState label="Opening Builder" />;
  if (resource.error !== null)
    return (
      <main className="boot-failure">
        <ErrorMessage error={resource.error} onRetry={resource.reload} />
        <button
          className="button button-quiet"
          type="button"
          onClick={() => navigate("/build")}
        >
          Back to Builder
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
            <strong>Builder access is not available</strong>
            <p>Only world owners and editors can open this studio.</p>
          </div>
        </div>
        <div className="access-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={() => navigate("/build")}
          >
            Back to Builder
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
          onClick={() => navigate("/")}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <div className="world-identity">
          <button type="button" onClick={() => navigate("/build")}>
            <span className="world-avatar" aria-hidden="true">
              {world.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{world.name}</strong>
              <small>
                Builder worlds <b aria-hidden="true">↗</b>
              </small>
            </span>
          </button>
          <RolePill role={world.role} />
        </div>

        <nav aria-label="World builder">
          <p>Mechanics</p>
          <button
            className={section === "capacities" ? "active" : ""}
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
            className={section === "capabilities" ? "active" : ""}
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
            className={section === "character-fields" ? "active" : ""}
            type="button"
            onClick={() => go("character-fields")}
          >
            <span className="nav-symbol" aria-hidden="true">
              ◫
            </span>
            <span>
              <strong>Character fields</strong>
              <small>Player onboarding</small>
            </span>
            <em>{world.character_field_count}</em>
          </button>
          <button
            className={section === "roster" ? "active" : ""}
            type="button"
            onClick={() => go("roster")}
          >
            <span className="nav-symbol" aria-hidden="true">
              ◎
            </span>
            <span>
              <strong>Roster & sheets</strong>
              <small>Entities & controllers</small>
            </span>
          </button>
          <button
            className={section === "people" ? "active" : ""}
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
            className={section === "settings" ? "active" : ""}
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
          onClick={() => navigate("/build")}
          aria-label="Builder worlds"
        >
          ←
        </button>
        <strong>{world.name}</strong>
        <select
          value={section}
          onChange={(event) => go(event.currentTarget.value as BuildSection)}
          aria-label="Builder section"
        >
          <option value="capacities">Capacities</option>
          <option value="capabilities">Capabilities</option>
          <option value="character-fields">Character fields</option>
          <option value="roster">Roster & sheets</option>
          <option value="people">People</option>
          <option value="settings">Settings</option>
        </select>
      </div>

      <main id="world-content" className="world-content" tabIndex={-1}>
        {section === "capacities" ? (
          <MechanicsWorkspace
            world={world}
            kind="capacity"
            selectedId={resourceId}
            navigate={navigate}
            onWorldChanged={resource.reload}
          />
        ) : null}
        {section === "capabilities" ? (
          <MechanicsWorkspace
            world={world}
            kind="capability"
            selectedId={resourceId}
            navigate={navigate}
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
          <RosterWorkspace
            world={world}
            user={user}
            onWorldChanged={resource.reload}
          />
        ) : null}
        {section === "people" ? <PeopleWorkspace world={world} /> : null}
        {section === "settings" ? (
          <SettingsWorkspace
            world={world}
            navigate={navigate}
            onWorldChanged={resource.reload}
          />
        ) : null}
      </main>
    </div>
  );
}
