import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "../api/client";
import {
  createAgentPlayTools,
  playSiteToolPageEligible,
} from "./agentPlayTools";
import { registerSiteTools } from "./siteTools";

const originalFetch = globalThis.fetch;
const playRecovery =
  "Refresh your view of Play with current World and Entity-sheet data.";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ChatGPT play tools", () => {
  test("makes the Play surface eligible only for an active current player", () => {
    expect(
      playSiteToolPageEligible({
        status: "active",
        facilitator: { source: "agent" },
        current_play_role: "player",
      }),
    ).toBe(true);
    expect(
      playSiteToolPageEligible({
        status: "active",
        facilitator: { source: "agent" },
        current_play_role: "spectator",
      }),
    ).toBe(false);
    expect(
      playSiteToolPageEligible({
        status: "archived",
        facilitator: { source: "agent" },
        current_play_role: "player",
      }),
    ).toBe(false);
    expect(
      playSiteToolPageEligible({
        status: "active",
        facilitator: { source: "terra" },
        current_play_role: "player",
      }),
    ).toBe(false);
  });

  test("registers the seven Play site tools with abortable registrations", async () => {
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

    await registerSiteTools(
      modelContext,
      createAgentPlayTools("world-1", () => undefined, controller.signal),
      controller.signal,
      playRecovery,
    );

    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "read_play_handbook",
      "inspect_play",
      "read_gameplay_readout",
      "claim_entity",
      "present_problem",
      "submit_action",
      "resolve_problem",
    ]);
    expect(
      registrations.every(({ signal }) => signal === controller.signal),
    ).toBe(true);
    const handbookTool = registrations.find(
      ({ tool }) => tool.name === "read_play_handbook",
    )?.tool;
    const inspectDescription = registrations.find(
      ({ tool }) => tool.name === "inspect_play",
    )?.tool.description;
    const readoutTool = registrations.find(
      ({ tool }) => tool.name === "read_gameplay_readout",
    )?.tool;
    const presentDescription = registrations.find(
      ({ tool }) => tool.name === "present_problem",
    )?.tool.description;
    const resolveDescription = registrations.find(
      ({ tool }) => tool.name === "resolve_problem",
    )?.tool.description;
    const submitDescription = registrations.find(
      ({ tool }) => tool.name === "submit_action",
    )?.tool.description;
    expect(inspectDescription).toContain("visible profile prose");
    expect(inspectDescription).toContain("prose guide");
    expect(inspectDescription).toContain("not what is true");
    expect(inspectDescription).toContain("unexpressed private thoughts");
    expect(inspectDescription).not.toContain("response_preamble");
    expect(handbookTool?.annotations?.readOnlyHint).toBe(true);
    expect(handbookTool?.description).toContain("presenting scenes");
    expect(handbookTool?.description).toContain("recovering from failures");
    expect(readoutTool?.annotations?.readOnlyHint).toBe(true);
    expect(readoutTool?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(readoutTool?.description).toContain("no-input read-only tool");
    expect(readoutTool?.description).toContain(
      "immediately before presenting the first Problem",
    );
    expect(readoutTool?.description).toContain(
      "after each successfully committed Consequence",
    );
    expect(readoutTool?.description).toContain(
      "Copy every non-empty result verbatim",
    );
    expect(readoutTool?.description).toContain(
      "An empty string means no controlled-Character state changed",
    );
    expect(presentDescription).toContain("concrete environmental details");
    expect(presentDescription).toContain("effective Mechanics");
    expect(presentDescription).toContain("Details need not be clues");
    expect(presentDescription).toContain("invent a Perception check");
    expect(presentDescription).toContain(
      "Follow the prose guide in the latest Play inspection",
    );
    expect(presentDescription).toContain("cannot change established facts");
    expect(presentDescription).toContain("Never quote it");
    expect(presentDescription).toContain("same narrative text you present");
    expect(presentDescription).toContain("read_gameplay_readout");
    expect(presentDescription).toContain("copy that text verbatim");
    expect(presentDescription).toContain("not part of the saved Problem");
    expect(presentDescription).toContain(
      "does not count toward the prose word or beat target",
    );
    expect(presentDescription).not.toContain("receipt");
    expect(presentDescription).toMatch(/up to about 180 words/i);
    expect(presentDescription).toMatch(/combined public passage.+100 to 140/i);
    expect(resolveDescription).toContain("Show decisions and changed state");
    expect(resolveDescription).toContain("report about the operation");
    expect(resolveDescription).toContain("read_gameplay_readout");
    expect(resolveDescription).toContain("copy that text verbatim");
    expect(resolveDescription).toContain("If it returns an empty string");
    expect(resolveDescription).toContain("Follow the prose guide");
    expect(resolveDescription).toContain("unexpressed thoughts");
    expect(resolveDescription).toMatch(/100 to 140 words total/i);
    expect(resolveDescription).toMatch(/not 100 to 140 words for each/i);
    expect(submitDescription).toContain("explicitly states or delegates");
    expect(submitDescription).toContain("Never infer or invent an Action");
    expect(submitDescription).toContain("Do not announce submission");
  });

  test("reads the complete Play handbook or one validated topic", async () => {
    const readHandbook = createAgentPlayTools(
      "world-1",
      () => undefined,
      new AbortController().signal,
    ).find((tool) => tool.name === "read_play_handbook");
    expect(readHandbook).toBeDefined();

    const complete = (await readHandbook!.execute({ topic: "all" })) as {
      handbook: {
        topic: string;
        sections: Array<{ topic: string; guidance: string }>;
      };
    };
    expect(complete.handbook.topic).toBe("all");
    expect(complete.handbook.sections.map(({ topic }) => topic)).toEqual([
      "role-and-authority",
      "play-loop",
      "state-and-effects",
      "narrative-presentation",
      "fiction-and-privacy",
      "failure-and-recovery",
    ]);
    expect(
      complete.handbook.sections.find(
        ({ topic }) => topic === "narrative-presentation",
      )?.guidance,
    ).toContain("same public Problem and Consequence words");
    const narrativeGuidance = complete.handbook.sections.find(
      ({ topic }) => topic === "narrative-presentation",
    )?.guidance;
    const stateGuidance = complete.handbook.sections.find(
      ({ topic }) => topic === "state-and-effects",
    )?.guidance;
    expect(stateGuidance).toContain(
      "read_gameplay_readout returns final Markdown",
    );
    expect(stateGuidance).toContain("bold Character name");
    expect(stateGuidance).toContain(
      "one bullet per current effective Mechanic",
    );
    expect(stateGuidance).toContain("Label: value");
    expect(stateGuidance).toContain("current Statuses");
    expect(stateGuidance).toContain("only exact controlled-Character");
    expect(stateGuidance).toContain("Label: before → after");
    expect(stateGuidance).toContain("Status: +Name");
    expect(stateGuidance).toContain("Status: −Name");
    expect(stateGuidance).toContain("empty string");
    expect(stateGuidance).toContain("byte-for-byte");
    expect(stateGuidance).toContain(
      "never emit a header or divider for an empty result",
    );
    expect(stateGuidance).toContain("not saved fiction");
    expect(narrativeGuidance).toContain(
      "Follow the inspected World's prose guide",
    );
    expect(narrativeGuidance).toContain("cannot change established facts");
    expect(narrativeGuidance).toContain("Never quote it");
    expect(narrativeGuidance).toMatch(/100 to 140 words/i);
    expect(narrativeGuidance).toMatch(/180 words or fewer/i);
    expect(narrativeGuidance).toMatch(/5 to 7 short prose beats/i);
    expect(narrativeGuidance).toMatch(/combined passage, not each saved part/i);
    expect(narrativeGuidance).toContain(
      "readout does not count toward either target",
    );
    expect(narrativeGuidance).toMatch(
      /at most one concise sentence on changed state/i,
    );
    expect(narrativeGuidance).toMatch(/direct question.+clear cliffhanger/i);
    expect(narrativeGuidance).toContain(
      "Never pad, truncate, or paraphrase saved prose",
    );
    expect(narrativeGuidance).not.toContain("control-plane");
    expect(narrativeGuidance).not.toContain("receipt-shaped");

    const presentation = (await readHandbook!.execute({
      topic: "narrative-presentation",
    })) as {
      handbook: { topic: string; sections: Array<{ topic: string }> };
    };
    expect(presentation.handbook).toMatchObject({
      topic: "narrative-presentation",
      sections: [{ topic: "narrative-presentation" }],
    });

    let invalidTopicError: unknown;
    try {
      await readHandbook!.execute({ topic: "unwritten-house-rule" });
    } catch (error) {
      invalidTopicError = error;
    }
    expect(invalidTopicError).toBeInstanceOf(Error);
    expect((invalidTopicError as Error).message).toContain(
      "topic must be one of",
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
      ok: boolean;
      error: { code: string };
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
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("character_setup_required");
    expect(payload.next_step).toContain("delegated Play is unavailable");
    expect(payload.next_step).toContain(
      "Do not ask the participant to operate Wrought",
    );
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
              prose_guide: "Keep the language spare and salt-stung.",
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
      world: { facilitator_source: string; prose_guide: string };
      viewer: {
        membership_role: string;
        current_play_role: string;
      };
      members: Array<{ current_play_role: string }>;
      active_interaction: { id: string; context_entity_ids: string[] };
    };

    expect(payload.world.facilitator_source).toBe("agent");
    expect(payload.world.prose_guide).toBe(
      "Keep the language spare and salt-stung.",
    );
    expect(payload.viewer.membership_role).toBe("owner");
    expect(payload.viewer.current_play_role).toBe("player");
    expect(payload.members[0]?.current_play_role).toBe("player");
    expect(payload.active_interaction.id).toBe("interaction-1");
    expect(payload.active_interaction.context_entity_ids).toEqual(["ash"]);
    expect(payload).not.toHaveProperty("response_preamble");
  });

  test("returns exact deterministic initial, delta, and empty gameplay readouts", async () => {
    let interactions: unknown[] = [];
    let useMarkdownSensitiveNames = false;
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
              role: "player",
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
                controlled_entity_ids: ["aria"],
              },
            ]),
          );
        if (path === "/api/worlds/world-1/entities")
          return Promise.resolve(
            Response.json([
              {
                id: "aria",
                display_name: useMarkdownSensitiveNames
                  ? "Aria &copy; ~~Scout~~"
                  : "Aria",
                archived: false,
                character_status: "ready",
                sheet: {
                  entity_id: "aria",
                  logical_input_values: {
                    resolve: { kind: "number", value: "6" },
                  },
                  effective_values: {
                    resolve: { kind: "number", value: "4" },
                    vigilance: { kind: "boolean", value: true },
                    supply: { kind: "number", value: "2" },
                    hidden: { kind: "number", value: "99" },
                  },
                  active_status_instances: [
                    {
                      id: "shaken-1",
                      name: useMarkdownSensitiveNames
                        ? "Shaken &copy; ~~hard~~"
                        : "Shaken",
                    },
                    {
                      id: "shaken-2",
                      name: useMarkdownSensitiveNames
                        ? "Shaken &copy; ~~hard~~"
                        : "Shaken",
                    },
                  ],
                },
              },
            ]),
          );
        if (path === "/api/worlds/world-1/entities/aria/profile")
          return Promise.resolve(
            Response.json({ entity_id: "aria", fields: [] }),
          );
        if (path === "/api/worlds/world-1/mechanics")
          return Promise.resolve(
            Response.json({
              revision: 3,
              mechanics: [
                { id: "resolve", name: "Resolve", archived: false },
                { id: "vigilance", name: "Vigilance", archived: false },
                { id: "supply", name: "Supply", archived: false },
                { id: "hidden", name: "Hidden", archived: true },
              ],
            }),
          );
        if (path === "/api/worlds/world-1/interactions")
          return Promise.resolve(Response.json(interactions));
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    let changedCount = 0;
    const readout = createAgentPlayTools(
      "world-1",
      () => {
        changedCount += 1;
      },
      new AbortController().signal,
    ).find((tool) => tool.name === "read_gameplay_readout");
    expect(readout).toBeDefined();

    const initial = (await readout!.execute({})) as string;
    expect(initial).toBe(
      "**Aria**\n\n- **Resolve:** 4\n- **Vigilance:** true\n- **Supply:** 2\n- **Statuses:** Shaken ×2\n\n---\n\n",
    );
    expect(await readout!.execute({})).toBe(initial);

    interactions = [
      {
        id: "resolution-1",
        status: "resolved",
        resolution: { applications: [], effective_changes: [] },
      },
    ];
    expect(await readout!.execute({})).toBe("");

    interactions = [
      {
        id: "resolution-2",
        status: "resolved",
        resolution: {
          effective_changes: [
            {
              entity_id: "aria",
              mechanic_id: "resolve",
              before: { kind: "number", value: "6" },
              after: { kind: "number", value: "4" },
            },
          ],
          applications: [
            {
              type: "apply-status",
              entity_id: "aria",
              status_name: "Shaken",
              active_before: false,
              active_after: true,
              changed: true,
            },
            {
              type: "remove-status",
              entity_id: "aria",
              status_name: "Inspired",
              active_before: true,
              active_after: false,
              changed: true,
            },
          ],
        },
      },
    ];
    const changed = (await readout!.execute({})) as string;
    expect(changed).toBe(
      "**Aria**\n\n- **Resolve:** 6 → 4\n- **Status:** +Shaken\n- **Status:** −Inspired\n\n---\n\n",
    );
    expect(await readout!.execute({})).toBe(changed);
    expect(changed).not.toContain("Vigilance");
    expect(changed).not.toContain("Supply");
    expect(changed).not.toContain("Statuses");
    expect(changed).not.toContain("Hidden");
    expect(changed).not.toContain("99");

    interactions = [
      { id: "open-3", status: "open" },
      {
        id: "resolution-2",
        status: "resolved",
        resolution: {
          effective_changes: [
            {
              entity_id: "aria",
              mechanic_id: "resolve",
              before: { kind: "number", value: "6" },
              after: { kind: "number", value: "4" },
            },
          ],
          applications: [],
        },
      },
    ];
    expect(await readout!.execute({})).toBe(
      "**Aria**\n\n- **Resolve:** 6 → 4\n\n---\n\n",
    );

    interactions = [
      { id: "cancelled-3", status: "cancelled" },
      interactions[1],
    ];
    expect(await readout!.execute({})).toBe("");

    interactions = [
      {
        id: "resolution-4",
        status: "resolved",
        resolution: {
          effective_changes: [
            {
              entity_id: "uncontrolled",
              mechanic_id: "resolve",
              before: { kind: "number", value: "2" },
              after: { kind: "number", value: "1" },
            },
          ],
          applications: [],
        },
      },
    ];
    expect(await readout!.execute({})).toBe("");

    interactions = [];
    useMarkdownSensitiveNames = true;
    expect(await readout!.execute({})).toBe(
      "**Aria \\&copy; \\~\\~Scout\\~\\~**\n\n- **Resolve:** 4\n- **Vigilance:** true\n- **Supply:** 2\n- **Statuses:** Shaken \\&copy; \\~\\~hard\\~\\~ ×2\n\n---\n\n",
    );
    expect(changedCount).toBe(0);
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
      next_step: string;
    };

    expect(payload.presented_interaction.id).toBe("interaction-1");
    expect(payload.presented_interaction.context_entity_ids).toEqual(["ash"]);
    expect(payload.next_step).toContain(
      "If read_gameplay_readout returned non-empty text",
    );
    expect(payload.next_step).toContain("copy that text verbatim first");
    expect(payload.next_step).toContain(
      "otherwise add nothing before the narrative",
    );
    expect(payload.next_step).toContain(
      "presented_interaction.prompt unchanged as the scene",
    );
    expect(payload.next_step).toContain("without saying it was saved");
  });

  test("records only the explicit player Action represented by its input", async () => {
    let submittedBody: unknown;
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        if (path === "/api/worlds/world-1/interactions")
          return Promise.resolve(
            Response.json([
              {
                id: "problem-1",
                revision: 6,
                status: "open",
                facilitator_source: "agent",
              },
            ]),
          );
        if (path === "/api/worlds/world-1/interactions/problem-1/actions") {
          if (typeof init?.body === "string")
            submittedBody = JSON.parse(init.body) as unknown;
          return Promise.resolve(
            Response.json({ id: "action-1", text: "I bar the gate." }),
          );
        }
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    const submit = createAgentPlayTools(
      "world-1",
      () => undefined,
      new AbortController().signal,
    ).find((tool) => tool.name === "submit_action");

    const payload = (await submit?.execute({
      text: "I bar the gate.",
      acting_entity_id: "ash",
    })) as {
      submitted_action: { id: string };
      next_step: string;
    };

    expect(submittedBody).toEqual({
      text: "I bar the gate.",
      acting_entity_id: "ash",
      expected_revision: 6,
    });
    expect(payload.submitted_action.id).toBe("action-1");
    expect(payload.next_step).toContain(
      "Never submit another Action until the player explicitly states or delegates it",
    );
    expect(payload.next_step).toContain("Do not announce Action submission");
  });

  test("preserves the saved Consequence while directing a refreshed gameplay readout", async () => {
    let submittedBody: unknown;
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        if (path === "/api/worlds/world-1/interactions")
          return Promise.resolve(
            Response.json([
              {
                id: "problem-1",
                revision: 6,
                status: "open",
                facilitator_source: "agent",
              },
            ]),
          );
        if (path === "/api/worlds/world-1/mechanics")
          return Promise.resolve(Response.json({ revision: 3, mechanics: [] }));
        if (
          path === "/api/worlds/world-1/interactions/problem-1/agent/resolve"
        ) {
          if (typeof init?.body === "string")
            submittedBody = JSON.parse(init.body) as unknown;
          return Promise.resolve(
            Response.json({
              interaction_id: "problem-1",
              interaction_revision: 7,
              rules_revision: 3,
              narrative: "The gate gives, one hinge at a time.",
              applications: [],
              effective_changes: [],
              entity_sheets: {},
            }),
          );
        }
        return Promise.resolve(Response.json({}, { status: 404 }));
      },
      { preconnect: originalFetch.preconnect },
    );
    const resolve = createAgentPlayTools(
      "world-1",
      () => undefined,
      new AbortController().signal,
    ).find((tool) => tool.name === "resolve_problem");

    const payload = (await resolve?.execute({
      narrative: "The gate gives, one hinge at a time.",
      effects: [],
    })) as {
      resolution: { narrative: string; effective_changes: unknown[] };
      next_step: string;
    };

    expect(submittedBody).toMatchObject({
      narrative: "The gate gives, one hinge at a time.",
      effects: [],
    });
    expect(JSON.stringify(submittedBody)).not.toContain(
      "read_gameplay_readout",
    );
    expect(JSON.stringify(submittedBody)).not.toContain("---");
    expect(payload.resolution.narrative).toBe(
      "The gate gives, one hinge at a time.",
    );
    expect(payload.resolution.effective_changes).toEqual([]);
    expect(payload.next_step).toContain("Read Play again");
    expect(payload.next_step).toContain(
      "call read_gameplay_readout exactly once",
    );
    expect(payload.next_step).toContain(
      "If the readout is non-empty, copy it verbatim",
    );
    expect(payload.next_step).toContain("if it is empty, add nothing");
    expect(payload.next_step).toContain("resolution.narrative unchanged");
    expect(payload.next_step).toContain("narrative portion");
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

    await registerSiteTools(
      modelContext,
      [failingTool],
      registrationController.signal,
      playRecovery,
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

    await registerSiteTools(
      modelContext,
      [inspect!],
      controller.signal,
      playRecovery,
    );
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
