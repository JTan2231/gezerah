import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CharacterOnboardingView,
  LiveInteractionView,
  WorldPlayView,
} from "./WorldPlayView";
import {
  NewProblemView,
  OpenProblemView,
  TerraDecisionPendingView,
} from "./WorldProblemView";
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
          accessLabel: "Owner",
          facilitator: true,
          canCreateProblem: true,
          hasActiveProblem: true,
          dungeonMaster: {
            name: "Mara Vale",
            source: "human",
            selectedValue: "human:member-1",
            canChange: true,
            canTakeOver: false,
            changing: false,
            choices: [
              { value: "human:member-1", name: "Mara Vale (you)" },
              { value: "terra", name: "Terra Auto DM" },
            ],
            issue: null,
          },
          idle: {
            terraFacilitated: false,
            canContinue: false,
            continuing: false,
            issue: null,
          },
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
              facilitatorLabel: "Mara Vale",
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
          changeFacilitator: noop,
          takeOverFacilitation: noop,
          continueWithTerra: noop,
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
          dungeonMasterName: "Terra Auto DM",
          statusLabel: "Setup required",
          facilitatorActionLabel: "Take over from Terra",
          canBecomeFacilitator: true,
          changingFacilitator: false,
          facilitatorIssue: null,
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
        actions={{
          retry: noop,
          selectCharacter: noop,
          becomeFacilitator: noop,
        }}
        profile={<form aria-label="Character profile">Profile fixture</form>}
      />,
    );

    expect(html).toContain("Your characters");
    expect(html).toContain("Dungeon Master: Terra Auto DM");
    expect(html).toContain("Take over from Terra");
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
          saving: true,
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
          terraFacilitated: false,
          canRequestDecision: false,
          allRespondersReady: false,
          decisionEnabled: true,
          responseProgressLabel: "0 of 1 responders have acted or passed.",
          deciding: false,
          issue: null,
        }}
        actions={{
          changeActingEntity: noop,
          changeActionText: noop,
          submitAction: noop,
          passAction: noop,
          withdrawAction: noop,
          closeActions: noop,
          requestDecision: noop,
        }}
      />,
    );

    expect(problemHtml).toContain("Creating…");
    expect(problemHtml).toContain("Description is required.");
    expect(actionHtml).toContain("Submitting…");
    expect(actionHtml).toContain("Seal the breach");
  });

  test("renders Terra as the assigned DM with player pacing controls", () => {
    const idleHtml = renderToStaticMarkup(
      <WorldPlayView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          roleLabel: "Player",
          accessLabel: "Owner",
          facilitator: false,
          canCreateProblem: false,
          hasActiveProblem: false,
          dungeonMaster: {
            name: "Terra Auto DM",
            source: "terra",
            selectedValue: "terra",
            canChange: false,
            canTakeOver: false,
            changing: false,
            choices: [],
            issue: null,
          },
          idle: {
            terraFacilitated: true,
            canContinue: true,
            continuing: false,
            issue: null,
          },
          roster: {
            loading: false,
            showEmpty: true,
            issue: null,
            entities: [],
            readyMembers: [],
          },
          problems: { loading: false, issue: null },
          history: [],
        }}
        actions={{
          createProblem: noop,
          changeFacilitator: noop,
          takeOverFacilitation: noop,
          continueWithTerra: noop,
          retryRoster: noop,
          retryProblems: noop,
          selectEntity: noop,
        }}
        slots={{
          activeProblem: null,
          selectedEntity: null,
          problemDialog: null,
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
          controlledEntities: [],
          actingEntityId: "",
          actionText: "",
          saving: false,
          closing: false,
          terraFacilitated: true,
          canRequestDecision: true,
          allRespondersReady: true,
          decisionEnabled: true,
          responseProgressLabel: "No player responses are required.",
          deciding: false,
          issue: null,
        }}
        actions={{
          changeActingEntity: noop,
          changeActionText: noop,
          submitAction: noop,
          passAction: noop,
          withdrawAction: noop,
          closeActions: noop,
          requestDecision: noop,
        }}
      />,
    );

    expect(idleHtml).toContain("Dungeon Master: Terra Auto DM");
    expect(idleHtml).toContain("Your role");
    expect(idleHtml).toContain("Ask Terra to continue");
    expect(actionHtml).toContain("Pass");
    expect(actionHtml).toContain("Let Terra decide");
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
    const terraRetryHtml = renderToStaticMarkup(
      <TerraDecisionPendingView
        retrying={false}
        issue={{
          kind: "request",
          message: "Terra could not decide the outcome.",
          fields: {},
        }}
        onRetry={noop}
      />,
    );

    expect(liveHtml).toContain("Adjudicating");
    expect(liveHtml).toContain("Ruling fixture");
    expect(rulingHtml).toContain("Refreshing the current rules");
    expect(rulingHtml).toContain("Interpreting…");
    expect(terraRetryHtml).toContain("Retry Terra");
  });
});
