import {
  Avatar,
  ErrorMessage,
  Field,
  LoadingState,
  PageIntro,
  RolePill,
} from "../components/StudioUI";

export type InviteRole = "player" | "spectator" | "editor";

interface PeopleIssue {
  kind: "connection" | "request";
  message: string;
}

interface PeopleMember {
  id: string;
  displayName: string;
  role: "owner" | "editor" | "player" | "spectator";
  details: string;
}

export interface PeopleInvite {
  id: string;
  roleLabel: string;
  creatorAndUses: string;
  statusLabel: string;
  closed: boolean;
}

interface PeopleViewModel {
  inviteDraft: {
    role: InviteRole;
    expiresInDays: number;
  };
  creating: boolean;
  createdLink: string;
  createdRoleLabel: string;
  copied: boolean;
  issue: PeopleIssue | null;
  members: readonly PeopleMember[];
  membersLoading: boolean;
  membersIssue: PeopleIssue | null;
  invites: readonly PeopleInvite[];
  invitesLoading: boolean;
  invitesIssue: PeopleIssue | null;
  activeInviteCount: number;
}

interface PeopleViewActions {
  changeRole: (role: InviteRole) => void;
  changeExpiry: (days: number) => void;
  createInvite: () => void;
  copyLink: () => void;
  revokeInvite: (inviteID: string) => void;
  retryMembers: () => void;
  retryInvites: () => void;
}

export function PeopleView({
  model,
  actions,
}: {
  model: PeopleViewModel;
  actions: PeopleViewActions;
}) {
  return (
    <section className="people-page content-narrow">
      <PageIntro
        title="People & invites"
        description="Invite links add people to this world with a selected role."
      />

      <div className="people-layout">
        <section className="panel invite-builder">
          <header>
            <h2>Create invite</h2>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              actions.createInvite();
            }}
          >
            <div className="invite-form-grid">
              <Field label="They can join as">
                <select
                  value={model.inviteDraft.role}
                  onChange={(event) =>
                    actions.changeRole(event.currentTarget.value as InviteRole)
                  }
                >
                  <option value="player">Player — respond in play</option>
                  <option value="spectator">Spectator — watch the table</option>
                  <option value="editor">
                    Editor — configure and assign the DM
                  </option>
                </select>
              </Field>
              <Field label="Link expires">
                <select
                  value={model.inviteDraft.expiresInDays}
                  onChange={(event) =>
                    actions.changeExpiry(Number(event.currentTarget.value))
                  }
                >
                  <option value={1}>In 24 hours</option>
                  <option value={7}>In 7 days</option>
                  <option value={30}>In 30 days</option>
                  <option value={90}>In 90 days</option>
                </select>
              </Field>
            </div>
            <button
              className="button button-primary"
              type="submit"
              disabled={model.creating}
            >
              {model.creating ? "Creating link…" : "Create invite link"}
            </button>
          </form>
          {model.createdLink === "" ? null : (
            <div className="created-invite" role="status">
              <div>
                <span>{model.createdRoleLabel} invitation</span>
                <strong>Invite link created</strong>
              </div>
              <div className="copy-field">
                <input
                  id="created-invite-link"
                  readOnly
                  value={model.createdLink}
                  aria-label="Invite link"
                />
                <button
                  className="button button-ink"
                  type="button"
                  onClick={actions.copyLink}
                >
                  {model.copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p>
                The full token is shown only now. You can revoke the link below
                at any time.
              </p>
            </div>
          )}
          {model.issue === null ? null : <ErrorMessage error={model.issue} />}
        </section>

        <section className="panel member-panel">
          <header>
            <h2>Members</h2>
            <span>{model.members.length}</span>
          </header>
          {model.membersLoading ? (
            <LoadingState label="Loading members" />
          ) : null}
          {model.membersIssue === null ? null : (
            <ErrorMessage
              error={model.membersIssue}
              onRetry={actions.retryMembers}
            />
          )}
          <div className="member-list">
            {model.members.map((member) => (
              <div className="member-row" key={member.id}>
                <Avatar name={member.displayName} />
                <div>
                  <strong>{member.displayName}</strong>
                  <small>{member.details}</small>
                </div>
                <RolePill role={member.role} />
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel invite-list-panel">
        <header>
          <div>
            <h2>Invitations</h2>
            <p>
              {model.activeInviteCount === 0
                ? "No active links"
                : `${model.activeInviteCount} active ${model.activeInviteCount === 1 ? "link" : "links"}`}
            </p>
          </div>
        </header>
        {model.invitesLoading ? (
          <LoadingState label="Loading invitations" />
        ) : null}
        {model.invitesIssue === null ? null : (
          <ErrorMessage
            error={model.invitesIssue}
            onRetry={actions.retryInvites}
          />
        )}
        <div className="invite-list">
          {model.invites.map((invite) => (
            <div
              className={
                invite.closed ? "invite-row invite-row-closed" : "invite-row"
              }
              key={invite.id}
            >
              <div>
                <strong>{invite.roleLabel} link</strong>
                <small>{invite.creatorAndUses}</small>
              </div>
              <span>{invite.statusLabel}</span>
              {invite.closed ? null : (
                <button
                  className="button button-danger-quiet"
                  type="button"
                  onClick={() => actions.revokeInvite(invite.id)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
