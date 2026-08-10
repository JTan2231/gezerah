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
  changeDMSource: () => undefined,
  save: () => undefined,
  archive: () => undefined,
};

const ownerDraft: SettingsViewModel = {
  draft: {
    name: "The Verdant Reach",
    description: "A frontier beneath a restless canopy.",
    dmSource: "terra",
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
  },
  canArchive: true,
};

describe("SettingsView", () => {
  test("renders an editable owner fixture without backend state", () => {
    const html = renderToStaticMarkup(
      <SettingsView model={ownerDraft} actions={actions} />,
    );

    expect(html).toContain("The Verdant Reach");
    expect(html).toContain("Terra Auto DM");
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
          fieldIssues: { name: "must not be empty" },
        }}
        actions={actions}
      />,
    );

    expect(html).toContain("must not be empty");
    expect(html).toContain("Check the highlighted fields.");
    expect(html).toContain("Saving…");
  });
});
