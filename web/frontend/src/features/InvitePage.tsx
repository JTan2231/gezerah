import { useEffect, useState } from "react";

import { api, ApiError, toErrorNotice, worldInvitePath } from "../api/client";
import type {
  AuthenticatedSession,
  User,
  World,
  WorldInvitePreview,
} from "../api/types";
import { useResource } from "../hooks/useResource";
import {
  buildWorldURL,
  inviteURL,
  playWorldURL,
  type AppArea,
  type Navigate,
} from "../worldRoutes";
import { AccountControls } from "./AccountControls";
import { InvitePageView } from "./InvitePageView";

export function InvitePage({
  area,
  token,
  user,
  navigate,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  area: AppArea;
  token: string;
  user: User;
  navigate: Navigate;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const invite = useResource<WorldInvitePreview>(worldInvitePath(token));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const canonicalArea: AppArea | undefined =
    invite.value === null
      ? undefined
      : invite.value.role === "editor"
        ? "build"
        : "play";

  useEffect(() => {
    if (canonicalArea === undefined || canonicalArea === area) return;
    navigate(inviteURL(canonicalArea, token), { replace: true });
  }, [area, canonicalArea, navigate, token]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const world = await api<World>(worldInvitePath(token, "redeem"), {
        method: "POST",
      });
      navigate(
        world.role === "owner" || world.role === "editor"
          ? buildWorldURL(world.id, "capacities")
          : playWorldURL(world.id),
      );
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not join this world."),
      );
      setJoining(false);
    }
  }

  return (
    <InvitePageView
      model={{
        account: {
          displayName: user.display_name,
          username: user.username,
        },
        loading: invite.loading,
        loadIssue: invite.error === null ? null : toErrorNotice(invite.error),
        joinIssue: error === null ? null : toErrorNotice(error),
        joining,
        invitation:
          invite.value === null
            ? null
            : {
                worldName: invite.value.world_name,
                worldDescription: invite.value.world_description,
                invitedByDisplayName: invite.value.invited_by_display_name,
                role: invite.value.role,
              },
      }}
      accountControls={
        <AccountControls
          user={user}
          onLogout={onLogout}
          onLogoutAll={onLogoutAll}
          onSessionChanged={onSessionChanged}
        />
      }
      onJoin={() => void join()}
      onReturnToWorlds={() => navigate(`/${area}`)}
      onNotNow={() => navigate(`/${canonicalArea ?? area}`)}
    />
  );
}
