import { useMemo, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  EntityProfileVisibility,
  World,
  WorldCharacterFieldSet,
} from "../api/types";
import {
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";
import { useDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";

interface CharacterFieldDraft {
  clientKey: string;
  id?: string | undefined;
  label: string;
  helpText: string;
  visibility: EntityProfileVisibility;
}

export function CharacterFieldsWorkspace({
  world,
  onWorldChanged,
}: {
  world: World;
  onWorldChanged: () => void;
}) {
  const resource = useResource<WorldCharacterFieldSet>(
    worldPath(world.id, "character-fields"),
  );

  if (resource.loading && resource.value === null)
    return <LoadingState label="Opening character fields" />;
  if (resource.error !== null)
    return <ErrorMessage error={resource.error} onRetry={resource.reload} />;
  if (resource.value === null) return null;

  return (
    <CharacterFieldsEditor
      key={resource.value.revision}
      world={world}
      fieldSet={resource.value}
      onSaved={() => {
        resource.reload();
        onWorldChanged();
      }}
    />
  );
}

function CharacterFieldsEditor({
  world,
  fieldSet,
  onSaved,
}: {
  world: World;
  fieldSet: WorldCharacterFieldSet;
  onSaved: () => void;
}) {
  const source = useMemo<CharacterFieldDraft[]>(
    () =>
      fieldSet.fields.map((field) => ({
        clientKey: field.id,
        id: field.id,
        label: field.label,
        helpText: field.help_text ?? "",
        visibility: field.visibility,
      })),
    [fieldSet.fields],
  );
  const draft = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  function update(index: number, patch: Partial<CharacterFieldDraft>) {
    draft.setDraft((current) =>
      current.map((field, candidateIndex) =>
        candidateIndex === index ? { ...field, ...patch } : field,
      ),
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.draft.length) return;
    draft.setDraft((current) => {
      const next = [...current];
      const moving = next[index];
      const displaced = next[target];
      if (moving === undefined || displaced === undefined) return current;
      next[index] = displaced;
      next[target] = moving;
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const existingIDs = new Set(fieldSet.fields.map((field) => field.id));
    const desiredIDs = new Set(
      draft.draft.flatMap((field) =>
        field.id === undefined ? [] : [field.id],
      ),
    );
    const requirementsChanged =
      draft.draft.some((field) => field.id === undefined) ||
      [...existingIDs].some((id) => !desiredIDs.has(id));
    if (
      requirementsChanged &&
      fieldSet.fields.length > 0 &&
      !window.confirm(
        "Publish these requirements? Existing controlled characters missing a new field will return to setup.",
      )
    )
      return;

    setSaving(true);
    setError(null);
    try {
      await api<WorldCharacterFieldSet>(
        worldPath(world.id, "character-fields"),
        {
          method: "PUT",
          ...jsonBody({
            expected_revision: fieldSet.revision,
            fields: draft.draft.map((field) => ({
              id: field.id,
              label: field.label.trim(),
              help_text: field.helpText.trim() || undefined,
              visibility: field.visibility,
            })),
          }),
        },
      );
      draft.accept(draft.draft);
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not publish character fields."),
      );
      setSaving(false);
    }
  }

  const labels = draft.draft.map((field) => field.label.trim().toLowerCase());
  const valid = draft.draft.every(
    (field, index) =>
      field.label.trim() !== "" &&
      labels.indexOf(labels[index] ?? "") === index,
  );

  return (
    <section className="character-fields-page content-narrow">
      <PageIntro
        eyebrow="Character onboarding"
        title="Character fields"
        description="Define the story information every player-controlled character must complete before entering play."
      />

      <form
        className="panel character-fields-form"
        onSubmit={(event) => void save(event)}
      >
        <header>
          <div>
            <p className="eyebrow">Published requirements</p>
            <h2>
              {draft.draft.length} required{" "}
              {draft.draft.length === 1 ? "field" : "fields"}
            </h2>
          </div>
          <span>schema r{fieldSet.revision}</span>
        </header>

        {draft.draft.length === 0 ? (
          <EmptyState
            title="No character fields yet"
            description="Controlled entities are immediately ready until you publish at least one field."
          />
        ) : null}

        <div className="character-field-definition-list">
          {draft.draft.map((characterField, index) => (
            <fieldset
              className="character-field-definition"
              key={characterField.clientKey}
            >
              <legend>Required field {index + 1}</legend>
              <div className="profile-section-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move character field ${index + 1} up`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={index === draft.draft.length - 1}
                  aria-label={`Move character field ${index + 1} down`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() =>
                    draft.setDraft((current) =>
                      current.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </div>
              <Field
                label="Field label"
                error={error?.fields[`fields[${index}].label`]}
              >
                <input
                  value={characterField.label}
                  maxLength={200}
                  placeholder="Backstory"
                  onChange={(event) =>
                    update(index, { label: event.currentTarget.value })
                  }
                />
              </Field>
              <Field
                label="Guidance"
                hint="Optional instructions shown while the player writes."
                error={error?.fields[`fields[${index}].help_text`]}
              >
                <textarea
                  value={characterField.helpText}
                  rows={3}
                  maxLength={2000}
                  placeholder="Where did this character come from?"
                  onChange={(event) =>
                    update(index, { helpText: event.currentTarget.value })
                  }
                />
              </Field>
              <Field label="Who can read the answer?">
                <select
                  value={characterField.visibility}
                  onChange={(event) =>
                    update(index, {
                      visibility: event.currentTarget
                        .value as EntityProfileVisibility,
                    })
                  }
                >
                  <option value="table">Everyone at the table</option>
                  <option value="controllers-and-facilitators">
                    Character controllers and Dungeon Masters
                  </option>
                </select>
              </Field>
            </fieldset>
          ))}
        </div>

        {error === null ? null : <ErrorMessage error={error} />}
        <footer className="form-actions">
          <button
            className="button button-quiet"
            type="button"
            disabled={draft.draft.length >= 50}
            onClick={() =>
              draft.setDraft((current) => [
                ...current,
                {
                  clientKey: crypto.randomUUID(),
                  label: "",
                  helpText: "",
                  visibility: "table",
                },
              ])
            }
          >
            Add required field
          </button>
          <span>{draft.dirty ? "Unpublished changes" : "Published"}</span>
          <button
            className="button button-primary"
            type="submit"
            disabled={!draft.dirty || !valid || saving}
          >
            {saving ? "Publishing…" : "Publish requirements"}
          </button>
        </footer>
      </form>
    </section>
  );
}
