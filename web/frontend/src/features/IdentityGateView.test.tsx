import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { IdentityGateView } from "./IdentityGateView";

type IdentityGateViewProps = Parameters<typeof IdentityGateView>[0];

const noop = () => undefined;
const actions: IdentityGateViewProps["actions"] = {
  changeMode: noop,
  changeUsername: noop,
  changeDisplayName: noop,
  changePassword: noop,
  changePasswordConfirmation: noop,
  submit: noop,
};

describe("IdentityGateView", () => {
  test("renders signup validation and a busy connection-error state", () => {
    const html = renderToStaticMarkup(
      <IdentityGateView
        model={{
          mode: "signup",
          username: "r",
          displayName: "",
          password: "short",
          passwordConfirmation: "different",
          passwordConfirmationError: "Passwords do not match.",
          minimumPasswordCharacters: 12,
          notice: "Your previous session ended.",
          saving: true,
          canSubmit: false,
          issue: {
            kind: "connection",
            message: "Check your connection and try again.",
          },
          fieldIssues: {
            username: "Use at least 3 characters.",
            displayName: "Enter a display name.",
            password: "Use at least 12 characters.",
          },
        }}
        actions={actions}
      />,
    );

    expect(html).toContain("Create account");
    expect(html).toContain("Your previous session ended.");
    expect(html).toContain("Use at least 3 characters.");
    expect(html).toContain("Passwords do not match.");
    expect(html).toContain("Connection lost");
    expect(html).toContain("Creating account…");
    expect(html).toContain('name="displayName"');
  });

  test("renders the compact sign-in branch", () => {
    const html = renderToStaticMarkup(
      <IdentityGateView
        model={{
          mode: "signin",
          username: "rowan",
          displayName: "",
          password: "",
          passwordConfirmation: "",
          minimumPasswordCharacters: 12,
          saving: false,
          canSubmit: false,
          issue: null,
          fieldIssues: {},
        }}
        actions={actions}
      />,
    );

    expect(html).toContain("Enter your username and password.");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('name="displayName"');
    expect(html).not.toContain('name="passwordConfirmation"');
  });
});
