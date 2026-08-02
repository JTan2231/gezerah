import { useState } from "react";

import { api, ApiError, jsonBody, selectUserId } from "../api/client";
import type { User } from "../api/types";
import { Brand, ErrorMessage, LoadingState } from "../components/StudioUI";
import { useCollection } from "../hooks/useCollection";

export function IdentityGate({
  onSelected,
}: {
  onSelected: (user: User) => void;
}) {
  const users = useCollection<User>("/api/users");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  function choose(user: User) {
    selectUserId(user.id);
    onSelected(user);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    setSaving(true);
    setError(null);
    try {
      const user = await api<User>("/api/users", {
        method: "POST",
        ...jsonBody({ display_name: name.trim() }),
      });
      choose(user);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create your profile."),
      );
      setSaving(false);
    }
  }

  return (
    <main className="identity-page">
      <section className="identity-story">
        <Brand />
        <div className="identity-headline">
          <p className="eyebrow">A shared table for improvised worlds</p>
          <h1>
            Build the rules.
            <br />
            Make the rest up together.
          </h1>
          <p>
            Define the capacities and capabilities that matter, invite your
            table, and let every problem emerge in play.
          </p>
        </div>
        <div className="identity-motif" aria-hidden="true">
          <span>capacity</span>
          <i />
          <span>action</span>
          <i />
          <span>consequence</span>
        </div>
      </section>
      <section className="identity-panel" aria-labelledby="identity-title">
        <div className="identity-panel-inner">
          <p className="eyebrow">Trusted development profile</p>
          <h2 id="identity-title">Who is opening the book?</h2>
          <p className="muted-copy">
            Choose a local profile or make one for this browser.
          </p>
          {users.loading ? (
            <LoadingState label="Finding local profiles" />
          ) : null}
          {users.error === null ? null : (
            <ErrorMessage error={users.error} onRetry={users.reload} />
          )}
          {users.items.length > 0 ? (
            <div className="profile-list">
              {users.items.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  onClick={() => choose(user)}
                >
                  <span className="profile-mark" aria-hidden="true">
                    {user.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{user.display_name}</span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="identity-divider">
            <span>or begin here</span>
          </div>
          <form
            className="identity-form"
            onSubmit={(event) => void create(event)}
          >
            <label>
              <span>Your display name</span>
              <input
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="e.g. Joey"
                maxLength={200}
              />
            </label>
            {error === null ? null : <ErrorMessage error={error} />}
            <button
              className="button button-primary button-wide"
              type="submit"
              disabled={saving || name.trim() === ""}
            >
              {saving ? "Creating profile…" : "Create local profile"}
            </button>
          </form>
          <p className="identity-footnote">
            This build uses local development identities. Production
            authentication remains a separate security boundary.
          </p>
        </div>
      </section>
    </main>
  );
}
