import { spawn, type ChildProcess } from "node:child_process";
import { constants, createWriteStream, type WriteStream } from "node:fs";
import { access, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  startTestOpenAIStubServer,
  type TestOpenAIStubServer,
} from "./openAIStubServer";
import { runCommand } from "./command";
import { createDisposableDatabase, type DisposableDatabase } from "./database";

export interface AppServer {
  baseURL: string;
  controlledTimeDatabaseURL: string;
  logPath: string;
  stop: () => Promise<void>;
}

export async function startAppServer(options: {
  repoRoot: string;
  artifactsDir: string;
  prebuiltBinaryPath?: string;
}): Promise<AppServer> {
  const startupStartedAt = Date.now();
  await mkdir(options.artifactsDir, { recursive: true });
  const preparedBinary = await prepareApplication(options);

  let database: DisposableDatabase | undefined;
  let child: ChildProcess | undefined;
  let logStream: WriteStream | undefined;
  let openAIStubServer: TestOpenAIStubServer | undefined;
  try {
    openAIStubServer = await startTestOpenAIStubServer();
    process.stdout.write("\n==> E2E: creating disposable database\n");
    database = await createDisposableDatabase();
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const logPath = path.join(options.artifactsDir, "app-server.log");
    logStream = createWriteStream(logPath, { flags: "w" });
    child = spawn(preparedBinary.path, [], {
      cwd: options.repoRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        WROUGHT_ADDR: `127.0.0.1:${port}`,
        WROUGHT_DATABASE_URL: database.url,
        WROUGHT_LOG_LEVEL: "debug",
        WROUGHT_PUBLIC_ORIGIN: baseURL,
        OPENAI_API_KEY: "e2e-model-key",
        WROUGHT_OPENAI_BASE_URL: openAIStubServer.baseURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
    await waitForHealth(baseURL, child);
    reportTiming("database and application startup", startupStartedAt);

    const runningChild = child;
    const runningLog = logStream;
    const runningDatabase = database;
    const runningOpenAIStubServer = openAIStubServer;
    let stopped = false;
    return {
      baseURL,
      controlledTimeDatabaseURL: runningDatabase.url,
      logPath,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        const cleanupStartedAt = Date.now();
        try {
          await stopProcess(runningChild).catch(() => undefined);
          try {
            await endStream(runningLog);
          } finally {
            await runningDatabase.drop();
          }
        } finally {
          try {
            await runningOpenAIStubServer.stop();
          } finally {
            await preparedBinary.cleanup();
          }
          reportTiming("application and database cleanup", cleanupStartedAt);
        }
      },
    };
  } catch (error) {
    if (child !== undefined) await stopProcess(child).catch(() => undefined);
    if (logStream !== undefined)
      await endStream(logStream).catch(() => undefined);
    if (database !== undefined) await database.drop().catch(() => undefined);
    if (openAIStubServer !== undefined)
      await openAIStubServer.stop().catch(() => undefined);
    await preparedBinary.cleanup().catch(() => undefined);
    throw error;
  }
}

interface PreparedBinary {
  path: string;
  cleanup: () => Promise<void>;
}

async function prepareApplication(options: {
  repoRoot: string;
  prebuiltBinaryPath?: string;
}): Promise<PreparedBinary> {
  if (options.prebuiltBinaryPath !== undefined) {
    const binaryPath = path.resolve(
      options.repoRoot,
      options.prebuiltBinaryPath,
    );
    const binaryStat = await stat(binaryPath).catch(() => undefined);
    if (binaryStat?.isFile() !== true) {
      throw new Error(`prebuilt E2E application is not a file: ${binaryPath}`);
    }
    if (process.platform !== "win32") {
      await access(binaryPath, constants.X_OK);
    }
    process.stdout.write(
      `\n==> E2E: using verified application artifact ${binaryPath}\n`,
    );
    return { path: binaryPath, cleanup: async () => undefined };
  }

  process.stdout.write("\n==> E2E: building frontend (direct-run fallback)\n");
  const frontendStartedAt = Date.now();
  await runCommand("bun", ["run", "build"], {
    cwd: path.join(options.repoRoot, "web/frontend"),
  });
  reportTiming("fallback frontend build", frontendStartedAt);

  const buildDir = await mkdtemp(path.join(os.tmpdir(), "wrought-e2e-bin-"));
  const binaryPath = path.join(buildDir, "wrought");
  try {
    process.stdout.write(
      "\n==> E2E: building application (direct-run fallback)\n",
    );
    const backendStartedAt = Date.now();
    await runCommand(
      "go",
      ["build", "-trimpath", "-o", binaryPath, "./cmd/wrought"],
      {
        cwd: options.repoRoot,
      },
    );
    reportTiming("fallback application build", backendStartedAt);
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true });
    throw error;
  }
  return {
    path: binaryPath,
    cleanup: async () => rm(buildDir, { recursive: true, force: true }),
  };
}

async function waitForHealth(
  baseURL: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 10_000;
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("application did not become healthy within 10 seconds");
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => signalProcess(child, "SIGKILL"), 2_000);
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

function reportTiming(name: string, startedAt: number): void {
  process.stdout.write(
    `==> Timing: E2E ${name} ${((Date.now() - startedAt) / 1000).toFixed(3)}s\n`,
  );
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
