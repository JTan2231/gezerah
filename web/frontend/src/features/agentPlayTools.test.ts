import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "../api/client";
import {
  buildAgentLaunchURL,
  buildAgentStarterPrompt,
  createAgentPlayTools,
  registerTools,
} from "./agentPlayTools";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ChatGPT play tools", () => {
  test("registers the five page tools with abortable registrations", async () => {
    const controller = new AbortController();
    const registrations: Array<{
      tool: ModelContextTool;
      signal: AbortSignal | undefined;
    }> = [];
    const modelContext: ModelContext = {
      registerTool: (tool, options) => {
        registrations.push({ tool, signal: options?.signal });
      },
    };

    await registerTools(
      modelContext,
      createAgentPlayTools("world-1", () => undefined, controller.signal),
      controller.signal,
    );

    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "inspect_play",
      "claim_entity",
      "present_problem",
      "submit_action",
      "resolve_problem",
    ]);
    expect(
      registrations.every(({ signal }) => signal === controller.signal),
    ).toBe(true);
    const starterPrompt = buildAgentStarterPrompt(
      "https://play.example/play/world-1",
    );
    expect(starterPrompt).toContain("https://play.example/play/world-1");
    expect(starterPrompt).toContain("Keep lasting game state in dnd");
    expect(starterPrompt).toContain("naturally notice or care about");
    expect(starterPrompt).toContain("not private thoughts");
    expect(starterPrompt).not.toContain("inspect_play");
    expect(starterPrompt).not.toContain("Site Tools");
    expect(starterPrompt).not.toContain("built-in browser");
    const inspectDescription = registrations.find(
      ({ tool }) => tool.name === "inspect_play",
    )?.tool.description;
    const presentDescription = registrations.find(
      ({ tool }) => tool.name === "present_problem",
    )?.tool.description;
    const resolveDescription = registrations.find(
      ({ tool }) => tool.name === "resolve_problem",
    )?.tool.description;
    expect(inspectDescription).toContain("visible profile prose");
    expect(inspectDescription).toContain("unexpressed private thoughts");
    expect(presentDescription).toContain("concrete environmental details");
    expect(presentDescription).toContain("effective Mechanics");
    expect(presentDescription).toContain("Details need not be clues");
    expect(presentDescription).toContain("invent a Perception check");
    expect(resolveDescription).toContain("character-attuned narration");
    expect(resolveDescription).toContain("unexpressed thoughts");
    expect(
      buildAgentLaunchURL("https://play.example/play/world-1", "Inspect Play."),
    ).toBe(
      "codex://threads/new?prompt=Inspect+Play.&browserUrl=https%3A%2F%2Fplay.example%2Fplay%2Fworld-1",
    );
  });

  test("inspects setup-required characters without requesting claim choices", async () => {
    const requests: string[] = [];
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0]) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        requests.push(path);
        if (path === "/api/worlds/world-1")
          return Promise.resolve(
            Response.json({
              id: "world-1",
              name: "The Glass Coast",
              description: null,
              status: "active",
              facilitator: { source: "agent" },
              membership_id: "member-1",
              role: "owner",
              current_play_role: "player",
              play_status: "setup-required",
              roster_revision: 4,
              rules_revision: 3,
            }),
          );
        if (path === "/api/worlds/world-1/members")
          return Promise.resolve(
            Response.json([
              {
                id: "member-1",
                controlled_entity_ids: ["ash"],
              },
            ]),
          );
        if (path === "/api/worlds/world-1/entities")
          return Promise.resolve(
            Response.json([
              {
                id: "ash",
                display_name: "Ash",
                archived: false,
                completed_field_count: 1,
                required_field_count: 2,
              },
              {
                id: "unclaimed",
                display_name: "Moss",
                archived: false,
                completed_field_count: 0,
                required_field_count: 2,
              },
            ]),
          );
        if (path === "/api/worlds/world-1/entities/ash/profile")
          return Promise.resolve(
            Response.json({
              entity_id: "ash",
              fields: [],
              missing_field_ids: ["calling"],
            }),
          );
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    const controller = new AbortController();
    const inspect = createAgentPlayTools(
      "world-1",
      () => undefined,
      controller.signal,
    ).find((tool) => tool.name === "inspect_play");

    const payload = (await inspect?.execute({})) as {
      world: { facilitator_source: string };
      viewer: {
        membership_role: string;
        current_play_role: string;
      };
      claimed_characters: Array<{ id: string }>;
      next_step: string;
    };

    expect(requests).not.toContain("/api/worlds/world-1/available-entities");
    expect(requests).not.toContain(
      "/api/worlds/world-1/entities/unclaimed/profile",
    );
    expect(payload.claimed_characters.map(({ id }) => id)).toEqual(["ash"]);
    expect(payload.world.facilitator_source).toBe("agent");
    expect(payload.viewer.membership_role).toBe("owner");
    expect(payload.viewer.current_play_role).toBe("player");
    expect(payload.next_step).toContain("required fields in the page");
  });

  test("inspects Play with canonical World, membership, and Interaction keys", async () => {
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0]) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        if (path === "/api/worlds/world-1")
          return Promise.resolve(
            Response.json({
              id: "world-1",
              name: "The Glass Coast",
              status: "active",
              facilitator: { source: "agent" },
              membership_id: "member-1",
              role: "owner",
              current_play_role: "player",
              play_status: "ready",
              roster_revision: 4,
              rules_revision: 3,
            }),
          );
        if (path === "/api/worlds/world-1/members")
          return Promise.resolve(
            Response.json([
              {
                id: "member-1",
                display_name: "River",
                status: "active",
                current_play_role: "player",
                play_status: "ready",
                controlled_entity_ids: [],
              },
            ]),
          );
        if (path === "/api/worlds/world-1/entities")
          return Promise.resolve(Response.json([]));
        if (path === "/api/worlds/world-1/mechanics")
          return Promise.resolve(Response.json({ revision: 3, mechanics: [] }));
        if (path === "/api/worlds/world-1/interactions")
          return Promise.resolve(
            Response.json([
              {
                id: "interaction-1",
                status: "open",
                facilitator_source: "agent",
                actions: [],
                eligible_responder_membership_ids: [],
                context_entity_ids: ["ash"],
              },
            ]),
          );
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    const inspect = createAgentPlayTools(
      "world-1",
      () => undefined,
      new AbortController().signal,
    ).find((tool) => tool.name === "inspect_play");

    const payload = (await inspect?.execute({})) as {
      world: { facilitator_source: string };
      viewer: {
        membership_role: string;
        current_play_role: string;
      };
      members: Array<{ current_play_role: string }>;
      active_interaction: { id: string; context_entity_ids: string[] };
    };

    expect(payload.world.facilitator_source).toBe("agent");
    expect(payload.viewer.membership_role).toBe("owner");
    expect(payload.viewer.current_play_role).toBe("player");
    expect(payload.members[0]?.current_play_role).toBe("player");
    expect(payload.active_interaction.id).toBe("interaction-1");
    expect(payload.active_interaction.context_entity_ids).toEqual(["ash"]);
  });

  test("claims an available Entity against the world roster revision", async () => {
    const requests: Array<{
      path: string;
      init: RequestInit | undefined;
    }> = [];
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        requests.push({ path, init });
        if (path === "/api/worlds/world-1/available-entities")
          return Promise.resolve(
            Response.json({
              roster_revision: 7,
              entities: [{ id: "entity-1", display_name: "Entity One" }],
            }),
          );
        if (path === "/api/worlds/world-1/entities/entity-1/claim")
          return Promise.resolve(
            Response.json({
              entity_id: "entity-1",
              controller_world_membership_ids: ["membership-1"],
              roster_revision: 8,
              play_status: "ready",
            }),
          );
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    let changed = 0;
    const claim = createAgentPlayTools(
      "world-1",
      () => {
        changed += 1;
      },
      new AbortController().signal,
    ).find((tool) => tool.name === "claim_entity");

    const result = (await claim?.execute({ entity_id: "entity-1" })) as {
      claimed_character: { id: string };
      roster_revision: number;
      next_step: string;
    };

    expect(requests.map(({ path }) => path)).toEqual([
      "/api/worlds/world-1/available-entities",
      "/api/worlds/world-1/entities/entity-1/claim",
    ]);
    const claimBody = requests[1]?.init?.body;
    if (typeof claimBody !== "string")
      throw new Error("claim request body was not JSON text");
    expect(JSON.parse(claimBody)).toEqual({
      expected_roster_revision: 7,
    });
    expect(result.claimed_character.id).toBe("entity-1");
    expect(result.roster_revision).toBe(8);
    expect(result.next_step).toContain("Refresh your view of Play");
    expect(result.next_step).not.toContain("inspect_play");
    expect(changed).toBe(1);
  });

  test("returns a presented Interaction with the canonical key", async () => {
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0]) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        if (path === "/api/worlds/world-1/agent/continue")
          return Promise.resolve(
            Response.json({
              id: "interaction-1",
              status: "open",
              context_entity_ids: ["ash"],
            }),
          );
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    const present = createAgentPlayTools(
      "world-1",
      () => undefined,
      new AbortController().signal,
    ).find((tool) => tool.name === "present_problem");

    const payload = (await present?.execute({ prompt: "A door opens." })) as {
      presented_interaction: { id: string; context_entity_ids: string[] };
    };

    expect(payload.presented_interaction.id).toBe("interaction-1");
    expect(payload.presented_interaction.context_entity_ids).toEqual(["ash"]);
  });

  test("returns API conflicts as useful tool results", async () => {
    const registrationController = new AbortController();
    const invocationController = new AbortController();
    let registered: ModelContextTool | undefined;
    const modelContext: ModelContext = {
      registerTool: (tool) => {
        registered = tool;
      },
    };
    const failingTool: ModelContextTool = {
      name: "failing_tool",
      description: "Fixture",
      inputSchema: { type: "object" },
      execute: (_input, options) => {
        expect(options?.signal).toBe(invocationController.signal);
        return Promise.reject(
          new ApiError(409, "stale_revision", "Inspect fresh World data.", {
            expected_revision: "The world roster changed.",
          }),
        );
      },
    };

    await registerTools(
      modelContext,
      [failingTool],
      registrationController.signal,
    );
    const payload = (await registered?.execute(
      {},
      { signal: invocationController.signal },
    )) as {
      ok: boolean;
      error: { code: string; fields: Record<string, string> };
      next_step: string;
    };

    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("stale_revision");
    expect(payload.error.fields["expected_revision"]).toBe(
      "The world roster changed.",
    );
    expect(payload.next_step).toContain("Refresh your view of Play");
    expect(payload.next_step).not.toContain("inspect_play");
  });

  test("returns recoverable usage errors as tool results", async () => {
    const controller = new AbortController();
    let registered: ModelContextTool | undefined;
    const modelContext: ModelContext = {
      registerTool: (tool) => {
        registered = tool;
      },
    };
    const inspect = createAgentPlayTools(
      "world-1",
      () => undefined,
      controller.signal,
    ).find((tool) => tool.name === "inspect_play");
    expect(inspect).toBeDefined();

    await registerTools(modelContext, [inspect!], controller.signal);
    const payload = (await registered?.execute(null)) as {
      ok: boolean;
      error: { code: string; message: string };
      next_step: string;
    };

    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("tool_usage_error");
    expect(payload.error.message).toContain("must be an object");
    expect(payload.next_step).toContain("Refresh your view of Play");
    expect(payload.next_step).not.toContain("inspect_play");
  });
});
