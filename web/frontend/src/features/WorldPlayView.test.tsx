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
            agentFacilitated: false,
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
            {
              id: "problem-2",
              outcome: "cancelled",
              cancellationLabel: "Skipped",
              occurredLabel: "1m ago",
              facilitatorLabel: "Terra Auto DM",
              title: "The silent causeway",
              prompt: "A causeway rises from the fog.",
              effects: [],
              effectiveChanges: [],
            },
            {
              id: "problem-3",
              outcome: "cancelled",
              cancellationLabel: "Cancelled",
              occurredLabel: "just now",
              facilitatorLabel: "Mara Vale",
              title: "The sealed gate",
              prompt: "The gate refuses to open.",
              effects: [],
              effectiveChanges: [],
            },
          ],
          agentMode: null,
        }}
        actions={{
          createProblem: noop,
          changeFacilitator: noop,
          takeOverFacilitation: noop,
          continueWithTerra: noop,
          copyAgentPrompt: noop,
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
    expect(html).toContain("Skipped · Terra Auto DM");
    expect(html).toContain("Cancelled · Mara Vale");
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
          claimableCharacters: [],
          claimIssue: null,
          agentMode: null,
        }}
        actions={{
          retry: noop,
          selectCharacter: noop,
          becomeFacilitator: noop,
          claimCharacter: noop,
          copyAgentPrompt: noop,
        }}
        profile={<form aria-label="Character profile">Profile fixture</form>}
      />,
    );

    expect(html).toContain("Your characters");
    expect(html).toContain("Dungeon Master: Terra Auto DM");
    expect(html).toContain("Take over from Terra");
    expect(html).not.toContain("Skip problem");
    expect(html).toContain("2 of 3 complete");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Profile fixture");
  });

  test("renders ChatGPT launch guidance and atomic character choices", () => {
    const html = renderToStaticMarkup(
      <CharacterOnboardingView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          dungeonMasterName: "ChatGPT",
          statusLabel: "Waiting for a character",
          facilitatorActionLabel: "Take over from ChatGPT",
          canBecomeFacilitator: false,
          changingFacilitator: false,
          facilitatorIssue: null,
          loading: false,
          issue: null,
          characters: [],
          claimableCharacters: [
            {
              id: "ash",
              name: "Ash",
              summary: "A courier who knows the flooded roads.",
            },
          ],
          claimIssue: null,
          agentMode: {
            siteToolsAvailable: true,
            starterPrompt:
              "Use https://game.example/play/world-1 as the game table.",
            launchURL:
              "codex://threads/new?prompt=fixture&browserUrl=https%3A%2F%2Fgame.example%2Fplay%2Fworld-1",
            promptCopied: false,
          },
        }}
        actions={{
          retry: noop,
          selectCharacter: noop,
          becomeFacilitator: noop,
          claimCharacter: noop,
          copyAgentPrompt: noop,
        }}
        profile={null}
      />,
    );

    expect(html).toContain("Dungeon Master: ChatGPT");
    expect(html).toContain("Choose your character");
    expect(html).toContain("A courier who knows the flooded roads.");
    expect(html).toContain("Open in ChatGPT");
    expect(html).toContain("codex://threads/new?");
    expect(html).toContain("https://game.example/play/world-1");
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
          agentFacilitated: false,
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
            agentFacilitated: false,
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
          agentMode: null,
        }}
        actions={{
          createProblem: noop,
          changeFacilitator: noop,
          takeOverFacilitation: noop,
          continueWithTerra: noop,
          copyAgentPrompt: noop,
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
          agentFacilitated: false,
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
          canSkip: false,
          working: true,
          skipping: false,
          issue: null,
        }}
        content={<p>Ruling fixture</p>}
        onCancel={noop}
        onSkip={noop}
      />,
    );
    const terraLiveHtml = renderToStaticMarkup(
      <LiveInteractionView
        model={{
          status: "adjudicating",
          statusLabel: "Terra is deciding",
          presentedLabel: "just now",
          title: "Flooded archive",
          prompt: "The lower stacks are filling.",
          contextEntityNames: ["Ash"],
          facilitator: false,
          canSkip: true,
          working: true,
          skipping: false,
          issue: null,
        }}
        content={<p>Terra pending fixture</p>}
        onCancel={noop}
        onSkip={noop}
      />,
    );
    const spectatorLiveHtml = renderToStaticMarkup(
      <LiveInteractionView
        model={{
          status: "adjudicating",
          statusLabel: "Terra is deciding",
          presentedLabel: "just now",
          title: "Flooded archive",
          prompt: "The lower stacks are filling.",
          contextEntityNames: [],
          facilitator: false,
          canSkip: false,
          working: false,
          skipping: false,
          issue: null,
        }}
        content={<p>Observer fixture</p>}
        onCancel={noop}
        onSkip={noop}
      />,
    );
    const skippingHtml = renderToStaticMarkup(
      <LiveInteractionView
        model={{
          status: "open",
          statusLabel: "Accepting actions",
          presentedLabel: "just now",
          title: "Flooded archive",
          prompt: "The lower stacks are filling.",
          contextEntityNames: [],
          facilitator: false,
          canSkip: true,
          working: false,
          skipping: true,
          issue: null,
        }}
        content={null}
        onCancel={noop}
        onSkip={noop}
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
    expect(liveHtml).toContain("Cancel problem");
    expect(terraLiveHtml).toContain("Skip problem");
    expect(terraLiveHtml).not.toContain("disabled");
    expect(spectatorLiveHtml).not.toContain("Skip problem");
    expect(spectatorLiveHtml).not.toContain("Cancel problem");
    expect(skippingHtml).toContain("Skipping…");
    expect(skippingHtml).toContain("disabled");
    expect(rulingHtml).toContain("Refreshing the current rules");
    expect(rulingHtml).toContain("Interpreting…");
    expect(terraRetryHtml).toContain("Retry Terra");
  });
});
