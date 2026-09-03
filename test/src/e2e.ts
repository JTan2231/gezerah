#!/usr/bin/env node
import { ensureBrowser } from "./browser";
import { runCommand } from "./command";
import { repoRoot, testRoot } from "./paths";
import { finalizeSuiteCoverage } from "./scenario/evidence/suiteCoverage";

async function main(): Promise<void> {
  const launcherStartedAt = Date.now();
  const browser = await timed("browser resolution", ensureBrowser);
  const env = {
    ...process.env,
    ...(browser === undefined
      ? {}
      : { WROUGHT_E2E_BROWSER_EXECUTABLE: browser }),
  };
  await timed("Playwright execution", async () => {
    await runCommand("bunx", ["playwright", "test"], { cwd: testRoot, env });
  });
  const inventory = await timed("coverage inventory", async () =>
    finalizeSuiteCoverage({
      requireComplete:
        process.env.WROUGHT_E2E_REQUIRE_COMPLETE_COVERAGE === "1",
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

await main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\nRepository: ${repoRoot}\n`,
  );
  process.exitCode = 1;
});
