import { describe, expect, test } from "bun:test";

import { completeSiteToolRegistration, registerSiteTools } from "./siteTools";

describe("site-tool registration", () => {
  test("keeps registered handlers closed until the complete surface is ready", async () => {
    const controller = new AbortController();
    const registered = new Map<string, ModelContextTool>();
    let finishSecondRegistration: (() => void) | undefined;
    const secondRegistration = new Promise<void>((resolve) => {
      finishSecondRegistration = resolve;
    });
    const modelContext: ModelContext = {
      registerTool: (tool) => {
        registered.set(tool.name, tool);
        return tool.name === "second_tool"
          ? secondRegistration
          : Promise.resolve();
      },
    };
    const tools: ModelContextTool[] = ["first_tool", "second_tool"].map(
      (name) => ({
        name,
        description: "Fixture tool",
        inputSchema: { type: "object" },
        execute: () => Promise.resolve({ ok: true }),
      }),
    );

    const registration = registerSiteTools(
      modelContext,
      tools,
      controller.signal,
      "Reinspect this page and retry.",
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(await registered.get("first_tool")?.execute({})).toEqual({
      ok: false,
      error: {
        code: "tool_usage_error",
        message: "The complete site-tool surface is not ready.",
      },
      next_step: "Reinspect this page and retry.",
    });

    finishSecondRegistration?.();
    const result = await registration;
    expect(completeSiteToolRegistration(controller, result, 2)?.status).toBe(
      "ready",
    );
    expect(await registered.get("first_tool")?.execute({})).toEqual({
      ok: true,
    });
  });

  test("fails closed and aborts a partial surface", async () => {
    const controller = new AbortController();
    const registeredSignals: AbortSignal[] = [];
    const modelContext: ModelContext = {
      registerTool: (tool, options) => {
        if (tool.name === "second_tool") throw new Error("unsupported tool");
        if (options?.signal !== undefined)
          registeredSignals.push(options.signal);
      },
    };
    const tools: ModelContextTool[] = ["first_tool", "second_tool"].map(
      (name) => ({
        name,
        description: "Fixture tool",
        inputSchema: { type: "object" },
        execute: () => Promise.resolve({ ok: true }),
      }),
    );

    const result = await registerSiteTools(
      modelContext,
      tools,
      controller.signal,
      "Reinspect this page and retry.",
    );
    const state = completeSiteToolRegistration(controller, result, 2);

    expect(state).toEqual({
      status: "failed",
      registeredToolNames: ["first_tool"],
      failedToolNames: ["second_tool"],
    });
    expect(controller.signal.aborted).toBe(true);
    expect(registeredSignals[0]?.aborted).toBe(true);
  });

  test("reports ready only when the complete surface registers", async () => {
    const controller = new AbortController();
    const modelContext: ModelContext = {
      registerTool: () => undefined,
    };
    const tool: ModelContextTool = {
      name: "only_tool",
      description: "Fixture tool",
      inputSchema: { type: "object" },
      execute: () => Promise.resolve({ ok: true }),
    };

    const result = await registerSiteTools(
      modelContext,
      [tool],
      controller.signal,
      "Reinspect this page and retry.",
    );
    const state = completeSiteToolRegistration(controller, result, 1);

    expect(state?.status).toBe("ready");
    expect(controller.signal.aborted).toBe(false);
  });
});
