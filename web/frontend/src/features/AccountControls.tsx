import { useState } from "react";

import { api, ApiError, jsonBody } from "../api/client";
import type { AuthenticatedSession, User } from "../api/types";
import { ErrorMessage, Field, Modal } from "../components/StudioUI";
import {
  minimumPasswordCharacters,
  passwordMeetsMinimumLength,
} from "../domain/password";

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
  const [signingOut, setSigningOut] = useState<"current" | "all" | null>(null);
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

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!canChangePassword) return;
    setSaving(true);
    setChanged(false);
    setError(null);
    try {
      const session = await api<AuthenticatedSession>("/api/me/password", {
        method: "PUT",
        ...jsonBody({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
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

  async function signOut(scope: "current" | "all") {
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
    <>
      <div className="account-control-buttons">
        <button
          className="text-button"
          type="button"
          onClick={() => setOpen(true)}
        >
          Account
        </button>
        <button
          className="text-button"
          type="button"
          disabled={signingOut !== null}
          onClick={() => void signOut("current")}
        >
          {signingOut === "current" ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {open ? (
        <Modal
          title="Your account"
          description={`Signed in as @${user.username}`}
          onClose={close}
        >
          <form
            className="modal-form account-password-form"
            onSubmit={(event) => void changePassword(event)}
          >
            <div className="account-details">
              <span>Display name</span>
              <strong>{user.display_name}</strong>
              <span>Username</span>
              <strong>@{user.username}</strong>
            </div>
            <Field
              label="Current password"
              error={error?.fields["current_password"]}
            >
              <input
                name="current_password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) =>
                  setCurrentPassword(event.currentTarget.value)
                }
                required
              />
            </Field>
            <Field
              label="New password"
              hint={`Minimum ${minimumPasswordCharacters} characters.`}
              error={error?.fields["new_password"]}
            >
              <input
                name="new_password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                required
              />
            </Field>
            <Field
              label="Confirm new password"
              error={newPasswordConfirmationError}
            >
              <input
                name="new_password_confirmation"
                type="password"
                autoComplete="new-password"
                value={newPasswordConfirmation}
                onChange={(event) =>
                  setNewPasswordConfirmation(event.currentTarget.value)
                }
                aria-invalid={newPasswordConfirmationError !== undefined}
                required
              />
            </Field>
            {changed ? (
              <div className="notice notice-success" role="status">
                <p>Your password has been changed.</p>
              </div>
            ) : null}
            {error === null ? null : <ErrorMessage error={error} />}
            <div className="account-session-actions">
              <div>
                <strong>End this session</strong>
                <p>You will need your username and password to return.</p>
              </div>
              <button
                className="button button-danger-quiet"
                type="button"
                disabled={signingOut !== null}
                onClick={() => void signOut("current")}
              >
                {signingOut === "current" ? "Signing out…" : "Sign out"}
              </button>
            </div>
            <div className="account-session-actions">
              <div>
                <strong>End every session</strong>
                <p>Sign out on this browser and every other device.</p>
              </div>
              <button
                className="button button-danger-quiet"
                type="button"
                disabled={signingOut !== null}
                onClick={() => void signOut("all")}
              >
                {signingOut === "all" ? "Signing out…" : "Sign out everywhere"}
              </button>
            </div>
            <footer className="modal-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={close}
              >
                Close
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={saving || !canChangePassword}
              >
                {saving ? "Changing password…" : "Change password"}
              </button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
