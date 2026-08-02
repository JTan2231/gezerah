import path from "node:path";
import { fileURLToPath } from "node:url";

export const sourceDir = fileURLToPath(new URL(".", import.meta.url));
export const testRoot = path.resolve(sourceDir, "..");
export const repoRoot = path.resolve(testRoot, "..");
export const artifactsDir = path.join(testRoot, "artifacts");
export const runtimePath = path.join(artifactsDir, "runtime.json");
