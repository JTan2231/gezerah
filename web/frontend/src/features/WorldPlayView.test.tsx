import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CharacterOnboardingView,
  LiveInteractionView,
  WorldPlayView,
} from "./WorldPlayView";
import {
  AgentDecisionPendingView,
  NewProblemView,
  OpenProblemView,
  TerraDecisionPendingView,
} from "./WorldProblemView";
import { ConsequenceView } from "./WorldConsequenceView";

const noop = () => undefined;

describe("WorldPlayView", () => {
  test("renders the Play surface entirely from a backend-free fixture", () => {
    const html = renderToStaticMarkup(
      <WorldPlayView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          currentPlayRoleLabel: "Facilitator",
          membershipRoleLabel: "Owner",
          facilitator: true,
          canCreateProblem: true,
          hasActiveProblem: true,
          facilitatorAssignment: {
            name: "Mara Vale",
            source: "human",
            selectedValue: "human:member-1",
            canChange: true,
            canTakeOver: false,
            changing: false,
            choices: [
              { value: "human:member-1", name: "Mara Vale (you)" },
              { value: "terra", name: "Terra" },
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
            playReadyMembers: [{ id: "member-1", name: "Mara Vale" }],
          },
          problems: { loading: false, issue: null },
          history: [
            {
              id: "problem-1",
              resolutionStatus: "resolved",
              occurredLabel: "2m ago",
              facilitatorLabel: "Mara Vale",
              title: "The flooded archive",
              prompt: "The lower stacks are filling with seawater.",
              narrative: "Ash seals the breach before the maps are lost.",
              applications: [
                {
                  id: "effect-1",
                  label: "Ash: applied Exhausted",
                },
              ],
              effectiveChanges: [],
            },
            {
              id: "problem-2",
              resolutionStatus: "cancelled",
              cancellationLabel: "Skipped",
              occurredLabel: "1m ago",
              facilitatorLabel: "Terra",
              title: "The silent causeway",
              prompt: "A causeway rises from the fog.",
              applications: [],
              effectiveChanges: [],
            },
            {
              id: "problem-3",
              resolutionStatus: "cancelled",
              cancellationLabel: "Cancelled",
              occurredLabel: "just now",
              facilitatorLabel: "Mara Vale",
              title: "The sealed gate",
              prompt: "The gate refuses to open.",
              applications: [],
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
    expect(html).toContain("1 play-ready member");
    expect(html).toContain("Ash: applied Exhausted");
    expect(html).toContain("Skipped · Terra");
    expect(html).toContain("Cancelled · Mara Vale");
  });

  test("renders onboarding selection and progress from semantic state", () => {
    const html = renderToStaticMarkup(
      <CharacterOnboardingView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          waitingForCharacter: false,
          facilitatorName: "Terra",
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
          availableEntities: [],
          claimIssue: null,
          agentMode: null,
        }}
        actions={{
          retry: noop,
          selectCharacter: noop,
          becomeFacilitator: noop,
          claimEntity: noop,
        }}
        profile={<form aria-label="Entity profile">Profile fixture</form>}
      />,
    );

    expect(html).toContain("Your characters");
    expect(html).toContain("Facilitator: Terra");
    expect(html).toContain("Take over from Terra");
    expect(html).not.toContain("Skip problem");
    expect(html).toContain("2 of 3 complete");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Profile fixture");
  });

  test("renders agent Play as readiness and reference only", () => {
    const html = renderToStaticMarkup(
      <CharacterOnboardingView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          waitingForCharacter: true,
          facilitatorName: "ChatGPT",
          statusLabel: "Waiting for a character",
          facilitatorActionLabel: "Become Facilitator",
          canBecomeFacilitator: false,
          changingFacilitator: false,
          facilitatorIssue: null,
          loading: false,
          issue: null,
          characters: [],
          availableEntities: [
            {
              id: "ash",
              name: "Ash",
              summary: "A courier who knows the flooded roads.",
            },
          ],
          claimIssue: null,
          agentMode: {
            siteTools: {
              status: "ready",
              registeredToolNames: [
                "inspect_play",
                "claim_entity",
                "present_problem",
                "submit_action",
                "resolve_problem",
              ],
              failedToolNames: [],
            },
          },
        }}
        actions={{
          retry: noop,
          selectCharacter: noop,
          becomeFacilitator: noop,
          claimEntity: noop,
        }}
        profile={null}
      />,
    );

    expect(html).toContain("Facilitator: ChatGPT");
    expect(html).toContain("ChatGPT is choosing");
    expect(html).toContain("Meet the characters");
    expect(html).toContain("A courier who knows the flooded roads.");
    expect(html).toContain("Play site-tool surface is ready");
    expect(html).not.toContain("Play as Ash");
    expect(html).not.toContain("Open in ChatGPT");
    expect(html).not.toContain("Copy starter prompt");
  });

  test("renders Problem creation and Action entry states", () => {
    const problemHtml = renderToStaticMarkup(
      <NewProblemView
        model={{
          draft: {
            title: "Flooded archive",
            description: "",
            selectedContextEntityIDs: [],
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
          actions: [],
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
          allRespondersActed: false,
          decisionEnabled: true,
          actionProgressLabel: "0 of 1 Responders have acted or passed.",
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

  test("renders Terra as the assigned Facilitator with player pacing controls", () => {
    const idleHtml = renderToStaticMarkup(
      <WorldPlayView
        model={{
          worldName: "The Glass Coast",
          currentUserName: "Mara Vale",
          currentPlayRoleLabel: "Player",
          membershipRoleLabel: "Owner",
          facilitator: false,
          canCreateProblem: false,
          hasActiveProblem: false,
          facilitatorAssignment: {
            name: "Terra",
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
            playReadyMembers: [],
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
          actions: [],
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
          allRespondersActed: true,
          decisionEnabled: true,
          actionProgressLabel: "No responder Actions are required.",
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

    expect(idleHtml).toContain("Facilitator: Terra");
    expect(idleHtml).toContain("Your current play role");
    expect(idleHtml).toContain("Membership role");
    expect(idleHtml).toContain("Ask Terra for the next Problem");
    expect(actionHtml).toContain("Pass");
    expect(actionHtml).toContain("Let Terra decide");
  });

  test("renders live and consequence synchronization states", () => {
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
        content={<p>Consequence fixture</p>}
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
    const consequenceHtml = renderToStaticMarkup(
      <ConsequenceView
        model={{
          actions: [],
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
          message: "Terra could not resolve the problem.",
          fields: {},
        }}
        onRetry={noop}
      />,
    );
    const agentPendingHtml = renderToStaticMarkup(<AgentDecisionPendingView />);

    expect(liveHtml).toContain("Adjudicating");
    expect(liveHtml).toContain("Consequence fixture");
    expect(liveHtml).toContain("Cancel problem");
    expect(terraLiveHtml).toContain("Skip problem");
    expect(terraLiveHtml).not.toContain("disabled");
    expect(spectatorLiveHtml).not.toContain("Skip problem");
    expect(spectatorLiveHtml).not.toContain("Cancel problem");
    expect(skippingHtml).toContain("Skipping…");
    expect(skippingHtml).toContain("disabled");
    expect(consequenceHtml).toContain("Refreshing the current rules");
    expect(consequenceHtml).toContain("Interpreting…");
    expect(terraRetryHtml).toContain("Retry Terra");
    expect(agentPendingHtml).toContain("reinspect the current durable Play");
    expect(agentPendingHtml).not.toContain("ask it to");
    expect(agentPendingHtml).not.toContain("skip");
    expect(agentPendingHtml).not.toContain("inspect_play");
  });
});
