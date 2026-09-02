import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SettingsView,
  type SettingsViewActions,
  type SettingsViewModel,
} from "./SettingsView";

const actions: SettingsViewActions = {
  changeName: () => undefined,
  changeDescription: () => undefined,
  changeProseGuide: () => undefined,
  save: () => undefined,
  archive: () => undefined,
};

const ownerDraft: SettingsViewModel = {
  draft: {
    name: "The Verdant Reach",
    description: "A frontier beneath a restless canopy.",
    proseGuide:
      "Tell the Reach through work, weather, and what neighbors owe one another.",
  },
  dirty: true,
  busy: null,
  issue: null,
  fieldIssues: {},
  access: {
    role: "owner",
    memberCount: 4,
    mechanicCount: 9,
    status: "active",
    facilitator: "Terra",
  },
  canArchive: true,
};

describe("SettingsView", () => {
  test("renders an editable owner fixture without backend state", () => {
    const html = renderToStaticMarkup(
      <SettingsView model={ownerDraft} actions={actions} />,
    );

    expect(html).toContain("The Verdant Reach");
    expect(html).toContain("Terra");
    expect(html).toContain(
      "Describe the World for its members and Facilitator.",
    );
    expect(html).toContain("Prose guide");
    expect(html).toContain(
      "This shapes the writing, not the World’s facts or rules.",
    );
    expect(html).toContain(
      "Tell the Reach through work, weather, and what neighbors owe one another.",
    );
    expect(html).toContain(
      "Hand off Facilitator responsibility from Play between Problems.",
    );
    expect(html).not.toContain("Facilitator source");
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("Archive world");
    expect(html).toContain("<dd>9</dd>");
  });

  test("renders field feedback and a busy save state", () => {
    const html = renderToStaticMarkup(
      <SettingsView
        model={{
          ...ownerDraft,
          busy: "saving",
          issue: {
            kind: "request",
            message: "Check the highlighted fields.",
          },
          fieldIssues: {
            name: "must not be empty",
            proseGuide: "must be at most 10000 characters",
          },
        }}
        actions={actions}
      />,
    );

    expect(html).toContain("must not be empty");
    expect(html).toContain("must be at most 10000 characters");
    expect(html).toContain("Check the highlighted fields.");
    expect(html).toContain("Saving…");
  });
});
