import { useState } from "react";

import { api, ApiError, worldInvitePath } from "../api/client";
import type { User, World, WorldInvitePreview } from "../api/types";
import {
  Avatar,
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";
import { useResource } from "../hooks/useResource";
import { worldURL } from "../worldRoutes";

export function InvitePage({
  token,
  user,
  navigate,
}: {
  token: string;
  user: User;
  navigate: (path: string) => void;
}) {
  const invite = useResource<WorldInvitePreview>(worldInvitePath(token));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const world = await api<World>(worldInvitePath(token, "redeem"), {
        method: "POST",
      });
      const section =
        world.role === "owner" || world.role === "editor"
          ? "capacities"
          : "play";
      navigate(worldURL(world.id, section));
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
            onClick={() => navigate("/worlds")}
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
              <span>You’ll join as</span>
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
              onClick={() => navigate("/worlds")}
            >
              Not now
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
