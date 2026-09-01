import { readFile } from "node:fs/promises";

import { runtimePath } from "./paths";

export async function readBaseURL(): Promise<string> {
  const source = await readFile(runtimePath, "utf8");
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== "object" ||
    value === null ||
    !("baseURL" in value) ||
    typeof value.baseURL !== "string"
  ) {
    throw new Error("invalid E2E runtime metadata");
  }
  return value.baseURL;
}
