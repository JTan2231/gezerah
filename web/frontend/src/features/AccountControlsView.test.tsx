import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AccountControlsView } from "./AccountControlsView";

type AccountControlsViewProps = Parameters<typeof AccountControlsView>[0];

const noop = () => undefined;
const actions: AccountControlsViewProps["actions"] = {
  open: noop,
  close: noop,
  changeCurrentPassword: noop,
  changeNewPassword: noop,
  changeNewPasswordConfirmation: noop,
  changePassword: noop,
  signOut: noop,
};

const baseModel: AccountControlsViewProps["model"] = {
  user: { displayName: "Rowan Vale", username: "rowan" },
  open: false,
  currentPassword: "",
  newPassword: "",
  newPasswordConfirmation: "",
  minimumPasswordCharacters: 12,
  canChangePassword: false,
  saving: false,
  signingOut: null,
  changed: false,
  issue: null,
  fieldIssues: {},
};

describe("AccountControlsView", () => {
  test("renders the closed current-session busy state", () => {
    const html = renderToStaticMarkup(
      <AccountControlsView
        model={{ ...baseModel, signingOut: "current" }}
        actions={actions}
      />,
    );

    expect(html).toContain("Account");
    expect(html).toContain("Signing out…");
    expect(html).not.toContain('role="dialog"');
  });

  test("renders password validation and modal busy state", () => {
    const html = renderToStaticMarkup(
      <AccountControlsView
        model={{
          ...baseModel,
          open: true,
          currentPassword: "incorrect",
          newPassword: "short",
          newPasswordConfirmation: "different",
          newPasswordConfirmationError: "Passwords do not match.",
          saving: true,
          issue: {
            kind: "request",
            message: "Check the highlighted fields.",
          },
          fieldIssues: {
            currentPassword: "Current password is incorrect.",
            newPassword: "Use at least 12 characters.",
          },
        }}
        actions={actions}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Signed in as @rowan");
    expect(html).toContain("Current password is incorrect.");
    expect(html).toContain("Passwords do not match.");
    expect(html).toContain("Check the highlighted fields.");
    expect(html).toContain("Changing password…");
  });
});
