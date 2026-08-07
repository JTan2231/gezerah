import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import {
  createEntity,
  createOpenInteraction,
  createUser,
  createWorld,
  joinWorld,
  openAs,
  postJSON,
  type Interaction,
} from "./support";

test("UI boundaries: interrupted live events resume from the cursor without duplicate history", async ({
  page,
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createUser(request, baseURL, `Reconnect Owner ${unique}`);
  const player = await createUser(
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

  const eventPattern = new RegExp(`/api/worlds/${world.id}/events(?:\\?.*)?$`);
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
    await openAs(page, baseURL, `/play/${world.id}`, player.display_name);
    await firstStream;
    await expect(page.getByText(prompt)).toBeVisible();
    await postJSON<Interaction>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${interaction.id}/cancel`,
      { expected_revision: interaction.revision },
      owner.id,
    );
  });

  await test.step("NAV-007/reconnect-from-cursor-and-converge-once", async () => {
    const reconnectURL = new URL(await reconnect);
    expect(reconnectURL.searchParams.get("after")).toBe("0");
    await expect(
      page.getByRole("heading", { name: "Waiting for the next problem." }),
    ).toBeVisible({ timeout: 4_000 });
    await expect(page.getByText(prompt)).toHaveCount(0);
    await expect(page.getByText("Cancelled")).toHaveCount(0);
  });
});
