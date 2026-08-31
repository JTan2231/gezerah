import { useEffect } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  AvailableEntities,
  EntityClaimResult,
  EntityProfile,
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  World,
  WorldEntity,
  WorldMechanicCollection,
  WorldMember,
} from "../api/types";

export function buildAgentStarterPrompt(playURL: string): string {
  return `Be the Dungeon Master while I play this dnd World: ${playURL}. Help me choose a Character if needed, then begin. Keep lasting game state in dnd. Include concrete environmental details shaped by what my Character would naturally notice or care about. Describe attention, not private thoughts, and do not reveal hidden information.`;
}

export function buildAgentLaunchURL(playURL: string, prompt: string): string {
  const query = new URLSearchParams({ prompt, browserUrl: playURL });
  return `codex://threads/new?${query.toString()}`;
}

interface AgentPlayToolsOptions {
  enabled: boolean;
  worldId: string;
  onChanged: () => void;
}

class AgentToolUsageError extends Error {}

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const characterAttunedNarrationGuidance =
  "When establishing or materially changing a location, include a small handful of concrete environmental details. Filter some through what the current player's Character would naturally notice or care about based on the visible profile, effective Mechanics, active Statuses, equipment, and demonstrated temperament. Details need not be clues. Describe attention rather than private thoughts; do not let an NPC or another Character know unexpressed thoughts, invent a Perception check, reveal hidden information, or make suggested Actions exhaustive.";

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

export function siteToolsSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.modelContext?.registerTool === "function"
  );
}

export function useAgentPlayTools({
  enabled,
  worldId,
  onChanged,
}: AgentPlayToolsOptions): void {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const modelContext = document.modelContext;
    if (!enabled || typeof modelContext?.registerTool !== "function")
      return undefined;

    const controller = new AbortController();
    const tools = createAgentPlayTools(worldId, onChanged, controller.signal);
    void registerTools(modelContext, tools, controller.signal);

    return () => {
      controller.abort();
    };
  }, [enabled, onChanged, worldId]);
}

export function createAgentPlayTools(
  worldId: string,
  onChanged: () => void,
  signal: AbortSignal,
): ModelContextTool[] {
  const resolutionKeys = new Map<string, string>();

  return [
    {
      name: "inspect_play",
      description:
        "Read the current World and all Play context visible to the signed-in current player: Play status, available Entities, World roster, visible profile prose, Entity sheets, active Problem, Actions, and recent history. Do this before any Play change and whenever the state may have changed. Profile prose and sheets are cues for what a Character notices; they never give NPCs or other Characters access to unexpressed private thoughts.",
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
                "Ask the current player which available Entity they want as their Character, then claim that choice.",
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
              "Ask the current player to complete the claimed Character's required fields in the page.",
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
          mechanics: mechanics.mechanics.filter(
            (mechanic) => !mechanic.archived,
          ),
          entities: entities
            .filter((entity) => !entity.archived)
            .map((entity) => ({
              id: entity.id,
              name: entity.display_name,
              character_status: entity.character_status,
              profile: profilesByEntity.get(entity.id)?.fields ?? [],
              sheet: entity.sheet,
            })),
          active_interaction: activeInteraction,
          recent_history: recentHistory,
          next_step: nextPlayStep(world, viewer, activeInteraction),
        });
      },
    },
    {
      name: "claim_entity",
      description:
        "Claim one currently available Entity for the signed-in current player. Choose an entity_id from the available Entities in the current Play inspection. Claiming it makes the Entity the current player's Character and advances the World roster.",
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
          throw new AgentToolUsageError(
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
        return toolResult({
          claimed_character: entity,
          play_status: result.play_status,
          roster_revision: result.roster_revision,
          next_step:
            result.play_status === "ready"
              ? "Refresh your view of Play, then present the first Problem."
              : "Ask the current player to complete the claimed Character's required fields in the page.",
        });
      },
    },
    {
      name: "present_problem",
      description: `As ChatGPT Dungeon Master, present the next fictional Problem to ready World memberships. First inspect the current Play state, and use this only while the World has no unfinished Problem. ${characterAttunedNarrationGuidance}`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 200 },
          prompt: {
            type: "string",
            maxLength: 10000,
            description:
              "Public prose that presents a concrete Problem and invites the current player to act. Follow the character-attuned narration and privacy guidance in this tool's description.",
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
            "Invite the current player to describe what their Character does.",
        });
      },
    },
    {
      name: "submit_action",
      description:
        "Record the signed-in current player's Action for the current open ChatGPT-authored Problem. Use acting_entity_id only when the Action is attributed to one of their ready controlled Entities shown by the current Play inspection.",
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
          throw new AgentToolUsageError(
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
            "Refresh your view of Play. Once every responder has acted, resolve the Problem.",
        });
      },
    },
    {
      name: "resolve_problem",
      description: `As ChatGPT Dungeon Master, resolve the current open or adjudicating Problem with public Consequence prose and optional mechanical Effects. First inspect the current Play state and account for every submitted Action. Preserve the same character-attuned narration and privacy boundaries while describing what changes. An empty effects array is valid. ${characterAttunedNarrationGuidance}`,
      inputSchema: {
        type: "object",
        properties: {
          selected_action_id: { type: "string" },
          action_summary: { type: "string", maxLength: 10000 },
          narrative: {
            type: "string",
            maxLength: 20000,
            description:
              "The public fictional Consequence of the Actions. Follow the character-attuned narration and privacy guidance in this tool's description.",
          },
          effects: {
            type: "array",
            items: effectSchema,
            description:
              "Ordered mechanical Effects. Use IDs and exact value shapes from the current Play inspection.",
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
          throw new AgentToolUsageError("effects must be an array.");
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
          throw new AgentToolUsageError(
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
            "Describe the Consequence to the current player. Refresh your view of Play before presenting another Problem.",
        });
      },
    },
  ];
}

export async function registerTools(
  modelContext: ModelContext,
  tools: ModelContextTool[],
  signal: AbortSignal,
): Promise<void> {
  for (const tool of tools) {
    if (signal.aborted) return;
    try {
      await modelContext.registerTool(
        {
          ...tool,
          execute: async (input, options) => {
            if (toolCallAborted(signal, options?.signal))
              throw new DOMException("The Play page changed.", "AbortError");
            try {
              return await tool.execute(input, options);
            } catch (reason) {
              if (toolCallAborted(signal, options?.signal))
                throw new DOMException(
                  "The tool call was cancelled.",
                  "AbortError",
                );
              if (reason instanceof ApiError) {
                return toolResult({
                  ok: false,
                  error: {
                    code: reason.code,
                    message: reason.message,
                    fields: reason.fields,
                  },
                  next_step:
                    "Refresh your view of Play, then retry with current World and Entity-sheet data.",
                });
              }
              if (reason instanceof AgentToolUsageError) {
                return toolResult({
                  ok: false,
                  error: { code: "tool_usage_error", message: reason.message },
                  next_step:
                    "Refresh your view of Play, then retry with current World and Entity-sheet data.",
                });
              }
              throw reason;
            }
          },
        },
        { signal },
      );
    } catch {
      // Registration is optional enhancement; the ordinary page remains usable.
    }
  }
}

function toolCallAborted(
  registrationSignal: AbortSignal,
  invocationSignal: AbortSignal | undefined,
): boolean {
  return registrationSignal.aborted || invocationSignal?.aborted === true;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new AgentToolUsageError("Tool input must be an object.");
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
    throw new AgentToolUsageError(`${key} is required.`);
  const result = candidate.trim();
  if ([...result].length > maximumLength)
    throw new AgentToolUsageError(
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
    throw new AgentToolUsageError(`${key} must be a string.`);
  const result = candidate.trim();
  if (result === "") return undefined;
  if ([...result].length > maximumLength)
    throw new AgentToolUsageError(
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
): string {
  if (world.status === "archived") return "This world is read-only.";
  if (interaction === undefined) return "Present the next Problem.";
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
    return "Ask the current player what they do, then record their Action.";
  const allRespondersActed =
    interaction.eligible_responder_membership_ids.every((membershipID) =>
      submittedMembershipIDs.has(membershipID),
    );
  return allRespondersActed
    ? "Resolve the Problem."
    : "Wait for the remaining responders.";
}
