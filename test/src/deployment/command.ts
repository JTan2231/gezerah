import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  inherit?: boolean;
  signal?: AbortSignal;
}

export class CommandFailure extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(options: {
    command: string;
    args: readonly string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }) {
    const output = options.stderr.trim() || options.stdout.trim();
    super(
      `${formatCommand(options.command, options.args)} failed with exit code ${options.exitCode ?? "unknown"}${output === "" ? "" : `\n${output}`}`,
    );
    this.name = "CommandFailure";
    this.command = options.command;
    this.args = options.args;
    this.exitCode = options.exitCode;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
  }
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions,
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      stdio: options.inherit === true ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout !== null) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    if (child.stderr !== null) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new CommandFailure({ command, args, exitCode, stdout, stderr }));
    });
  });
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((value) =>
      /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value),
    )
    .join(" ");
}
