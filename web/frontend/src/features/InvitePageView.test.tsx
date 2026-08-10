import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { InvitePageView } from "./InvitePageView";

type InvitePageViewProps = Parameters<typeof InvitePageView>[0];

const noop = () => undefined;
const baseModel: InvitePageViewProps["model"] = {
  account: { displayName: "Mara Vale", username: "mara" },
  loading: false,
  loadIssue: null,
  joinIssue: null,
  joining: false,
  invitation: null,
};

function renderInvite(model: InvitePageViewProps["model"]) {
  return renderToStaticMarkup(
    <InvitePageView
      model={model}
      accountControls={<button type="button">Account fixture</button>}
      onJoin={noop}
      onReturnToWorlds={noop}
      onNotNow={noop}
    />,
  );
}

describe("InvitePageView", () => {
  test("renders the loading state independently of invitation transport", () => {
    const html = renderInvite({ ...baseModel, loading: true });

    expect(html).toContain("Loading invitation");
    expect(html).toContain("Account fixture");
    expect(html).toContain("@mara");
  });

  test("renders an unavailable invitation with a retry destination", () => {
    const html = renderInvite({
      ...baseModel,
      loadIssue: {
        kind: "connection",
        message: "The invitation could not be loaded.",
      },
    });

    expect(html).toContain("Invitation unavailable");
    expect(html).toContain("Connection lost");
    expect(html).toContain("The invitation could not be loaded.");
    expect(html).toContain("Return to your worlds");
  });

  test("renders invitation details and a busy join error", () => {
    const html = renderInvite({
      ...baseModel,
      joining: true,
      joinIssue: {
        kind: "request",
        message: "You could not join this world.",
      },
      invitation: {
        worldName: "The Glass Coast",
        worldDescription: "Storms, wrecks, and difficult bargains.",
        invitedByDisplayName: "Rowan Vale",
        role: "player",
      },
    });

    expect(html).toContain("Invitation to The Glass Coast");
    expect(html).toContain("Invited by Rowan Vale");
    expect(html).toContain("Storms, wrecks, and difficult bargains.");
    expect(html).toContain("Player");
    expect(html).toContain("You could not join this world.");
    expect(html).toContain("Joining…");
  });
});
