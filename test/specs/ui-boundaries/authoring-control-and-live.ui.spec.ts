import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import {
  acceptNextDialog,
  createEntity,
  createInvite,
  createOpenInteraction,
  createUser,
  createWorld,
  getJSON,
  joinWorld,
  openAs,
  putCharacterFields,
  putProfile,
  readProfile,
  readWorld,
  replaceControllers,
  type CharacterFieldSet,
  type Entity,
} from "./support";

const NARROW_VIEWPORT = { width: 390, height: 844 } as const;

test("UI boundaries: authored profiles, shared control, live actions, and accessible recovery stay coherent", async ({
  browser,
  page: ownerPage,
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const labels = {
    owner: `Boundary Author ${unique}`,
    playerOne: `Boundary Player One ${unique}`,
    playerTwo: `Boundary Player Two ${unique}`,
    visitor: `Boundary Visitor ${unique}`,
    world: `Boundary Shoals ${unique}`,
    shared: `Shared Courier ${unique}`,
    solo: `Solo Courier ${unique}`,
    originalField: `Old Calling ${unique}`,
    firstField: `First Truth ${unique}`,
    revisedFirstField: `Revised Truth ${unique}`,
    secondField: `Second Truth ${unique}`,
    newField: `New Bond ${unique}`,
  };

  const actorContexts = await createNarrowContexts(browser, 3);
  const playerOneContext = required(
    actorContexts[0],
    "player one browser context",
  );
  const playerTwoContext = required(
    actorContexts[1],
    "player two browser context",
  );
  const visitorContext = required(actorContexts[2], "visitor browser context");
  const [playerOnePage, playerTwoPage, visitorPage] = await Promise.all([
    playerOneContext.newPage(),
    playerTwoContext.newPage(),
    visitorContext.newPage(),
  ]);
  await ownerPage.setViewportSize(NARROW_VIEWPORT);

  try {
    const [owner, playerOne, playerTwo, visitor] = await Promise.all([
      createUser(request, baseURL, labels.owner),
      createUser(request, baseURL, labels.playerOne),
      createUser(request, baseURL, labels.playerTwo),
      createUser(request, baseURL, labels.visitor),
    ]);
    const world = await createWorld(request, baseURL, owner.id, labels.world);
    const [playerOneMembership, playerTwoMembership] = await Promise.all([
      joinWorld(request, baseURL, world.id, owner.id, playerOne.id, "player"),
      joinWorld(request, baseURL, world.id, owner.id, playerTwo.id, "player"),
    ]);
    const initialFields = await putCharacterFields(
      request,
      baseURL,
      world.id,
      owner.id,
      0,
      [
        {
          label: labels.originalField,
          visibility: "table",
        },
      ],
    );
    const shared = await createEntity(
      request,
      baseURL,
      world.id,
      owner.id,
      labels.shared,
      [playerOneMembership.membership_id, playerTwoMembership.membership_id],
    );
    const originalField = required(
      initialFields.fields[0],
      "initial character field",
    );
    await putProfile(
      request,
      baseURL,
      world.id,
      shared.id,
      playerOne.id,
      await readProfile(request, baseURL, world.id, shared.id, playerOne.id),
      [{ field_id: originalField.id, value: `Original value ${unique}` }],
    );

    await Promise.all([
      openAs(
        ownerPage,
        baseURL,
        `/build/${world.id}/character-fields`,
        labels.owner,
      ),
      openAs(playerOnePage, baseURL, `/play/${world.id}`, labels.playerOne),
      openAs(playerTwoPage, baseURL, `/play/${world.id}`, labels.playerTwo),
    ]);

    await test.step("NAV-005/keyboard-semantic-core and GLO-010", async () => {
      await ownerPage.goto(`${baseURL}/build/${world.id}/character-fields`);
      await ownerPage.locator("body").press("Tab");
      await expect(ownerPage.locator(".skip-link")).toBeFocused();
      await ownerPage.keyboard.press("Enter");
      await expect(ownerPage.locator("#world-content")).toBeFocused();
      await expect(
        ownerPage.getByRole("heading", { name: "Character fields" }),
      ).toBeVisible();
      await expectNoHorizontalPageOverflow(ownerPage);
    });

    await test.step("CHF-001/zero-field-schema", async () => {
      await ownerPage.getByRole("button", { name: "Remove" }).click();
      acceptNextDialog(ownerPage);
      await ownerPage
        .getByRole("button", { name: "Publish requirements" })
        .click();
      await expect(ownerPage.getByText("0 required fields")).toBeVisible();
      await expect(
        ownerPage.getByText("Controlled entities are immediately ready"),
      ).toBeVisible();
      await expect(
        playerOnePage.getByRole("heading", {
          name: "Waiting for the next problem.",
        }),
      ).toBeVisible({ timeout: 4_000 });
    });

    const emptyFields = await getJSON<CharacterFieldSet>(
      request,
      `${baseURL}/api/worlds/${world.id}/character-fields`,
      owner.id,
    );
    const authoredFields = await putCharacterFields(
      request,
      baseURL,
      world.id,
      owner.id,
      emptyFields.revision,
      [
        { label: labels.firstField, visibility: "table" },
        {
          label: labels.secondField,
          visibility: "controllers-and-facilitators",
        },
      ],
    );
    const firstField = required(authoredFields.fields[0], "first field");
    const secondField = required(authoredFields.fields[1], "second field");
    const firstValue = `First value ${unique}`;
    const secondValue = `Second value ${unique}`;
    await putProfile(
      request,
      baseURL,
      world.id,
      shared.id,
      playerOne.id,
      await readProfile(request, baseURL, world.id, shared.id, playerOne.id),
      [
        { field_id: firstField.id, value: firstValue },
        { field_id: secondField.id, value: secondValue },
      ],
    );
    await Promise.all([
      ownerPage.goto(`${baseURL}/build/${world.id}/character-fields`),
      playerOnePage.goto(`${baseURL}/play/${world.id}`),
    ]);

    await test.step("CHF-003/reorder-preserves-field-identity", async () => {
      await ownerPage
        .getByLabel("Field label")
        .nth(0)
        .fill(labels.revisedFirstField);
      await ownerPage
        .getByRole("button", { name: "Move character field 2 up" })
        .click();
      await ownerPage
        .getByRole("button", { name: "Publish requirements" })
        .click();
      await expect(
        ownerPage.getByText("Published", { exact: true }),
      ).toBeVisible();

      await playerOnePage.goto(`${baseURL}/play/${world.id}`);
      await playerOnePage
        .getByRole("button", { name: new RegExp(labels.shared) })
        .click();
      await expect(playerOnePage.getByLabel(labels.secondField)).toHaveValue(
        secondValue,
      );
      await expect(
        playerOnePage.getByLabel(labels.revisedFirstField),
      ).toHaveValue(firstValue);
    });

    await test.step("CHF-004/add-requirement-regresses-readiness", async () => {
      await ownerPage
        .getByRole("button", { name: "Add required field" })
        .click();
      await ownerPage.getByLabel("Field label").last().fill(labels.newField);
      acceptNextDialog(ownerPage);
      await ownerPage
        .getByRole("button", { name: "Publish requirements" })
        .click();
      await expect(
        playerOnePage.getByText("Setup required").first(),
      ).toBeVisible({ timeout: 4_000 });
      await expect(playerOnePage.getByLabel(labels.secondField)).toHaveValue(
        secondValue,
      );
      await expect(
        playerOnePage.getByLabel(labels.revisedFirstField),
      ).toHaveValue(firstValue);
      await playerOnePage
        .getByLabel(labels.newField)
        .fill(`New value ${unique}`);
      await playerOnePage
        .getByRole("button", { name: "Save character" })
        .click();
      await expect(
        playerOnePage.getByRole("heading", {
          name: "Waiting for the next problem.",
        }),
      ).toBeVisible({ timeout: 4_000 });
    });

    await test.step("NAV-008 and NAV-V03/transient-resource-retry", async () => {
      await selectBuildSection(ownerPage, "settings");
      const characterFieldsURL = `${baseURL}/api/worlds/${world.id}/character-fields`;
      let failed = false;
      await ownerPage.route(characterFieldsURL, async (route) => {
        if (!failed) {
          failed = true;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "temporary_failure",
                message: "The character fields are temporarily unavailable.",
              },
            }),
          });
          return;
        }
        await route.continue();
      });
      await selectBuildSection(ownerPage, "character-fields");
      await expect(ownerPage.getByRole("alert")).toContainText(
        "temporarily unavailable",
      );
      await ownerPage.getByRole("button", { name: "Try again" }).click();
      await expect(
        ownerPage.getByRole("heading", { name: "Character fields" }),
      ).toBeVisible();
      await ownerPage.unroute(characterFieldsURL);
    });

    await test.step("NAV-006/obsolete-resource-response", async () => {
      const entities = await getJSON<Entity[]>(
        request,
        `${baseURL}/api/worlds/${world.id}/entities`,
        owner.id,
      );
      const entitiesURL = `${baseURL}/api/worlds/${world.id}/entities`;
      let releaseRoute: (() => void) | undefined;
      let observeRoute: ((route: Route) => void) | undefined;
      const intercepted = new Promise<Route>((resolve) => {
        observeRoute = resolve;
      });
      await ownerPage.route(entitiesURL, async (route) => {
        observeRoute?.(route);
        await new Promise<void>((resolve) => {
          releaseRoute = resolve;
        });
        await route
          .fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(entities),
          })
          .catch(() => undefined);
      });
      await selectBuildSection(ownerPage, "roster");
      await intercepted;
      await selectBuildSection(ownerPage, "settings");
      releaseRoute?.();
      await expect(
        ownerPage.getByRole("heading", { name: "Settings" }),
      ).toBeVisible();
      await expect(ownerPage.getByText(labels.shared)).toHaveCount(0);
      await ownerPage.unroute(entitiesURL);
    });

    const currentWorld = await readWorld(request, baseURL, world.id, owner.id);
    await replaceControllers(
      request,
      baseURL,
      world.id,
      shared.id,
      owner.id,
      currentWorld.table_revision,
      [playerTwoMembership.membership_id],
    );
    const solo = await createEntity(
      request,
      baseURL,
      world.id,
      owner.id,
      labels.solo,
    );

    await test.step("RST-006/shared-and-multiple-control", async () => {
      await ownerPage.goto(`${baseURL}/build/${world.id}/roster`);
      await ownerPage
        .getByRole("button", { name: new RegExp(labels.shared) })
        .click();
      await ownerPage.getByRole("button", { name: "Controllers" }).click();
      await ownerPage.getByRole("checkbox", { name: labels.playerOne }).check();
      await ownerPage.getByRole("button", { name: "Save controllers" }).click();
      await expect(ownerPage.getByRole("dialog")).toHaveCount(0);

      await ownerPage.goto(`${baseURL}/build/${world.id}/roster`);
      await ownerPage
        .getByRole("button", { name: new RegExp(labels.solo) })
        .click();
      await ownerPage.getByRole("button", { name: "Controllers" }).click();
      await ownerPage.getByRole("checkbox", { name: labels.playerOne }).check();
      await ownerPage.getByRole("button", { name: "Save controllers" }).click();

      await playerOnePage.goto(`${baseURL}/play/${world.id}`);
      await expect(
        playerOnePage.getByText("Setup required").first(),
      ).toBeVisible();
      await playerOnePage
        .getByRole("button", { name: new RegExp(labels.solo) })
        .click();
      for (const label of [
        labels.secondField,
        labels.revisedFirstField,
        labels.newField,
      ]) {
        await playerOnePage.getByLabel(label).fill(`${label} solo value`);
      }
      await playerOnePage
        .getByRole("button", { name: "Save character" })
        .click();
      await expect(
        playerOnePage.getByRole("heading", {
          name: "Waiting for the next problem.",
        }),
      ).toBeVisible();

      await playerTwoPage.goto(`${baseURL}/play/${world.id}`);
      await playerTwoPage
        .getByRole("button", { name: new RegExp(labels.shared) })
        .click();
      await playerTwoPage.getByRole("tab", { name: "Character" }).click();
      await playerTwoPage
        .getByLabel(labels.revisedFirstField)
        .fill(`Player two preserved value ${unique}`);
      await playerTwoPage
        .getByRole("button", { name: "Save character" })
        .click();

      await selectBuildSection(ownerPage, "roster");
      await ownerPage.getByRole("button", { name: "Create entity" }).focus();
      await ownerPage.keyboard.press("Enter");
      await expect(ownerPage.getByRole("dialog")).toBeVisible();
      await ownerPage.keyboard.press("Escape");
      await expect(ownerPage.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("RST-007/remove-control-revokes-authority", async () => {
      await ownerPage.goto(`${baseURL}/build/${world.id}/roster`);
      await ownerPage
        .getByRole("button", { name: new RegExp(labels.shared) })
        .click();
      await ownerPage.getByRole("button", { name: "Controllers" }).click();
      await ownerPage
        .getByRole("checkbox", { name: labels.playerOne })
        .uncheck();
      await ownerPage.getByRole("button", { name: "Save controllers" }).click();

      await playerOnePage.goto(`${baseURL}/play/${world.id}`);
      await playerOnePage
        .getByRole("button", { name: new RegExp(labels.shared) })
        .click();
      await playerOnePage.getByRole("tab", { name: "Character" }).click();
      await expect(
        playerOnePage.getByText(`Player two preserved value ${unique}`),
      ).toBeVisible();
      await expect(
        playerOnePage.getByRole("button", { name: "Save character" }),
      ).toHaveCount(0);
    });

    const visitorInvite = await createInvite(
      request,
      baseURL,
      world.id,
      owner.id,
      "spectator",
    );
    const visitorToken = required(
      visitorInvite.join_path.split("/").at(-1),
      "visitor invite token",
    );
    await test.step("NAV-004/narrow-identity-invite-configuration-onboarding-live", async () => {
      await openAs(
        visitorPage,
        baseURL,
        `/play/invite/${visitorToken}`,
        labels.visitor,
      );
      await visitorPage
        .getByRole("button", { name: `Join ${labels.world}` })
        .click();
      await expect(
        visitorPage.getByRole("heading", { name: labels.world }),
      ).toBeVisible();
      await Promise.all([
        expectNoHorizontalPageOverflow(visitorPage),
        expectNoHorizontalPageOverflow(ownerPage),
        expectNoHorizontalPageOverflow(playerOnePage),
      ]);
    });

    await createOpenInteraction(
      request,
      baseURL,
      world.id,
      owner.id,
      `A boundary problem ${unique}`,
      [playerOneMembership.membership_id, playerTwoMembership.membership_id],
      [shared.id, solo.id],
    );

    await test.step("PLY-005/withdraw-and-replace-one-action", async () => {
      await expect(
        playerTwoPage.getByText(`A boundary problem ${unique}`),
      ).toBeVisible({ timeout: 4_000 });
      await playerTwoPage
        .getByLabel("What do you do?")
        .fill(`Other player's action ${unique}`);
      await playerTwoPage.getByRole("button", { name: "Offer action" }).click();

      await expect(
        playerOnePage.getByText(`Other player's action ${unique}`),
      ).toBeVisible({ timeout: 4_000 });
      const actingCharacter = playerOnePage.getByLabel("Acting character");
      await expect(
        actingCharacter.getByRole("option", { name: labels.shared }),
      ).toHaveCount(0);
      await expect(
        actingCharacter.getByRole("option", { name: labels.solo }),
      ).toHaveCount(1);
      await playerOnePage
        .getByLabel("What do you do?")
        .fill(`First offered action ${unique}`);
      await playerOnePage.getByRole("button", { name: "Offer action" }).click();
      await playerOnePage.getByRole("button", { name: "Withdraw it" }).click();
      await expect(
        playerOnePage.getByText(`Other player's action ${unique}`),
      ).toBeVisible();
      await playerOnePage
        .getByLabel("What do you do?")
        .fill(`Replacement action ${unique}`);
      await playerOnePage.getByRole("button", { name: "Offer action" }).click();
      await expect(
        playerOnePage.getByText(`Replacement action ${unique}`),
      ).toBeVisible();
    });

    await test.step("PLY-007/cancel-unfinished-and-release-archive", async () => {
      await ownerPage.goto(`${baseURL}/play/${world.id}`);
      await expect(
        ownerPage.getByText(`A boundary problem ${unique}`),
      ).toBeVisible();
      await ownerPage.getByRole("button", { name: "Cancel problem" }).click();
      await expect(ownerPage.getByText("Cancelled")).toBeVisible();
      await expect(
        ownerPage.getByText(`A boundary problem ${unique}`),
      ).toBeVisible();

      await ownerPage.goto(`${baseURL}/build/${world.id}/settings`);
      acceptNextDialog(ownerPage);
      await ownerPage.getByRole("button", { name: "Archive world" }).click();
      await expect(
        ownerPage.getByRole("heading", { name: "Shape a world." }),
      ).toBeVisible();
    });
  } finally {
    await Promise.all([
      playerOneContext.close(),
      playerTwoContext.close(),
      visitorContext.close(),
    ]);
  }
});

async function createNarrowContexts(
  browser: Browser,
  count: number,
): Promise<BrowserContext[]> {
  return Promise.all(
    Array.from({ length: count }, async () =>
      browser.newContext({
        viewport: NARROW_VIEWPORT,
        reducedMotion: "reduce",
      }),
    ),
  );
}

async function selectBuildSection(page: Page, section: string): Promise<void> {
  await page.getByLabel("Builder section").selectOption(section);
}

async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.locator("html").evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}
