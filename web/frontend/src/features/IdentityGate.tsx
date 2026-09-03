import { useState } from "react";

import { api, ApiError, jsonBody, toErrorNotice } from "../api/client";
import type { AuthenticatedSession } from "../api/types";
import {
  minimumPasswordCharacters,
  passwordMeetsMinimumLength,
} from "../domain/password";
import { IdentityGateView, type AuthenticationMode } from "./IdentityGateView";

export function IdentityGate({
  notice,
  onAuthenticated,
}: {
  notice?: string | undefined;
  onAuthenticated: (session: AuthenticatedSession) => void;
}) {
  const [mode, setMode] = useState<AuthenticationMode>("signin");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const canSubmit =
    username.trim() !== "" &&
    password !== "" &&
    (mode === "signin" ||
      (displayName.trim() !== "" &&
        passwordMeetsMinimumLength(password) &&
        passwordConfirmation === password));
  const passwordConfirmationError =
    mode === "signup" &&
    passwordConfirmation !== "" &&
    passwordConfirmation !== password
      ? "must match the password"
      : undefined;

  function changeMode(nextMode: AuthenticationMode) {
    setMode(nextMode);
    setPassword("");
    setPasswordConfirmation("");
    setError(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const session = await api<AuthenticatedSession>(
        mode === "signup"
          ? "/wrought/api/auth/signup"
          : "/wrought/api/auth/signin",
        {
          method: "POST",
          ...jsonBody(
            mode === "signup"
              ? {
                  username: username.trim(),
                  display_name: displayName.trim(),
                  password,
                }
              : { username: username.trim(), password },
          ),
        },
      );
      onAuthenticated(session);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(
              0,
              "unknown",
              mode === "signup"
                ? "Could not create your account."
                : "Could not sign you in.",
            ),
      );
      setSaving(false);
    }
  }

  return (
    <IdentityGateView
      model={{
        mode,
        username,
        displayName,
        password,
        passwordConfirmation,
        passwordConfirmationError,
        minimumPasswordCharacters,
        notice,
        saving,
        canSubmit,
        issue: error === null ? null : toErrorNotice(error),
        fieldIssues: {
          username: error?.fields["username"],
          displayName: error?.fields["display_name"],
          password: error?.fields["password"],
        },
      }}
      actions={{
        changeMode,
        changeUsername: setUsername,
        changeDisplayName: setDisplayName,
        changePassword: setPassword,
        changePasswordConfirmation: setPasswordConfirmation,
        submit: () => void submit(),
      }}
    />
  );
}
