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
        tab="story"
        showControllers
        characterPanel={<p>Character story</p>}
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
    expect(html).toContain("Character story");
    expect(html).toContain("Controllers");
  });

  test("renders a generated sheet from display-ready state", () => {
    const html = renderToStaticMarkup(
      <EntitySheetView
        displayName="Mara Vey"
        metadata="Entity sheet · current rules"
        statuses={[
          {
            id: "status-1",
            name: "Inspired",
            details: "A trusted ally helped",
          },
        ]}
        mechanics={[
          {
            id: "grit",
            kind: "capacity",
            mode: "pool",
            sourceKind: "input",
            name: "Grit",
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
        values={{ grit: "3" }}
        saving
        issue={{ kind: "request", message: "Check the sheet values." }}
        onValueChange={noop}
        onSubmit={noop}
      />,
    );

    expect(html).toContain("Mara Vey");
    expect(html).toContain("Entity sheet · current rules");
    expect(html).toContain("Inspired");
    expect(html).toContain("4 / 6");
    expect(html).toContain("Calculated");
    expect(html).toContain("Check the sheet values.");
    expect(html).toContain("Saving…");
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
        visibility: "controllers-and-facilitators" as const,
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

    expect(loadingHtml).toContain("Opening this character");
    expect(failureHtml).toContain("Connection lost");
    expect(failureHtml).toContain("Try again");
    expect(readerHtml).toContain("1 of 1 required fields · current profile");
    expect(readerHtml).toContain("Private");
    expect(readerHtml).toContain("The northern road");
    expect(editorHtml).toContain("Origin is too long.");
    expect(editorHtml).toContain("Saving…");
  });

  test("renders entity and controller modal fixtures", () => {
    const players = [
      { id: "member-1", displayName: "Jo Rowan" },
      { id: "member-2", displayName: "Tamsin Hale" },
    ];
    const createHtml = renderToStaticMarkup(
      <NewEntityModalView
        name="Mara"
        controllerIds={["member-1"]}
        players={players}
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
        players={[]}
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
    expect(manageHtml).toContain("Manage character control");
    expect(manageHtml).toContain("Invite a player before assigning control.");
    expect(manageHtml).toContain("Save controllers");
  });
});
