import { mkdir, rm, writeFile } from "node:fs/promises";

import { startAppServer } from "./appServer";
import { artifactsDir, repoRoot, runtimePath } from "./paths";

export default async function globalSetup(): Promise<() => Promise<void>> {
  await mkdir(artifactsDir, { recursive: true });
  await rm(runtimePath, { force: true });
  const configuredBinary = process.env.SCRYER_E2E_APP_BINARY?.trim();
  const app = await startAppServer({
    repoRoot,
    artifactsDir,
    ...(configuredBinary === undefined || configuredBinary === ""
      ? {}
      : { prebuiltBinaryPath: configuredBinary }),
  });
  try {
    await writeFile(
      runtimePath,
      `${JSON.stringify(
        {
          baseURL: app.baseURL,
          controlledTimeDatabaseURL: app.controlledTimeDatabaseURL,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    await app.stop().catch(() => undefined);
    await rm(runtimePath, { force: true });
    throw error;
  }

  return async () => {
    try {
      await app.stop();
    } finally {
      await rm(runtimePath, { force: true });
    }
  };
}
