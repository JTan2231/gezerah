#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureBrowser } from "../browser";
import { repoRoot } from "../paths";
import { parseArguments, usage, UsageError } from "./cli";
import { runCommand } from "./command";
import { buildEvidence, writeEvidence } from "./evidence";
import {
  assertDeploymentManifest,
  assertNoActiveDeployment,
  databaseHealthy,
  findDeployment,
  RailwayClient,
  selectTarget,
  serviceHealthy,
  waitForDeployment,
  waitForHealthyServices,
  type RailwayDeployment,
  type RailwayEnvironment,
  type RailwayProject,
  type RailwayService,
  type UploadedDeployment,
} from "./railway";
import {
  normalizePublicURL,
  skippedBrowserCheck,
  verifyBrowser,
  verifyHTTP,
} from "./smoke";

interface DeploymentConfiguration {
  expectedProjectId: string;
  expectedProject: string;
  expectedEnvironmentId: string;
  expectedEnvironment: string;
  expectedWebId: string;
  expectedWeb: string;
  expectedDatabaseId: string;
  expectedDatabase: string;
  expectedDatabaseVolume: string;
  publicURL?: string;
  timeoutMs: number;
}

interface SourceIdentity {
  commit: string;
  shortCommit: string;
}

const RECENT_DEPLOYMENT_LIMIT = 20;
const DEPLOYMENT_HISTORY_LIMIT = 1_000;

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const configuration = readConfiguration(process.env);
  const controller = new AbortController();
  const abort = (signal: string) =>
    controller.abort(new Error(`deployment interrupted by ${signal}`));
  const abortInterrupt = () => abort("SIGINT");
  const abortTermination = () => abort("SIGTERM");
  process.once("SIGINT", abortInterrupt);
  process.once("SIGTERM", abortTermination);
  try {
    await runDeployment(options, configuration, controller.signal);
  } finally {
    process.removeListener("SIGINT", abortInterrupt);
    process.removeListener("SIGTERM", abortTermination);
  }
}

async function runDeployment(
  options: ReturnType<typeof parseArguments>,
  configuration: DeploymentConfiguration,
  signal: AbortSignal,
): Promise<void> {
  const startedAt = new Date().toISOString();
  stage("Preflight");
  const source = await readSourceIdentity(signal);
  if (options.mode === "deploy") await assertCleanSource(source, signal);

  const railway = new RailwayClient(repoRoot);
  const project = await railway.project(signal);
  const environment = exactEnvironment(
    project,
    configuration.expectedProjectId,
    configuration.expectedProject,
    configuration.expectedEnvironmentId,
    configuration.expectedEnvironment,
  );
  const initialServices = await railway.services(environment.id, signal);
  let target = selectTarget({
    project,
    services: initialServices,
    expectedProjectId: configuration.expectedProjectId,
    expectedProject: configuration.expectedProject,
    expectedEnvironmentId: configuration.expectedEnvironmentId,
    expectedEnvironment: configuration.expectedEnvironment,
    expectedWebId: configuration.expectedWebId,
    expectedWeb: configuration.expectedWeb,
    expectedDatabaseId: configuration.expectedDatabaseId,
    expectedDatabase: configuration.expectedDatabase,
  });

  let deployment: RailwayDeployment;
  if (options.mode === "deploy") {
    if (
      !databaseHealthy(target.database, configuration.expectedDatabaseVolume)
    ) {
      throw new Error(
        "the Railway PostgreSQL service or its persistent volume is not healthy",
      );
    }
    const existingDeployments = await railway.deployments(
      target.web.id,
      environment.id,
      DEPLOYMENT_HISTORY_LIMIT,
      signal,
    );
    assertNoActiveDeployment(existingDeployments);

    if (!options.skipCI) {
      stage("Complete repository validation");
      await runCommand("./ci.sh", [], {
        cwd: repoRoot,
        inherit: true,
        signal,
      });
      await assertCleanSource(source, signal);
    } else {
      process.stdout.write("Skipping ./ci.sh by explicit request.\n");
    }

    stage("Railway source upload");
    const message = `Deploy ${source.shortCommit} ${randomUUID()}`;
    const uploaded = await uploadCommittedSource({
      commit: source.commit,
      projectId: project.id,
      environmentId: environment.id,
      serviceId: target.web.id,
      message,
      signal,
    });
    process.stdout.write(`Deployment: ${uploaded.deploymentId}\n`);
    if (uploaded.logsUrl !== undefined) {
      process.stdout.write(`Railway logs: ${uploaded.logsUrl}\n`);
    }
    await assertCleanSource(source, signal);

    stage("Railway build and rollout");
    try {
      deployment = await waitForDeployment(
        uploaded.deploymentId,
        () =>
          railway.deployments(
            target.web.id,
            environment.id,
            RECENT_DEPLOYMENT_LIMIT,
            signal,
          ),
        {
          timeoutMs: configuration.timeoutMs,
          pollMs: 2_000,
          signal,
          onStatus: (status) => process.stdout.write(`  ${status}\n`),
        },
      );
      if (deployment.message !== message) {
        throw new Error(
          `deployment ${deployment.id} has an unexpected Railway message`,
        );
      }
      assertDeploymentManifest(deployment);
      const rolledOut = await waitForHealthyServices(
        () => railway.services(environment.id, signal),
        {
          targetDeploymentId: deployment.id,
          webServiceId: configuration.expectedWebId,
          webService: configuration.expectedWeb,
          databaseServiceId: configuration.expectedDatabaseId,
          databaseService: configuration.expectedDatabase,
          databaseVolume: configuration.expectedDatabaseVolume,
          timeoutMs: 60_000,
          pollMs: 2_000,
          signal,
          onStatus: (status) => process.stdout.write(`  ${status}\n`),
        },
      );
      target = { ...target, web: rolledOut.web, database: rolledOut.database };
    } catch (error) {
      const diagnostics = await railway.diagnosticLogs(
        uploaded.deploymentId,
        signal,
      );
      process.stderr.write(`${diagnostics}\n`);
      throw error;
    }
  } else {
    stage("Current Railway release");
    if (
      !serviceHealthy(target.web) ||
      !databaseHealthy(target.database, configuration.expectedDatabaseVolume)
    ) {
      throw new Error(
        "the current Railway web, PostgreSQL, or database volume state is not healthy",
      );
    }
    const deployments = await railway.deployments(
      target.web.id,
      environment.id,
      DEPLOYMENT_HISTORY_LIMIT,
      signal,
    );
    assertNoActiveDeployment(deployments);
    deployment = findDeployment(deployments, target.web.deploymentId);
    if (deployment.status !== "SUCCESS") {
      throw new Error(
        `current Railway deployment ${deployment.id} is ${deployment.status}, expected SUCCESS`,
      );
    }
    assertDeploymentManifest(deployment);
  }

  const publicURL = boundPublicURL(configuration.publicURL, target.web);
  stage("Public HTTPS smoke");
  const http = await verifyHTTP(publicURL, { signal });
  for (const check of http) {
    process.stdout.write(
      `  ${check.status} ${new URL(check.url).pathname} (${check.bytes} bytes)\n`,
    );
  }

  let browser = skippedBrowserCheck();
  if (options.browser) {
    stage("Real browser smoke");
    const executablePath = await ensureBrowser(signal);
    browser = await verifyBrowser(publicURL, {
      ...(executablePath === undefined ? {} : { executablePath }),
      signal,
    });
    process.stdout.write(
      `  ${browser.title ?? "browser"} ${browser.finalPath ?? ""}; auth probe passed\n`,
    );
  } else {
    process.stdout.write("Browser smoke skipped by explicit request.\n");
  }

  stage("Final Railway consistency");
  const finalTarget = selectTarget({
    project,
    services: await railway.services(environment.id, signal),
    expectedProjectId: configuration.expectedProjectId,
    expectedProject: configuration.expectedProject,
    expectedEnvironmentId: configuration.expectedEnvironmentId,
    expectedEnvironment: configuration.expectedEnvironment,
    expectedWebId: configuration.expectedWebId,
    expectedWeb: configuration.expectedWeb,
    expectedDatabaseId: configuration.expectedDatabaseId,
    expectedDatabase: configuration.expectedDatabase,
  });
  const finalDeployments = await railway.deployments(
    finalTarget.web.id,
    environment.id,
    DEPLOYMENT_HISTORY_LIMIT,
    signal,
  );
  assertNoActiveDeployment(finalDeployments);
  const finalDeployment = findDeployment(finalDeployments, deployment.id);
  if (
    finalTarget.web.deploymentId !== deployment.id ||
    finalDeployment.status !== "SUCCESS" ||
    !serviceHealthy(finalTarget.web) ||
    !databaseHealthy(finalTarget.database, configuration.expectedDatabaseVolume)
  ) {
    throw new Error(
      `Railway release changed or became unhealthy during smoke verification; expected deployment ${deployment.id}, found ${finalTarget.web.deploymentId}`,
    );
  }
  const finalPublicURL = boundPublicURL(
    configuration.publicURL,
    finalTarget.web,
  );
  if (finalPublicURL !== publicURL) {
    throw new Error(
      `Railway public URL changed during smoke verification; expected ${publicURL}, found ${finalPublicURL}`,
    );
  }
  target = finalTarget;
  deployment = finalDeployment;

  const completedAt = new Date().toISOString();
  const evidence = buildEvidence({
    mode: options.mode,
    ci:
      options.mode === "verify"
        ? "not-run"
        : options.skipCI
          ? "skipped"
          : "passed",
    project,
    environment,
    web: target.web,
    database: target.database,
    deployment,
    localCommit: source.commit,
    publicURL,
    http,
    browser,
    startedAt,
    completedAt,
  });
  const evidencePath = await writeEvidence(repoRoot, evidence);
  printSummary(evidencePath, evidence);
}

function readConfiguration(env: NodeJS.ProcessEnv): DeploymentConfiguration {
  return {
    expectedProjectId:
      env.SCRYER_DEPLOY_PROJECT_ID ?? "0bc0c39c-c630-4898-b4af-d7f0ebe459db",
    expectedProject: env.SCRYER_DEPLOY_PROJECT ?? "Scryer",
    expectedEnvironmentId:
      env.SCRYER_DEPLOY_ENVIRONMENT_ID ??
      "9f15ee7b-a2b6-4fbb-b6dc-966739a8bc08",
    expectedEnvironment: env.SCRYER_DEPLOY_ENVIRONMENT ?? "production",
    expectedWebId:
      env.SCRYER_DEPLOY_WEB_SERVICE_ID ??
      "73261ce4-d382-41a5-a7ac-64dd71c536ab",
    expectedWeb: env.SCRYER_DEPLOY_WEB_SERVICE ?? "scryer-web",
    expectedDatabaseId:
      env.SCRYER_DEPLOY_DATABASE_SERVICE_ID ??
      "beb083b4-4ca6-4b3d-b2df-c429e9746f44",
    expectedDatabase: env.SCRYER_DEPLOY_DATABASE_SERVICE ?? "Postgres",
    expectedDatabaseVolume:
      env.SCRYER_DEPLOY_DATABASE_VOLUME ?? "postgres-volume",
    publicURL: normalizePublicURL(
      env.SCRYER_DEPLOY_URL ?? "https://scryingorb.com",
    ),
    timeoutMs: readTimeout(env.SCRYER_DEPLOY_TIMEOUT_SECONDS),
  };
}

function readTimeout(value: string | undefined): number {
  if (value === undefined) return 10 * 60 * 1_000;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3_600) {
    throw new UsageError(
      "SCRYER_DEPLOY_TIMEOUT_SECONDS must be an integer from 30 through 3600",
    );
  }
  return seconds * 1_000;
}

async function readSourceIdentity(
  signal: AbortSignal,
): Promise<SourceIdentity> {
  const [commitResult, shortResult] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot, signal }),
    runCommand("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      signal,
    }),
  ]);
  const commit = commitResult.stdout.trim();
  const shortCommit = shortResult.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(commit) || !/^[0-9a-f]+$/i.test(shortCommit)) {
    throw new Error("could not resolve a valid Git source identity");
  }
  return { commit, shortCommit };
}

async function assertCleanSource(
  expected: SourceIdentity,
  signal: AbortSignal,
): Promise<void> {
  const [current, status] = await Promise.all([
    readSourceIdentity(signal),
    runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repoRoot,
      signal,
    }),
  ]);
  if (current.commit !== expected.commit || status.stdout.trim() !== "") {
    throw new Error(
      "deployment requires a clean committed checkout that remains unchanged through validation",
    );
  }
}

async function uploadCommittedSource(options: {
  commit: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  message: string;
  signal: AbortSignal;
}): Promise<UploadedDeployment> {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "scryer-deploy-source-"),
  );
  const checkout = path.join(temporaryRoot, "source");
  let worktreeAdded = false;
  try {
    await runCommand(
      "git",
      ["worktree", "add", "--detach", checkout, options.commit],
      { cwd: repoRoot, signal: options.signal },
    );
    worktreeAdded = true;
    return await new RailwayClient(checkout).upload({
      projectId: options.projectId,
      environmentId: options.environmentId,
      serviceId: options.serviceId,
      message: options.message,
      signal: options.signal,
    });
  } finally {
    const cleanupErrors: string[] = [];
    if (worktreeAdded) {
      try {
        await runCommand("git", ["worktree", "remove", "--force", checkout], {
          cwd: repoRoot,
        });
      } catch (error) {
        cleanupErrors.push(safeError(error));
      }
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(safeError(error));
    }
    if (cleanupErrors.length > 0) {
      const message = `temporary deployment source cleanup failed: ${cleanupErrors.join("; ")}`;
      process.stderr.write(`${message}\n`);
    }
  }
}

function exactEnvironment(
  project: RailwayProject,
  expectedProjectId: string,
  expectedProjectName: string,
  expectedId: string,
  expectedName: string,
): RailwayEnvironment {
  if (
    project.id !== expectedProjectId ||
    project.name !== expectedProjectName
  ) {
    throw new Error(
      `linked Railway project is ${project.id} ${JSON.stringify(project.name)}, expected ${expectedProjectId} ${JSON.stringify(expectedProjectName)}`,
    );
  }
  const matches = project.environments.filter(({ id }) => id === expectedId);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one Railway environment with ID ${expectedId}, found ${matches.length}`,
    );
  }
  const environment = matches[0] as RailwayEnvironment;
  if (environment.name !== expectedName) {
    throw new Error(
      `Railway environment ${expectedId} is named ${JSON.stringify(environment.name)}, expected ${JSON.stringify(expectedName)}`,
    );
  }
  return environment;
}

function requiredPublicURL(service: RailwayService): string {
  if (service.url === undefined) {
    throw new Error(
      `Railway service ${service.name} does not expose a public URL`,
    );
  }
  return service.url;
}

function boundPublicURL(
  configuredURL: string | undefined,
  service: RailwayService,
): string {
  const discoveredURL = normalizePublicURL(requiredPublicURL(service));
  if (configuredURL !== undefined && configuredURL !== discoveredURL) {
    throw new Error(
      `SCRYER_DEPLOY_URL is ${configuredURL}, but Railway service ${service.id} exposes ${discoveredURL}`,
    );
  }
  return discoveredURL;
}

function stage(name: string): void {
  process.stdout.write(`\n==> Deploy: ${name}\n`);
}

function printSummary(
  evidencePath: string,
  evidence: ReturnType<typeof buildEvidence>,
): void {
  const sourceLine =
    evidence.mode === "deploy"
      ? `Uploaded:     ${evidence.uploadedCommit ?? evidence.localCommit}`
      : `Local only:   ${evidence.localCommit} (not release identity)`;
  process.stdout.write(`
Deployment verification passed

${sourceLine}
CI:           ${evidence.ci}
Deployment:   ${evidence.deployment.id}
URL:          ${evidence.publicURL}
Web replica:  ${evidence.railway.web.replicas.running}/${evidence.railway.web.replicas.configured} running
Postgres:     ${evidence.railway.database.replicas.running}/${evidence.railway.database.replicas.configured} running
HTTP checks:  ${evidence.http.length} passed
Browser:      ${evidence.browser.skipped ? "skipped" : "passed"}
Evidence:     ${evidencePath}
`);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
