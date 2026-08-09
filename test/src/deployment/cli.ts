export interface DeployOptions {
  mode: "deploy" | "verify";
  skipCI: boolean;
  browser: boolean;
  help: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArguments(args: readonly string[]): DeployOptions {
  let mode: "deploy" | "verify" = "deploy";
  let modeSeen = false;
  let skipCI = false;
  let browser = true;
  let help = false;
  for (const argument of args) {
    switch (argument) {
      case "deploy":
      case "verify":
        if (modeSeen) {
          throw new UsageError("only one deploy command may be provided");
        }
        mode = argument;
        modeSeen = true;
        break;
      case "--skip-ci":
        skipCI = true;
        break;
      case "--no-browser":
        browser = false;
        break;
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        throw new UsageError(`unknown deploy option: ${argument}`);
    }
  }
  if (mode === "verify" && skipCI) {
    throw new UsageError("verify does not run CI, so --skip-ci is not valid");
  }
  return { mode, skipCI, browser, help };
}

export function usage(): string {
  return `Usage:
  ./deploy.sh [deploy] [--skip-ci] [--no-browser]
  ./deploy.sh verify [--no-browser]

The default command validates a clean committed checkout, uploads its source to
the existing linked Railway web service, waits for the exact deployment, and
verifies the public HTTPS application. It does not create infrastructure or
automatically roll back a failed release.
`;
}
