import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import {
  acceptNextDialog,
  createDerivedMechanic,
  createEntity,
  createInputMechanic,
  createOpenInteraction,
  createActor,
  createWorld,
  dismissNextDialog,
  disposeAuthenticatedActors,
  joinWorld,
  openAuthenticated,
  postJSON,
  type Interaction,
} from "./support";

test.afterEach(async () => disposeAuthenticatedActors());

test("UI boundaries: stale settings, dirty drafts, and mechanic archive order recover visibly", async ({
  browser,
  page: ownerPage,
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const labels = {
    owner: `Lifecycle Owner ${unique}`,
    editor: `Lifecycle Editor ${unique}`,
    world: `Lifecycle Weald ${unique}`,
    independent: `Independent Reserve ${unique}`,
    base: `Foundation Score ${unique}`,
    derived: `Dependent Score ${unique}`,
    entity: `Archive Witness ${unique}`,
    history: `A retained ruling ${unique}`,
  };
  const editorContext = await browser.newContext({ reducedMotion: "reduce" });
  const editorPage = await editorContext.newPage();

  try {
    const [owner, editor] = await Promise.all([
      createActor(request, baseURL, labels.owner),
      createActor(request, baseURL, labels.editor),
    ]);
    const world = await createWorld(request, baseURL, owner.id, labels.world);
    await joinWorld(request, baseURL, world.id, owner.id, editor.id, "editor");
    const independent = await createInputMechanic(
      request,
      baseURL,
      world.id,
      owner.id,
      labels.independent,
      world.rules_revision,
    );
    const base = await createInputMechanic(
      request,
      baseURL,
      world.id,
      owner.id,
      labels.base,
      independent.revision,
    );
    const derived = await createDerivedMechanic(
      request,
      baseURL,
      world.id,
      owner.id,
      labels.derived,
      base.mechanic.id,
      base.revision,
    );
    const entity = await createEntity(
      request,
      baseURL,
      world.id,
      owner.id,
      labels.entity,
    );
    const open = await createOpenInteraction(
      request,
      baseURL,
      world.id,
      owner.id,
      `Archived values stay legible ${unique}`,
      [],
      [entity.id],
    );
    const adjudicating = await postJSON<Interaction>(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/adjudicate`,
      { expected_revision: open.revision },
      owner.id,
    );
    await postJSON(
      request,
      `${baseURL}/api/worlds/${world.id}/interactions/${open.id}/resolve`,
      {
        expected_revision: adjudicating.revision,
        expected_rules_revision: derived.revision,
        idempotency_key: randomUUID(),
        narrative: labels.history,
        effects: [
          {
            id: randomUUID(),
            type: "adjust-number",
            entity_ids: [entity.id],
            mechanic_id: independent.mechanic.id,
            amount: 1,
          },
        ],
      },
      owner.id,
    );

    await Promise.all([
      openAuthenticated(
        ownerPage,
        baseURL,
        `/build/${world.id}/settings`,
        owner,
      ),
      openAuthenticated(
        editorPage,
        baseURL,
        `/build/${world.id}/settings`,
        editor,
      ),
    ]);

    await test.step("CCY-V01/stale-world-details-recovery", async () => {
      await ownerPage
        .getByLabel("Description")
        .fill(`Owner stale description ${unique}`);
      const editorDescription = `Editor winning description ${unique}`;
      await editorPage.getByLabel("Description").fill(editorDescription);
      await editorPage.getByRole("button", { name: "Save details" }).click();
      await expect(editorPage.getByText("Up to date")).toBeVisible();

      await ownerPage.getByRole("button", { name: "Save details" }).click();
      await expect(ownerPage.getByRole("alert")).toContainText(
        /revision|changed|stale/i,
      );
      acceptNextDialog(ownerPage);
      await ownerPage.locator(".world-identity > button").click();
      const worldCard = ownerPage.locator(".world-card").filter({
        hasText: labels.world,
      });
      await worldCard.getByRole("button", { name: /Open builder/ }).click();
      await ownerPage.getByRole("button", { name: /Settings/ }).click();
      await expect(ownerPage.getByLabel("Description")).toHaveValue(
        editorDescription,
      );

      const retriedDescription = `Owner intentional retry ${unique}`;
      await ownerPage.getByLabel("Description").fill(retriedDescription);
      await ownerPage.getByRole("button", { name: "Save details" }).click();
      await expect(ownerPage.getByText("Up to date")).toBeVisible();
      await expect(ownerPage.getByLabel("Description")).toHaveValue(
        retriedDescription,
      );
    });

    await test.step("NAV-003/dirty-draft-save-and-discard", async () => {
      await ownerPage.goto(
        `${baseURL}/build/${world.id}/capacities/${independent.mechanic.id}`,
      );
      const savedName = `${labels.independent} revised`;
      await ownerPage.getByLabel("Name").fill(savedName);
      await expect(ownerPage.getByText("Unsaved changes")).toBeVisible();

      dismissNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: /Settings/ }).click();
      await expect(ownerPage.getByLabel("Name")).toHaveValue(savedName);
      await ownerPage.getByRole("button", { name: "Save changes" }).click();
      await expect(ownerPage.getByText("All changes saved")).toBeVisible();

      await ownerPage.getByRole("button", { name: /Settings/ }).click();
      await ownerPage.getByRole("button", { name: /Capacities/ }).click();
      await ownerPage
        .getByRole("button", { name: new RegExp(savedName) })
        .click();
      await expect(ownerPage.getByLabel("Name")).toHaveValue(savedName);

      await ownerPage
        .getByLabel("Description")
        .fill(`This text must be discarded ${unique}`);

      dismissNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: "Return home" }).click();
      await expect(ownerPage).toHaveURL(
        new RegExp(`/build/${world.id}/capacities/${independent.mechanic.id}$`),
      );
      await expect(ownerPage.getByLabel("Description")).toHaveValue(
        `This text must be discarded ${unique}`,
      );

      dismissNextDialog(ownerPage);
      await ownerPage
        .locator(".world-identity > button", { hasText: "Builder worlds" })
        .click();
      await expect(ownerPage).toHaveURL(
        new RegExp(`/build/${world.id}/capacities/${independent.mechanic.id}$`),
      );
      await expect(ownerPage.getByLabel("Description")).toHaveValue(
        `This text must be discarded ${unique}`,
      );

      dismissNextDialog(ownerPage);
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await ownerPage.getByRole("button", { name: "Builder worlds" }).click();
      await expect(ownerPage).toHaveURL(
        new RegExp(`/build/${world.id}/capacities/${independent.mechanic.id}$`),
      );
      await expect(ownerPage.getByLabel("Description")).toHaveValue(
        `This text must be discarded ${unique}`,
      );
      await ownerPage.setViewportSize({ width: 1280, height: 720 });

      dismissNextDialog(ownerPage);
      await ownerPage
        .getByRole("button", { name: new RegExp(labels.base) })
        .click();
      await expect(ownerPage).toHaveURL(
        new RegExp(`/build/${world.id}/capacities/${independent.mechanic.id}$`),
      );
      await expect(ownerPage.getByLabel("Description")).toHaveValue(
        `This text must be discarded ${unique}`,
      );

      acceptNextDialog(ownerPage);
      await ownerPage
        .getByRole("button", { name: new RegExp(labels.base) })
        .click();
      await expect(ownerPage).toHaveURL(
        new RegExp(`/build/${world.id}/capacities/${base.mechanic.id}$`),
      );
      await ownerPage
        .getByRole("button", { name: new RegExp(savedName) })
        .click();
      await expect(ownerPage.getByLabel("Description")).not.toHaveValue(
        `This text must be discarded ${unique}`,
      );
    });

    await test.step("LFC-002/archive-dependency-chain-in-safe-order", async () => {
      await ownerPage.goto(
        `${baseURL}/build/${world.id}/capacities/${base.mechanic.id}`,
      );
      acceptNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: "Archive capacity" }).click();
      await expect(ownerPage.getByRole("alert")).toContainText(/depend/i);
      await expect(
        ownerPage.getByText("Archived", { exact: true }),
      ).toHaveCount(0);

      await ownerPage.goto(
        `${baseURL}/build/${world.id}/capacities/${derived.mechanic.id}`,
      );
      acceptNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: "Archive capacity" }).click();
      await expect(
        ownerPage.getByText("Archived", { exact: true }),
      ).toBeVisible();

      await ownerPage.goto(
        `${baseURL}/build/${world.id}/capacities/${base.mechanic.id}`,
      );
      acceptNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: "Archive capacity" }).click();
      await expect(
        ownerPage.getByText("Archived", { exact: true }),
      ).toBeVisible();
    });

    await test.step("LFC-001/archive-independent-mechanic-retains-history", async () => {
      await ownerPage.goto(
        `${baseURL}/build/${world.id}/capacities/${independent.mechanic.id}`,
      );
      acceptNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: "Archive capacity" }).click();
      await expect(
        ownerPage.getByText("Archived", { exact: true }),
      ).toBeVisible();

      await ownerPage.goto(`${baseURL}/build/${world.id}/roster`);
      await ownerPage
        .getByRole("button", { name: new RegExp(labels.entity) })
        .click();
      await ownerPage.getByRole("tab", { name: "Sheet" }).click();
      await expect(ownerPage.getByLabel(labels.independent)).toHaveCount(0);

      await ownerPage.goto(`${baseURL}/play/${world.id}`);
      await expect(ownerPage.getByText(labels.history)).toBeVisible();
      await expect(
        ownerPage.locator(".history-card").filter({ hasText: labels.history }),
      ).toContainText(labels.independent);
    });
  } finally {
    await editorContext.close();
  }
});
