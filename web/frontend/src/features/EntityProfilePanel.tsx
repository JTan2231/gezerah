import { useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type { EntityProfile, World, WorldEntity } from "../api/types";
import { useDirtyGuard } from "../hooks/useDraft";
import { useResource } from "../hooks/useResource";
import {
  EntityProfileEditorView,
  EntityProfileLoadErrorView,
  EntityProfileLoadingView,
  EntityProfileView,
  type EntityProfileFieldViewModel,
  type EntityProfileIssue,
  type EntityProfileViewModel,
} from "./EntityProfileView";

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
    return <EntityProfileLoadingView />;
  if (profile.error !== null)
    return (
      <EntityProfileLoadErrorView
        issue={toErrorNotice(profile.error)}
        onRetry={profile.reload}
      />
    );
  if (profile.value === null) return null;

  const profileView = toEntityProfileView(entity, profile.value);
  const canEdit = editable && profile.value.can_edit;

  return (
    <EntityProfileView
      profile={profileView}
      editor={
        canEdit ? (
          <EntityProfileEditorController
            key={`${entity.id}:${profile.value.revision}:${profile.value.character_fields_revision}`}
            entity={entity}
            profile={profile.value}
            fields={profileView.fields}
            world={world}
            onSaved={() => {
              profile.reload();
              onChanged();
            }}
          />
        ) : null
      }
    />
  );
}

function EntityProfileEditorController({
  world,
  entity,
  profile,
  fields,
  onSaved,
}: {
  world: World;
  entity: WorldEntity;
  profile: EntityProfile;
  fields: EntityProfileFieldViewModel[];
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
  const [issue, setIssue] = useState<EntityProfileIssue | null>(null);
  const dirty = profile.fields.some(
    (characterField) =>
      (values[characterField.id] ?? "") !== (characterField.value ?? ""),
  );
  const clearDirtyGuard = useDirtyGuard(dirty);

  async function save() {
    setSaving(true);
    setIssue(null);
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
      setIssue(
        toEntityProfileIssue(
          reason,
          profile.fields.map((field) => field.id),
        ),
      );
      setSaving(false);
    }
  }

  return (
    <EntityProfileEditorView
      fields={fields}
      values={values}
      saving={saving}
      dirty={dirty}
      issue={issue}
      onValueChange={(fieldId, value) =>
        setValues((current) => ({ ...current, [fieldId]: value }))
      }
      onSubmit={() => void save()}
    />
  );
}

function toEntityProfileView(
  entity: WorldEntity,
  profile: EntityProfile,
): EntityProfileViewModel {
  return {
    displayName: entity.display_name,
    summary: `${profile.completed_field_count} of ${profile.required_field_count} required fields · profile r${profile.revision}`,
    characterStatus: profile.character_status,
    fields: profile.fields.map((field) => ({
      id: field.id,
      label: field.label,
      helpText: field.help_text,
      visibility: field.visibility,
      value: field.value,
    })),
  };
}

function toEntityProfileIssue(
  reason: unknown,
  fieldIds: string[],
): EntityProfileIssue {
  if (!(reason instanceof ApiError))
    return {
      kind: "request",
      message: "Could not save this character.",
      fieldErrors: {},
    };
  return {
    ...toErrorNotice(reason),
    fieldErrors: Object.fromEntries(
      fieldIds.map((fieldId, index) => [
        fieldId,
        reason.fields[`values[${index}].value`],
      ]),
    ),
  };
}
