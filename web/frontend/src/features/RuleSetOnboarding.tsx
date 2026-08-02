import { useState } from "react";

import { api, ApiError, jsonBody } from "../api/client";
import type { RuleSet } from "../api/types";
import { Field, Panel } from "../components/ui";
import { slugify } from "../domain/options";

export function RuleSetOnboarding({
  onCreated,
  compact = false,
  onCancel,
}: {
  onCreated: (ruleSet: RuleSet) => void;
  compact?: boolean;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api<RuleSet>("/api/rule-sets", {
        method: "POST",
        ...jsonBody({
          name,
          key,
          ...(description.trim() === "" ? {} : { description }),
        }),
      });
      onCreated(created);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create the ruleset."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? "dialog-backdrop" : "onboarding-shell"}>
      <Panel className="onboarding-card">
        <p className="eyebrow">A clean rules vocabulary starts here</p>
        <h1>
          {compact
            ? "Create another ruleset"
            : "Compose a world with explicit rules."}
        </h1>
        <p className="lede">
          Define who can own state, how conditions read it, and exactly what
          each choice changes. Nothing is assumed for you.
        </p>
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <Field
              label="Ruleset name"
              required
              hint="A human-readable workspace name."
            >
              <input
                value={name}
                required
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setName(next);
                  if (!keyTouched) setKey(slugify(next));
                }}
              />
            </Field>
            <Field
              label="Stable key"
              required
              hint="Used in durable links. It will not follow later name edits."
            >
              <input
                value={key}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                onChange={(event) => {
                  setKeyTouched(true);
                  setKey(event.currentTarget.value);
                }}
              />
            </Field>
          </div>
          <Field
            label="Description"
            hint="Optional context for other rules authors."
          >
            <textarea
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
          </Field>
          {error === null ? null : (
            <p className="form-error" role="alert">
              {error.message}
            </p>
          )}
          <div className="form-actions">
            {onCancel === undefined ? null : (
              <button
                className="button-secondary"
                type="button"
                onClick={onCancel}
              >
                Cancel
              </button>
            )}
            <button disabled={saving}>
              {saving ? "Creating…" : "Create ruleset"}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
