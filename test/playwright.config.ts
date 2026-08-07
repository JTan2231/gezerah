import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.DND_E2E_BROWSER_EXECUTABLE;
const diagnosticsEnabled = process.env.DND_E2E_DIAGNOSTICS === "1";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./artifacts/playwright",
  globalSetup: "./src/globalSetup.ts",
  timeout: 20_000,
  expect: { timeout: 4_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/report", open: "never" }],
    ["./src/scenario/playwright/scenarioReporter.ts"],
  ],
  use: {
    screenshot: "only-on-failure",
    trace: diagnosticsEnabled ? "retain-on-failure" : "off",
    video: diagnosticsEnabled ? "retain-on-failure" : "off",
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
