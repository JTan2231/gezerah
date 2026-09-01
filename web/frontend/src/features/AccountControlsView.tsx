import { ErrorMessage, Field, Modal } from "../components/StudioUI";

export type SignOutScope = "current" | "all";

interface AccountIssue {
  kind: "connection" | "request";
  message: string;
}

interface AccountControlsViewModel {
  user: {
    displayName: string;
    username: string;
  };
  open: boolean;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  newPasswordConfirmationError?: string | undefined;
  minimumPasswordCharacters: number;
  canChangePassword: boolean;
  saving: boolean;
  signingOut: SignOutScope | null;
  changed: boolean;
  issue: AccountIssue | null;
  fieldIssues: {
    currentPassword?: string | undefined;
    newPassword?: string | undefined;
  };
}

interface AccountControlsViewActions {
  open: () => void;
  close: () => void;
  changeCurrentPassword: (password: string) => void;
  changeNewPassword: (password: string) => void;
  changeNewPasswordConfirmation: (confirmation: string) => void;
  changePassword: () => void;
  signOut: (scope: SignOutScope) => void;
}

export function AccountControlsView({
  model,
  actions,
}: {
  model: AccountControlsViewModel;
  actions: AccountControlsViewActions;
}) {
  return (
    <>
      <div className="account-control-buttons">
        <button className="text-button" type="button" onClick={actions.open}>
          Account
        </button>
        <button
          className="text-button"
          type="button"
          disabled={model.signingOut !== null}
          onClick={() => actions.signOut("current")}
        >
          {model.signingOut === "current" ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {model.open ? (
        <Modal
          title="Your account"
          description={`Signed in as @${model.user.username}`}
          onClose={actions.close}
        >
          <form
            className="modal-form account-password-form"
            onSubmit={(event) => {
              event.preventDefault();
              actions.changePassword();
            }}
          >
            <div className="account-details">
              <span>Display name</span>
              <strong>{model.user.displayName}</strong>
              <span>Username</span>
              <strong>@{model.user.username}</strong>
            </div>
            <Field
              label="Current password"
              error={model.fieldIssues.currentPassword}
            >
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                value={model.currentPassword}
                onChange={(event) =>
                  actions.changeCurrentPassword(event.currentTarget.value)
                }
                required
              />
            </Field>
            <Field
              label="New password"
              hint={`Minimum ${model.minimumPasswordCharacters} characters.`}
              error={model.fieldIssues.newPassword}
            >
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={model.newPassword}
                onChange={(event) =>
                  actions.changeNewPassword(event.currentTarget.value)
                }
                required
              />
            </Field>
            <Field
              label="Confirm new password"
              error={model.newPasswordConfirmationError}
            >
              <input
                name="newPasswordConfirmation"
                type="password"
                autoComplete="new-password"
                value={model.newPasswordConfirmation}
                onChange={(event) =>
                  actions.changeNewPasswordConfirmation(
                    event.currentTarget.value,
                  )
                }
                aria-invalid={model.newPasswordConfirmationError !== undefined}
                required
              />
            </Field>
            {model.changed ? (
              <div className="notice notice-success" role="status">
                <p>Your password has been changed.</p>
              </div>
            ) : null}
            {model.issue === null ? null : <ErrorMessage error={model.issue} />}
            <div className="account-session-actions">
              <div>
                <strong>End this session</strong>
                <p>You will need your username and password to return.</p>
              </div>
              <button
                className="button button-danger-quiet"
                type="button"
                disabled={model.signingOut !== null}
                onClick={() => actions.signOut("current")}
              >
                {model.signingOut === "current" ? "Signing out…" : "Sign out"}
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
                disabled={model.signingOut !== null}
                onClick={() => actions.signOut("all")}
              >
                {model.signingOut === "all"
                  ? "Signing out…"
                  : "Sign out everywhere"}
              </button>
            </div>
            <footer className="modal-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={actions.close}
              >
                Close
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={model.saving || !model.canChangePassword}
              >
                {model.saving ? "Changing password…" : "Change password"}
              </button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
