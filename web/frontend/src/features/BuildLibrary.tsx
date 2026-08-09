import { useState } from "react";

import { api, ApiError, jsonBody } from "../api/client";
import type { AuthenticatedSession, User, World } from "../api/types";
import {
  Avatar,
  Brand,
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  Modal,
  RolePill,
} from "../components/StudioUI";
import { formatRelativeDate } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { buildWorldURL, type Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";

export function BuildLibrary({
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
  const [creating, setCreating] = useState(false);
  const editableWorlds = worlds.items.filter(
    (world) => world.role === "owner" || world.role === "editor",
  );

  return (
    <div className="library-page build-library-page">
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
          <span className="account-copy">
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

      <main className="library-main">
        <header className="library-heading">
          <div>
            <h1>Worlds</h1>
            <p>Worlds you can edit.</p>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            Create world
          </button>
        </header>

        {worlds.loading ? <LoadingState label="Loading worlds" /> : null}
        {worlds.error === null ? null : (
          <ErrorMessage error={worlds.error} onRetry={worlds.reload} />
        )}
        {!worlds.loading &&
        worlds.error === null &&
        editableWorlds.length === 0 ? (
          <EmptyState
            title="No worlds"
            description="Create a world to configure its mechanics and invite people."
            action={
              <button
                className="button button-primary"
                type="button"
                onClick={() => setCreating(true)}
              >
                Create world
              </button>
            }
          />
        ) : null}

        <div className="world-grid">
          {editableWorlds.map((world) => {
            return (
              <article className="world-card" key={world.id}>
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
                  onClick={() =>
                    navigate(buildWorldURL(world.id, "capacities"))
                  }
                >
                  <span>
                    <strong>{world.name}</strong>
                    <small>{world.description ?? "No description"}</small>
                  </span>
                </button>
                <dl className="world-stats">
                  <div>
                    <dt>Members</dt>
                    <dd>{world.member_count}</dd>
                  </div>
                  <div>
                    <dt>Capacities</dt>
                    <dd>{world.capacity_count}</dd>
                  </div>
                  <div>
                    <dt>Capabilities</dt>
                    <dd>{world.capability_count}</dd>
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
                      className="button button-ink"
                      type="button"
                      onClick={() =>
                        navigate(buildWorldURL(world.id, "capacities"))
                      }
                    >
                      Open
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      </main>

      {creating ? (
        <CreateWorldModal
          onClose={() => setCreating(false)}
          onCreated={(world) => {
            worlds.replaceItem(world, (item) => item.id);
            navigate(buildWorldURL(world.id, "capacities"));
          }}
        />
      ) : null}
    </div>
  );
}

function CreateWorldModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (world: World) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const world = await api<World>("/api/worlds", {
        method: "POST",
        ...jsonBody({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      onCreated(world);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create the world."),
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Create a world"
      description="Enter a name. You can configure mechanics after creation."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <Field label="World name" error={error?.fields["name"]}>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={200}
            placeholder="World name"
          />
        </Field>
        <Field label="Short description" hint="Optional.">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            rows={3}
            placeholder="World description"
          />
        </Field>
        {error === null ? null : <ErrorMessage error={error} />}
        <footer className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={saving}
          >
            {saving ? "Creating…" : "Create world"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
