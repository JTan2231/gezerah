import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CharacterOnboardingView,
  LiveInteractionView,
  WorldPlayView,
} from "./WorldPlayView";
import { NewProblemView, OpenProblemView } from "./WorldProblemView";
import { RulingView } from "./WorldRulingView";

const noop = () => undefined;

describe("WorldPlayView", () => {
  test("renders the live table entirely from a backend-free fixture", () => {
    const html = renderToStaticMarkup(
      <WorldPlayView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          roleLabel: "Facilitator",
          facilitator: true,
          canCreateProblem: true,
          hasActiveProblem: true,
          roster: {
            loading: false,
            showEmpty: false,
            issue: null,
            entities: [
              {
                id: "entity-1",
                name: "Ash",
                subtitle: "Your character",
                selected: true,
                controlled: true,
                setupRequired: false,
              },
            ],
            readyMembers: [{ id: "member-1", name: "Mara Vale" }],
          },
          problems: { loading: false, issue: null },
          history: [
            {
              id: "problem-1",
              outcome: "resolved",
              occurredLabel: "2m ago",
              title: "The flooded archive",
              prompt: "The lower stacks are filling with seawater.",
              narrative: "Ash seals the breach before the maps are lost.",
              effects: [
                {
                  id: "effect-1",
                  label: "Ash: applied Exhausted",
                },
              ],
              effectiveChanges: [],
            },
          ],
        }}
        actions={{
          createProblem: noop,
          retryRoster: noop,
          retryProblems: noop,
          selectEntity: noop,
        }}
        slots={{
          activeProblem: <article>Accepting actions</article>,
          selectedEntity: <section>Ash’s generated sheet</section>,
          problemDialog: null,
        }}
      />,
    );

    expect(html).toContain("The Glass Coast");
    expect(html).toContain("Your character");
    expect(html).toContain("Accepting actions");
    expect(html).toContain("Ash’s generated sheet");
    expect(html).toContain("Ash: applied Exhausted");
  });

  test("renders onboarding selection and progress from semantic state", () => {
    const html = renderToStaticMarkup(
      <CharacterOnboardingView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          statusLabel: "Setup required",
          loading: false,
          issue: null,
          characters: [
            {
              id: "ash",
              name: "Ash",
              completedFieldCount: 2,
              requiredFieldCount: 3,
              selected: true,
            },
            {
              id: "moss",
              name: "Moss",
              completedFieldCount: 3,
              requiredFieldCount: 3,
              selected: false,
            },
          ],
        }}
        actions={{ retry: noop, selectCharacter: noop }}
        profile={<form aria-label="Character profile">Profile fixture</form>}
      />,
    );

    expect(html).toContain("Your characters");
    expect(html).toContain("2 of 3 complete");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Profile fixture");
  });

  test("renders problem creation and action submission states", () => {
    const problemHtml = renderToStaticMarkup(
      <NewProblemView
        model={{
          draft: {
            title: "Flooded archive",
            description: "",
            selectedEntityIds: [],
            selectedResponderIds: ["member-1"],
          },
          contextEntities: [{ id: "ash", name: "Ash" }],
          showContextChoices: true,
          responders: [{ id: "member-1", name: "Mara Vale" }],
          terraEnabled: true,
          generating: true,
          saving: false,
          issue: {
            kind: "request",
            message: "Describe the problem.",
            fields: { description: "Description is required." },
          },
        }}
        actions={{
          changeTitle: noop,
          changeDescription: noop,
          toggleContextEntity: noop,
          toggleResponder: noop,
          generate: noop,
          submit: noop,
          close: noop,
        }}
      />,
    );
    const actionHtml = renderToStaticMarkup(
      <OpenProblemView
        model={{
          submissions: [],
          facilitator: false,
          eligibleResponder: true,
          actionSubmitted: false,
          controlledEntities: [{ id: "ash", name: "Ash" }],
          actingEntityId: "ash",
          actionText: "Seal the breach",
          saving: true,
          closing: false,
          issue: null,
        }}
        actions={{
          changeActingEntity: noop,
          changeActionText: noop,
          submitAction: noop,
          withdrawAction: noop,
          closeActions: noop,
        }}
      />,
    );

    expect(problemHtml).toContain("Generating…");
    expect(problemHtml).toContain("Description is required.");
    expect(actionHtml).toContain("Submitting…");
    expect(actionHtml).toContain("Seal the breach");
  });

  test("renders live and ruling synchronization states", () => {
    const liveHtml = renderToStaticMarkup(
      <LiveInteractionView
        model={{
          status: "adjudicating",
          statusLabel: "Adjudicating",
          presentedLabel: "just now",
          title: "Flooded archive",
          prompt: "The lower stacks are filling.",
          contextEntityNames: ["Ash"],
          facilitator: true,
          working: true,
          issue: null,
        }}
        content={<p>Ruling fixture</p>}
        onCancel={noop}
      />,
    );
    const rulingHtml = renderToStaticMarkup(
      <RulingView
        model={{
          terraEnabled: false,
          submissions: [],
          narrative: "Ash seals the breach.",
          selectedAction: null,
          preview: null,
          rulesReady: false,
          previewStale: false,
          saving: "compile",
          issue: null,
        }}
        actions={{ changeNarrative: noop, prepare: noop, resolve: noop }}
      />,
    );

    expect(liveHtml).toContain("Adjudicating");
    expect(liveHtml).toContain("Ruling fixture");
    expect(rulingHtml).toContain("Refreshing the current rules");
    expect(rulingHtml).toContain("Interpreting…");
  });
});
