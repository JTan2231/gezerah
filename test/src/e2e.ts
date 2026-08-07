#!/usr/bin/env node
import { existsSync } from "node:fs";

import { chromium } from "@playwright/test";

import { runCommand } from "./command";
import { repoRoot, testRoot } from "./paths";
import { finalizeSuiteCoverage } from "./scenario/evidence/suiteCoverage";

async function main(): Promise<void> {
  const launcherStartedAt = Date.now();
  const browser = await timed("browser resolution", ensureBrowser);
  const env = {
    ...process.env,
    ...(browser === undefined ? {} : { DND_E2E_BROWSER_EXECUTABLE: browser }),
  };
  await timed("Playwright execution", async () => {
    await runCommand("bunx", ["playwright", "test"], { cwd: testRoot, env });
  });
  const inventory = await timed("coverage inventory", async () =>
    finalizeSuiteCoverage({
      requireComplete: process.env.DND_E2E_REQUIRE_COMPLETE_COVERAGE === "1",
    }),
  );
  process.stdout.write(
    `==> Scenario coverage: ${inventory.passed}/${inventory.catalogSize} passed\n`,
  );
  reportTiming("launcher total", launcherStartedAt);
}

async function timed<T>(name: string, action: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await action();
  } finally {
    reportTiming(name, startedAt);
  }
}

function reportTiming(name: string, startedAt: number): void {
  process.stdout.write(
    `==> Timing: E2E ${name} ${((Date.now() - startedAt) / 1000).toFixed(3)}s\n`,
  );
}

async function ensureBrowser(): Promise<string | undefined> {
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return undefined;

  for (const candidate of systemBrowserCandidates()) {
    if (existsSync(candidate)) return candidate;
  }

  process.stdout.write("\n==> E2E: installing Playwright Chromium\n");
  await runCommand("bunx", ["playwright", "install", "chromium"], {
    cwd: testRoot,
  });
  if (!existsSync(chromium.executablePath())) {
    throw new Error(
      "Playwright Chromium installation completed without a browser executable",
    );
  }
  return undefined;
}

function systemBrowserCandidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
    ];
    return roots
      .filter((root): root is string => root !== undefined)
      .map((root) => `${root}\\Google\\Chrome\\Application\\chrome.exe`);
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

await main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\nRepository: ${repoRoot}\n`,
  );
  process.exitCode = 1;
});
