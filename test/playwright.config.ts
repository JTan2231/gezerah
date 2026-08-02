import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.DND_E2E_BROWSER_EXECUTABLE;

export default defineConfig({
  testDir: "./specs",
  outputDir: "./artifacts/playwright",
  globalSetup: "./src/globalSetup.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/report", open: "never" }],
  ],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
