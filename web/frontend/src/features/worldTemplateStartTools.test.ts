import { afterEach, describe, expect, test } from "bun:test";

import { createWorldTemplateStartTools } from "./worldTemplateStartTools";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const templates = [
  {
    id: "eldermead",
    name: "Banners at Eldermead",
    description: "War closes around a village.",
    prose_guide: "Tell the village through work, weather, and obligation.",
    setting: "Medieval fantasy",
    character_count: 5,
  },
  {
    id: "courtesy-season",
    name: "The Courtesy Season",
    description: "Perfect comfort exposes its costs.",
    prose_guide: "Tell Bellwether in cool, exact prose.",
    setting: "Cyberpunk future",
    character_count: 5,
  },
  {
    id: "terms-of-the-city",
    name: "Terms of the City",
    description: "New York words begin to rhyme.",
    prose_guide: "Tell New York with alert, unsentimental precision.",
    setting: "New York today",
    character_count: 5,
  },
];

describe("delegated Start tools", () => {
  test("exposes the complete catalog for one-preference recommendation", async () => {
    globalThis.fetch = Object.assign(
      () => Promise.resolve(Response.json(templates)),
      { preconnect: originalFetch.preconnect },
    );
    const tools = createWorldTemplateStartTools(
      () => undefined,
      new AbortController().signal,
    );

    expect(tools.map(({ name }) => name)).toEqual([
      "inspect_world_templates",
      "copy_world_template",
    ]);
    expect(tools[0]?.description).toContain("single stated play preference");
    expect(tools[0]?.description).toContain("tone");
    expect(tools[0]?.description).toContain("without asking setup questions");
    const result = (await tools[0]?.execute({})) as {
      world_templates: typeof templates;
      next_step: string;
    };
    expect(result.world_templates).toEqual(templates);
    expect(result.world_templates[1]?.prose_guide).toBe(
      "Tell Bellwether in cool, exact prose.",
    );
    expect(result.next_step).toContain("prose guides");
    expect(result.next_step).toContain("Recommend the best match");
    expect(result.next_step).toContain("Do not ask another setup question");
  });

  test("copies idempotently and navigates the attached tab to Play", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    globalThis.fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const requestURL =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(requestURL, "https://play.example").pathname;
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined;
        requests.push({ path, body });
        if (path === "/wrought/api/world-templates")
          return Promise.resolve(Response.json(templates));
        return Promise.resolve(
          Response.json({
            id: "world-copy",
            name: "Banners at Eldermead",
            description: "War closes around a village.",
            prose_guide:
              "Tell the village through work, weather, and obligation.",
            status: "active",
            facilitator: { source: "agent" },
            current_play_role: "player",
            play_status: "waiting-for-character",
          }),
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    const navigations: Array<[string, { replace?: boolean } | undefined]> = [];
    const tools = createWorldTemplateStartTools(
      (href, options) => navigations.push([href, options]),
      new AbortController().signal,
    );
    const copy = tools.find(({ name }) => name === "copy_world_template");

    const first = (await copy?.execute({ template_id: "eldermead" })) as {
      copied_world: {
        id: string;
        name: string;
        description: string;
        prose_guide: string;
        status: string;
        facilitator_source: string;
        current_play_role: string;
        play_status: string;
      };
      next_step: string;
    };
    await copy?.execute({ template_id: "eldermead" });

    const cloneBodies = requests
      .filter(({ path }) => path.endsWith("/clone"))
      .map(({ body }) => body as { id: string });
    expect(cloneBodies).toHaveLength(2);
    expect(cloneBodies[0]?.id).toBeString();
    expect(cloneBodies[1]?.id).toBe(cloneBodies[0]?.id);
    expect(first.copied_world).toEqual({
      id: "world-copy",
      name: "Banners at Eldermead",
      description: "War closes around a village.",
      prose_guide: "Tell the village through work, weather, and obligation.",
      status: "active",
      facilitator_source: "agent",
      current_play_role: "player",
      play_status: "waiting-for-character",
    });
    expect(first.next_step).toContain("choose and claim");
    expect(first.next_step).toContain("Never invent or submit an Action");
    expect(navigations).toEqual([
      ["/wrought/play/world-copy", { replace: true }],
      ["/wrought/play/world-copy", { replace: true }],
    ]);
  });
});
