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
    expect(html).toContain("Members &amp; invites");
    expect(html).toContain("Character field editor");
    expect(html).toContain('class="active"');
  });

  test("renders the Play shell without route or API state", () => {
    const html = renderToStaticMarkup(
      <PlayWorkspaceView
        worldName="The Glass March"
        agentMode={false}
        currentPlayRoleLabel="player"
        user={{ displayName: "River", username: "river.song" }}
        accountControls={<button type="button">Account</button>}
        onHome={() => undefined}
        onWorldLibrary={() => undefined}
      >
        <p>Play surface fixture</p>
      </PlayWorkspaceView>,
    );

    expect(html).toContain("All worlds");
    expect(html).toContain("The Glass March");
    expect(html).toContain("Play surface fixture");
  });

  test("renders an agent-facilitated Play shell without site navigation", () => {
    const html = renderToStaticMarkup(
      <PlayWorkspaceView
        worldName="The Glass March"
        agentMode
        currentPlayRoleLabel="player"
        user={{ displayName: "River", username: "river.song" }}
        accountControls={<button type="button">Account</button>}
        onHome={() => undefined}
        onWorldLibrary={() => undefined}
      >
        <p>Delegated Play reference</p>
      </PlayWorkspaceView>,
    );

    expect(html).toContain("Attached World");
    expect(html).not.toContain("All worlds");
    expect(html).not.toContain("Return home");
    expect(html).toContain("Delegated Play reference");
  });
});
