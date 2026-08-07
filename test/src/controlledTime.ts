import { readFile } from "node:fs/promises";

import { runCommand } from "./command";
import { runtimePath } from "./paths";

const canonicalUUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Advances one invite across its expiry boundary without exposing clock control
 * through the product or scenario-journey surfaces.
 */
export async function expireInviteForDirectContract(
  inviteID: string,
): Promise<void> {
  if (!canonicalUUID.test(inviteID)) {
    throw new Error("controlled-time invite ID must be a canonical UUID");
  }

  const databaseEnvironment = await readControlledTimeDatabaseEnvironment();
  await runCommand(
    "psql",
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `with expired as (
  update world_invites
  set expires_at = created_at + ((current_timestamp - created_at) / 2)
  where id = '${inviteID}'::uuid
  returning id
)
select 1 / count(*) from expired`,
    ],
    {
      env: databaseEnvironment,
      quiet: true,
    },
  );
}

async function readControlledTimeDatabaseEnvironment(): Promise<NodeJS.ProcessEnv> {
  const source = await readFile(runtimePath, "utf8");
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== "object" ||
    value === null ||
    !("controlledTimeDatabaseURL" in value) ||
    typeof value.controlledTimeDatabaseURL !== "string"
  ) {
    throw new Error("invalid controlled-time E2E runtime metadata");
  }
  let databaseURL: URL;
  try {
    databaseURL = new URL(value.controlledTimeDatabaseURL);
  } catch {
    throw new Error("invalid controlled-time E2E database URL");
  }
  if (
    databaseURL.protocol !== "postgres:" &&
    databaseURL.protocol !== "postgresql:"
  ) {
    throw new Error("invalid controlled-time E2E database URL");
  }
  const databaseName = decodeURIComponent(databaseURL.pathname.slice(1));
  if (databaseURL.hostname === "" || databaseName === "") {
    throw new Error("invalid controlled-time E2E database URL");
  }
  for (const key of databaseURL.searchParams.keys()) {
    if (key !== "sslmode") {
      throw new Error("invalid controlled-time E2E database URL options");
    }
  }

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: databaseURL.hostname,
    PGPORT: databaseURL.port || "5432",
    PGDATABASE: databaseName,
  };
  if (databaseURL.username !== "") {
    environment.PGUSER = decodeURIComponent(databaseURL.username);
  }
  if (databaseURL.password !== "") {
    environment.PGPASSWORD = decodeURIComponent(databaseURL.password);
  }
  const sslMode = databaseURL.searchParams.get("sslmode");
  if (sslMode !== null) environment.PGSSLMODE = sslMode;
  return environment;
}
