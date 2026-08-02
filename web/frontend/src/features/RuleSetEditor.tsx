import { useState } from "react";

import { api, ApiError, jsonBody, ruleSetPath } from "../api/client";
import type { RuleSet } from "../api/types";
import { Field, Panel } from "../components/ui";
import { confirmDiscardDraft, useDraft } from "../hooks/useDraft";

export function RuleSetEditor({
  source,
  onSaved,
  onCancel,
}: {
  source: RuleSet;
  onSaved: (ruleSet: RuleSet) => void;
  onCancel: () => void;
}) {
  const editor = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  function cancel() {
    if (confirmDiscardDraft()) onCancel();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await api<RuleSet>(ruleSetPath(source.id), {
        method: "PATCH",
        ...jsonBody({
          id: source.id,
          name: editor.draft.name,
          description: editor.draft.description ?? "",
        }),
      });
      editor.accept(saved);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not update this ruleset."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="ruleset-editor-title"
        aria-modal="true"
        className="ruleset-editor-dialog"
        role="dialog"
      >
        <Panel className="onboarding-card">
          <p className="eyebrow">Ruleset details</p>
          <h1 id="ruleset-editor-title">Edit this workspace</h1>
          <p className="lede">
            Update the author-facing name and context without changing its
            durable key.
          </p>
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <div className="form-grid">
              <Field label="Ruleset name" required>
                <input
                  value={editor.draft.name}
                  required
                  onChange={(event) =>
                    editor.setDraft({
                      ...editor.draft,
                      name: event.currentTarget.value,
                    })
                  }
                />
              </Field>
              <Field
                label="Stable key"
                hint="The durable key is preserved by this editor."
              >
                <input readOnly value={editor.draft.key} />
              </Field>
            </div>
            <Field
              label="Description"
              hint="Optional context shown to other rules authors."
            >
              <textarea
                value={editor.draft.description ?? ""}
                onChange={(event) =>
                  editor.setDraft({
                    ...editor.draft,
                    description: event.currentTarget.value,
                  })
                }
              />
            </Field>
            {error === null ? null : (
              <p className="form-error" role="alert">
                {error.message}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button-secondary"
                type="button"
                disabled={saving}
                onClick={cancel}
              >
                Cancel
              </button>
              <button disabled={saving || !editor.dirty}>
                {saving ? "Saving…" : "Save details"}
              </button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
