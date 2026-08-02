import { mkdir, rm, writeFile } from "node:fs/promises";

import { startAppServer } from "./appServer";
import { artifactsDir, repoRoot, runtimePath } from "./paths";

export default async function globalSetup(): Promise<() => Promise<void>> {
  await mkdir(artifactsDir, { recursive: true });
  await rm(runtimePath, { force: true });
  const app = await startAppServer({ repoRoot, artifactsDir });
  await writeFile(
    runtimePath,
    `${JSON.stringify({ baseURL: app.baseURL }, null, 2)}\n`,
    "utf8",
  );

  return async () => {
    try {
      await app.stop();
    } finally {
      await rm(runtimePath, { force: true });
    }
  };
}
