import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import { disposeAuthenticatedActors, signupActor } from "../support/auth";

test.afterEach(async () => disposeAuthenticatedActors());

test("UI authentication: signin, password changes, and logout use server sessions", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const actor = await signupActor(baseURL, `Returning builder ${unique}`);
  const newPassword = "returning-builder-keeps-a-new-long-passphrase";

  await test.step("IDN-005 signin resumes the protected destination and survives reload", async () => {
    await page.goto(`${baseURL}/build`);
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/build");
    await signInThroughGate(page, actor.username, actor.password);
    await expect(
      page.getByRole("heading", { name: "Shape a world." }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/build");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Shape a world." }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Account" })).toBeVisible();
  });

  await test.step("IDN-008 sign out everywhere revokes every account session", async () => {
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out everywhere", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/build");
    expect((await actor.api.get("/api/me")).status()).toBe(401);
    expect(
      (await page.context().request.get(`${baseURL}/api/me`)).status(),
    ).toBe(401);
  });

  await test.step("IDN-007 password change confirms the new secret and rotates sessions", async () => {
    await signInThroughGate(page, actor.username, actor.password);
    await expect(
      page.getByRole("heading", { name: "Shape a world." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Your account" }),
    ).toBeVisible();
    await dialog.locator('input[name="current_password"]').fill(actor.password);
    await dialog.locator('input[name="new_password"]').fill(newPassword);
    const changePassword = dialog.getByRole("button", {
      name: "Change password",
      exact: true,
    });
    await expect(changePassword).toBeDisabled();
    await dialog
      .locator('input[name="new_password_confirmation"]')
      .fill(`${newPassword}-mismatch`);
    await expect(dialog.getByText("must match the new password")).toBeVisible();
    await expect(changePassword).toBeDisabled();
    await dialog
      .locator('input[name="new_password_confirmation"]')
      .fill(newPassword);
    await changePassword.click();
    await expect(
      dialog.getByText("Your password has been changed."),
    ).toBeVisible();
    await dialog
      .locator(".modal-actions")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Shape a world." }),
    ).toBeVisible();
  });

  await test.step("IDN-006 logout revokes the session and preserves the protected route", async () => {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/build");
    const me = await page.context().request.get(`${baseURL}/api/me`);
    expect(me.status()).toBe(401);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
  });
});

async function signInThroughGate(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  const form = page.locator("form.identity-form");
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}
