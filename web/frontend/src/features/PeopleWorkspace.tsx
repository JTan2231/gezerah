import { useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type { World, WorldInvite, WorldMember } from "../api/types";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { PeopleView, type InviteRole, type PeopleInvite } from "./PeopleView";

export function PeopleWorkspace({ world }: { world: World }) {
  const members = useCollection<WorldMember>(worldPath(world.id, "members"));
  const invites = useCollection<WorldInvite>(worldPath(world.id, "invites"));
  const [role, setRole] = useState<InviteRole>("player");
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function createInvite() {
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

  async function revoke(inviteID: string) {
    const invite = invites.items.find((candidate) => candidate.id === inviteID);
    if (invite === undefined) return;
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

  const now = Date.now();
  const viewInvites = invites.items.map<PeopleInvite>((invite) => {
    const expired = new Date(invite.expires_at).getTime() <= now;
    const closed = invite.revoked_at !== undefined || expired;
    return {
      id: invite.id,
      roleLabel: humanize(invite.role),
      creatorAndUses: `Created by ${invite.created_by_display_name} · ${invite.use_count} ${invite.use_count === 1 ? "use" : "uses"}`,
      statusLabel:
        invite.revoked_at !== undefined
          ? "Revoked"
          : expired
            ? "Expired"
            : `Expires ${formatRelativeDate(invite.expires_at)}`,
      closed,
    };
  });
  const activeInviteCount = viewInvites.filter(
    (invite) => !invite.closed,
  ).length;

  return (
    <PeopleView
      model={{
        inviteDraft: { role, expiresInDays: days },
        creating,
        createdLink,
        createdRoleLabel: humanize(role),
        copied,
        issue: error === null ? null : toErrorNotice(error),
        members: members.items.map((member) => ({
          id: member.id,
          displayName: member.display_name,
          role: member.role,
          details: `Joined ${formatRelativeDate(member.joined_at ?? member.created_at)}${member.role === "spectator" ? "" : ` · ${humanize(member.current_play_role)} · ${humanize(member.play_status)}`}`,
        })),
        membersLoading: members.loading,
        membersIssue:
          members.error === null ? null : toErrorNotice(members.error),
        invites: viewInvites,
        invitesLoading: invites.loading,
        invitesIssue:
          invites.error === null ? null : toErrorNotice(invites.error),
        activeInviteCount,
      }}
      actions={{
        changeRole: setRole,
        changeExpiry: setDays,
        createInvite: () => void createInvite(),
        copyLink: () => void copyLink(),
        revokeInvite: (inviteID) => void revoke(inviteID),
        retryMembers: members.reload,
        retryInvites: invites.reload,
      }}
    />
  );
}
