export interface DeployOptions {
  mode: "deploy" | "verify";
  releaseStage: "pre-dns" | "post-cutover";
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
  let releaseStage: "pre-dns" | "post-cutover" = "post-cutover";
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
      case "--pre-dns":
        releaseStage = "pre-dns";
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
  if (mode === "verify" && releaseStage === "pre-dns") {
    throw new UsageError("--pre-dns is valid only while deploying a release");
  }
  return {
    mode,
    releaseStage,
    skipCI,
    browser: releaseStage === "pre-dns" ? false : browser,
    help,
  };
}

export function usage(): string {
  return `Usage:
  ./deploy.sh [deploy] [--skip-ci] [--no-browser] [--pre-dns]
  ./deploy.sh verify [--no-browser]

The default command validates a clean committed checkout, uploads its source to
the existing linked Railway web service, waits for the exact deployment, and
verifies the post-cutover canonical HTTPS application and domain cleanup.
--pre-dns instead verifies the deployed application over the exact generated
Railway provider hostname with HTTP checks only; it never runs the browser auth
probe against that non-canonical origin. The command does not create
infrastructure or automatically roll back a failed release.
`;
}
