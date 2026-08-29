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
      "inspect_game",
      "claim_character",
      "present_problem",
      "submit_action",
      "resolve_problem",
    ]);
    expect(
      registrations.every(({ signal }) => signal === controller.signal),
    ).toBe(true);
    expect(
      buildAgentStarterPrompt("https://game.example/play/world-1"),
    ).toContain("https://game.example/play/world-1");
    expect(
      buildAgentLaunchURL(
        "https://game.example/play/world-1",
        "Inspect the game.",
      ),
    ).toBe(
      "codex://threads/new?prompt=Inspect+the+game.&browserUrl=https%3A%2F%2Fgame.example%2Fplay%2Fworld-1",
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
        const path = new URL(requestURL, "https://game.example").pathname;
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
              table_revision: 4,
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
    ).find((tool) => tool.name === "inspect_game");

    const payload = (await inspect?.execute({})) as {
      claimed_characters: Array<{ id: string }>;
      next_step: string;
    };

    expect(requests).not.toContain("/api/worlds/world-1/available-characters");
    expect(requests).not.toContain(
      "/api/worlds/world-1/entities/unclaimed/profile",
    );
    expect(payload.claimed_characters.map(({ id }) => id)).toEqual(["ash"]);
    expect(payload.next_step).toContain("required fields in the page");
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
          new ApiError(409, "stale_revision", "Inspect fresh state.", {
            expected_revision: "The table changed.",
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
      "The table changed.",
    );
    expect(payload.next_step).toContain("Inspect the game");
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
    ).find((tool) => tool.name === "inspect_game");
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
    expect(payload.next_step).toContain("Inspect the game");
  });
});
