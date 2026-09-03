import { useEffect, useState } from "react";

import { api, jsonBody } from "../api/client";
import type { World, WorldTemplate } from "../api/types";
import { playWorldURL, type Navigate } from "../worldRoutes";
import {
  completeSiteToolRegistration,
  registerSiteTools,
  siteToolsSupported,
  SiteToolUsageError,
  type SiteToolRegistrationState,
} from "./siteTools";

export function useWorldTemplateStartTools(
  navigate: Navigate,
): SiteToolRegistrationState {
  const supported = siteToolsSupported();
  const [registration, setRegistration] = useState<SiteToolRegistrationState>(
    supported
      ? {
          status: "registering",
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
    const modelContext = document.modelContext;
    if (typeof modelContext?.registerTool !== "function") {
      setRegistration({
        status: "unsupported",
        registeredToolNames: [],
        failedToolNames: [],
      });
      return undefined;
    }

    const controller = new AbortController();
    const tools = createWorldTemplateStartTools(navigate, controller.signal);
    setRegistration({
      status: "registering",
      registeredToolNames: [],
      failedToolNames: [],
    });
    void registerSiteTools(
      modelContext,
      tools,
      controller.signal,
      "Reinspect the current Start page and retry with the complete World catalog. Do not ask the participant to operate Wrought.",
    ).then((result) => {
      const completed = completeSiteToolRegistration(
        controller,
        result,
        tools.length,
      );
      if (completed !== null) setRegistration(completed);
    });

    return () => controller.abort();
  }, [navigate]);

  return registration;
}

export function createWorldTemplateStartTools(
  navigate: Navigate,
  signal: AbortSignal,
): ModelContextTool[] {
  const destinationWorldIDs = new Map<string, string>();

  return [
    {
      name: "inspect_world_templates",
      description:
        "Read Wrought's complete ready-made World catalog, including how each World's scenes are written. Use the player's single stated play preference—setting, Character, tone, or difficult choices—to recommend the closest match without asking setup questions or asking the participant to operate Wrought.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        requireObject(input);
        const worldTemplates = await loadCompleteCatalog(
          invocationSignal(signal, options?.signal),
        );
        return {
          world_templates: worldTemplates,
          next_step:
            "Compare the settings, Characters, descriptions, and prose guides against the player's single stated play preference. Recommend the best match, then copy that World. Do not ask another setup question or ask the participant to operate Wrought.",
        };
      },
    },
    {
      name: "copy_world_template",
      description:
        "Copy one ready-made World for the signed-in player and continue in that World in the same attached tab. Choose template_id from the complete World-template inspection. Retrying the same template is idempotent.",
      inputSchema: {
        type: "object",
        properties: {
          template_id: {
            type: "string",
            description: "The selected ready-made World template ID.",
          },
        },
        required: ["template_id"],
        additionalProperties: false,
      },
      execute: async (input, options) => {
        const templateID = requiredString(input, "template_id", 200);
        const requestSignal = invocationSignal(signal, options?.signal);
        const worldTemplates = await loadCompleteCatalog(requestSignal);
        if (!worldTemplates.some((template) => template.id === templateID))
          throw new SiteToolUsageError(
            "That World template is not in the current complete catalog.",
          );

        let destinationWorldID = destinationWorldIDs.get(templateID);
        if (destinationWorldID === undefined) {
          destinationWorldID = crypto.randomUUID();
          destinationWorldIDs.set(templateID, destinationWorldID);
        }
        const world = await api<World>(
          `/wrought/api/world-templates/${encodeURIComponent(templateID)}/clone`,
          {
            method: "POST",
            signal: requestSignal,
            ...jsonBody({ id: destinationWorldID }),
          },
        );
        const result = {
          copied_world: {
            id: world.id,
            name: world.name,
            description: world.description,
            prose_guide: world.prose_guide,
            status: world.status,
            facilitator_source: world.facilitator.source,
            current_play_role: world.current_play_role,
            play_status: world.play_status,
          },
          next_step:
            "The attached page is moving to the copied World. Inspect Play there, use the same preference to choose and claim the best-fitting available Character without asking another setup question, then present the first Problem. Never invent or submit an Action before the player says what they do.",
        };
        navigate(playWorldURL(world.id), { replace: true });
        return result;
      },
    },
  ];
}

async function loadCompleteCatalog(
  signal: AbortSignal,
): Promise<WorldTemplate[]> {
  const worldTemplates = await api<WorldTemplate[]>(
    "/wrought/api/world-templates",
    {
      signal,
    },
  );
  if (worldTemplates.length !== 3)
    throw new SiteToolUsageError(
      "The complete set of three ready-made Worlds is not available.",
    );
  return worldTemplates;
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

function invocationSignal(
  registrationSignal: AbortSignal,
  toolSignal: AbortSignal | undefined,
): AbortSignal {
  return toolSignal === undefined
    ? registrationSignal
    : AbortSignal.any([registrationSignal, toolSignal]);
}
