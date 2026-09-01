import { useState } from "react";

import { api, ApiError, jsonBody, toErrorNotice } from "../api/client";
import type { AuthenticatedSession, User, World } from "../api/types";
import { formatRelativeDate } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { buildWorldURL, type Navigate } from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import {
  BuildLibraryView,
  CreateWorldView,
  type BuildLibraryWorld,
} from "./BuildLibraryView";
import { useChatGPTWorldStart } from "./useChatGPTWorldStart";

export function BuildLibrary({
  user,
  navigate,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  user: User;
  navigate: Navigate;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const worlds = useCollection<World>("/api/worlds");
  const [creating, setCreating] = useState(false);
  const worldStart = useChatGPTWorldStart("/build", "build");
  const editableWorlds = worlds.items.flatMap<BuildLibraryWorld>((world) => {
    if (world.role !== "owner" && world.role !== "editor") return [];
    return [
      {
        id: world.id,
        name: world.name,
        description: world.description ?? "No description",
        role: world.role,
        status: world.status,
        memberCount: world.member_count,
        capacityCount: world.capacity_count,
        capabilityCount: world.capability_count,
        lastActive: formatRelativeDate(
          world.last_interaction_at ?? world.updated_at,
        ),
      },
    ];
  });

  return (
    <BuildLibraryView
      model={{
        account: {
          displayName: user.display_name,
          username: user.username,
        },
        worlds: editableWorlds,
        loading: worlds.loading,
        issue: worlds.error === null ? null : toErrorNotice(worlds.error),
      }}
      actions={{
        returnHome: () => navigate("/"),
        createWorld: () => setCreating(true),
        openWorld: (worldID) => navigate(buildWorldURL(worldID, "capacities")),
        retry: worlds.reload,
      }}
      worldStart={{
        variant: "build",
        prompt: worldStart.prompt,
        chatGPTHref: worldStart.chatGPTHref,
        copyStatus: worldStart.copyStatus,
        onCopyPrompt: () => void worldStart.copyPrompt(),
      }}
      accountControls={
        <AccountControls
          user={user}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
      createWorldDialog={
        creating ? (
          <CreateWorldController
            onClose={() => setCreating(false)}
            onCreated={(world) => {
              worlds.replaceItem(world, (item) => item.id);
              navigate(buildWorldURL(world.id, "capacities"));
            }}
          />
        ) : null
      }
    />
  );
}

function CreateWorldController({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (world: World) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const world = await api<World>("/api/worlds", {
        method: "POST",
        ...jsonBody({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      onCreated(world);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create the world."),
      );
      setSaving(false);
    }
  }

  return (
    <CreateWorldView
      model={{
        name,
        description,
        saving,
        issue: error === null ? null : toErrorNotice(error),
        nameIssue: error?.fields["name"],
      }}
      actions={{
        changeName: setName,
        changeDescription: setDescription,
        close: onClose,
        submit: () => void submit(),
      }}
    />
  );
}
