import { useState } from "react";

import { api, ApiError, jsonBody, toErrorNotice } from "../api/client";
import type { AuthenticatedSession, User } from "../api/types";
import {
  minimumPasswordCharacters,
  passwordMeetsMinimumLength,
} from "../domain/password";
import { AccountControlsView, type SignOutScope } from "./AccountControlsView";

export function AccountControls({
  user,
  onLogout,
  onLogoutAll,
  onSessionChanged,
}: {
  user: User;
  onLogout: () => Promise<void>;
  onLogoutAll: () => Promise<void>;
  onSessionChanged: (session: AuthenticatedSession) => void;
}) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState<SignOutScope | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const canChangePassword =
    currentPassword !== "" &&
    passwordMeetsMinimumLength(newPassword) &&
    newPasswordConfirmation === newPassword;
  const newPasswordConfirmationError =
    newPasswordConfirmation !== "" && newPasswordConfirmation !== newPassword
      ? "must match the new password"
      : undefined;

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordConfirmation("");
    setChanged(false);
    setError(null);
  }

  async function changePassword() {
    if (!canChangePassword) return;
    setSaving(true);
    setChanged(false);
    setError(null);
    try {
      const session = await api<AuthenticatedSession>(
        "/wrought/api/me/password",
        {
          method: "PUT",
          ...jsonBody({
            current_password: currentPassword,
            new_password: newPassword,
          }),
        },
      );
      onSessionChanged(session);
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setChanged(true);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not change your password."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function signOut(scope: SignOutScope) {
    setSigningOut(scope);
    setError(null);
    try {
      await (scope === "all" ? onLogoutAll() : onLogout());
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not sign you out."),
      );
      setOpen(true);
    } finally {
      setSigningOut(null);
    }
  }

  return (
    <AccountControlsView
      model={{
        user: { displayName: user.display_name, username: user.username },
        open,
        currentPassword,
        newPassword,
        newPasswordConfirmation,
        newPasswordConfirmationError,
        minimumPasswordCharacters,
        canChangePassword,
        saving,
        signingOut,
        changed,
        issue: error === null ? null : toErrorNotice(error),
        fieldIssues: {
          currentPassword: error?.fields["current_password"],
          newPassword: error?.fields["new_password"],
        },
      }}
      actions={{
        open: () => setOpen(true),
        close,
        changeCurrentPassword: setCurrentPassword,
        changeNewPassword: setNewPassword,
        changeNewPasswordConfirmation: setNewPasswordConfirmation,
        changePassword: () => void changePassword(),
        signOut: (scope) => void signOut(scope),
      }}
    />
  );
}
