import { useMemo, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type { World } from "../api/types";
import {
  ErrorMessage,
  Field,
  PageIntro,
  RolePill,
} from "../components/StudioUI";
import { confirmDiscardDraft, useDirtyGuard } from "../hooks/useDraft";
import type { Navigate } from "../worldRoutes";

export function SettingsWorkspace({
  world,
  navigate,
  onWorldChanged,
}: {
  world: World;
  navigate: Navigate;
  onWorldChanged: () => void;
}) {
  const [name, setName] = useState(world.name);
  const [description, setDescription] = useState(world.description ?? "");
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const dirty = useMemo(
    () => name !== world.name || description !== (world.description ?? ""),
    [description, name, world.description, world.name],
  );
  const clearDirtyGuard = useDirtyGuard(dirty);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<World>(worldPath(world.id), {
        method: "PATCH",
        ...jsonBody({
          name: name.trim(),
          description: description.trim() || null,
          expected_revision: world.revision,
        }),
      });
      clearDirtyGuard();
      onWorldChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save world settings."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirmDiscardDraft()) return;
    if (
      !window.confirm(
        `Archive ${world.name}? No new problems can be presented afterward.`,
      )
    )
      return;
    setArchiving(true);
    setError(null);
    try {
      await api<World>(worldPath(world.id, "archive"), {
        method: "POST",
        ...jsonBody({ expected_revision: world.revision }),
      });
      clearDirtyGuard();
      navigate("/build");
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not archive this world."),
      );
      setArchiving(false);
    }
  }

  return (
    <section className="settings-page content-narrow">
      <PageIntro
        eyebrow="World administration"
        title="Settings"
        description="The durable identity and lifecycle of this world."
      />
      <div className="settings-layout">
        <form
          className="panel settings-form"
          onSubmit={(event) => void save(event)}
        >
          <header>
            <div>
              <p className="eyebrow">World details</p>
              <h2>What the table sees</h2>
            </div>
          </header>
          <Field label="World name" error={error?.fields["name"]}>
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={200}
            />
          </Field>
          <Field
            label="Description"
            hint="Keep it short enough to orient a newly invited player."
          >
            <textarea
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              rows={4}
            />
          </Field>
          {error === null ? null : <ErrorMessage error={error} />}
          <footer className="form-actions">
            <span>{dirty ? "Unsaved changes" : "Up to date"}</span>
            <button
              className="button button-primary"
              type="submit"
              disabled={!dirty || saving || name.trim() === ""}
            >
              {saving ? "Saving…" : "Save details"}
            </button>
          </footer>
        </form>

        <aside className="settings-summary">
          <p className="eyebrow">Your access</p>
          <RolePill role={world.role} />
          <p>
            {world.role === "owner"
              ? "You can configure mechanics, invite members, facilitate play, and archive this world."
              : "You can configure mechanics and facilitate play."}
          </p>
          <dl>
            <div>
              <dt>Members</dt>
              <dd>{world.member_count}</dd>
            </div>
            <div>
              <dt>Mechanics</dt>
              <dd>{world.capacity_count + world.capability_count}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{world.status}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {world.role === "owner" && world.status === "active" ? (
        <section className="panel danger-zone">
          <div>
            <p className="eyebrow">Lifecycle</p>
            <h2>Close the book</h2>
            <p>
              Archiving keeps every entity, resolved problem, and ruling receipt
              readable. Active problems must be resolved or cancelled first.
            </p>
          </div>
          <button
            className="button button-danger"
            type="button"
            onClick={() => void archive()}
            disabled={archiving}
          >
            {archiving ? "Archiving…" : "Archive world"}
          </button>
        </section>
      ) : null}
    </section>
  );
}
