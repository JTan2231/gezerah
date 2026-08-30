import { Brand, ErrorMessage, Field } from "../components/StudioUI";

export type AuthenticationMode = "signin" | "signup";

interface AuthenticationIssue {
  kind: "connection" | "request";
  message: string;
}

interface IdentityGateViewModel {
  mode: AuthenticationMode;
  username: string;
  displayName: string;
  password: string;
  passwordConfirmation: string;
  passwordConfirmationError?: string | undefined;
  minimumPasswordCharacters: number;
  notice?: string | undefined;
  saving: boolean;
  canSubmit: boolean;
  issue: AuthenticationIssue | null;
  fieldIssues: {
    username?: string | undefined;
    displayName?: string | undefined;
    password?: string | undefined;
  };
}

interface IdentityGateViewActions {
  changeMode: (mode: AuthenticationMode) => void;
  changeUsername: (username: string) => void;
  changeDisplayName: (displayName: string) => void;
  changePassword: (password: string) => void;
  changePasswordConfirmation: (confirmation: string) => void;
  submit: () => void;
}

const usernamePattern = "[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}";

export function IdentityGateView({
  model,
  actions,
}: {
  model: IdentityGateViewModel;
  actions: IdentityGateViewActions;
}) {
  const signingUp = model.mode === "signup";

  return (
    <main className="identity-page">
      <section className="identity-panel" aria-labelledby="identity-title">
        <div className="identity-panel-inner">
          <Brand />
          <h1 id="identity-title">
            {signingUp ? "Create account" : "Sign in"}
          </h1>
          <p className="muted-copy">
            {signingUp
              ? "Choose a username and password. No email is required."
              : "Enter your username and password."}
          </p>

          <div className="auth-mode-switch" aria-label="Authentication mode">
            <button
              type="button"
              aria-pressed={!signingUp}
              onClick={() => actions.changeMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={signingUp}
              onClick={() => actions.changeMode("signup")}
            >
              Create account
            </button>
          </div>

          {model.notice === undefined ? null : (
            <div className="notice auth-session-notice" role="status">
              <p>{model.notice}</p>
            </div>
          )}

          <form
            className="identity-form"
            onSubmit={(event) => {
              event.preventDefault();
              actions.submit();
            }}
          >
            <Field
              label="Username"
              hint={
                signingUp
                  ? "3–64 characters. Use letters, numbers, dots, underscores, or hyphens."
                  : undefined
              }
              error={model.fieldIssues.username}
            >
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={model.username}
                onChange={(event) =>
                  actions.changeUsername(event.currentTarget.value)
                }
                pattern={signingUp ? usernamePattern : undefined}
                maxLength={64}
                required
              />
            </Field>
            {signingUp ? (
              <Field
                label="Display name"
                hint="The name shown to other World members in Play."
                error={model.fieldIssues.displayName}
              >
                <input
                  name="displayName"
                  autoComplete="name"
                  value={model.displayName}
                  onChange={(event) =>
                    actions.changeDisplayName(event.currentTarget.value)
                  }
                  maxLength={200}
                  required
                />
              </Field>
            ) : null}
            <Field
              label="Password"
              hint={
                signingUp
                  ? `Minimum ${model.minimumPasswordCharacters} characters.`
                  : undefined
              }
              error={model.fieldIssues.password}
            >
              <input
                name="password"
                type="password"
                autoComplete={signingUp ? "new-password" : "current-password"}
                value={model.password}
                onChange={(event) =>
                  actions.changePassword(event.currentTarget.value)
                }
                required
              />
            </Field>
            {signingUp ? (
              <Field
                label="Confirm password"
                error={model.passwordConfirmationError}
              >
                <input
                  name="passwordConfirmation"
                  type="password"
                  autoComplete="new-password"
                  value={model.passwordConfirmation}
                  onChange={(event) =>
                    actions.changePasswordConfirmation(
                      event.currentTarget.value,
                    )
                  }
                  aria-invalid={model.passwordConfirmationError !== undefined}
                  required
                />
              </Field>
            ) : null}
            {model.issue === null ? null : <ErrorMessage error={model.issue} />}
            <button
              className="button button-primary button-wide"
              type="submit"
              disabled={model.saving || !model.canSubmit}
            >
              {model.saving
                ? signingUp
                  ? "Creating account…"
                  : "Signing in…"
                : signingUp
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
