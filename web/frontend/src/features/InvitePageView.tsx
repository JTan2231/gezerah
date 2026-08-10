import type { ReactNode } from "react";

import {
  Brand,
  ErrorMessage,
  LoadingState,
  RolePill,
} from "../components/StudioUI";

interface InvitePageIssue {
  kind: "connection" | "request";
  message: string;
}

interface InvitePageViewModel {
  account: {
    displayName: string;
    username: string;
  };
  loading: boolean;
  loadIssue: InvitePageIssue | null;
  joinIssue: InvitePageIssue | null;
  joining: boolean;
  invitation: {
    worldName: string;
    worldDescription?: string | undefined;
    invitedByDisplayName: string;
    role: "editor" | "player" | "spectator";
  } | null;
}

export function InvitePageView({
  model,
  accountControls,
  onJoin,
  onReturnToWorlds,
  onNotNow,
}: {
  model: InvitePageViewModel;
  accountControls: ReactNode;
  onJoin: () => void;
  onReturnToWorlds: () => void;
  onNotNow: () => void;
}) {
  return (
    <main className="invite-page">
      <header>
        <Brand compact />
        <div className="invite-account">
          <span>
            <strong>{model.account.displayName}</strong>
            <small>@{model.account.username}</small>
          </span>
          {accountControls}
        </div>
      </header>
      {model.loading ? <LoadingState label="Loading invitation" /> : null}
      {model.loadIssue === null ? null : (
        <div className="invite-card invite-card-error">
          <h1>Invitation unavailable</h1>
          <p>This invitation may have expired or been revoked.</p>
          <ErrorMessage error={model.loadIssue} />
          <button
            className="button button-ink"
            type="button"
            onClick={onReturnToWorlds}
          >
            Return to your worlds
          </button>
        </div>
      )}
      {model.invitation === null ? null : (
        <section className="invite-card">
          <h1>Invitation to {model.invitation.worldName}</h1>
          <p>Invited by {model.invitation.invitedByDisplayName}</p>
          {model.invitation.worldDescription === undefined ? null : (
            <p className="invite-description">
              {model.invitation.worldDescription}
            </p>
          )}
          <div className="invite-role-row">
            <div>
              <span>Role</span>
              <RolePill role={model.invitation.role} />
            </div>
          </div>
          {model.joinIssue === null ? null : (
            <ErrorMessage error={model.joinIssue} />
          )}
          <div className="invite-actions">
            <button
              className="button button-primary button-wide"
              type="button"
              onClick={onJoin}
              disabled={model.joining}
            >
              {model.joining
                ? "Joining…"
                : `Join ${model.invitation.worldName}`}
            </button>
            <button className="text-button" type="button" onClick={onNotNow}>
              Not now
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
