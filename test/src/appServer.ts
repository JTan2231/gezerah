import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { runCommand } from "./command";
import { createDisposableDatabase, type DisposableDatabase } from "./database";

export interface AppServer {
  baseURL: string;
  logPath: string;
  stop: () => Promise<void>;
}

export async function startAppServer(options: {
  repoRoot: string;
  artifactsDir: string;
}): Promise<AppServer> {
  await mkdir(options.artifactsDir, { recursive: true });
  process.stdout.write("\n==> E2E: building frontend\n");
  await runCommand("bun", ["run", "build"], {
    cwd: path.join(options.repoRoot, "web/frontend"),
  });

  const buildDir = await mkdtemp(path.join(os.tmpdir(), "dnd-e2e-bin-"));
  const binaryPath = path.join(buildDir, "dnd");
  try {
    process.stdout.write("\n==> E2E: building application\n");
    await runCommand(
      "go",
      ["build", "-trimpath", "-o", binaryPath, "./cmd/dnd"],
      {
        cwd: options.repoRoot,
      },
    );
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true });
    throw error;
  }

  let database: DisposableDatabase | undefined;
  let child: ChildProcess | undefined;
  let logStream: WriteStream | undefined;
  try {
    process.stdout.write("\n==> E2E: creating disposable database\n");
    database = await createDisposableDatabase();
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const logPath = path.join(options.artifactsDir, "app-server.log");
    logStream = createWriteStream(logPath, { flags: "w" });
    child = spawn(binaryPath, [], {
      cwd: options.repoRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        DND_ADDR: `127.0.0.1:${port}`,
        DND_DATABASE_URL: database.url,
        DND_LOG_LEVEL: "debug",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
    await waitForHealth(baseURL, child);

    const runningChild = child;
    const runningLog = logStream;
    const runningDatabase = database;
    let stopped = false;
    return {
      baseURL,
      logPath,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await stopProcess(runningChild).catch(() => undefined);
        await endStream(runningLog);
        await runningDatabase.drop();
        await rm(buildDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child !== undefined) await stopProcess(child).catch(() => undefined);
    if (logStream !== undefined) await endStream(logStream);
    if (database !== undefined) await database.drop().catch(() => undefined);
    await rm(buildDir, { recursive: true, force: true });
    throw error;
  }
}

async function waitForHealth(
  baseURL: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `application exited before health check: code=${child.exitCode ?? "none"} signal=${child.signalCode ?? "none"}`,
      );
    }
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // Startup and migrations are still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("application did not become healthy within 60 seconds");
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => signalProcess(child, "SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    signalProcess(child, "SIGTERM");
  });
}

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function endStream(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve) => stream.end(resolve));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate a TCP port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}
