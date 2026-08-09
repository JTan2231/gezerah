import { useState } from "react";

import { api, ApiError, jsonBody } from "../api/client";
import type { AuthenticatedSession } from "../api/types";
import { Brand, ErrorMessage, Field } from "../components/StudioUI";
import {
  minimumPasswordCharacters,
  passwordMeetsMinimumLength,
} from "../domain/password";

type AuthenticationMode = "signin" | "signup";

const usernamePattern = "[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}";

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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const session = await api<AuthenticatedSession>(
        mode === "signup" ? "/api/auth/signup" : "/api/auth/signin",
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
    <main className="identity-page">
      <section className="identity-panel" aria-labelledby="identity-title">
        <div className="identity-panel-inner">
          <Brand />
          <h1 id="identity-title">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h1>
          <p className="muted-copy">
            {mode === "signin"
              ? "Enter your username and password."
              : "Choose a username and password. No email is required."}
          </p>

          <div className="auth-mode-switch" aria-label="Authentication mode">
            <button
              type="button"
              aria-pressed={mode === "signin"}
              onClick={() => changeMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              onClick={() => changeMode("signup")}
            >
              Create account
            </button>
          </div>

          {notice === undefined ? null : (
            <div className="notice auth-session-notice" role="status">
              <p>{notice}</p>
            </div>
          )}

          <form
            className="identity-form"
            onSubmit={(event) => void submit(event)}
          >
            <Field
              label="Username"
              hint={
                mode === "signup"
                  ? "3–64 characters. Use letters, numbers, dots, underscores, or hyphens."
                  : undefined
              }
              error={error?.fields["username"]}
            >
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.currentTarget.value)}
                pattern={mode === "signup" ? usernamePattern : undefined}
                maxLength={64}
                required
              />
            </Field>
            {mode === "signup" ? (
              <Field
                label="Display name"
                hint="The name other people will see at the table."
                error={error?.fields["display_name"]}
              >
                <input
                  name="display_name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) =>
                    setDisplayName(event.currentTarget.value)
                  }
                  maxLength={200}
                  required
                />
              </Field>
            ) : null}
            <Field
              label="Password"
              hint={
                mode === "signup"
                  ? `Minimum ${minimumPasswordCharacters} characters.`
                  : undefined
              }
              error={error?.fields["password"]}
            >
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                required
              />
            </Field>
            {mode === "signup" ? (
              <Field label="Confirm password" error={passwordConfirmationError}>
                <input
                  name="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirmation}
                  onChange={(event) =>
                    setPasswordConfirmation(event.currentTarget.value)
                  }
                  aria-invalid={passwordConfirmationError !== undefined}
                  required
                />
              </Field>
            ) : null}
            {error === null ? null : <ErrorMessage error={error} />}
            <button
              className="button button-primary button-wide"
              type="submit"
              disabled={saving || !canSubmit}
            >
              {saving
                ? mode === "signup"
                  ? "Creating account…"
                  : "Signing in…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
          <p className="identity-footnote">
            There is no email recovery. Keep your password somewhere safe.
          </p>
        </div>
      </section>
    </main>
  );
}
