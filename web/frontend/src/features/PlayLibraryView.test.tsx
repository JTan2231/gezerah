import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayLibraryView, type PlayLibraryViewModel } from "./PlayLibraryView";

const noop = () => undefined;
const worldStart = {
  prompt: "Starter prompt fixture",
  chatGPTHref:
    "https://chatgpt.com/?surface=work&prompt=Starter+prompt+fixture",
  copyStatus: "idle" as const,
  buildHref: "/build",
  onCopyPrompt: noop,
  onStartBuild: noop,
  footnote: "Already invited? Open the invitation link you received.",
};
const emptyLibrary: PlayLibraryViewModel = {
  account: { displayName: "Rowan Vale", username: "rowan" },
  worlds: [],
  loading: false,
  issue: null,
};

describe("PlayLibraryView", () => {
  test("offers the ChatGPT quick start when the library is empty", () => {
    const html = renderToStaticMarkup(
      <PlayLibraryView
        model={emptyLibrary}
        accountControls={null}
        onReturnHome={noop}
        onOpenWorld={noop}
        onRetry={noop}
        worldStart={worldStart}
      />,
    );

    expect(html).toContain("Start a World with ChatGPT");
    expect(html).toContain("Starter prompt fixture");
    expect(html).toContain("Start in ChatGPT");
    expect(html).toContain(
      "Already invited? Open the invitation link you received.",
    );
  });

  test("shows admitted Worlds without the quick start", () => {
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
        worldStart={worldStart}
      />,
    );

    expect(html).toContain("Glass Harbor");
    expect(html).not.toContain("Start a World with ChatGPT");
  });
});
