import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BuildLibraryView,
  type BuildLibraryViewActions,
  type BuildLibraryViewModel,
} from "./BuildLibraryView";

const actions: BuildLibraryViewActions = {
  returnHome: () => undefined,
  createWorld: () => undefined,
  openWorld: () => undefined,
  retry: () => undefined,
};

const worldStart = {
  variant: "build" as const,
  prompt:
    "Help me start a new World in Gezerah at https://gezerah.example/build.",
  chatGPTHref:
    "https://chatgpt.com/?surface=work&prompt=Help+me+start+a+new+World",
  copyStatus: "idle" as const,
  onCopyPrompt: () => undefined,
};

const loadedLibrary: BuildLibraryViewModel = {
  account: { displayName: "Rowan Vale", username: "rowan" },
  loading: false,
  issue: null,
  worlds: [
    {
      id: "world-1",
      name: "Glass Harbor",
      description: "Ships, storms, and difficult bargains.",
      role: "owner",
      status: "active",
      memberCount: 5,
      capacityCount: 3,
      capabilityCount: 7,
      lastActive: "2h ago",
    },
  ],
};

describe("BuildLibraryView", () => {
  test("renders a mapped library fixture without collections or routes", () => {
    const html = renderToStaticMarkup(
      <BuildLibraryView
        model={loadedLibrary}
        actions={actions}
        worldStart={worldStart}
        accountControls={<button type="button">Account fixture</button>}
        createWorldDialog={null}
      />,
    );

    expect(html).toContain("Glass Harbor");
    expect(html).toContain("Ships, storms, and difficult bargains.");
    expect(html).toContain("Active 2h ago");
    expect(html).toContain("Account fixture");
    expect(html).toContain("Start a World with ChatGPT");
    expect(html).toContain("https://gezerah.example/build");
    expect(html).toContain("Copy starter prompt");
    expect(html.indexOf("Start a World with ChatGPT")).toBeLessThan(
      html.indexOf("Glass Harbor"),
    );
  });

  test("renders the empty state from an empty fixture", () => {
    const html = renderToStaticMarkup(
      <BuildLibraryView
        model={{ ...loadedLibrary, worlds: [] }}
        actions={actions}
        worldStart={worldStart}
        accountControls={null}
        createWorldDialog={null}
      />,
    );

    expect(html).toContain("No worlds");
    expect(html).toContain(
      "Create a world to configure its Mechanics and issue membership invitations.",
    );
  });
});
