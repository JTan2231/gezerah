import { useEffect } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  AvailableCharacters,
  CharacterClaimResult,
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
  return `Open ${playURL} in your built-in browser. If the page asks, sign in; the Play page provides Site Tools. Be the Dungeon Master for this world. Inspect the game, help me choose a character if needed, then set the first scene.`;
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

const stateValueSchema = {
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

const statusTargetsSchema = {
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
        value: stateValueSchema,
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
        targets: statusTargetsSchema,
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
                  value: stateValueSchema,
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
      name: "inspect_game",
      description:
        "Inspect the current world, player seat, available characters, table, character sheets, active problem, actions, and recent history. Call this before taking another game action.",
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
            const available = await api<AvailableCharacters>(
              worldPath(worldId, "available-characters"),
              { signal: requestSignal },
            );
            return toolResult({
              world: gameWorldSummary(world),
              viewer: viewerSummary(viewer, world),
              available_characters: available.characters,
              table_revision: available.table_revision,
              next_step: "Choose one available character with claim_character.",
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
            world: gameWorldSummary(world),
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
              "Ask the player to complete the claimed character's required fields in the page.",
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
        const activeProblem = interactions.find(isUnfinishedInteraction);
        const recentHistory = interactions
          .filter(
            (interaction) =>
              interaction.status === "resolved" ||
              interaction.status === "cancelled",
          )
          .slice(0, 3);

        return toolResult({
          world: gameWorldSummary(world),
          viewer: viewerSummary(viewer, world),
          members: members
            .filter((membership) => membership.status === "active")
            .map((membership) => ({
              id: membership.id,
              name: membership.display_name,
              play_role: membership.current_play_role,
              play_status: membership.play_status,
              controlled_entity_ids: membership.controlled_entity_ids,
            })),
          rules_revision: mechanics.revision,
          mechanics: mechanics.mechanics.filter(
            (mechanic) => !mechanic.archived,
          ),
          characters: entities
            .filter((entity) => !entity.archived)
            .map((entity) => ({
              id: entity.id,
              name: entity.display_name,
              character_status: entity.character_status,
              profile: profilesByEntity.get(entity.id)?.fields ?? [],
              effective_values: entity.state.effective_values,
              active_statuses: entity.state.active_statuses,
              state_revision: entity.state.revision,
              status_revision: entity.state.status_revision,
            })),
          current_problem: activeProblem,
          recent_history: recentHistory,
          next_step: nextGameStep(world, viewer, activeProblem),
        });
      },
    },
    {
      name: "claim_character",
      description:
        "Claim one currently available character for the signed-in player. Use an entity_id returned by inspect_game. This changes the player's table seat.",
      inputSchema: {
        type: "object",
        properties: {
          entity_id: {
            type: "string",
            description: "The available character entity ID.",
          },
        },
        required: ["entity_id"],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const requestSignal = toolSignal(signal, options?.signal);
        const entityID = requiredString(input, "entity_id", 200);
        const available = await api<AvailableCharacters>(
          worldPath(worldId, "available-characters"),
          { signal: requestSignal },
        );
        const character = available.characters.find(
          (candidate) => candidate.id === entityID,
        );
        if (character === undefined)
          throw new AgentToolUsageError(
            "That character is no longer available to claim.",
          );
        const result = await api<CharacterClaimResult>(
          worldPath(worldId, `entities/${entityID}/claim`),
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({
              expected_table_revision: available.table_revision,
            }),
          },
        );
        onChanged();
        return toolResult({
          claimed_character: character,
          play_status: result.play_status,
          table_revision: result.table_revision,
          next_step:
            result.play_status === "ready"
              ? "Inspect the game again, then begin the adventure."
              : "Ask the player to complete the claimed character's required fields in the page.",
        });
      },
    },
    {
      name: "present_problem",
      description:
        "As ChatGPT Dungeon Master, present the next fictional problem to the ready table. Use only while the table has no unfinished problem.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 200 },
          prompt: {
            type: "string",
            maxLength: 10000,
            description:
              "Public prose that sets a concrete situation and invites the player to act.",
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
          worldPath(worldId, "agent-dm/continue"),
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({ prompt, ...(title === undefined ? {} : { title }) }),
          },
        );
        onChanged();
        return toolResult({
          presented_problem: interaction,
          next_step: "Invite the player to describe what their character does.",
        });
      },
    },
    {
      name: "submit_action",
      description:
        "Record the signed-in player's action for the current open ChatGPT-authored problem. Use acting_entity_id only when the action is attributed to one of their ready characters.",
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
            "Inspect the game. Once every responder has acted, decide and resolve the outcome.",
        });
      },
    },
    {
      name: "resolve_problem",
      description:
        "As ChatGPT Dungeon Master, resolve the current open or adjudicating problem with public consequence prose and optional mechanical effects. Inspect the game first and account for every submitted action. An empty effects array is valid.",
      inputSchema: {
        type: "object",
        properties: {
          selected_action_id: { type: "string" },
          action_summary: { type: "string", maxLength: 10000 },
          narrative: {
            type: "string",
            maxLength: 20000,
            description: "The public fictional consequence of the actions.",
          },
          effects: {
            type: "array",
            items: effectSchema,
            description:
              "Ordered mechanical effects. Use IDs and exact value shapes from inspect_game.",
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
          worldPath(worldId, `interactions/${interaction.id}/agent-dm/resolve`),
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
            "Describe the consequence to the player. Inspect the game before presenting another problem.",
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
              throw new DOMException("The game page changed.", "AbortError");
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
                  next_step: "Inspect the game and retry with fresh state.",
                });
              }
              if (reason instanceof AgentToolUsageError) {
                return toolResult({
                  ok: false,
                  error: { code: "tool_usage_error", message: reason.message },
                  next_step: "Inspect the game and retry with fresh state.",
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

function gameWorldSummary(world: World) {
  return {
    id: world.id,
    name: world.name,
    description: world.description,
    status: world.status,
    dungeon_master: world.facilitator.source,
    table_revision: world.table_revision,
    rules_revision: world.rules_revision,
  };
}

function viewerSummary(member: WorldMember | undefined, world: World) {
  return {
    membership_id: world.membership_id,
    durable_role: world.role,
    play_role: world.current_play_role,
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

function nextGameStep(
  world: World,
  viewer: WorldMember | undefined,
  interaction: Interaction | undefined,
): string {
  if (world.status === "archived") return "This world is read-only.";
  if (interaction === undefined)
    return "Present the next problem with present_problem.";
  if (interaction.status === "adjudicating")
    return "Retry the pending outcome with resolve_problem using fresh state.";
  if (interaction.status !== "open")
    return "Wait for the current problem state to finish updating.";
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
    return "Ask the player what they do, then record it with submit_action.";
  const allResponded = interaction.eligible_responder_membership_ids.every(
    (membershipID) => submittedMembershipIDs.has(membershipID),
  );
  return allResponded
    ? "Resolve the outcome with resolve_problem."
    : "Wait for the remaining responders.";
}
