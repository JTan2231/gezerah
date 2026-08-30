import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntityDetailView, EntitySheetView } from "./EntityDetailView";
import {
  EntityProfileEditorView,
  EntityProfileLoadErrorView,
  EntityProfileLoadingView,
  EntityProfileView,
} from "./EntityProfileView";
import {
  ManageControllersModalView,
  NewEntityModalView,
} from "./RosterModalsView";

const noop = () => undefined;

describe("entity presentation views", () => {
  test("renders linked tabs with one selected and focusable control", () => {
    const html = renderToStaticMarkup(
      <EntityDetailView
        tab="profile"
        showControllers
        profilePanel={<p>Entity profile</p>}
        sheetPanel={<p>Generated sheet</p>}
        onSelectTab={noop}
        onManageControllers={noop}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Entity profile");
    expect(html).toContain("Controllers");
  });

  test("renders a generated Entity sheet view model", () => {
    const html = renderToStaticMarkup(
      <EntitySheetView
        displayName="Mara Vey"
        metadata="Entity sheet · current rules"
        statusInstances={[
          {
            id: "status-1",
            name: "Inspired",
            details: "A trusted ally helped",
          },
        ]}
        mechanics={[
          {
            id: "measure",
            kind: "capacity",
            mode: "pool",
            sourceKind: "input",
            name: "Measure",
            maximum: "6",
            effectiveValue: "4 / 6",
            modifiers: [
              {
                id: "modifier-1",
                statusName: "Inspired",
                summary: "add 1 · 3 → 4",
              },
            ],
          },
          {
            id: "vigilant",
            kind: "capability",
            mode: "binary",
            sourceKind: "derived",
            name: "Vigilant",
            effectiveValue: "Yes",
            modifiers: [],
          },
        ]}
        editable
        logicalInputValues={{ measure: "3" }}
        saving={false}
        issue={{ kind: "request", message: "Check the sheet values." }}
        onValueChange={noop}
        onSubmit={noop}
      />,
    );

    expect(html).toContain("Mara Vey");
    expect(html).toContain("Entity sheet · current rules");
    expect(html).toContain("Inspired");
    expect(html).toContain("4 / 6");
    expect(html).toContain("Derived");
    expect(html).toContain("Logical input values");
    expect(html).toContain("Save logical state");
    expect(html).toContain("Check the sheet values.");
  });

  test("renders profile loading, failure, reader, and editor states", () => {
    const loadingHtml = renderToStaticMarkup(<EntityProfileLoadingView />);
    const failureHtml = renderToStaticMarkup(
      <EntityProfileLoadErrorView
        issue={{ kind: "connection", message: "Profile unavailable." }}
        onRetry={noop}
      />,
    );
    const fields = [
      {
        id: "origin",
        label: "Origin",
        helpText: "Where did you begin?",
        visibility: "restricted" as const,
        value: "The northern road",
      },
    ];
    const readerHtml = renderToStaticMarkup(
      <EntityProfileView
        profile={{
          displayName: "Mara Vey",
          summary: "1 of 1 required fields · current profile",
          characterStatus: "ready",
          fields,
        }}
        editor={null}
      />,
    );
    const editorHtml = renderToStaticMarkup(
      <EntityProfileEditorView
        fields={fields}
        values={{ origin: "A revised origin" }}
        saving
        dirty
        issue={{
          kind: "request",
          message: "Review this character.",
          fieldErrors: { origin: "Origin is too long." },
        }}
        onValueChange={noop}
        onSubmit={noop}
      />,
    );

    expect(loadingHtml).toContain("Opening this Entity");
    expect(failureHtml).toContain("Connection lost");
    expect(failureHtml).toContain("Try again");
    expect(readerHtml).toContain("1 of 1 required fields · current profile");
    expect(readerHtml).toContain("Restricted");
    expect(readerHtml).toContain("The northern road");
    expect(editorHtml).toContain("Origin is too long.");
    expect(editorHtml).toContain("Saving…");
  });

  test("renders entity and controller modal fixtures", () => {
    const eligibleControllers = [
      { id: "member-1", displayName: "Jo Rowan" },
      { id: "member-2", displayName: "Tamsin Hale" },
    ];
    const createHtml = renderToStaticMarkup(
      <NewEntityModalView
        name="Mara"
        controllerIds={["member-1"]}
        eligibleControllers={eligibleControllers}
        saving
        issue={{
          kind: "request",
          message: "Review the entity.",
          fields: { displayName: "Use a longer name." },
        }}
        onNameChange={noop}
        onToggleController={noop}
        onClose={noop}
        onSubmit={noop}
      />,
    );
    const manageHtml = renderToStaticMarkup(
      <ManageControllersModalView
        entityName="Mara"
        controllerIds={[]}
        eligibleControllers={[]}
        saving={false}
        issue={null}
        onToggleController={noop}
        onClose={noop}
        onSubmit={noop}
      />,
    );

    expect(createHtml).toContain("Create an entity");
    expect(createHtml).toContain("Use a longer name.");
    expect(createHtml).toContain("Jo Rowan");
    expect(createHtml).toContain("Creating…");
    expect(manageHtml).toContain("Manage Entity controllers");
    expect(manageHtml).toContain(
      "No active owner, editor, or player is available.",
    );
    expect(manageHtml).toContain("Save controllers");
  });
});
