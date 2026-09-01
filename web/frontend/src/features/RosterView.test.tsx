import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RosterView } from "./RosterView";

const noop = () => undefined;

describe("RosterView", () => {
  test("renders a backend-free roster fixture and selected detail", () => {
    const html = renderToStaticMarkup(
      <RosterView
        preparing={false}
        active
        loading={false}
        issue={null}
        entities={[
          {
            id: "entity-1",
            displayName: "Mara Vey",
            subtitle: "Ready · You",
          },
          {
            id: "entity-2",
            displayName: "The Lantern",
            subtitle: "Uncontrolled entity",
          },
        ]}
        selectedEntityId="entity-1"
        detail={<div>Mara's generated sheet</div>}
        overlays={null}
        onCreateEntity={noop}
        onRetry={noop}
        onSelectEntity={noop}
      />,
    );

    expect(html).toContain("Roster &amp; sheets");
    expect(html).toContain("Mara Vey");
    expect(html).toContain("Ready · You");
    expect(html).toContain("Mara&#x27;s generated sheet");
    expect(html).not.toContain("Loading roster");
  });
});
