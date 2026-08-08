import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { runCommand } from "./command";
import { runtimePath } from "./paths";

const execFileAsync = promisify(execFile);
const canonicalUUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthPersistenceRecord {
  readonly passwordHash: string;
  readonly sessionTokenHash: string;
  readonly sessionCount: number;
}

export async function expireSessionForDirectContract(
  userID: string,
): Promise<void> {
  assertUserID(userID);
  await executeAuthSQL(`with expired as (
  update auth_sessions
  set created_at = now() - interval '2 days',
      last_seen_at = now() - interval '2 days',
      idle_expires_at = now() - interval '1 day'
  where id = (
    select id from auth_sessions
    where user_id = '${userID}'::uuid and revoked_at is null
    order by created_at desc
    limit 1
  )
  returning id
)
select 1 / count(*) from expired`);
}

export async function disableUserForDirectContract(
  userID: string,
): Promise<void> {
  assertUserID(userID);
  await executeAuthSQL(`with disabled as (
  update users set status = 'disabled'
  where id = '${userID}'::uuid
  returning id
)
select 1 / count(*) from disabled`);
}

export async function insertActiveSessionFixturesForDirectContract(
  userID: string,
  count: number,
): Promise<void> {
  assertUserID(userID);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("authentication session fixture count is invalid");
  }
  await executeAuthSQL(`with inserted as (
  insert into auth_sessions (
    user_id,
    token_hash,
    created_at,
    last_seen_at,
    idle_expires_at,
    absolute_expires_at
  )
  select
    '${userID}'::uuid,
    md5('${userID}:' || fixture_index::text) ||
      md5('auth-session:${userID}:' || fixture_index::text),
    now(),
    now(),
    now() + interval '7 days',
    now() + interval '30 days'
  from generate_series(1, ${count}) fixture_index
  returning id
)
select 1 / case when count(*) = ${count} then 1 else 0 end from inserted`);
}

export async function readAuthPersistenceForDirectContract(
  userID: string,
): Promise<AuthPersistenceRecord> {
  assertUserID(userID);
  const environment = await readAuthDatabaseEnvironment();
  const { stdout } = await execFileAsync(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-F",
      "\t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `select app_user.password_hash,
  latest.token_hash,
  (select count(*) from auth_sessions where user_id = app_user.id)
from users app_user
join lateral (
  select token_hash from auth_sessions
  where user_id = app_user.id
  order by created_at desc
  limit 1
) latest on true
where app_user.id = '${userID}'::uuid`,
    ],
    { env: environment, encoding: "utf8" },
  );
  const [passwordHash, sessionTokenHash, sessionCountText] = stdout
    .trim()
    .split("\t");
  const sessionCount = Number(sessionCountText);
  if (
    passwordHash === undefined ||
    sessionTokenHash === undefined ||
    !Number.isInteger(sessionCount)
  ) {
    throw new Error("authentication persistence query returned invalid data");
  }
  return { passwordHash, sessionTokenHash, sessionCount };
}

async function executeAuthSQL(sql: string): Promise<void> {
  await runCommand("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: await readAuthDatabaseEnvironment(),
    quiet: true,
  });
}

async function readAuthDatabaseEnvironment(): Promise<NodeJS.ProcessEnv> {
  const source = await readFile(runtimePath, "utf8");
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== "object" ||
    value === null ||
    !("controlledTimeDatabaseURL" in value) ||
    typeof value.controlledTimeDatabaseURL !== "string"
  ) {
    throw new Error("invalid authentication-state E2E runtime metadata");
  }
  const databaseURL = new URL(value.controlledTimeDatabaseURL);
  if (
    (databaseURL.protocol !== "postgres:" &&
      databaseURL.protocol !== "postgresql:") ||
    databaseURL.hostname === "" ||
    databaseURL.pathname.length <= 1
  ) {
    throw new Error("invalid authentication-state E2E database URL");
  }
  for (const key of databaseURL.searchParams.keys()) {
    if (key !== "sslmode") {
      throw new Error("invalid authentication-state E2E database URL options");
    }
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: databaseURL.hostname,
    PGPORT: databaseURL.port || "5432",
    PGDATABASE: decodeURIComponent(databaseURL.pathname.slice(1)),
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

function assertUserID(userID: string): void {
  if (!canonicalUUID.test(userID)) {
    throw new Error("authentication-state user ID must be a canonical UUID");
  }
}
