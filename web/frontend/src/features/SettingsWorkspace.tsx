import { useMemo, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type { World } from "../api/types";
import { confirmDiscardDraft, useDraft } from "../hooks/useDraft";
import type { Navigate } from "../worldRoutes";
import { SettingsView, type SettingsDMSource } from "./SettingsView";

export function SettingsWorkspace({
  world,
  navigate,
  onWorldChanged,
}: {
  world: World;
  navigate: Navigate;
  onWorldChanged: () => void;
}) {
  const source = useMemo(
    () => ({
      name: world.name,
      description: world.description ?? "",
      dmSource: world.dm_source,
    }),
    [world.description, world.dm_source, world.name],
  );
  const draft = useDraft(source);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api<World>(worldPath(world.id), {
        method: "PATCH",
        ...jsonBody({
          name: draft.draft.name.trim(),
          description: draft.draft.description.trim() || null,
          dm_source: draft.draft.dmSource,
          expected_revision: world.revision,
        }),
      });
      draft.accept({
        name: saved.name,
        description: saved.description ?? "",
        dmSource: saved.dm_source,
      });
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
      draft.accept(draft.draft);
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
    <SettingsView
      model={{
        draft: draft.draft,
        dirty: draft.dirty,
        busy: saving ? "saving" : archiving ? "archiving" : null,
        issue: error === null ? null : toErrorNotice(error),
        fieldIssues: {
          name: error?.fields["name"],
          dmSource: error?.fields["dm_source"],
        },
        access: {
          role: world.role === "owner" ? "owner" : "editor",
          memberCount: world.member_count,
          mechanicCount: world.capacity_count + world.capability_count,
          status: world.status,
        },
        canArchive: world.role === "owner" && world.status === "active",
      }}
      actions={{
        changeName: (name) =>
          draft.setDraft((current) => ({ ...current, name })),
        changeDescription: (description) =>
          draft.setDraft((current) => ({ ...current, description })),
        changeDMSource: (dmSource: SettingsDMSource) =>
          draft.setDraft((current) => ({ ...current, dmSource })),
        save: () => void save(),
        archive: () => void archive(),
      }}
    />
  );
}
