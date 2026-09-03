import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "../../src/scenario";

const LIFECYCLE_PASSWORD = "lantern-estuary-keeps-four-safe-harbors";

test("one rendered lifecycle carries the World from authoring through archive", async ({
  scenario,
}) => {
  const { baseURL } = scenario;
  const {
    owner: ownerPage,
    editor: editorPage,
    player: playerPage,
    spectator: spectatorPage,
  } = scenario.actors;
  const run = randomUUID().slice(0, 8);
  const labels = {
    owner: `Harbor Author ${run}`,
    ownerUsername: `owner-${run}`,
    editor: `Harbor Editor ${run}`,
    editorUsername: `editor-${run}`,
    player: `Harbor Player ${run}`,
    playerUsername: `player-${run}`,
    spectator: `Harbor Witness ${run}`,
    spectatorUsername: `spectator-${run}`,
    world: `Lantern Estuary ${run}`,
    worldDescription: `A tidebound crossing authored for run ${run}.`,
    editedDescription: `A tidebound crossing tended by its editor ${run}.`,
    numeric: `Bearing ${run}`,
    boolean: `Carries Signal ${run}`,
    derived: `Current Bearing ${run}`,
    worldVisibleField: `World-visible Sign ${run}`,
    restrictedField: `Restricted Oath ${run}`,
    entity: `Glasswing Courier ${run}`,
    worldVisibleStory: `Known by a silver wake ${run}.`,
    restrictedStory: `Carries the unopened letter ${run}.`,
    status: `Off Balance ${run}`,
    firstStatusDescription: `The first crossing left a visible stagger ${run}.`,
    secondStatusDescription: `A separate gust caused another stagger ${run}.`,
  };

  let firstStatusInstance = "";

  await scenario.checkpoint("JRN-001/playable-world", async () => {
    await scenario.behavior(
      "identity.enter-internal-builder",
      async () => {
        await ownerPage.goto(`${baseURL}`);
        await expect(
          ownerPage.getByRole("heading", {
            name: "Wrought",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          ownerPage.getByRole("link", { name: "Play with ChatGPT" }),
        ).toBeVisible();
        await expect(
          ownerPage.getByRole("link", { name: "Build", exact: true }),
        ).toHaveCount(0);
        await ownerPage.goto(`${baseURL}/build`);
        await createAccount(ownerPage, labels.ownerUsername, labels.owner);
        await expect(
          ownerPage.getByRole("heading", { name: "Worlds", exact: true }),
        ).toBeVisible();
      },
      async () => {
        await expect(
          ownerPage.getByRole("heading", { name: "Worlds", exact: true }),
        ).toBeVisible();
      },
    );

    await scenario.behavior(
      "world.create",
      async () => {
        await ownerPage
          .locator(".library-heading")
          .getByRole("button", { name: "Create world" })
          .click();
        const dialog = ownerPage.getByRole("dialog");
        await dialog.getByRole("button", { name: "Create world" }).click();
        await expect(dialog.getByText("is required")).toBeVisible();
        await expect(
          ownerPage.locator(".world-card").filter({ hasText: labels.world }),
        ).toHaveCount(0);
        await dialog.getByLabel("World name").fill(labels.world);
        await dialog
          .getByLabel("Short description")
          .fill(labels.worldDescription);
        await dialog.getByRole("button", { name: "Create world" }).click();
        await expect(
          ownerPage.getByRole("heading", { name: "Capacities", exact: true }),
        ).toBeVisible();
      },
      async () => {
        await expect(
          ownerPage.getByRole("heading", { name: "Capacities", exact: true }),
        ).toBeVisible();
      },
    );

    await scenario.rib("MEC-V01/invalid-bounds", async () => {
      await beginInvalidNumericInput(ownerPage, labels.numeric);
    });
    await scenario.behavior(
      "mechanics.publish",
      async () => {
        await completeNumericInput(ownerPage, labels.numeric);
        await createNumericReference(ownerPage, labels.derived, labels.numeric);

        await ownerPage.getByRole("button", { name: /Capabilities/ }).click();
        await ownerPage.getByRole("button", { name: "New capability" }).click();
        await ownerPage.getByLabel("Name").fill(labels.boolean);
        await ownerPage
          .getByLabel("Description")
          .fill("Whether the courier carries the World's authored signal.");
        await ownerPage
          .getByRole("button", { name: "Create capability" })
          .click();
        await expect(ownerPage.getByText("All changes saved")).toBeVisible();
      },
      async () => {
        await expect(
          ownerPage.getByRole("heading", {
            name: labels.boolean,
            exact: true,
          }),
        ).toBeVisible();
      },
    );

    await scenario.behavior(
      "character-fields.publish",
      async () => {
        await ownerPage
          .getByRole("button", { name: /Character fields/ })
          .click();
        await expect(
          ownerPage.getByRole("heading", {
            name: "Character fields",
            exact: true,
          }),
        ).toBeVisible();
        await ownerPage
          .getByRole("button", { name: "Add required field" })
          .click();
        await ownerPage
          .getByRole("button", { name: "Add required field" })
          .click();
        await ownerPage
          .getByLabel("Field label")
          .nth(0)
          .fill(labels.worldVisibleField);
        await ownerPage
          .getByLabel("Guidance")
          .nth(0)
          .fill("Write the sign the whole World can recognize.");
        await ownerPage
          .getByLabel("Field label")
          .nth(1)
          .fill(labels.restrictedField);
        await ownerPage
          .getByLabel("Guidance")
          .nth(1)
          .fill(
            "Write the promise only controllers and facilitators may read.",
          );
        await ownerPage
          .getByLabel("Who can read this value?")
          .nth(1)
          .selectOption("restricted");
        await ownerPage.getByRole("button", { name: "Publish fields" }).click();
        await expect(ownerPage.getByText("Character fields r1")).toBeVisible();
      },
      async () => {
        await expect(ownerPage.getByText("Character fields r1")).toBeVisible();
      },
    );

    await scenario.behavior(
      "entity.create-sheet",
      async () => {
        await ownerPage
          .getByRole("button", { name: /Roster & sheets/ })
          .click();
        await ownerPage
          .getByRole("button", { name: "Create entity" })
          .first()
          .click();
        await ownerPage.getByLabel("Display name").fill(labels.entity);
        await ownerPage
          .getByRole("dialog")
          .getByRole("button", { name: "Create entity" })
          .click();
        await expect(
          ownerPage.getByRole("heading", { name: labels.entity }),
        ).toBeVisible();
        await ownerPage
          .getByRole("textbox", { name: labels.numeric, exact: true })
          .fill("9");
        await ownerPage.getByLabel(labels.boolean).check();
        await ownerPage
          .getByRole("button", { name: "Save logical state" })
          .click();
        await expect(ownerPage.getByText("logical state r1")).toBeVisible();
        await expect(
          ownerPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");

        await ownerPage.getByRole("button", { name: /Capacities/ }).click();
        await ownerPage
          .getByRole("button", { name: /Roster & sheets/ })
          .click();
        await expect(
          ownerPage.getByRole("textbox", {
            name: labels.numeric,
            exact: true,
          }),
        ).toHaveValue("9");
        await expect(ownerPage.getByLabel(labels.boolean)).toBeChecked();
        await expect(
          ownerPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");
      },
      async () => {
        await expect(
          ownerPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");
      },
    );
  });

  await scenario.checkpoint("JRN-002/ready-player", async () => {
    await scenario.behavior(
      "invites.create-and-redeem",
      async () => {
        await ownerPage
          .getByRole("button", { name: /Members & invites/ })
          .click();
        const editorInvite = await createInvite(ownerPage, "editor");
        const playerInvite = await createInvite(ownerPage, "player");
        const spectatorInvite = await createInvite(ownerPage, "spectator");

        await Promise.all([
          redeemInvite(
            editorPage,
            editorInvite,
            labels.editorUsername,
            labels.editor,
            labels.world,
            "Capacities",
          ),
          redeemInvite(
            playerPage,
            playerInvite,
            labels.playerUsername,
            labels.player,
            labels.world,
            labels.world,
          ),
          redeemInvite(
            spectatorPage,
            spectatorInvite,
            labels.spectatorUsername,
            labels.spectator,
            labels.world,
            labels.world,
          ),
        ]);
        const playerWorldURL = playerPage.url();

        await scenario.rib("INV-005/revoke-used-invite", async () => {
          await ownerPage
            .getByRole("button", { name: /Roster & sheets/ })
            .click();
          await ownerPage
            .getByRole("button", { name: /Members & invites/ })
            .click();
          const usedPlayerInvite = ownerPage
            .locator(".invite-row")
            .filter({ hasText: "Player link" });
          await expect(usedPlayerInvite).toContainText("1 use");
          await usedPlayerInvite
            .getByRole("button", { name: "Revoke" })
            .click();
          await expect(usedPlayerInvite).toContainText("Revoked");
          await playerPage.goto(playerInvite);
          await expect(
            playerPage.getByRole("heading", {
              name: "Invitation unavailable",
            }),
          ).toBeVisible();
          await playerPage.goto(playerWorldURL);
          await expect(
            playerPage.getByRole("heading", { name: labels.world }),
          ).toBeVisible();
        });

        await playerPage.getByRole("button", { name: /All worlds/ }).click();
        await expect(
          playerPage.locator(".world-card").filter({ hasText: labels.world }),
        ).toBeVisible();
        await playerPage.goto(`${baseURL}/build`);
        await expect(
          playerPage.locator(".world-card").filter({ hasText: labels.world }),
        ).toHaveCount(0);
        await playerPage.goto(`${baseURL}/play`);
        await enterWorldFromLibrary(playerPage, labels.world);

        await ownerPage
          .getByRole("button", { name: /Roster & sheets/ })
          .click();
        await ownerPage
          .getByRole("button", { name: /Members & invites/ })
          .click();
        await expect(ownerPage.getByLabel("Invite link")).toHaveCount(0);
        for (const inviteURL of [editorInvite, playerInvite, spectatorInvite]) {
          const token = inviteURL.split("/").at(-1);
          expect(token).toBeTruthy();
          await expect(
            ownerPage.getByText(token ?? "", { exact: false }),
          ).toHaveCount(0);
        }
        await expect(ownerPage.locator(".invite-row")).toHaveCount(3);
      },
      async () => {
        await expect(
          playerPage.getByRole("heading", { name: labels.world }),
        ).toBeVisible();
        await expect(ownerPage.locator(".invite-row")).toHaveCount(3);
      },
    );

    await scenario.behavior(
      "onboarding.wait",
      async () => {
        await expect(
          playerPage.getByText("Waiting for a character"),
        ).toBeVisible();
        await expect(
          playerPage.getByRole("button", { name: "New problem" }),
        ).toHaveCount(0);
      },
      async () => {
        await expect(
          playerPage.getByText("Waiting for a character"),
        ).toBeVisible();
      },
    );

    await scenario.behavior(
      "controllers.assign",
      async () => {
        await ownerPage.locator(".world-identity > button").click();
        const ownerBuildCard = ownerPage
          .locator(".world-card")
          .filter({ hasText: labels.world });
        await expect(ownerBuildCard).toBeVisible();
        await ownerBuildCard.getByRole("button", { name: /^Open$/ }).click();
        await ownerPage
          .getByRole("button", { name: /Roster & sheets/ })
          .click();
        await ownerPage
          .getByRole("button", { name: "Controllers", exact: true })
          .click();
        await ownerPage.getByRole("checkbox", { name: labels.player }).check();
        await ownerPage
          .getByRole("dialog")
          .getByRole("button", { name: "Save controllers" })
          .click();
        await expect(ownerPage.getByRole("dialog")).toHaveCount(0);
        await expect(
          playerPage.getByText("Setup required").first(),
        ).toBeVisible({
          timeout: 4_000,
        });
      },
      async () => {
        await expect(
          playerPage.getByText("Setup required").first(),
        ).toBeVisible();
      },
    );

    await scenario.behavior(
      "profile.save-partial",
      async () => {
        await playerPage
          .getByLabel(labels.worldVisibleField)
          .fill(labels.worldVisibleStory);
        await playerPage.getByRole("button", { name: "Save profile" }).click();
        await expect(playerPage.getByText("profile r1")).toBeVisible();
        await expect(
          playerPage.getByText("Setup required").first(),
        ).toBeVisible();
      },
      async () => {
        await expect(playerPage.getByText("profile r1")).toBeVisible();
        await expect(
          playerPage.getByText("Setup required").first(),
        ).toBeVisible();
      },
    );

    await scenario.behavior(
      "profile.complete",
      async () => {
        await playerPage
          .getByLabel(labels.restrictedField)
          .fill(labels.restrictedStory);
        await playerPage.getByRole("button", { name: "Save profile" }).click();
        await expect(playerPage.getByText("Your character")).toBeVisible();
        await expect(playerPage.getByText("profile r2")).toBeVisible();
        await expect(
          playerPage.getByRole("button", { name: "New problem" }),
        ).toHaveCount(0);
      },
      async () => {
        await expect(playerPage.getByText("Your character")).toBeVisible();
        await expect(playerPage.getByText("profile r2")).toBeVisible();
      },
    );
  });

  await scenario.checkpoint("JRN-006/editor-authority-bounded", async () => {
    await scenario.behavior(
      "mechanic.edit",
      async () => {
        await editorPage.getByRole("button", { name: /Capacities/ }).click();
        await editorPage
          .locator(".catalog-item")
          .filter({
            has: editorPage.getByText(labels.numeric, { exact: true }),
          })
          .click();
        await editorPage
          .getByLabel("Description")
          .fill(`The editor clarified this authored measure ${run}.`);
        const playerRulesReload = playerPage.waitForResponse(
          (response) =>
            response.request().method() === "GET" &&
            new URL(response.url()).pathname.endsWith("/mechanics") &&
            response.ok(),
          { timeout: 4_000 },
        );
        await editorPage.getByRole("button", { name: "Save changes" }).click();
        await expect(editorPage.getByText("All changes saved")).toBeVisible();
        await playerRulesReload;
        await expect(spectatorPage.getByText("rules revision r4")).toBeVisible({
          timeout: 4_000,
        });
        await playerPage.getByRole("tab", { name: "Sheet" }).click();
        await expect(playerPage.getByText("rules revision r4")).toBeVisible({
          timeout: 4_000,
        });
        await expect(
          playerPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");
      },
      async () => {
        await expect(
          spectatorPage.getByText("rules revision r4"),
        ).toBeVisible();
        await expect(
          playerPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");
      },
    );

    await scenario.behavior(
      "world.edit",
      async () => {
        await editorPage.getByRole("button", { name: /Settings/ }).click();
        await expect(
          editorPage.getByRole("heading", { name: "Settings" }),
        ).toBeVisible();
        await editorPage
          .getByLabel("Description")
          .fill(labels.editedDescription);
        await editorPage.getByRole("button", { name: "Save details" }).click();
        await expect(
          editorPage.getByRole("button", { name: "Save details" }),
        ).toBeDisabled();
      },
      async () => {
        await expect(editorPage.getByLabel("Description")).toHaveValue(
          labels.editedDescription,
        );
      },
    );

    await scenario.behavior(
      "editor.authority",
      async () => {
        await expect(
          editorPage.getByRole("button", { name: "Archive world" }),
        ).toHaveCount(0);
        await editorPage.goto(`${baseURL}/play`);
        await enterWorldFromLibrary(editorPage, labels.world);
        await expect(
          editorPage.getByRole("heading", { name: labels.world }),
        ).toBeVisible();
        const facilitatorHandoff = editorPage.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname.endsWith("/facilitator") &&
            response.ok(),
        );
        const facilitatorRefresh = editorPage.waitForResponse((response) => {
          const pathname = new URL(response.url()).pathname;
          return (
            response.request().method() === "GET" &&
            pathname.match(/^\/api\/worlds\/[^/]+$/) !== null &&
            response.ok()
          );
        });
        editorPage.once("dialog", async (dialog) => dialog.accept());
        await editorPage
          .getByRole("button", { name: "Become Facilitator" })
          .click();
        await Promise.all([facilitatorHandoff, facilitatorRefresh]);
        await expect(
          editorPage
            .locator(".play-header-actions")
            .getByRole("button", { name: "New problem" }),
        ).toBeVisible();
        await expect(
          editorPage
            .locator(".play-header-actions .play-role")
            .getByText("Facilitator", { exact: true }),
        ).toBeVisible();
        await expect(
          editorPage.getByText("Membership role: Editor"),
        ).toBeVisible();
      },
      async () => {
        await expect(
          editorPage
            .locator(".play-header-actions")
            .getByRole("button", { name: "New problem" }),
        ).toBeVisible();
        await expect(
          editorPage
            .locator(".play-header-actions .play-role")
            .getByText("Facilitator", { exact: true }),
        ).toBeVisible();
        await expect(
          editorPage.getByText("Membership role: Editor"),
        ).toBeVisible();
      },
    );
  });

  await scenario.checkpoint("JRN-003/improvised-round-resolved", async () => {
    const title = `The tide gate bends ${run}`;
    const prompt = `A green surge folds the tide gate inward ${run}. What do you do?`;
    const action = `I lash the courier to the beacon chain ${run}.`;
    const consequence = `The courier holds, but the current tears at every footing ${run}.`;

    await scenario.behavior(
      "problem.present",
      async () => {
        await presentProblem(editorPage, title, prompt, labels.entity);
        await expect(
          playerPage.getByText(prompt, { exact: true }),
        ).toBeVisible();
      },
      async () => {
        await expect(
          playerPage.getByText(prompt, { exact: true }),
        ).toBeVisible();
        await expect(
          spectatorPage.getByText(prompt, { exact: true }),
        ).toBeVisible();
      },
    );

    await scenario.checkpoint(
      "JRN-005/spectator-world-visible-safe",
      async () => {
        await scenario.behavior(
          "profile.project-visibility",
          async () => {
            await spectatorPage.getByRole("tab", { name: "Profile" }).click();
            await playerPage.getByRole("tab", { name: "Profile" }).click();
            await expect(
              spectatorPage.getByText(labels.worldVisibleStory),
            ).toBeVisible();
            await expect(
              spectatorPage.getByText(labels.restrictedStory),
            ).toHaveCount(0);
            await expect(
              playerPage.getByText(labels.restrictedStory),
            ).toBeVisible();
          },
          async () => {
            await expect(
              spectatorPage.getByText(labels.worldVisibleStory),
            ).toBeVisible();
            await expect(
              spectatorPage.getByText(labels.restrictedStory),
            ).toHaveCount(0);
            await expect(
              playerPage.getByText(labels.restrictedStory),
            ).toBeVisible();
          },
        );

        await scenario.behavior(
          "spectator.project-world-visible",
          async () => {
            await expect(
              spectatorPage.getByText(prompt, { exact: true }),
            ).toBeVisible();
            await expect(
              spectatorPage.getByText(
                "You are part of this problem’s audience, but not one of its responders.",
              ),
            ).toBeVisible();
            await expect(
              spectatorPage.getByRole("button", { name: "Submit action" }),
            ).toHaveCount(0);
            await expect(
              spectatorPage.getByRole("button", { name: "New problem" }),
            ).toHaveCount(0);
          },
          async () => {
            await expect(
              spectatorPage.getByText(
                "You are part of this problem’s audience, but not one of its responders.",
              ),
            ).toBeVisible();
            await expect(
              spectatorPage.getByRole("button", { name: "Submit action" }),
            ).toHaveCount(0);
          },
        );

        await scenario.behavior(
          "world.archive-blocked",
          async () => {
            await scenario.rib("NAV-V04/archive-command-failure", async () => {
              await ownerPage.locator(".world-identity > button").click();
              const currentOwnerCard = ownerPage
                .locator(".world-card")
                .filter({ hasText: labels.world });
              await currentOwnerCard
                .getByRole("button", { name: /^Open$/ })
                .click();
              await ownerPage.getByRole("button", { name: /Settings/ }).click();
              ownerPage.once("dialog", async (dialog) => dialog.accept());
              await ownerPage
                .getByRole("button", { name: "Archive world" })
                .click();
              await expect(
                ownerPage.getByText(
                  "resolve or cancel active interactions before archiving the world",
                ),
              ).toBeVisible();
            });
          },
          async () => {
            await expect(
              ownerPage.getByText(
                "resolve or cancel active interactions before archiving the world",
              ),
            ).toBeVisible();
          },
        );

        await scenario.behavior(
          "action.offer",
          async () => {
            await expect(playerPage.getByLabel("Acting character")).toHaveValue(
              /.+/,
            );
            await playerPage.getByLabel("What do you do?").fill(action);
            await playerPage
              .getByRole("button", { name: "Submit action" })
              .click();
            await expect(
              editorPage.getByText(action, { exact: true }),
            ).toBeVisible();
          },
          async () => {
            await expect(
              editorPage.getByText(action, { exact: true }),
            ).toBeVisible();
          },
        );

        await scenario.behavior(
          "problem.adjudicate",
          async () => {
            await editorPage
              .getByRole("button", { name: "Close actions" })
              .click();
            await expect(
              spectatorPage.getByText(prompt, { exact: true }),
            ).toHaveCount(0);
            await expect(
              spectatorPage.getByRole("heading", {
                name: "No active problem",
              }),
            ).toBeVisible();
            await expect(
              playerPage.getByText(prompt, { exact: true }),
            ).toHaveCount(0);
          },
          async () => {
            await expect(
              playerPage.getByText(prompt, { exact: true }),
            ).toHaveCount(0);
            await expect(
              spectatorPage.getByText(prompt, { exact: true }),
            ).toHaveCount(0);
          },
        );

        await scenario.behavior(
          "consequence.preview",
          async () => {
            const invalidConsequence = `${consequence} The courier loses twenty bearing.`;
            await compileNarrative(editorPage, invalidConsequence);
            await expect(
              editorPage.getByText("number is below the configured minimum"),
            ).toBeVisible();
            await expect(
              editorPage
                .locator(".history-card")
                .filter({ hasText: consequence }),
            ).toHaveCount(0);
            await expect(
              editorPage.locator(".status-instance-chip"),
            ).toHaveCount(0);
            await compileNarrative(editorPage, consequence);
            await expect(
              editorPage.getByText("Preview is valid"),
            ).toBeVisible();
            await expect(
              editorPage
                .locator(".history-card")
                .filter({ hasText: consequence }),
            ).toHaveCount(0);
            await expect(spectatorPage.getByText(consequence)).toHaveCount(0);
          },
          async () => {
            await expect(
              editorPage.getByText("Preview is valid"),
            ).toBeVisible();
            await expect(
              editorPage
                .locator(".history-card")
                .filter({ hasText: consequence }),
            ).toHaveCount(0);
            await expect(spectatorPage.getByText(consequence)).toHaveCount(0);
          },
        );

        await scenario.behavior(
          "consequence.resolve",
          async () => {
            await editorPage
              .getByRole("button", { name: "Resolve problem" })
              .click();
            await expect(
              editorPage.getByText(consequence, { exact: true }),
            ).toBeVisible();
            await expect(
              spectatorPage.getByText(consequence, { exact: true }),
            ).toBeVisible();
            await expect(
              playerPage.getByText(consequence, { exact: true }),
            ).toBeVisible();
            await expect(
              spectatorPage.getByText(labels.restrictedStory),
            ).toHaveCount(0);
            await expect(
              playerPage
                .locator(".history-card")
                .filter({ hasText: consequence }),
            ).toContainText(`${labels.entity}: ${labels.numeric} 9 → 7`);

            const firstStatus = editorPage
              .locator(".status-instance-chip")
              .filter({ hasText: labels.firstStatusDescription });
            await expect(firstStatus).toHaveCount(1);
            firstStatusInstance = visibleStatusInstance(
              await firstStatus.getAttribute("aria-label"),
            );
            await expect(
              editorPage.getByLabel(`${labels.numeric} effective value`, {
                exact: true,
              }),
            ).toHaveText("8");
            await expect(
              editorPage.getByLabel(`${labels.derived} effective value`, {
                exact: true,
              }),
            ).toHaveText("8");
          },
          async () => {
            await expect(
              playerPage.getByText(consequence, { exact: true }),
            ).toBeVisible();
            await expect(
              spectatorPage.getByText(consequence, { exact: true }),
            ).toBeVisible();
            await expect(
              editorPage.getByLabel(`${labels.derived} effective value`, {
                exact: true,
              }),
            ).toHaveText("8");
          },
        );
      },
    );
  });

  await scenario.checkpoint("JRN-004/status-lifecycle-preserved", async () => {
    const secondConsequence = `A second gust settles into a separate strain ${run}.`;
    await scenario.behavior(
      "status.apply",
      async () => {
        await presentProblem(
          editorPage,
          `The beacon turns ${run}`,
          `The beacon turns against the wind ${run}.`,
          labels.entity,
        );
        await editorPage.getByRole("button", { name: "Close actions" }).click();
        await compileNarrative(editorPage, secondConsequence);
        await editorPage
          .getByRole("button", { name: "Resolve problem" })
          .click();
        await expect(
          editorPage.getByText(secondConsequence, { exact: true }),
        ).toBeVisible();
        await expect(
          editorPage.getByLabel(`${labels.numeric} effective value`, {
            exact: true,
          }),
        ).toHaveText("10");
        await expect(
          editorPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("10");
      },
      async () => {
        await expect(
          editorPage.getByText(secondConsequence, { exact: true }),
        ).toBeVisible();
        await expect(
          editorPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("10");
      },
    );

    await scenario.behavior(
      "status.keep-same-name-distinct",
      async () => {
        const sameNameStatuses = editorPage
          .locator(".status-instance-chip")
          .filter({ hasText: labels.status });
        await expect(sameNameStatuses).toHaveCount(2);
        await expect(sameNameStatuses.nth(0)).toContainText(
          labels.firstStatusDescription,
        );
        await expect(sameNameStatuses.nth(1)).toContainText(
          labels.secondStatusDescription,
        );
      },
      async () => {
        const sameNameStatuses = editorPage
          .locator(".status-instance-chip")
          .filter({ hasText: labels.status });
        await expect(sameNameStatuses).toHaveCount(2);
      },
    );

    const removalConsequence = `The first stagger ends while the second remains ${run}.`;
    await scenario.behavior(
      "status.remove-exact",
      async () => {
        await presentProblem(
          editorPage,
          `The first footing steadies ${run}`,
          `The courier finds one secure stone ${run}.`,
          labels.entity,
        );
        await editorPage.getByRole("button", { name: "Close actions" }).click();
        await compileNarrative(editorPage, removalConsequence);
        await editorPage
          .getByRole("button", { name: "Resolve problem" })
          .click();
        await expect(
          editorPage.getByText(removalConsequence, { exact: true }),
        ).toBeVisible();

        const remainingStatus = editorPage
          .locator(".status-instance-chip")
          .filter({ hasText: labels.status });
        await expect(remainingStatus).toHaveCount(1);
        await expect(remainingStatus).toContainText(
          labels.secondStatusDescription,
        );
        await expect(remainingStatus).not.toContainText(
          labels.firstStatusDescription,
        );
        await expect(
          editorPage.getByLabel(`${labels.numeric} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");
        await expect(
          editorPage.getByLabel(`${labels.derived} effective value`, {
            exact: true,
          }),
        ).toHaveText("9");
        await expect(editorPage.locator(".history-card")).toHaveCount(3);
      },
      async () => {
        const remainingStatus = editorPage
          .locator(".status-instance-chip")
          .filter({ hasText: labels.status });
        await expect(remainingStatus).toHaveCount(1);
        await expect(remainingStatus).toContainText(
          labels.secondStatusDescription,
        );
        await expect(remainingStatus).not.toContainText(
          labels.firstStatusDescription,
        );
        await expect(editorPage.locator(".history-card")).toHaveCount(3);
      },
    );
  });

  await scenario.checkpoint("JRN-007/archived-history-readable", async () => {
    await scenario.behavior(
      "world.archive",
      async () => {
        ownerPage.once("dialog", async (dialog) => dialog.accept());
        await ownerPage.getByRole("button", { name: "Archive world" }).click();

        const ownerBuildCard = ownerPage
          .locator(".world-card")
          .filter({ hasText: labels.world });
        await expect(ownerBuildCard).toBeVisible();
        await expect(
          ownerBuildCard.getByText("archived", { exact: true }),
        ).toBeVisible();

        await ownerPage.goto(`${baseURL}/play`);
        const ownerPlayCard = ownerPage
          .locator(".world-card")
          .filter({ hasText: labels.world });
        await expect(
          ownerPlayCard.getByText("archived", { exact: true }),
        ).toBeVisible();
        await ownerPlayCard.getByRole("button", { name: /^Open$/ }).click();
        await expect(
          ownerPage.getByRole("heading", { name: labels.world }),
        ).toBeVisible();
        await expect(
          ownerPage.getByRole("button", { name: "New problem" }),
        ).toHaveCount(0);
        await expect(
          ownerPage.getByText(labels.secondStatusDescription),
        ).toBeVisible();
        await expect(ownerPage.locator(".history-card")).toHaveCount(0);

        await Promise.all(
          [editorPage, playerPage, spectatorPage].map(async (actorPage) => {
            await reopenArchivedPlayWorld(actorPage, labels.world);
            await actorPage.getByRole("tab", { name: "Sheet" }).click();
            await expect(
              actorPage.getByText(labels.secondStatusDescription),
            ).toBeVisible();
            await expect(actorPage.locator(".history-card")).toHaveCount(3);
            await expect(
              actorPage.getByRole("button", { name: "New problem" }),
            ).toHaveCount(0);
          }),
        );
        await expect(
          spectatorPage.getByText(labels.restrictedStory),
        ).toHaveCount(0);
      },
      async () => {
        await expect(ownerPage.locator(".history-card")).toHaveCount(0);
        await expect(spectatorPage.locator(".history-card")).toHaveCount(3);
        await expect(
          ownerPage.getByRole("button", { name: "New problem" }),
        ).toHaveCount(0);
      },
    );
  });
});

async function createAccount(
  page: Page,
  username: string,
  displayName: string,
) {
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
  const form = page.locator("form.identity-form");
  await expect(
    form.getByText("Minimum 8 characters.", { exact: true }),
  ).toHaveCount(1);
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="displayName"]').fill(displayName);
  await form.locator('input[name="password"]').fill(LIFECYCLE_PASSWORD);
  await form
    .locator('input[name="passwordConfirmation"]')
    .fill(LIFECYCLE_PASSWORD);
  await form
    .getByRole("button", { name: "Create account", exact: true })
    .click();
}

async function beginInvalidNumericInput(page: Page, name: string) {
  await page.getByRole("button", { name: "New capacity" }).click();
  const numericSettings = page.locator(".numeric-settings");
  const minimumInput = numericSettings
    .locator("label")
    .filter({ hasText: /^Minimum/ })
    .locator("input");
  const maximumInput = numericSettings
    .locator("label")
    .filter({ hasText: /^Maximum/ })
    .locator("input");
  await page.getByLabel("Name").fill(name);
  await page
    .getByLabel("Description")
    .fill("A user-authored measure of balance against the current.");
  await page.getByRole("textbox", { name: "Default", exact: true }).fill("8");
  await minimumInput.fill("20");
  await maximumInput.fill("10");
  await page.getByLabel("Step").fill("1");
  await page.getByRole("button", { name: "Create capacity" }).click();
  await expect(
    page.getByText("maximum must be greater than or equal to minimum"),
  ).toBeVisible();
  await expect(
    page.locator(".catalog-item").filter({ hasText: name }),
  ).toHaveCount(0);
}

async function completeNumericInput(page: Page, name: string) {
  const numericSettings = page.locator(".numeric-settings");
  const minimumInput = numericSettings
    .locator("label")
    .filter({ hasText: /^Minimum/ })
    .locator("input");
  const maximumInput = numericSettings
    .locator("label")
    .filter({ hasText: /^Maximum/ })
    .locator("input");
  await minimumInput.fill("0");
  await maximumInput.fill("20");
  await page.getByRole("button", { name: "Create capacity" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(
    page.locator(".catalog-item").filter({ hasText: name }),
  ).toBeVisible();
}

async function createNumericReference(
  page: Page,
  name: string,
  referencedName: string,
) {
  await page.getByRole("button", { name: "New capacity" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("radio", { name: "Derived mechanic" }).check();
  await page
    .getByLabel("Result expression")
    .selectOption({ label: "Value reference" });
  const referencedOption = page
    .getByLabel("Result referenced value")
    .locator("option", { hasText: referencedName });
  await expect(referencedOption).toHaveCount(1);
  const referencedLabel = ((await referencedOption.textContent()) ?? "").trim();
  expect(referencedLabel).not.toBe("");
  await page
    .getByLabel("Result referenced value")
    .selectOption({ label: referencedLabel });
  await page.getByRole("button", { name: "Create capacity" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
}

async function createInvite(
  page: Page,
  role: "editor" | "player" | "spectator",
): Promise<string> {
  const inviteLink = page.getByLabel("Invite link");
  const previous = await inviteLink
    .isVisible()
    .then(async (visible) => (visible ? inviteLink.inputValue() : ""));
  await page.getByLabel("They can join as").selectOption(role);
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(inviteLink).toBeVisible();
  await expect.poll(async () => inviteLink.inputValue()).not.toBe(previous);
  return inviteLink.inputValue();
}

async function redeemInvite(
  page: Page,
  inviteURL: string,
  username: string,
  displayName: string,
  worldName: string,
  destinationHeading: string,
) {
  await page.goto(inviteURL);
  await expect(page.getByText(worldName, { exact: false })).toHaveCount(0);
  await createAccount(page, username, displayName);
  await expect(
    page.getByRole("heading", { name: `Invitation to ${worldName}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Join ${worldName}` }).click();
  await expect(
    page.getByRole("heading", { name: destinationHeading, exact: true }),
  ).toBeVisible();
}

async function enterWorldFromLibrary(page: Page, worldName: string) {
  const worldCard = page.locator(".world-card").filter({ hasText: worldName });
  await expect(worldCard).toBeVisible();
  await worldCard.getByRole("button", { name: /^Open$/ }).click();
}

async function reopenArchivedPlayWorld(page: Page, worldName: string) {
  await page.locator(".play-world-return").click();
  const worldCard = page.locator(".world-card").filter({ hasText: worldName });
  await expect(worldCard.getByText("archived", { exact: true })).toBeVisible();
  await worldCard.getByRole("button", { name: /^Open$/ }).click();
}

async function presentProblem(
  page: Page,
  title: string,
  prompt: string,
  entityName: string,
) {
  await page
    .locator(".play-header-actions")
    .getByRole("button", { name: "New problem" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Description").fill(prompt);
  await dialog.getByRole("checkbox", { name: entityName }).check();
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/interactions") &&
      response.ok(),
  );
  await dialog.getByRole("button", { name: "Create problem" }).click();
  await created;
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
}

async function compileNarrative(page: Page, narrative: string) {
  await page.getByLabel("What transpires").fill(narrative);
  await page.getByRole("button", { name: "Compile & preview" }).click();
}

function visibleStatusInstance(label: string | null): string {
  const instance = label?.match(/instance ([^ ]+)$/)?.[1];
  if (instance === undefined || instance === "")
    throw new Error(
      `active Status instance did not expose its visible identity: ${label}`,
    );
  return instance;
}
