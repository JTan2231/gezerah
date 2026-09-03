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
import { buildLibraryURL, type Navigate } from "../worldRoutes";
import { SettingsView } from "./SettingsView";

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
      proseGuide: world.prose_guide ?? "",
    }),
    [world.description, world.name, world.prose_guide],
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
          prose_guide: draft.draft.proseGuide.trim() || null,
          expected_revision: world.revision,
        }),
      });
      draft.accept({
        name: saved.name,
        description: saved.description ?? "",
        proseGuide: saved.prose_guide ?? "",
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
      navigate(buildLibraryURL());
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
          proseGuide: error?.fields["prose_guide"],
        },
        access: {
          role: world.role === "owner" ? "owner" : "editor",
          memberCount: world.member_count,
          mechanicCount: world.capacity_count + world.capability_count,
          status: world.status,
          facilitator:
            world.facilitator.display_name ??
            (world.facilitator.source === "terra"
              ? "Terra"
              : world.facilitator.source === "agent"
                ? "ChatGPT"
                : "Facilitator"),
        },
        canArchive: world.role === "owner" && world.status === "active",
      }}
      actions={{
        changeName: (name) =>
          draft.setDraft((current) => ({ ...current, name })),
        changeDescription: (description) =>
          draft.setDraft((current) => ({ ...current, description })),
        changeProseGuide: (proseGuide) =>
          draft.setDraft((current) => ({ ...current, proseGuide })),
        save: () => void save(),
        archive: () => void archive(),
      }}
    />
  );
}
