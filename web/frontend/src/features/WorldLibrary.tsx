import { useState } from "react";

import { api, ApiError, jsonBody, selectUserId } from "../api/client";
import type { User, World } from "../api/types";
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
import { worldURL } from "../worldRoutes";

export function WorldLibrary({
  user,
  navigate,
  onSwitchProfile,
}: {
  user: User;
  navigate: (path: string) => void;
  onSwitchProfile: () => void;
}) {
  const worlds = useCollection<World>("/api/worlds");
  const [creating, setCreating] = useState(false);

  function openWorld(world: World, mode: "configure" | "play") {
    const section = mode === "play" ? "play" : "capacities";
    navigate(worldURL(world.id, section));
  }

  return (
    <div className="library-page">
      <header className="library-topbar">
        <Brand compact />
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
            <p className="eyebrow">Your worlds</p>
            <h1>Where are we headed?</h1>
            <p>Only worlds you own or have joined appear here.</p>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            <span aria-hidden="true">＋</span> Create world
          </button>
        </header>

        {worlds.loading ? <LoadingState label="Opening your worlds" /> : null}
        {worlds.error === null ? null : (
          <ErrorMessage error={worlds.error} onRetry={worlds.reload} />
        )}
        {!worlds.loading &&
        worlds.error === null &&
        worlds.items.length === 0 ? (
          <EmptyState
            symbol="✦"
            title="Your first world starts with two lists"
            description="Create a world, define the values and skills that matter, then invite the rest of the table."
            action={
              <button
                className="button button-primary"
                type="button"
                onClick={() => setCreating(true)}
              >
                Create your first world
              </button>
            }
          />
        ) : null}

        <div className="world-grid">
          {worlds.items.map((world, index) => {
            const canEdit = world.role === "owner" || world.role === "editor";
            return (
              <article
                className="world-card"
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
                  onClick={() =>
                    openWorld(world, canEdit ? "configure" : "play")
                  }
                >
                  <span className="world-monogram" aria-hidden="true">
                    {world.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{world.name}</strong>
                    <small>{world.description ?? "An unwritten world."}</small>
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
                    {canEdit ? (
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={() => openWorld(world, "configure")}
                      >
                        Configure
                      </button>
                    ) : null}
                    <button
                      className="button button-ink"
                      type="button"
                      onClick={() => openWorld(world, "play")}
                    >
                      Enter play <span aria-hidden="true">→</span>
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
            navigate(worldURL(world.id, "capacities"));
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
      description="Name it now. Its mechanics begin on the next page."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <Field label="World name" error={error?.fields["name"]}>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={200}
            placeholder="Ember Coast"
          />
        </Field>
        <Field
          label="Short description"
          hint="Optional. Give the table a sentence to orient around."
        >
          <textarea
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            rows={3}
            placeholder="A rain-soaked frontier where old promises still have teeth."
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
            disabled={saving || name.trim() === ""}
          >
            {saving ? "Creating…" : "Create world"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
