import { useMemo, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type { World, WorldCharacterFieldSet } from "../api/types";
import { useDraft } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import {
  CharacterFieldsLoadErrorView,
  CharacterFieldsLoadingView,
  CharacterFieldsView,
  type CharacterFieldDraft,
} from "./CharacterFieldsView";

type CharacterFieldRecordDraft = CharacterFieldDraft & {
  id?: string | undefined;
};

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
    return <CharacterFieldsLoadingView />;
  if (resource.error !== null)
    return (
      <CharacterFieldsLoadErrorView
        issue={toErrorNotice(resource.error)}
        onRetry={resource.reload}
      />
    );
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
  const source = useMemo<CharacterFieldRecordDraft[]>(
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

  async function save() {
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
    <CharacterFieldsView
      model={{
        schemaLabel: `schema r${fieldSet.revision}`,
        fields: draft.draft.map((field, index) => ({
          clientKey: field.clientKey,
          label: field.label,
          helpText: field.helpText,
          visibility: field.visibility,
          labelIssue: error?.fields[`fields[${index}].label`],
          helpTextIssue: error?.fields[`fields[${index}].help_text`],
        })),
        dirty: draft.dirty,
        valid,
        saving,
        issue: error === null ? null : toErrorNotice(error),
      }}
      actions={{
        updateField: update,
        moveField: move,
        removeField: (index) =>
          draft.setDraft((current) =>
            current.filter((_, candidateIndex) => candidateIndex !== index),
          ),
        addField: () =>
          draft.setDraft((current) => [
            ...current,
            {
              clientKey: crypto.randomUUID(),
              label: "",
              helpText: "",
              visibility: "table",
            },
          ]),
        publish: () => void save(),
      }}
    />
  );
}
