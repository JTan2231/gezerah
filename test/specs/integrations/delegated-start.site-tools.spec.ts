import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import {
  authenticateBrowserContext,
  disposeAuthenticatedActors,
  signupActor,
} from "../support/auth";

test.afterEach(async () => disposeAuthenticatedActors());

interface SiteToolHarness {
  names(): string[];
  invoke(name: string, input: unknown): Promise<unknown>;
  trustedControlClicks(): string[];
}

interface WorldTemplateInspection {
  world_templates: Array<{
    id: string;
    name: string;
    description: string;
    setting: string;
    character_count: number;
  }>;
  next_step: string;
}

interface CopiedWorldResult {
  copied_world: {
    id: string;
    name: string;
    facilitator_source: "agent";
    current_play_role: "player";
    play_status: "waiting-for-character";
  };
  next_step: string;
}

interface AvailableEntity {
  id: string;
  display_name: string;
  profile_summary?: string;
}

interface Interaction {
  id: string;
  title?: string;
  prompt: string;
  status: "open" | "adjudicating" | "resolved" | "cancelled";
  actions: Array<{ id: string; text: string; status: string }>;
}

interface PlayInspection {
  viewer: {
    current_play_role: "player";
    play_status: "waiting-for-character" | "ready";
    controlled_entity_ids: string[];
  };
  available_entities?: AvailableEntity[];
  entities?: Array<{ id: string; name: string }>;
  active_interaction?: Interaction;
  recent_history?: Interaction[];
  next_step: string;
}

interface ClaimedCharacterResult {
  claimed_character: AvailableEntity;
  play_status: "ready";
}

interface PresentedProblemResult {
  presented_interaction: Interaction;
  next_step: string;
}

interface SubmittedActionResult {
  submitted_action: {
    id: string;
    text: string;
    status: "submitted";
  };
  next_step: string;
}

interface ResolvedProblemResult {
  resolution: {
    interaction_id: string;
    narrative: string;
  };
  next_step: string;
}

interface PlayHandbookResult {
  handbook: {
    topic: string;
    sections: Array<{ topic: string; guidance: string }>;
  };
}

test("browser/page integration: delegated-start site-tool surfaces continue through a resolved Problem and the next active Problem without setup clicks", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const run = randomUUID().slice(0, 8);
  const actor = await signupActor(baseURL, `Delegated Player ${run}`);
  await authenticateBrowserContext(page.context(), actor);
  await installSiteToolHarness(page);

  let additionalPageCount = 0;
  page.context().on("page", (candidate) => {
    if (candidate !== page) additionalPageCount += 1;
  });

  await page.goto(`${baseURL}/play/new`);
  await expect(
    page.getByRole("heading", { name: "Starting with ChatGPT" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Start site-tool surface is ready/i),
  ).toBeVisible();
  await waitForSiteTools(page, [
    "inspect_world_templates",
    "copy_world_template",
  ]);

  const templates = await invokeSiteTool<WorldTemplateInspection>(
    page,
    "inspect_world_templates",
    {},
  );
  expect(templates.world_templates).toHaveLength(3);
  expect(templates.next_step).toMatch(/do not ask|without asking/i);
  expect(templates.next_step).not.toMatch(
    /ask the (?:current )?player which|take control|click/i,
  );
  const selectedTemplate = templates.world_templates.find(
    ({ id }) => id === "terms-of-the-city",
  );
  expect(selectedTemplate).toBeDefined();
  await expect(page.getByRole("button", { name: "Copy and play" })).toHaveCount(
    0,
  );

  const copied = await invokeSiteTool<CopiedWorldResult>(
    page,
    "copy_world_template",
    { template_id: selectedTemplate!.id },
  );
  expect(copied.copied_world).toMatchObject({
    name: selectedTemplate!.name,
    facilitator_source: "agent",
    current_play_role: "player",
    play_status: "waiting-for-character",
  });
  await expect(page).toHaveURL(`${baseURL}/play/${copied.copied_world.id}`);
  expect(additionalPageCount).toBe(0);
  expect(page.context().pages()).toHaveLength(1);
  expect(page.context().pages()[0]).toBe(page);

  await waitForSiteTools(page, [
    "read_play_handbook",
    "inspect_play",
    "claim_entity",
    "present_problem",
    "submit_action",
    "resolve_problem",
  ]);
  await expect(
    page.getByText(/Play site-tool surface is ready/i),
  ).toBeVisible();
  const playToolNames = await registeredSiteToolNames(page);
  expect(playToolNames).not.toContain("inspect_world_templates");
  expect(playToolNames).not.toContain("copy_world_template");

  const handbook = await invokeSiteTool<PlayHandbookResult>(
    page,
    "read_play_handbook",
    { topic: "narrative-presentation" },
  );
  expect(handbook.handbook).toMatchObject({
    topic: "narrative-presentation",
    sections: [{ topic: "narrative-presentation" }],
  });
  expect(handbook.handbook.sections[0]?.guidance).toMatch(
    /same public Problem and Consequence words/i,
  );
  expect(handbook.handbook.sections[0]?.guidance).toMatch(/prose guide/i);
  expect(handbook.handbook.sections[0]?.guidance).toMatch(/100 to 140 words/i);
  expect(handbook.handbook.sections[0]?.guidance).toMatch(
    /combined passage, not each saved part/i,
  );

  const waiting = await invokeSiteTool<PlayInspection>(
    page,
    "inspect_play",
    {},
  );
  expect(waiting.viewer).toMatchObject({
    current_play_role: "player",
    play_status: "waiting-for-character",
    controlled_entity_ids: [],
  });
  expect(waiting.available_entities).toHaveLength(5);
  expect(waiting.next_step).toMatch(/do not ask|without asking/i);
  expect(waiting.next_step).not.toMatch(
    /ask the (?:current )?player which|take control|click/i,
  );
  const selectedCharacter = waiting.available_entities?.[0];
  expect(selectedCharacter).toBeDefined();
  await expect(page.getByRole("button", { name: /^Play as / })).toHaveCount(0);

  const claimed = await invokeSiteTool<ClaimedCharacterResult>(
    page,
    "claim_entity",
    { entity_id: selectedCharacter!.id },
  );
  expect(claimed).toMatchObject({
    claimed_character: { id: selectedCharacter!.id },
    play_status: "ready",
  });

  const ready = await invokeSiteTool<PlayInspection>(page, "inspect_play", {});
  expect(ready.viewer).toMatchObject({
    current_play_role: "player",
    play_status: "ready",
    controlled_entity_ids: [selectedCharacter!.id],
  });
  expect(ready.entities?.map(({ id }) => id)).toContain(selectedCharacter!.id);

  const firstProblem = {
    title: `The delayed sentence ${run}`,
    prompt: `Three signs repeat a sentence meant for no one ${run}. What do you do?`,
  };
  const presented = await invokeSiteTool<PresentedProblemResult>(
    page,
    "present_problem",
    firstProblem,
  );
  expect(presented.presented_interaction).toMatchObject({
    title: firstProblem.title,
    prompt: firstProblem.prompt,
    status: "open",
  });
  expect(presented.next_step).toMatch(/directly as the scene/i);
  expect(presented.next_step).not.toMatch(/problem (?:created|presented)/i);
  await expect(page.getByText(firstProblem.prompt)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "What do you do?" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit action" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Pass" })).toHaveCount(0);

  const actionText = `I copy the exact wording and compare the signs ${run}.`;
  const submitted = await invokeSiteTool<SubmittedActionResult>(
    page,
    "submit_action",
    {
      text: actionText,
      acting_entity_id: selectedCharacter!.id,
    },
  );
  expect(submitted.submitted_action).toMatchObject({
    text: actionText,
    status: "submitted",
  });
  expect(submitted.next_step).toMatch(/do not announce action submission/i);

  const resolutionNarrative = `The copied lines differ by one time stamp, narrowing what can be tested ${run}.`;
  const resolved = await invokeSiteTool<ResolvedProblemResult>(
    page,
    "resolve_problem",
    {
      selected_action_id: submitted.submitted_action.id,
      action_summary: actionText,
      narrative: resolutionNarrative,
      effects: [],
    },
  );
  expect(resolved.resolution).toMatchObject({
    interaction_id: presented.presented_interaction.id,
    narrative: resolutionNarrative,
  });
  expect(resolved.next_step).toMatch(/directly as the Consequence/i);
  expect(resolved.next_step).toMatch(
    /without an approval recap|report about the operation/i,
  );

  const secondProblem = {
    title: `The corrected clock ${run}`,
    prompt: `One corrected display now shows tomorrow's time ${run}. What do you do?`,
  };
  const continued = await invokeSiteTool<PresentedProblemResult>(
    page,
    "present_problem",
    secondProblem,
  );
  expect(continued.presented_interaction).toMatchObject({
    title: secondProblem.title,
    prompt: secondProblem.prompt,
    status: "open",
  });

  const controlClicksBeforeReload = await trustedControlClicks(page);
  expect(controlClicksBeforeReload).toEqual([]);

  await page.reload();
  await waitForSiteTools(page, ["inspect_play"]);
  const durable = await invokeSiteTool<PlayInspection>(
    page,
    "inspect_play",
    {},
  );
  expect(durable.viewer).toMatchObject({
    current_play_role: "player",
    play_status: "ready",
    controlled_entity_ids: [selectedCharacter!.id],
  });
  expect(durable.active_interaction).toMatchObject({
    id: continued.presented_interaction.id,
    title: secondProblem.title,
    prompt: secondProblem.prompt,
    status: "open",
  });
  expect(durable.recent_history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: presented.presented_interaction.id,
        status: "resolved",
      }),
    ]),
  );
  await expect(page.getByText(secondProblem.prompt)).toBeVisible();
  expect(await trustedControlClicks(page)).toEqual([]);
  expect(additionalPageCount).toBe(0);
});

async function installSiteToolHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type RegisteredTool = {
      readonly name: string;
      execute(input: unknown): Promise<unknown>;
    };
    type Registration = {
      readonly tool: RegisteredTool;
      readonly signal?: AbortSignal;
    };
    type HarnessWindow = Window & {
      __wroughtSiteToolHarness?: {
        names(): string[];
        invoke(name: string, input: unknown): Promise<unknown>;
        trustedControlClicks(): string[];
      };
    };

    const registrations = new Map<string, Registration>();
    const controlClicks: string[] = [];
    const modelContext = {
      registerTool(
        tool: RegisteredTool,
        options?: { signal?: AbortSignal },
      ): void {
        const registration: Registration = {
          tool,
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        };
        registrations.set(tool.name, registration);
        options?.signal?.addEventListener(
          "abort",
          () => {
            if (registrations.get(tool.name) === registration) {
              registrations.delete(tool.name);
            }
          },
          { once: true },
        );
      },
    };

    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });
    document.addEventListener(
      "click",
      (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const control = event.target.closest("button, a");
        if (control === null) return;
        const label = (
          control.getAttribute("aria-label") ??
          control.textContent ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        controlClicks.push(label);
      },
      true,
    );

    const harness: SiteToolHarness = {
      names: () => [...registrations.keys()].sort(),
      invoke: async (name, input) => {
        const registration = registrations.get(name);
        if (registration === undefined) {
          throw new Error(`site tool ${name} is not registered`);
        }
        return registration.tool.execute(input);
      },
      trustedControlClicks: () => [...controlClicks],
    };
    (window as HarnessWindow).__wroughtSiteToolHarness = harness;
  });
}

async function waitForSiteTools(
  page: Page,
  expectedNames: readonly string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const names = await registeredSiteToolNames(page);
      return expectedNames.every((name) => names.includes(name));
    })
    .toBe(true);
}

async function registeredSiteToolNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const harness = (
      window as Window & { __wroughtSiteToolHarness?: SiteToolHarness }
    ).__wroughtSiteToolHarness;
    if (harness === undefined) return [];
    return harness.names();
  });
}

async function invokeSiteTool<T>(
  page: Page,
  name: string,
  input: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const harness = (
        window as Window & { __wroughtSiteToolHarness?: SiteToolHarness }
      ).__wroughtSiteToolHarness;
      if (harness === undefined) {
        throw new Error("site-tool harness is unavailable");
      }
      return harness.invoke(toolName, toolInput);
    },
    { toolName: name, toolInput: input },
  ) as Promise<T>;
}

async function trustedControlClicks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const harness = (
      window as Window & { __wroughtSiteToolHarness?: SiteToolHarness }
    ).__wroughtSiteToolHarness;
    if (harness === undefined) {
      throw new Error("site-tool harness is unavailable");
    }
    return harness.trustedControlClicks();
  });
}
