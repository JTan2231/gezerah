import { useEffect, useState } from "react";

import { api, jsonBody, worldPath } from "../api/client";
import type {
  AvailableEntities,
  EntityClaimResult,
  EntityProfile,
  EntitySheet,
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  MechanicValue,
  World,
  WorldEntity,
  WorldMechanic,
  WorldMechanicCollection,
  WorldMember,
} from "../api/types";
import {
  completeSiteToolRegistration,
  registerSiteTools,
  siteToolsSupported,
  SiteToolUsageError,
  type SiteToolRegistrationState,
} from "./siteTools";
import {
  isPlayHandbookTopic,
  playHandbookTopics,
  readPlayHandbook,
} from "./agentPlayHandbook";

interface AgentPlayToolsOptions {
  enabled: boolean;
  worldId: string;
  onChanged: () => void;
}

export function playSiteToolPageEligible(
  world: Pick<World, "status" | "facilitator" | "current_play_role">,
): boolean {
  return (
    world.status === "active" &&
    world.facilitator.source === "agent" &&
    world.current_play_role === "player"
  );
}

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const characterAttunedNarrationGuidance =
  "When establishing or materially changing a location, include a small handful of concrete environmental details. Filter some through what the current player's Character would naturally notice or care about based on the visible profile, effective Mechanics, active Statuses, equipment, and demonstrated temperament. Details need not be clues. Describe attention rather than private thoughts; do not let an NPC or another Character know unexpressed thoughts, invent a Perception check, reveal hidden information, or make suggested Actions exhaustive.";

const proseGuideNarrationGuidance =
  "Follow the prose guide in the latest Play inspection throughout the public passage. It may shape word choice, rhythm, narrative distance, imagery, and the difference between the narrator's voice and language spoken or displayed inside the World. It cannot change established facts, Mechanics, privacy, authority, or the player's Action. Never quote it or mention it as instructions.";

const compactProblemNarrationGuidance =
  "Keep the Problem compact. A first Problem may use up to about 180 words and 5 to 7 short prose beats when the opening needs them. After a resolved Problem, use only enough words to establish the new pressure and decision point so the preceding Consequence and this Problem form a combined public passage of about 100 to 140 words. Use fewer words when the scene is already clear; a beat is a narrative movement, not a required line break. Introduce one immediate pressure and end with one direct question that leaves every eligible responder free to act or with a clear cliffhanger. If examples help, offer at most three compact, non-exhaustive possibilities in one sentence. Do not inventory unchanged context.";

const compactConsequenceNarrationGuidance =
  "Keep the Consequence compact enough that it and the following Problem form a combined public passage of about 100 to 140 words total, not 100 to 140 words for each saved part. Let each saved part use only the share it needs. Lead with the Action's immediate outcome, include only causal details that matter now, and use at most one concise sentence for changed state when stating it directly is clearest. Do not both dramatize and restate the same change.";

const gameplayReadoutGuidance =
  "Immediately before the first Problem after Character claim, and exactly once after each successfully committed Consequence and refreshed Play inspection, call read_gameplay_readout. If it returns non-empty text, copy that text verbatim as the first content in the public response; it already includes the separating divider. Never edit, reformat, summarize, reconstruct, or add to the readout. If it returns an empty string, add no readout or divider. The readout is not part of the saved Problem or Consequence and does not count toward the prose word or beat target.";

const mechanicValueSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "number" },
        value: {
          type: "string",
          description: "An exact decimal written as a string.",
        },
      },
      required: ["kind", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "boolean" },
        value: { type: "boolean" },
      },
      required: ["kind", "value"],
      additionalProperties: false,
    },
  ],
} as const;

const targetEntityIDsSchema = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  uniqueItems: true,
} as const;

const statusLifecycleEffectTargetsSchema = {
  type: "array",
  items: {
    type: "object",
    properties: { entity_id: { type: "string" } },
    required: ["entity_id"],
    additionalProperties: false,
  },
  minItems: 1,
} as const;

const effectSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "set" },
        entity_ids: targetEntityIDsSchema,
        mechanic_id: { type: "string" },
        value: mechanicValueSchema,
      },
      required: ["type", "entity_ids", "mechanic_id", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "adjust-number" },
        entity_ids: targetEntityIDsSchema,
        mechanic_id: { type: "string" },
        amount: {
          type: "string",
          description: "An exact decimal adjustment written as a string.",
        },
      },
      required: ["type", "entity_ids", "mechanic_id", "amount"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "apply-status" },
        targets: statusLifecycleEffectTargetsSchema,
        status: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            modifiers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  mechanic_id: { type: "string" },
                  operation: {
                    enum: ["set", "add-number", "multiply-number"],
                  },
                  value: mechanicValueSchema,
                  priority: { type: "integer" },
                },
                required: ["mechanic_id", "operation", "value", "priority"],
                additionalProperties: false,
              },
            },
          },
          required: ["name", "modifiers"],
          additionalProperties: false,
        },
      },
      required: ["type", "targets", "status"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "remove-status" },
        targets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              entity_id: { type: "string" },
              status_instance_id: { type: "string" },
            },
            required: ["entity_id", "status_instance_id"],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ["type", "targets"],
      additionalProperties: false,
    },
  ],
} as const;

export function useAgentPlayTools({
  enabled,
  worldId,
  onChanged,
}: AgentPlayToolsOptions): SiteToolRegistrationState {
  const supported = siteToolsSupported();
  const [registration, setRegistration] = useState<SiteToolRegistrationState>(
    supported && enabled
      ? {
          status: "registering",
          registeredToolNames: [],
          failedToolNames: [],
        }
      : supported
        ? {
            status: "unavailable",
            registeredToolNames: [],
            failedToolNames: [],
          }
        : {
            status: "unsupported",
            registeredToolNames: [],
            failedToolNames: [],
          },
  );
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") {
      setRegistration({
        status: "unsupported",
        registeredToolNames: [],
        failedToolNames: [],
      });
      return undefined;
    }
    if (!enabled) {
      setRegistration({
        status: "unavailable",
        registeredToolNames: [],
        failedToolNames: [],
      });
      return undefined;
    }

    const controller = new AbortController();
    const tools = createAgentPlayTools(worldId, onChanged, controller.signal);
    setRegistration({
      status: "registering",
      registeredToolNames: [],
      failedToolNames: [],
    });
    void registerSiteTools(
      modelContext,
      tools,
      controller.signal,
      "Reinspect the current Play state and retry with current World and Entity-sheet data. Do not ask the participant to operate Wrought.",
    ).then((result) => {
      const completed = completeSiteToolRegistration(
        controller,
        result,
        tools.length,
      );
      if (completed !== null) setRegistration(completed);
    });

    return () => {
      controller.abort();
    };
  }, [enabled, onChanged, worldId]);
  return registration;
}

export function createAgentPlayTools(
  worldId: string,
  onChanged: () => void,
  signal: AbortSignal,
): ModelContextTool[] {
  const resolutionKeys = new Map<string, string>();

  return [
    {
      name: "read_play_handbook",
      description:
        "Read the Wrought Play handbook before facilitating, or revisit one topic whenever you are unsure what should happen next. Follow it when presenting scenes or recovering from failures; reading it does not change Play.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: playHandbookTopics,
            description:
              "Use all before the first turn, or select the most relevant topic later.",
          },
        },
        required: ["topic"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const topic = requiredString(input, "topic", 100);
        if (!isPlayHandbookTopic(topic))
          throw new SiteToolUsageError(
            `topic must be one of: ${playHandbookTopics.join(", ")}.`,
          );
        return Promise.resolve(
          toolResult({
            handbook: readPlayHandbook(topic),
            next_step:
              topic === "all"
                ? "Inspect current Play and facilitate it using this handbook."
                : "Return to current Play and apply this guidance without narrating the workflow.",
          }),
        );
      },
    },
    {
      name: "inspect_play",
      description:
        "Read the current World and all Play context visible to the signed-in current player: Play status, prose guide, available Entities, World roster, visible profile prose, Entity sheets, active Problem, Actions, and recent history. Do this before any Play change and whenever the state may have changed. The prose guide shapes how public Problems and Consequences are written, not what is true. Profile prose and sheets are cues for what a Character notices; they never give NPCs or other Characters access to unexpressed private thoughts.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        requireObject(input);
        const world = await api<World>(worldPath(worldId), {
          signal: requestSignal,
        });
        const [members, entities] = await Promise.all([
          api<WorldMember[]>(worldPath(worldId, "members"), {
            signal: requestSignal,
          }),
          api<WorldEntity[]>(worldPath(worldId, "entities"), {
            signal: requestSignal,
          }),
        ]);
        const viewer = members.find(
          (membership) => membership.id === world.membership_id,
        );
        const playReady =
          world.status === "archived" ||
          world.current_play_role !== "player" ||
          world.play_status === "ready";

        if (!playReady) {
          if (world.play_status === "waiting-for-character") {
            const available = await api<AvailableEntities>(
              worldPath(worldId, "available-entities"),
              { signal: requestSignal },
            );
            return toolResult({
              world: worldSummary(world),
              viewer: viewerSummary(viewer, world),
              available_entities: available.entities,
              roster_revision: available.roster_revision,
              next_step:
                "Use the player's single stated play preference to choose and claim the best-fitting available Character. Do not ask another setup question or ask the participant to operate Wrought.",
            });
          }
          const controlledEntities = entities.filter((entity) =>
            (viewer?.controlled_entity_ids ?? []).includes(entity.id),
          );
          const controlledProfiles = await Promise.all(
            controlledEntities.map((entity) =>
              api<EntityProfile>(
                worldPath(worldId, `entities/${entity.id}/profile`),
                { signal: requestSignal },
              ),
            ),
          );
          return toolResult({
            ok: false,
            error: {
              code: "character_setup_required",
              message:
                "The claimed Character is incomplete, so delegated Play cannot continue.",
            },
            world: worldSummary(world),
            viewer: viewerSummary(viewer, world),
            claimed_characters: controlledEntities.map((entity) => {
              const profile = controlledProfiles.find(
                (candidate) => candidate.entity_id === entity.id,
              );
              return {
                id: entity.id,
                name: entity.display_name,
                completed_field_count: entity.completed_field_count,
                required_field_count: entity.required_field_count,
                missing_field_ids: profile?.missing_field_ids ?? [],
              };
            }),
            next_step:
              "Explain that delegated Play is unavailable for this Character. Do not ask the participant to operate Wrought.",
          });
        }

        const [mechanics, interactions, profiles] = await Promise.all([
          api<WorldMechanicCollection>(worldPath(worldId, "mechanics"), {
            signal: requestSignal,
          }),
          api<Interaction[]>(worldPath(worldId, "interactions"), {
            signal: requestSignal,
          }),
          Promise.all(
            entities
              .filter((entity) => !entity.archived)
              .map((entity) =>
                api<EntityProfile>(
                  worldPath(worldId, `entities/${entity.id}/profile`),
                  { signal: requestSignal },
                ),
              ),
          ),
        ]);
        const profilesByEntity = new Map(
          profiles.map((profile) => [profile.entity_id, profile]),
        );
        const activeInteraction = interactions.find(isUnfinishedInteraction);
        const recentHistory = interactions
          .filter(
            (interaction) =>
              interaction.status === "resolved" ||
              interaction.status === "cancelled",
          )
          .slice(0, 3);
        const activeMechanics = mechanics.mechanics.filter(
          (mechanic) => !mechanic.archived,
        );
        const activeEntities = entities.filter((entity) => !entity.archived);

        return toolResult({
          world: worldSummary(world),
          viewer: viewerSummary(viewer, world),
          members: members
            .filter((membership) => membership.status === "active")
            .map((membership) => ({
              id: membership.id,
              name: membership.display_name,
              current_play_role: membership.current_play_role,
              play_status: membership.play_status,
              controlled_entity_ids: membership.controlled_entity_ids,
            })),
          rules_revision: mechanics.revision,
          mechanics: activeMechanics,
          entities: activeEntities.map((entity) => ({
            id: entity.id,
            name: entity.display_name,
            character_status: entity.character_status,
            profile: profilesByEntity.get(entity.id)?.fields ?? [],
            sheet: entity.sheet,
          })),
          active_interaction: activeInteraction,
          recent_history: recentHistory,
          next_step: nextPlayStep(
            world,
            viewer,
            activeInteraction,
            recentHistory[0],
          ),
        });
      },
    },
    {
      name: "read_gameplay_readout",
      description:
        "Return the exact display-ready Markdown readout for the signed-in current player's controlled Characters. Call this no-input read-only tool only at two times: immediately before presenting the first Problem after Character claim, and exactly once after each successfully committed Consequence and refreshed Play inspection before presenting that Consequence with the next Problem. The first result contains the complete current readout. Later results contain only effective-value and Status changes from the newest finalized Interaction. The raw string already includes its final --- divider. Copy every non-empty result verbatim as the first content of that public response, then add the unchanged saved narrative below it. Never edit, reformat, summarize, reconstruct, or add to the returned text. An empty string means no controlled-Character state changed: output no readout and no divider.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        requireObject(input);
        const world = await api<World>(worldPath(worldId), {
          signal: requestSignal,
        });
        if (
          world.status !== "active" ||
          world.facilitator.source !== "agent" ||
          world.current_play_role !== "player" ||
          world.play_status !== "ready"
        )
          throw new SiteToolUsageError(
            "The gameplay readout is available only for ready current-player Play.",
          );
        const [members, entities, mechanics, interactions] = await Promise.all([
          api<WorldMember[]>(worldPath(worldId, "members"), {
            signal: requestSignal,
          }),
          api<WorldEntity[]>(worldPath(worldId, "entities"), {
            signal: requestSignal,
          }),
          api<WorldMechanicCollection>(worldPath(worldId, "mechanics"), {
            signal: requestSignal,
          }),
          api<Interaction[]>(worldPath(worldId, "interactions"), {
            signal: requestSignal,
          }),
        ]);
        const viewer = members.find(
          (membership) => membership.id === world.membership_id,
        );
        if (viewer === undefined)
          throw new SiteToolUsageError(
            "The current player membership is unavailable.",
          );
        const activeEntities = entities.filter((entity) => !entity.archived);
        const controlledEntityIDs = new Set(viewer.controlled_entity_ids);
        if (
          !activeEntities.some((entity) => controlledEntityIDs.has(entity.id))
        )
          throw new SiteToolUsageError(
            "The current player has no active controlled Character.",
          );
        const latestFinalizedInteraction = interactions.find(
          (interaction) =>
            interaction.status === "resolved" ||
            interaction.status === "cancelled",
        );
        if (
          latestFinalizedInteraction?.status === "resolved" &&
          latestFinalizedInteraction.resolution === undefined
        )
          throw new SiteToolUsageError(
            "The latest committed Resolution is unavailable.",
          );
        return buildGameplayReadout(
          activeEntities,
          viewer.controlled_entity_ids,
          mechanics.mechanics,
          latestFinalizedInteraction,
        );
      },
    },
    {
      name: "claim_entity",
      description:
        "Claim one currently available Entity for the signed-in current player. Use the player's single stated play preference to choose the best-fitting entity_id from the current Play inspection without asking another setup question. Claiming it makes the Entity the current player's Character and advances the World roster.",
      inputSchema: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            description: "The available Entity ID.",
          },
        },
        required: ["entity_id"],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        const entityID = requiredString(input, "entity_id", 200);
        const available = await api<AvailableEntities>(
          worldPath(worldId, "available-entities"),
          { signal: requestSignal },
        );
        const entity = available.entities.find(
          (candidate) => candidate.id === entityID,
        );
        if (entity === undefined)
          throw new SiteToolUsageError(
            "That entity is no longer available to claim.",
          );
        const result = await api<EntityClaimResult>(
          worldPath(worldId, `entities/${entityID}/claim`),
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({
              expected_roster_revision: available.roster_revision,
            }),
          },
        );
        onChanged();
        if (result.play_status !== "ready")
          return toolResult({
            ok: false,
            error: {
              code: "character_setup_required",
              message:
                "The claimed Character is incomplete, so delegated Play cannot continue.",
            },
            claimed_character: entity,
            play_status: result.play_status,
            roster_revision: result.roster_revision,
            next_step:
              "Explain that delegated Play is unavailable for this Character. Do not ask the participant to operate Wrought.",
          });
        return toolResult({
          claimed_character: entity,
          play_status: result.play_status,
          roster_revision: result.roster_revision,
          next_step:
            "Refresh your view of Play, then call read_gameplay_readout exactly once immediately before presenting the first Problem. Copy its complete raw result verbatim before the unchanged Problem narrative without asking another setup question.",
        });
      },
    },
    {
      name: "present_problem",
      description: `As ChatGPT Facilitator, write and save the next fictional Problem for ready World memberships. First inspect the current Play state, and use this only while the World has no unfinished Problem. The public prompt is the same narrative text you present in chat as the scene, unchanged after any separate gameplay readout. ${gameplayReadoutGuidance} Present the prompt without describing the save or adding another summary. ${proseGuideNarrationGuidance} ${characterAttunedNarrationGuidance} ${compactProblemNarrationGuidance}`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 200 },
          prompt: {
            type: "string",
            maxLength: 10000,
            description:
              "The compact public prose to present as a concrete Problem that invites the current player to act. Follow the cadence, prose-guide, character-attuned narration, and privacy guidance in this tool's description.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        const prompt = requiredString(input, "prompt", 10000);
        const title = optionalString(input, "title", 200);
        const interaction = await api<Interaction>(
          worldPath(worldId, "agent/continue"),
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({ prompt, ...(title === undefined ? {} : { title }) }),
          },
        );
        onChanged();
        return toolResult({
          presented_interaction: interaction,
          next_step:
            "If read_gameplay_readout returned non-empty text for this response, copy that text verbatim first; otherwise add nothing before the narrative. Then present presented_interaction.prompt unchanged as the scene, without saying it was saved or adding another summary, and invite the current player to describe what their Character does.",
        });
      },
    },
    {
      name: "submit_action",
      description:
        "Record the signed-in current player's Action for the current open ChatGPT-authored Problem only after the player explicitly states or delegates that Action. Never infer or invent an Action from their setup preference. Use acting_entity_id only when the Action is attributed to one of their ready controlled Entities shown by the current Play inspection. Do not announce submission or workflow status in the fiction; let the subsequent world response make the decision apparent.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 10000 },
          acting_entity_id: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        const text = requiredString(input, "text", 10000);
        const actingEntityID = optionalString(input, "acting_entity_id", 200);
        const interactions = await api<Interaction[]>(
          worldPath(worldId, "interactions"),
          { signal: requestSignal },
        );
        const interaction = interactions.find(
          (candidate) =>
            candidate.status === "open" &&
            candidate.facilitator_source === "agent",
        );
        if (interaction === undefined)
          throw new SiteToolUsageError(
            "There is no open ChatGPT-authored problem.",
          );
        const action = await api<InteractionAction>(
          worldPath(worldId, `interactions/${interaction.id}/actions`),
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({
              text,
              ...(actingEntityID === undefined
                ? {}
                : { acting_entity_id: actingEntityID }),
              expected_revision: interaction.revision,
            }),
          },
        );
        onChanged();
        return toolResult({
          submitted_action: action,
          next_step:
            "Refresh your view of Play. Once every responder has acted, resolve the Problem. Do not announce Action submission or workflow status; continue with what happens next. Never submit another Action until the player explicitly states or delegates it.",
        });
      },
    },
    {
      name: "resolve_problem",
      description: `As ChatGPT Facilitator, write and save the current open or adjudicating Problem's public Consequence and optional mechanical Effects. First inspect the current Play state and account for every submitted Action. The public narrative is the same narrative text you present in chat, unchanged after any separate gameplay readout. ${gameplayReadoutGuidance} Present the narrative without an approval recap, list of Effects, report about the operation, or invented story bridge. Show decisions and changed state through what happens. An empty effects array is valid. ${proseGuideNarrationGuidance} ${characterAttunedNarrationGuidance} ${compactConsequenceNarrationGuidance}`,
      inputSchema: {
        type: "object",
        properties: {
          selected_action_id: { type: "string" },
          action_summary: { type: "string", maxLength: 10000 },
          narrative: {
            type: "string",
            maxLength: 20000,
            description:
              "The compact public fictional Consequence of the Actions to present in chat. Follow the cadence, prose-guide, character-attuned narration, and privacy guidance in this tool's description.",
          },
          effects: {
            type: "array",
            items: effectSchema,
            description:
              "Ordered mechanical Effects. Use current IDs and copy value formats from the current Play inspection.",
          },
        },
        required: ["narrative", "effects"],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        const values = requireObject(input);
        const narrative = requiredString(values, "narrative", 20000);
        const selectedActionID = optionalString(
          values,
          "selected_action_id",
          200,
        );
        const actionSummary = optionalString(values, "action_summary", 10000);
        if (!Array.isArray(values["effects"]))
          throw new SiteToolUsageError("effects must be an array.");
        const effects: unknown[] = values["effects"];
        const [interactions, mechanics] = await Promise.all([
          api<Interaction[]>(worldPath(worldId, "interactions"), {
            signal: requestSignal,
          }),
          api<WorldMechanicCollection>(worldPath(worldId, "mechanics"), {
            signal: requestSignal,
          }),
        ]);
        const interaction = interactions.find(
          (candidate) =>
            (candidate.status === "open" ||
              candidate.status === "adjudicating") &&
            candidate.facilitator_source === "agent",
        );
        if (interaction === undefined)
          throw new SiteToolUsageError(
            "There is no pending ChatGPT-authored problem to resolve.",
          );
        let idempotencyKey = resolutionKeys.get(interaction.id);
        if (idempotencyKey === undefined) {
          idempotencyKey = crypto.randomUUID();
          resolutionKeys.set(interaction.id, idempotencyKey);
        }
        const result = await api<InteractionResolutionResult>(
          worldPath(worldId, `interactions/${interaction.id}/agent/resolve`),
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({
              expected_revision: interaction.revision,
              expected_rules_revision: mechanics.revision,
              idempotency_key: idempotencyKey,
              ...(selectedActionID === undefined
                ? {}
                : { selected_action_id: selectedActionID }),
              ...(actionSummary === undefined
                ? {}
                : { action_summary: actionSummary }),
              narrative,
              effects,
            }),
          },
        );
        onChanged();
        return toolResult({
          resolution: result,
          next_step:
            "Read Play again, then call read_gameplay_readout exactly once so it returns only this committed Consequence's controlled-Character changes, and save the next compact Problem. If the readout is non-empty, copy it verbatim as the first content of the combined response; if it is empty, add nothing. Then present resolution.narrative unchanged as the Consequence and let the next saved prompt flow from it as one continuous scene. Do not add an approval recap, list of Effects, or report about the operation. Keep the narrative portion of the combined ordinary single-player passage about 100 to 140 words across 5 to 7 short prose beats.",
        });
      },
    },
  ];
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new SiteToolUsageError("Tool input must be an object.");
  return value as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  key: string,
  maximumLength: number,
): string {
  const object = requireObject(value);
  const candidate = object[key];
  if (typeof candidate !== "string" || candidate.trim() === "")
    throw new SiteToolUsageError(`${key} is required.`);
  const result = candidate.trim();
  if ([...result].length > maximumLength)
    throw new SiteToolUsageError(
      `${key} must be at most ${maximumLength} characters.`,
    );
  return result;
}

function optionalString(
  value: unknown,
  key: string,
  maximumLength: number,
): string | undefined {
  const object = requireObject(value);
  const candidate = object[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string")
    throw new SiteToolUsageError(`${key} must be a string.`);
  const result = candidate.trim();
  if (result === "") return undefined;
  if ([...result].length > maximumLength)
    throw new SiteToolUsageError(
      `${key} must be at most ${maximumLength} characters.`,
    );
  return result;
}

function toolResult<T>(value: T): T {
  return value;
}

function toolSignal(
  registrationSignal: AbortSignal,
  invocationSignal: AbortSignal | undefined,
): AbortSignal {
  return invocationSignal === undefined
    ? registrationSignal
    : AbortSignal.any([registrationSignal, invocationSignal]);
}

function worldSummary(world: World) {
  return {
    id: world.id,
    name: world.name,
    description: world.description,
    prose_guide: world.prose_guide,
    status: world.status,
    facilitator_source: world.facilitator.source,
    roster_revision: world.roster_revision,
    rules_revision: world.rules_revision,
  };
}

function viewerSummary(member: WorldMember | undefined, world: World) {
  return {
    membership_id: world.membership_id,
    membership_role: world.role,
    current_play_role: world.current_play_role,
    play_status: world.play_status,
    controlled_entity_ids: member?.controlled_entity_ids ?? [],
  };
}

function isUnfinishedInteraction(interaction: Interaction): boolean {
  return (
    interaction.status === "draft" ||
    interaction.status === "open" ||
    interaction.status === "adjudicating"
  );
}

function nextPlayStep(
  world: World,
  viewer: WorldMember | undefined,
  interaction: Interaction | undefined,
  latestFinalizedInteraction: Interaction | undefined,
): string {
  if (world.status === "archived") return "This world is read-only.";
  if (interaction === undefined)
    return latestFinalizedInteraction === undefined
      ? "Call read_gameplay_readout immediately before writing and saving the first Problem. Copy its complete result verbatim before presenting the public prompt unchanged as the scene."
      : "Call read_gameplay_readout exactly once now, then write and save the next Problem. Copy a non-empty result verbatim before the persisted Consequence and public prompt, or add nothing if it is empty.";
  if (interaction.status === "adjudicating")
    return "Refresh your view of Play and the Entity sheets, then retry the pending Resolution.";
  if (interaction.status !== "open")
    return "Wait for the current problem to finish updating.";
  const submittedMembershipIDs = new Set(
    interaction.actions
      .filter((action) => action.status === "submitted")
      .map((action) => action.submitted_by_membership_id),
  );
  if (
    viewer !== undefined &&
    interaction.eligible_responder_membership_ids.includes(viewer.id) &&
    !submittedMembershipIDs.has(viewer.id)
  )
    return "Continue from the saved Problem as the scene and ask what the current player's Character does, then record only their explicit Action.";
  const allRespondersActed =
    interaction.eligible_responder_membership_ids.every((membershipID) =>
      submittedMembershipIDs.has(membershipID),
    );
  return allRespondersActed
    ? "Resolve the Problem, refresh Play, then call read_gameplay_readout exactly once before presenting its saved public Consequence."
    : "Continue the scene without workflow commentary while waiting for the remaining responders.";
}

function buildGameplayReadout(
  entities: WorldEntity[],
  controlledEntityIDs: string[],
  mechanics: WorldMechanic[],
  latestFinalizedInteraction: Interaction | undefined,
): string {
  const controlledIDs = new Set(controlledEntityIDs);
  const controlledEntities = entities.filter((entity) =>
    controlledIDs.has(entity.id),
  );
  const blocks = controlledEntities.flatMap((entity) => {
    const lines =
      latestFinalizedInteraction === undefined
        ? initialReadoutLines(entity.sheet, mechanics)
        : deltaReadoutLines(entity.id, mechanics, latestFinalizedInteraction);
    return lines.length === 0
      ? []
      : [
          [`**${diagnosticText(entity.display_name)}**`, "", ...lines].join(
            "\n",
          ),
        ];
  });
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n\n---\n\n`;
}

function initialReadoutLines(
  sheet: EntitySheet,
  mechanics: WorldMechanic[],
): string[] {
  const mechanicLines = mechanics
    .filter((mechanic) => !mechanic.archived)
    .map((mechanic) => {
      const value = sheet.effective_values[mechanic.id];
      if (value === undefined)
        throw new SiteToolUsageError(
          "A current effective Mechanic value is unavailable.",
        );
      return `- **${diagnosticText(mechanic.name)}:** ${formatMechanicValue(
        value,
        mechanic,
      )}`;
    });
  return [...mechanicLines, `- **Statuses:** ${statusSummary(sheet)}`];
}

function deltaReadoutLines(
  entityID: string,
  mechanics: WorldMechanic[],
  latestFinalizedInteraction: Interaction,
): string[] {
  if (
    latestFinalizedInteraction.status !== "resolved" ||
    latestFinalizedInteraction.resolution === undefined
  )
    return [];

  const mechanicsByID = new Map(
    mechanics.map((mechanic) => [mechanic.id, mechanic]),
  );
  const lines = latestFinalizedInteraction.resolution.effective_changes
    .filter((change) => change.entity_id === entityID)
    .map((change) => {
      const mechanic = mechanicsByID.get(change.mechanic_id);
      if (mechanic === undefined)
        throw new SiteToolUsageError(
          "A changed Mechanic is unavailable from the current World.",
        );
      return `- **${diagnosticText(mechanic.name)}:** ${formatMechanicValue(
        change.before,
        mechanic,
      )} → ${formatMechanicValue(change.after, mechanic)}`;
    });
  for (const application of latestFinalizedInteraction.resolution
    .applications) {
    if (application.entity_id !== entityID || !application.changed) continue;
    if (
      application.type === "apply-status" &&
      !application.active_before &&
      application.active_after
    )
      lines.push(`- **Status:** +${diagnosticText(application.status_name)}`);
    if (
      application.type === "remove-status" &&
      application.active_before &&
      !application.active_after
    )
      lines.push(`- **Status:** −${diagnosticText(application.status_name)}`);
  }
  return lines;
}

function statusSummary(sheet: EntitySheet): string {
  const counts = new Map<string, number>();
  for (const status of sheet.active_status_instances)
    counts.set(status.name, (counts.get(status.name) ?? 0) + 1);
  if (counts.size === 0) return "None";
  return [...counts]
    .map(
      ([name, count]) =>
        `${diagnosticText(name)}${count === 1 ? "" : ` ×${count}`}`,
    )
    .join(" · ");
}

function formatMechanicValue(
  value: MechanicValue,
  mechanic: WorldMechanic,
): string {
  const rendered = value.kind === "number" ? value.value : String(value.value);
  const unit = mechanic.unit?.trim();
  return value.kind === "number" && unit !== undefined && unit !== ""
    ? `${rendered} ${diagnosticText(unit)}`
    : rendered;
}

function diagnosticText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]<>&~]/g, "\\$&");
}
