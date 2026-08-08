import { useEffect, useState } from "react";

import { api, ApiError, worldInvitePath } from "../api/client";
import type {
  AuthenticatedSession,
  User,
  World,
  WorldInvitePreview,
} from "../api/types";
import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";
import { useResource } from "../hooks/useResource";
import {
  buildWorldURL,
  inviteURL,
  playWorldURL,
  type AppArea,
  type Navigate,
} from "../worldRoutes";
import { AccountControls } from "./AccountControls";

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
    <main className="invite-page">
      <header>
        <Brand compact />
        <div className="invite-account">
          <span>
            <strong>{user.display_name}</strong>
            <small>@{user.username}</small>
          </span>
          <AccountControls
            user={user}
            onLogout={onLogout}
            onLogoutAll={onLogoutAll}
            onSessionChanged={onSessionChanged}
          />
        </div>
      </header>
      {invite.loading ? <LoadingState label="Reading the invitation" /> : null}
      {invite.error === null ? null : (
        <div className="invite-card invite-card-error">
          <span className="invite-seal" aria-hidden="true">
            ×
          </span>
          <h1>This invitation has closed.</h1>
          <p>It may have expired or been revoked by the world’s authors.</p>
          <ErrorMessage error={invite.error} />
          <button
            className="button button-ink"
            type="button"
            onClick={() => navigate(`/${area}`)}
          >
            Return to your worlds
          </button>
        </div>
      )}
      {invite.value === null ? null : (
        <section className="invite-card">
          <span className="invite-seal" aria-hidden="true">
            ✦
          </span>
          <p className="eyebrow">
            An invitation from {invite.value.invited_by_display_name}
          </p>
          <h1>Come to {invite.value.world_name}.</h1>
          <p className="invite-description">
            {invite.value.world_description ?? "There is room at the table."}
          </p>
          <div className="invite-role-row">
            <Avatar name={user.display_name} />
            <div>
              <span>This invitation offers</span>
              <RolePill role={invite.value.role} />
            </div>
          </div>
          {error === null ? null : <ErrorMessage error={error} />}
          <div className="invite-actions">
            <button
              className="button button-primary button-wide"
              type="button"
              onClick={() => void join()}
              disabled={joining}
            >
              {joining ? "Joining…" : `Join ${invite.value.world_name}`}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => navigate(`/${canonicalArea ?? area}`)}
            >
              Not now
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
