import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorldTemplateLibraryView,
  type WorldTemplateLibraryViewModel,
} from "./WorldTemplateLibraryView";

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
  siteTools: {
    status: "ready",
    registeredToolNames: ["inspect_world_templates", "copy_world_template"],
    failedToolNames: [],
  },
};

describe("WorldTemplateLibraryView", () => {
  test("renders exactly three reference choices and a ready Start surface", () => {
    const html = renderToStaticMarkup(
      <WorldTemplateLibraryView model={readyModel} accountControls={null} />,
    );

    expect(html).toContain("Starting with ChatGPT");
    expect(html).toContain("Start site-tool surface is ready");
    expect(html).toContain("Banners at Eldermead");
    expect(html).toContain("The Courtesy Season");
    expect(html).toContain("Terms of the City");
    expect(html).not.toContain("Recommended");
    expect(html).not.toContain("Copy and play");
    expect(html).not.toContain("<button");
  });

  test("reports incomplete registration without offering manual recovery", () => {
    const failed = renderToStaticMarkup(
      <WorldTemplateLibraryView
        model={{
          ...readyModel,
          siteTools: {
            status: "failed",
            registeredToolNames: ["inspect_world_templates"],
            failedToolNames: ["copy_world_template"],
          },
        }}
        accountControls={null}
      />,
    );

    expect(failed).toContain(
      "Start site-tool surface failed: 1 of 2 registrations succeeded before teardown; complete surface not ready.",
    );
    expect(failed).toContain("Delegated start is unavailable");
    expect(failed).not.toContain("Try again");
  });
});
