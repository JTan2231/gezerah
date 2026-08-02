import { randomBytes } from "node:crypto";

import { runCommand } from "./command";

export interface DisposableDatabase {
  name: string;
  url: string;
  drop: () => Promise<void>;
}

export async function createDisposableDatabase(): Promise<DisposableDatabase> {
  const baseURL =
    process.env.DND_TEST_DATABASE_URL ??
    process.env.DND_E2E_ADMIN_DATABASE_URL ??
    process.env.DND_DATABASE_URL ??
    "postgres://localhost:5432/postgres?sslmode=disable";
  const databaseName = `dnd_e2e_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const databaseURL = databaseURLWithName(baseURL, databaseName);
  const adminURL = databaseURLWithName(baseURL, "postgres");
  const quotedName = quoteIdentifier(databaseName);

  await runCommand(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      adminURL,
      "-c",
      `create database ${quotedName}`,
    ],
    { quiet: true },
  );

  let dropped = false;
  return {
    name: databaseName,
    url: databaseURL,
    drop: async () => {
      if (dropped) return;
      dropped = true;
      await runCommand(
        "psql",
        [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          adminURL,
          "-c",
          `select pg_terminate_backend(pid) from pg_stat_activity where datname = ${quoteLiteral(databaseName)} and pid <> pg_backend_pid()`,
        ],
        { quiet: true },
      );
      await runCommand(
        "psql",
        [
          "-v",
          "ON_ERROR_STOP=1",
          "-d",
          adminURL,
          "-c",
          `drop database if exists ${quotedName}`,
        ],
        { quiet: true },
      );
    },
  };
}

function databaseURLWithName(rawURL: string, databaseName: string): string {
  const url = new URL(rawURL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error(`unsafe database identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
