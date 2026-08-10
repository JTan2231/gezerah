import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CharacterFieldsLoadErrorView,
  CharacterFieldsLoadingView,
  CharacterFieldsView,
} from "./CharacterFieldsView";

type CharacterFieldsViewProps = Parameters<typeof CharacterFieldsView>[0];

const noop = () => undefined;
const actions: CharacterFieldsViewProps["actions"] = {
  updateField: noop,
  moveField: noop,
  removeField: noop,
  addField: noop,
  publish: noop,
};

describe("CharacterFieldsView", () => {
  test("renders loading and retryable load-error fixtures", () => {
    const loadingHtml = renderToStaticMarkup(<CharacterFieldsLoadingView />);
    const errorHtml = renderToStaticMarkup(
      <CharacterFieldsLoadErrorView
        issue={{
          kind: "connection",
          message: "Character fields could not be loaded.",
        }}
        onRetry={noop}
      />,
    );

    expect(loadingHtml).toContain("Opening character fields");
    expect(errorHtml).toContain("Connection lost");
    expect(errorHtml).toContain("Character fields could not be loaded.");
    expect(errorHtml).toContain("Try again");
  });

  test("renders the empty published state", () => {
    const html = renderToStaticMarkup(
      <CharacterFieldsView
        model={{
          schemaLabel: "schema r3",
          fields: [],
          dirty: false,
          valid: true,
          saving: false,
          issue: null,
        }}
        actions={actions}
      />,
    );

    expect(html).toContain("No character fields yet");
    expect(html).toContain("schema r3");
    expect(html).toContain("Published");
  });

  test("renders field validation and a busy publish state", () => {
    const html = renderToStaticMarkup(
      <CharacterFieldsView
        model={{
          schemaLabel: "schema r4",
          fields: [
            {
              clientKey: "field-1",
              label: "Origin",
              helpText: "",
              visibility: "controllers-and-facilitators",
              labelIssue: "Field label is required.",
              helpTextIssue: "Guidance is too long.",
            },
            {
              clientKey: "field-2",
              label: "Bond",
              helpText: "Who would you risk everything for?",
              visibility: "table",
            },
          ],
          dirty: true,
          valid: false,
          saving: true,
          issue: {
            kind: "request",
            message: "Check the highlighted fields.",
          },
        }}
        actions={actions}
      />,
    );

    expect(html).toContain("2 required fields");
    expect(html).toContain("Field label is required.");
    expect(html).toContain("Guidance is too long.");
    expect(html).toContain("Character controllers and facilitators");
    expect(html).toContain("Check the highlighted fields.");
    expect(html).toContain("Publishing…");
    expect(html).toContain("Unpublished changes");
  });
});
