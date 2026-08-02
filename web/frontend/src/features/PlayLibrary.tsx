import { selectUserId } from "../api/client";
import type { User, World } from "../api/types";
import {
  Avatar,
  Brand,
  EmptyState,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { playWorldURL, type Navigate } from "../worldRoutes";

export function PlayLibrary({
  user,
  navigate,
  onSwitchProfile,
}: {
  user: User;
  navigate: Navigate;
  onSwitchProfile: () => void;
}) {
  const worlds = useCollection<World>("/api/worlds");

  return (
    <div className="library-page play-library-page">
      <header className="library-topbar">
        <button
          className="library-brand-button"
          type="button"
          onClick={() => navigate("/")}
          aria-label="Return home"
        >
          <Brand compact />
        </button>
        <div className="account-menu">
          <Avatar name={user.display_name} size="small" />
          <span>{user.display_name}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              selectUserId("");
              onSwitchProfile();
            }}
          >
            Switch
          </button>
        </div>
      </header>

      <main className="library-main">
        <header className="library-heading">
          <div>
            <p className="eyebrow">Play</p>
            <h1>Take your seat.</h1>
            <p>Choose a world where you are already a member of the table.</p>
          </div>
        </header>

        {worlds.loading ? <LoadingState label="Finding your tables" /> : null}
        {worlds.error === null ? null : (
          <ErrorMessage error={worlds.error} onRetry={worlds.reload} />
        )}
        {!worlds.loading &&
        worlds.error === null &&
        worlds.items.length === 0 ? (
          <EmptyState
            symbol="✦"
            title="No tables are waiting yet"
            description="Open an invitation from a world author to join a table."
          />
        ) : null}

        <div className="world-grid">
          {worlds.items.map((world, index) => (
            <article
              className="world-card play-world-card"
              key={world.id}
              style={{ "--world-index": index } as React.CSSProperties}
            >
              <div className="world-card-wash" aria-hidden="true" />
              <header>
                <RolePill role={world.role} />
                <span
                  className={
                    world.status === "active"
                      ? "world-status"
                      : "world-status world-status-archived"
                  }
                >
                  <i aria-hidden="true" /> {world.status}
                </span>
              </header>
              <button
                className="world-card-title"
                type="button"
                onClick={() => navigate(playWorldURL(world.id))}
              >
                <span className="world-monogram" aria-hidden="true">
                  {world.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{world.name}</strong>
                  <small>{world.description ?? "An unwritten world."}</small>
                </span>
              </button>
              <dl className="world-stats play-world-stats">
                <div>
                  <dt>Your role</dt>
                  <dd>{humanize(world.role)}</dd>
                </div>
                <div>
                  <dt>Readiness</dt>
                  <dd>{playStatus(world)}</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>{world.member_count}</dd>
                </div>
              </dl>
              <footer>
                <span>
                  Active{" "}
                  {formatRelativeDate(
                    world.last_interaction_at ?? world.updated_at,
                  )}
                </span>
                <div>
                  <button
                    className="button button-play"
                    type="button"
                    onClick={() => navigate(playWorldURL(world.id))}
                  >
                    Enter table <span aria-hidden="true">→</span>
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
