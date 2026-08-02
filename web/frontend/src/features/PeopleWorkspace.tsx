import { useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type { World, WorldInvite, WorldMember, WorldRole } from "../api/types";
import {
  Avatar,
  ErrorMessage,
  Field,
  LoadingState,
  PageIntro,
  RolePill,
} from "../components/StudioUI";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";

export function PeopleWorkspace({ world }: { world: World }) {
  const members = useCollection<WorldMember>(worldPath(world.id, "members"));
  const invites = useCollection<WorldInvite>(worldPath(world.id, "invites"));
  const [role, setRole] = useState<Exclude<WorldRole, "owner">>("player");
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreatedLink("");
    setCopied(false);
    setError(null);
    try {
      const invite = await api<WorldInvite>(worldPath(world.id, "invites"), {
        method: "POST",
        ...jsonBody({ role, expires_in_days: days }),
      });
      invites.replaceItem(invite, (item) => item.id);
      if (invite.join_path !== undefined)
        setCreatedLink(`${window.location.origin}${invite.join_path}`);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create an invitation."),
      );
    } finally {
      setCreating(false);
    }
  }

  async function revoke(invite: WorldInvite) {
    setError(null);
    try {
      const saved = await api<WorldInvite>(
        worldPath(world.id, `invites/${invite.id}/revoke`),
        { method: "POST" },
      );
      invites.replaceItem(saved, (item) => item.id);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not revoke this invitation."),
      );
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
    } catch {
      const input = document.querySelector<HTMLInputElement>(
        "#created-invite-link",
      );
      input?.select();
    }
  }

  const activeInvites = invites.items.filter(
    (invite) =>
      invite.revoked_at === undefined &&
      new Date(invite.expires_at).getTime() > Date.now(),
  );
  return (
    <section className="people-page content-narrow">
      <PageIntro
        eyebrow="World access"
        title="People & invites"
        description="Invite links give someone a place in this world. Their role decides what they can see and do."
      />

      <div className="people-layout">
        <section className="panel invite-builder">
          <header>
            <div>
              <p className="eyebrow">Invite someone</p>
              <h2>Make room at the table.</h2>
            </div>
            <span className="panel-mark" aria-hidden="true">
              ↗
            </span>
          </header>
          <form onSubmit={(event) => void createInvite(event)}>
            <div className="invite-form-grid">
              <Field label="They can join as">
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(
                      event.currentTarget.value as Exclude<WorldRole, "owner">,
                    )
                  }
                >
                  <option value="player">Player — respond in play</option>
                  <option value="spectator">Spectator — watch the table</option>
                  <option value="editor">
                    Editor — configure and facilitate
                  </option>
                </select>
              </Field>
              <Field label="Link expires">
                <select
                  value={days}
                  onChange={(event) =>
                    setDays(Number(event.currentTarget.value))
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
              disabled={creating}
            >
              {creating ? "Creating link…" : "Create invite link"}
            </button>
          </form>
          {createdLink === "" ? null : (
            <div className="created-invite" role="status">
              <div>
                <span>Ready to share</span>
                <strong>{humanize(role)} invitation</strong>
              </div>
              <div className="copy-field">
                <input
                  id="created-invite-link"
                  readOnly
                  value={createdLink}
                  aria-label="Invite link"
                />
                <button
                  className="button button-ink"
                  type="button"
                  onClick={() => void copyLink()}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <p>
                The full token is shown only now. You can revoke the link below
                at any time.
              </p>
            </div>
          )}
          {error === null ? null : <ErrorMessage error={error} />}
        </section>

        <section className="panel member-panel">
          <header>
            <div>
              <p className="eyebrow">Members</p>
              <h2>
                {members.items.length}{" "}
                {members.items.length === 1 ? "person" : "people"}
              </h2>
            </div>
          </header>
          {members.loading ? <LoadingState label="Loading members" /> : null}
          {members.error === null ? null : (
            <ErrorMessage error={members.error} onRetry={members.reload} />
          )}
          <div className="member-list">
            {members.items.map((member) => (
              <div className="member-row" key={member.id}>
                <Avatar name={member.display_name} />
                <div>
                  <strong>{member.display_name}</strong>
                  <small>
                    Joined{" "}
                    {formatRelativeDate(member.joined_at ?? member.created_at)}
                    {member.role === "player"
                      ? ` · ${humanize(member.play_status)}`
                      : ""}
                  </small>
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
            <p className="eyebrow">Open invitations</p>
            <h2>
              {activeInvites.length === 0
                ? "No links are open"
                : `${activeInvites.length} ${activeInvites.length === 1 ? "link" : "links"} can still be used`}
            </h2>
          </div>
        </header>
        {invites.loading ? <LoadingState label="Loading invitations" /> : null}
        {invites.error === null ? null : (
          <ErrorMessage error={invites.error} onRetry={invites.reload} />
        )}
        <div className="invite-list">
          {invites.items.map((invite) => {
            const expired = new Date(invite.expires_at).getTime() <= Date.now();
            const closed = invite.revoked_at !== undefined || expired;
            return (
              <div
                className={
                  closed ? "invite-row invite-row-closed" : "invite-row"
                }
                key={invite.id}
              >
                <span className="invite-row-icon" aria-hidden="true">
                  ↗
                </span>
                <div>
                  <strong>{humanize(invite.role)} link</strong>
                  <small>
                    Created by {invite.created_by_display_name} ·{" "}
                    {invite.use_count} {invite.use_count === 1 ? "use" : "uses"}
                  </small>
                </div>
                <span>
                  {invite.revoked_at !== undefined
                    ? "Revoked"
                    : expired
                      ? "Expired"
                      : `Expires ${formatRelativeDate(invite.expires_at)}`}
                </span>
                {!closed ? (
                  <button
                    className="button button-danger-quiet"
                    type="button"
                    onClick={() => void revoke(invite)}
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </section>
  );
}
