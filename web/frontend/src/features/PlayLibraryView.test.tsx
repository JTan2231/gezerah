import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayLibraryView, type PlayLibraryViewModel } from "./PlayLibraryView";

const noop = () => undefined;
const emptyLibrary: PlayLibraryViewModel = {
  account: { displayName: "Rowan Vale", username: "rowan" },
  worlds: [],
  loading: false,
  issue: null,
};

describe("PlayLibraryView", () => {
  test("sends an empty library back to the ChatGPT-first Home flow", () => {
    const html = renderToStaticMarkup(
      <PlayLibraryView
        model={emptyLibrary}
        accountControls={null}
        onReturnHome={noop}
        onOpenWorld={noop}
        onRetry={noop}
      />,
    );

    expect(html).toContain("What world do you want to play?");
    expect(html).toContain("No saved worlds yet");
    expect(html).toContain("Start from Home with ChatGPT");
    expect(html).not.toContain("New world");
  });

  test("shows saved Worlds without a manual new-World affordance", () => {
    const html = renderToStaticMarkup(
      <PlayLibraryView
        model={{
          ...emptyLibrary,
          worlds: [
            {
              id: "world-1",
              name: "Glass Harbor",
              description: "Ships, storms, and difficult bargains.",
              membershipRole: "owner",
              currentPlayRoleLabel: "Facilitator",
              status: "active",
              playStatus: "Ready",
              memberCount: 3,
              lastActive: "2h ago",
            },
          ],
        }}
        accountControls={null}
        onReturnHome={noop}
        onOpenWorld={noop}
        onRetry={noop}
      />,
    );

    expect(html).toContain("Glass Harbor");
    expect(html).toContain("Saved worlds");
    expect(html).not.toContain("New world");
    expect(html).toContain("Open");
  });
});
