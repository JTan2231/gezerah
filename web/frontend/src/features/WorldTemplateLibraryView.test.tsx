import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorldTemplateLibraryView,
  type WorldTemplateLibraryViewModel,
} from "./WorldTemplateLibraryView";

const noop = () => undefined;
const actions = {
  returnHome: noop,
  returnToWorlds: noop,
  retryCatalog: noop,
  copyTemplate: noop,
};
const readyModel: WorldTemplateLibraryViewModel = {
  account: { displayName: "Rowan Vale", username: "rowan" },
  templates: [
    {
      id: "eldermead",
      name: "Banners at Eldermead",
      description: "War is closing around a village outside a trade city.",
      setting: "Medieval fantasy",
      characterCount: 5,
    },
    {
      id: "courtesy-season",
      name: "The Courtesy Season",
      description: "Perfect comfort is beginning to expose its costs.",
      setting: "Cyberpunk future",
      characterCount: 5,
    },
    {
      id: "terms-of-the-city",
      name: "Terms of the City",
      description: "Unrelated words across New York begin to rhyme.",
      setting: "New York today",
      characterCount: 5,
    },
  ],
  loading: false,
  catalogIssue: null,
  cloneIssue: null,
};

describe("WorldTemplateLibraryView", () => {
  test("renders exactly three equal choices without ranking one", () => {
    const html = renderToStaticMarkup(
      <WorldTemplateLibraryView
        model={readyModel}
        actions={actions}
        accountControls={null}
      />,
    );

    expect(html).toContain("Choose a new world");
    expect(html.match(/Copy and play/g)).toHaveLength(3);
    expect(html).toContain("Banners at Eldermead");
    expect(html).toContain("The Courtesy Season");
    expect(html).toContain("Terms of the City");
    expect(html).not.toContain("Recommended");
  });

  test("makes the selected copy busy and keeps retry context visible", () => {
    const copying = renderToStaticMarkup(
      <WorldTemplateLibraryView
        model={{ ...readyModel, copyingTemplateID: "eldermead" }}
        actions={actions}
        accountControls={null}
      />,
    );
    expect(copying).toContain("Creating your copy…");
    expect(copying).toContain('aria-busy="true"');

    const failed = renderToStaticMarkup(
      <WorldTemplateLibraryView
        model={{
          ...readyModel,
          failedTemplateID: "eldermead",
          cloneIssue: { kind: "connection", message: "Could not confirm." },
        }}
        actions={actions}
        accountControls={null}
      />,
    );
    expect(failed).toContain("Could not confirm.");
    expect(failed).toContain("Try again");
  });
});
