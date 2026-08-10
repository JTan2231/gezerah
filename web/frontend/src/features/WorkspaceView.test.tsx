import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BuildWorkspaceView } from "./BuildWorkspaceView";
import { PlayWorkspaceView } from "./PlayWorkspaceView";

describe("workspace presentation", () => {
  test("renders the Build shell from semantic fixture data", () => {
    const html = renderToStaticMarkup(
      <BuildWorkspaceView
        model={{
          section: "character-fields",
          worldName: "The Glass March",
          role: "owner",
          capacityCount: 4,
          capabilityCount: 7,
          characterFieldCount: 3,
          memberCount: 5,
          user: { displayName: "River", username: "river.song" },
        }}
        actions={{
          openHome: () => undefined,
          openWorldLibrary: () => undefined,
          selectSection: () => undefined,
        }}
        desktopAccountControls={<button type="button">Account</button>}
        mobileAccountControls={<button type="button">Account</button>}
      >
        <p>Character field editor</p>
      </BuildWorkspaceView>,
    );

    expect(html).toContain("The Glass March");
    expect(html).toContain("Character fields");
    expect(html).toContain("Character field editor");
    expect(html).toContain('class="active"');
  });

  test("renders the Play shell without route or API state", () => {
    const html = renderToStaticMarkup(
      <PlayWorkspaceView
        worldName="The Glass March"
        roleLabel="player"
        user={{ displayName: "River", username: "river.song" }}
        accountControls={<button type="button">Account</button>}
        onHome={() => undefined}
        onWorldLibrary={() => undefined}
      >
        <p>Live table fixture</p>
      </PlayWorkspaceView>,
    );

    expect(html).toContain("All worlds");
    expect(html).toContain("The Glass March");
    expect(html).toContain("Live table fixture");
  });
});
