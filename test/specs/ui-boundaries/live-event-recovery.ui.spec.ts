import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import {
  createEntity,
  createOpenInteraction,
  createActor,
  createWorld,
  disposeAuthenticatedActors,
  joinWorld,
  openAuthenticated,
  postJSON,
  type Interaction,
} from "./support";

test.afterEach(async () => disposeAuthenticatedActors());

test("UI boundaries: interrupted live events resume from the cursor without duplicate history", async ({
  page,
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createActor(
    request,
    baseURL,
    `Reconnect Owner ${unique}`,
  );
  const player = await createActor(
    request,
    baseURL,
    `Reconnect Player ${unique}`,
  );
  const world = await createWorld(
    request,
    baseURL,
    owner.id,
    `Reconnect Reach ${unique}`,
  );
  const membership = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    player.id,
    "player",
  );
  const entity = await createEntity(
    request,
    baseURL,
    world.id,
    owner.id,
    `Reconnect Courier ${unique}`,
    [membership.membership_id],
  );
  const prompt = `The missed bell rings ${unique}`;
  const interaction = await createOpenInteraction(
    request,
    baseURL,
    world.id,
    owner.id,
    prompt,
    [membership.membership_id],
    [entity.id],
  );

  const eventPattern = new RegExp(
    `/wrought/api/worlds/${world.id}/events(?:\\?.*)?$`,
  );
  let attempt = 0;
  let firstStreamObserved: (() => void) | undefined;
  let reconnectObserved: ((url: string) => void) | undefined;
  const firstStream = new Promise<void>((resolve) => {
    firstStreamObserved = resolve;
  });
  const reconnect = new Promise<string>((resolve) => {
    reconnectObserved = resolve;
  });
  await page.route(eventPattern, async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'retry: 10\nid: 0\ndata: {"type":"fixture-baseline"}\n\n',
      });
      firstStreamObserved?.();
      return;
    }
    reconnectObserved?.(route.request().url());
    await route.continue();
  });

  await test.step("NAV-V02/event-stream-interruption", async () => {
    await openAuthenticated(page, baseURL, `/wrought/play/${world.id}`, player);
    await firstStream;
    await expect(page.getByText(prompt)).toBeVisible();
    await postJSON<Interaction>(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}/interactions/${interaction.id}/cancel`,
      { expected_revision: interaction.revision },
      owner.id,
    );
  });

  await test.step("NAV-007/reconnect-from-cursor-and-converge-once", async () => {
    const reconnectURL = new URL(await reconnect);
    expect(reconnectURL.searchParams.get("after")).toBe("0");
    await expect(
      page.getByRole("heading", { name: "No active problem" }),
    ).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(prompt)).toHaveCount(1);
    await expect(page.getByText("Cancelled", { exact: false })).toHaveCount(1);
  });
});
