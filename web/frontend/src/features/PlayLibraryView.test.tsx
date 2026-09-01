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
  test("always offers a new World when the library is empty", () => {
    const html = renderToStaticMarkup(
      <PlayLibraryView
        model={emptyLibrary}
        accountControls={null}
        onReturnHome={noop}
        onCreateWorld={noop}
        onOpenWorld={noop}
        onRetry={noop}
      />,
    );

    expect(html).toContain("What world do you want to play?");
    expect(html).toContain("New world");
    expect(html).toContain("No saved worlds yet");
  });

  test("shows saved Worlds alongside the new-World choice", () => {
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
        onCreateWorld={noop}
        onOpenWorld={noop}
        onRetry={noop}
      />,
    );

    expect(html).toContain("Glass Harbor");
    expect(html).toContain("Saved worlds");
    expect(html).toContain("New world");
    expect(html).toContain("Open");
  });
});
