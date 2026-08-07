import { useEffect, useMemo, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type { EntityProfile, World, WorldEntity } from "../api/types";
import {
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
} from "../components/StudioUI";
import { useDirtyGuard } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";

export function EntityProfilePanel({
  world,
  entity,
  refreshToken,
  onChanged,
  editable = true,
}: {
  world: World;
  entity: WorldEntity;
  refreshToken: number;
  onChanged: () => void;
  editable?: boolean | undefined;
}) {
  const profile = useResource<EntityProfile>(
    worldPath(world.id, `entities/${entity.id}/profile`),
  );
  const reloadProfile = profile.reload;

  useEffect(() => {
    if (refreshToken > 0) reloadProfile();
  }, [refreshToken, reloadProfile]);

  if (profile.loading && profile.value === null)
    return <LoadingState label="Opening this character" />;
  if (profile.error !== null)
    return <ErrorMessage error={profile.error} onRetry={profile.reload} />;
  if (profile.value === null) return null;

  return (
    <article className="entity-profile">
      <header>
        <span className="entity-portrait" aria-hidden="true">
          {entity.display_name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">Character profile</p>
          <h2>{entity.display_name}</h2>
          <span>
            {profile.value.completed_field_count} of{" "}
            {profile.value.required_field_count} required fields · profile r
            {profile.value.revision}
          </span>
        </div>
        <CharacterStatus profile={profile.value} />
      </header>
      {editable && profile.value.can_edit ? (
        <EntityProfileEditor
          key={`${entity.id}:${profile.value.revision}:${profile.value.character_fields_revision}`}
          entity={entity}
          profile={profile.value}
          world={world}
          onSaved={() => {
            profile.reload();
            onChanged();
          }}
        />
      ) : (
        <EntityProfileReader profile={profile.value} />
      )}
    </article>
  );
}

function CharacterStatus({ profile }: { profile: EntityProfile }) {
  if (profile.character_status === "not-controlled")
    return (
      <span className="character-status status-neutral">Uncontrolled</span>
    );
  if (profile.character_status === "ready")
    return <span className="character-status status-ready">Ready</span>;
  return <span className="character-status status-setup">Setup required</span>;
}

function EntityProfileReader({ profile }: { profile: EntityProfile }) {
  if (profile.fields.length === 0)
    return (
      <EmptyState
        title="No character story is visible"
        description="There are no completed table-visible character fields yet."
      />
    );
  return (
    <div className="profile-section-list">
      {profile.fields.map((characterField) => (
        <section className="profile-section" key={characterField.id}>
          <header>
            <h3>{characterField.label}</h3>
            {characterField.visibility === "controllers-and-facilitators" ? (
              <span>Private</span>
            ) : null}
          </header>
          <p>{characterField.value}</p>
        </section>
      ))}
    </div>
  );
}

function EntityProfileEditor({
  world,
  entity,
  profile,
  onSaved,
}: {
  world: World;
  entity: WorldEntity;
  profile: EntityProfile;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () =>
      Object.fromEntries(
        profile.fields.map((characterField) => [
          characterField.id,
          characterField.value ?? "",
        ]),
      ),
    [profile.fields],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const dirty = profile.fields.some(
    (characterField) =>
      (values[characterField.id] ?? "") !== (characterField.value ?? ""),
  );
  const clearDirtyGuard = useDirtyGuard(dirty);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<EntityProfile>(
        worldPath(world.id, `entities/${entity.id}/profile`),
        {
          method: "PUT",
          ...jsonBody({
            expected_revision: profile.revision,
            expected_character_fields_revision:
              profile.character_fields_revision,
            values: profile.fields.map((characterField) => ({
              field_id: characterField.id,
              value: (values[characterField.id] ?? "").trim(),
            })),
          }),
        },
      );
      clearDirtyGuard();
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this character."),
      );
      setSaving(false);
    }
  }

  return (
    <form className="profile-editor" onSubmit={(event) => void save(event)}>
      {profile.fields.length === 0 ? (
        <EmptyState
          title="No character fields configured"
          description="A Dungeon Master can publish required fields from world configuration. This controlled entity is ready without them."
        />
      ) : (
        <div className="character-profile-fields">
          {profile.fields.map((characterField, index) => (
            <Field
              key={characterField.id}
              label={characterField.label}
              hint={characterField.help_text}
              error={error?.fields[`values[${index}].value`]}
            >
              <textarea
                value={values[characterField.id] ?? ""}
                rows={6}
                maxLength={20_000}
                placeholder={`Write ${characterField.label.toLowerCase()}…`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setValues((current) => ({
                    ...current,
                    [characterField.id]: value,
                  }));
                }}
              />
              <span className="character-field-visibility">
                {characterField.visibility === "table"
                  ? "Visible to everyone at the table"
                  : "Visible only to controllers and Dungeon Masters"}
              </span>
            </Field>
          ))}
        </div>
      )}
      {error === null ? null : <ErrorMessage error={error} />}
      {profile.fields.length > 0 ? (
        <footer>
          <span>
            Drafts may be incomplete. Every field is required before play.
          </span>
          <button
            className="button button-ink"
            type="submit"
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save character"}
          </button>
        </footer>
      ) : null}
    </form>
  );
}
