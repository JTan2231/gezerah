import { runCommand, type CommandResult } from "./command";

type JSONRecord = Record<string, unknown>;

export interface RailwayEnvironment {
  id: string;
  name: string;
  serviceDomains: readonly RailwayServiceDomains[];
}

export interface RailwayServiceDomains {
  serviceId: string;
  serviceName: string;
  customDomains: readonly string[];
  serviceDomains: readonly string[];
}

export interface RailwayProject {
  id: string;
  name: string;
  environments: readonly RailwayEnvironment[];
}

export interface ReplicaState {
  configured: number;
  running: number;
  crashed: number;
  exited: number;
  total: number;
}

export interface RailwayVolume {
  name: string;
  state: string;
  sizeMb: number;
  mountPath: string;
}

export interface RailwayService {
  id: string;
  name: string;
  status: string;
  deploymentId: string;
  deploymentStopped: boolean;
  volumeMigrating: boolean;
  url?: string;
  replicas: ReplicaState;
  volumes: readonly RailwayVolume[];
}

export interface DeploymentManifest {
  healthcheckPath?: string;
  healthcheckTimeout?: number;
  numReplicas?: number;
  drainingSeconds?: number;
}

export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string;
  message?: string;
  manifest?: DeploymentManifest;
}

export interface UploadedDeployment {
  deploymentId: string;
  logsUrl?: string;
}

export interface RailwayTarget {
  project: RailwayProject;
  environment: RailwayEnvironment;
  web: RailwayService;
  database: RailwayService;
}

export type RailwayExec = (
  args: readonly string[],
  options?: { signal?: AbortSignal },
) => Promise<CommandResult>;

export class RailwayClient {
  readonly #exec: RailwayExec;

  constructor(
    private readonly repoRoot: string,
    exec?: RailwayExec,
  ) {
    this.#exec =
      exec ??
      ((args, options) =>
        runCommand("railway", args, {
          cwd: this.repoRoot,
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }));
  }

  async project(signal?: AbortSignal): Promise<RailwayProject> {
    return parseProjectStatus(await this.#json(["status", "--json"], signal));
  }

  async services(
    environmentId: string,
    signal?: AbortSignal,
  ): Promise<readonly RailwayService[]> {
    return parseServiceList(
      await this.#json(
        ["service", "list", "--environment", environmentId, "--json"],
        signal,
      ),
    );
  }

  async deployments(
    serviceId: string,
    environmentId: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<readonly RailwayDeployment[]> {
    return parseDeploymentList(
      await this.#json(
        [
          "deployment",
          "list",
          "--service",
          serviceId,
          "--environment",
          environmentId,
          "--limit",
          String(limit),
          "--json",
        ],
        signal,
      ),
    );
  }

  async upload(options: {
    projectId: string;
    environmentId: string;
    serviceId: string;
    message: string;
    signal?: AbortSignal;
  }): Promise<UploadedDeployment> {
    const result = await this.#exec(
      [
        "up",
        "--project",
        options.projectId,
        "--environment",
        options.environmentId,
        "--service",
        options.serviceId,
        "--detach",
        "--json",
        "--message",
        options.message,
      ],
      options.signal === undefined ? {} : { signal: options.signal },
    );
    return parseUploadOutput(result.stdout);
  }

  async diagnosticLogs(
    deploymentId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const outputs = await Promise.all(
      ["build", "deployment"].map(async (kind) => {
        try {
          const result = await this.#exec(
            ["logs", deploymentId, `--${kind}`, "--lines", "100"],
            signal === undefined ? {} : { signal },
          );
          return `==> Railway ${kind} logs\n${result.stdout.trim()}`;
        } catch (error) {
          return `==> Railway ${kind} logs unavailable: ${safeError(error)}`;
        }
      }),
    );
    return outputs.join("\n\n");
  }

  async #json(args: readonly string[], signal?: AbortSignal): Promise<unknown> {
    const result = await this.#exec(
      args,
      signal === undefined ? {} : { signal },
    );
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch (error) {
      throw new Error(
        `railway ${args.join(" ")} returned invalid JSON: ${safeError(error)}`,
      );
    }
  }
}

export function parseProjectStatus(value: unknown): RailwayProject {
  const project = record(value, "Railway project status");
  const environmentContainer = record(
    project.environments,
    "Railway project environments",
  );
  const environmentEdges = array(
    environmentContainer.edges,
    "Railway project environment edges",
  );
  const environments = environmentEdges.map((edge, index) => {
    const edgeRecord = record(edge, `Railway environment edge ${index}`);
    const node = record(
      edgeRecord.node,
      `Railway environment edge ${index} node`,
    );
    const serviceInstanceContainer = record(
      node.serviceInstances,
      `Railway environment ${index} service instances`,
    );
    const serviceInstanceEdges = array(
      serviceInstanceContainer.edges,
      `Railway environment ${index} service instance edges`,
    );
    const serviceDomains = serviceInstanceEdges.map(
      (serviceEdge, serviceIndex) => {
        const serviceEdgeRecord = record(
          serviceEdge,
          `Railway environment ${index} service instance edge ${serviceIndex}`,
        );
        const service = record(
          serviceEdgeRecord.node,
          `Railway environment ${index} service instance ${serviceIndex}`,
        );
        const domainContainer = record(
          service.domains,
          `Railway environment ${index} service instance ${serviceIndex} domains`,
        );
        const customDomains = parseDomains(
          array(
            domainContainer.customDomains,
            `Railway environment ${index} service instance ${serviceIndex} custom domains`,
          ),
          `Railway environment ${index} service instance ${serviceIndex} custom domain`,
        );
        const railwayServiceDomains = parseDomains(
          array(
            domainContainer.serviceDomains,
            `Railway environment ${index} service instance ${serviceIndex} service domains`,
          ),
          `Railway environment ${index} service instance ${serviceIndex} service domain`,
        );
        const allDomains = [...customDomains, ...railwayServiceDomains];
        if (new Set(allDomains).size !== allDomains.length) {
          throw new Error(
            `Railway environment ${index} service instance ${serviceIndex} contains duplicate domains`,
          );
        }
        return {
          serviceId: string(
            service.serviceId,
            `Railway environment ${index} service instance ${serviceIndex} service id`,
          ),
          serviceName: string(
            service.serviceName,
            `Railway environment ${index} service instance ${serviceIndex} service name`,
          ),
          customDomains,
          serviceDomains: railwayServiceDomains,
        };
      },
    );
    if (
      new Set(serviceDomains.map(({ serviceId }) => serviceId)).size !==
      serviceDomains.length
    ) {
      throw new Error(
        `Railway environment ${index} contains duplicate service domain bindings`,
      );
    }
    return {
      id: string(node.id, `Railway environment ${index} id`),
      name: string(node.name, `Railway environment ${index} name`),
      serviceDomains,
    };
  });
  return {
    id: string(project.id, "Railway project id"),
    name: string(project.name, "Railway project name"),
    environments,
  };
}

export function parseServiceList(value: unknown): readonly RailwayService[] {
  return array(value, "Railway service list").map((item, index) => {
    const service = record(item, `Railway service ${index}`);
    const replicaSource = record(
      service.replicas,
      `Railway service ${index} replicas`,
    );
    const url = nullableString(service.url, `Railway service ${index} URL`);
    return {
      id: string(service.id, `Railway service ${index} id`),
      name: string(service.name, `Railway service ${index} name`),
      status: string(service.status, `Railway service ${index} status`),
      deploymentId: string(
        service.deploymentId,
        `Railway service ${index} deployment id`,
      ),
      deploymentStopped: boolean(
        service.deploymentStopped,
        `Railway service ${index} deployment stopped`,
      ),
      volumeMigrating: boolean(
        service.volumeMigrating,
        `Railway service ${index} volume migrating`,
      ),
      ...(url === null ? {} : { url }),
      replicas: {
        configured: number(
          replicaSource.configured,
          `Railway service ${index} configured replicas`,
        ),
        running: number(
          replicaSource.running,
          `Railway service ${index} running replicas`,
        ),
        crashed: number(
          replicaSource.crashed,
          `Railway service ${index} crashed replicas`,
        ),
        exited: number(
          replicaSource.exited,
          `Railway service ${index} exited replicas`,
        ),
        total: number(
          replicaSource.total,
          `Railway service ${index} total replicas`,
        ),
      },
      volumes: array(service.volumes, `Railway service ${index} volumes`).map(
        (volumeValue, volumeIndex) => {
          const volume = record(
            volumeValue,
            `Railway service ${index} volume ${volumeIndex}`,
          );
          return {
            name: string(
              volume.name,
              `Railway service ${index} volume ${volumeIndex} name`,
            ),
            state: string(
              volume.state,
              `Railway service ${index} volume ${volumeIndex} state`,
            ),
            sizeMb: number(
              volume.sizeMb,
              `Railway service ${index} volume ${volumeIndex} size`,
            ),
            mountPath: string(
              volume.mountPath,
              `Railway service ${index} volume ${volumeIndex} mount path`,
            ),
          };
        },
      ),
    };
  });
}

export function parseDeploymentList(
  value: unknown,
): readonly RailwayDeployment[] {
  return array(value, "Railway deployment list").map((item, index) => {
    const deployment = record(item, `Railway deployment ${index}`);
    const meta = optionalRecord(deployment.meta);
    const message = optionalString(meta?.cliMessage);
    const manifestSource = optionalRecord(
      optionalRecord(meta?.serviceManifest)?.deploy,
    );
    const manifest = parseManifest(manifestSource);
    return {
      id: string(deployment.id, `Railway deployment ${index} id`),
      status: string(deployment.status, `Railway deployment ${index} status`),
      createdAt: string(
        deployment.createdAt,
        `Railway deployment ${index} created at`,
      ),
      ...(message === undefined ? {} : { message }),
      ...(manifest === undefined ? {} : { manifest }),
    };
  });
}

export function parseUploadOutput(output: string): UploadedDeployment {
  const candidates: unknown[] = [];
  try {
    candidates.push(JSON.parse(output) as unknown);
  } catch {
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        candidates.push(JSON.parse(trimmed) as unknown);
      } catch {
        // Railway can mix progress output with its final JSON record.
      }
    }
  }
  const uploads = candidates.flatMap((candidate) => {
    const source = optionalRecord(candidate);
    const deploymentId = optionalString(source?.deploymentId);
    if (deploymentId === undefined) return [];
    return [
      {
        deploymentId,
        logsUrl: optionalString(source?.logsUrl),
      },
    ];
  });
  const ids = new Set(uploads.map(({ deploymentId }) => deploymentId));
  if (ids.size !== 1) {
    throw new Error(
      ids.size === 0
        ? "Railway upload output did not contain a deploymentId"
        : "Railway upload output contained conflicting deployment IDs",
    );
  }
  const upload = uploads.at(-1);
  if (upload === undefined || !isUUID(upload.deploymentId)) {
    throw new Error("Railway upload returned an invalid deploymentId");
  }
  return {
    deploymentId: upload.deploymentId,
    ...(upload.logsUrl === undefined ? {} : { logsUrl: upload.logsUrl }),
  };
}

export function selectTarget(options: {
  project: RailwayProject;
  services: readonly RailwayService[];
  expectedProjectId: string | undefined;
  expectedProject: string;
  expectedEnvironmentId: string | undefined;
  expectedEnvironment: string;
  expectedWebId: string | undefined;
  expectedWeb: string;
  expectedDatabaseId: string | undefined;
  expectedDatabase: string;
}): RailwayTarget {
  if (
    (options.expectedProjectId !== undefined &&
      options.project.id !== options.expectedProjectId) ||
    options.project.name !== options.expectedProject
  ) {
    throw new Error(
      `linked Railway project is ${options.project.id} ${JSON.stringify(options.project.name)}, expected ${options.expectedProjectId === undefined ? "a project named" : options.expectedProjectId} ${JSON.stringify(options.expectedProject)}`,
    );
  }
  const environment = exactIdentity(
    options.project.environments,
    options.expectedEnvironmentId,
    options.expectedEnvironment,
    "Railway environment",
  );
  const web = exactIdentity(
    options.services,
    options.expectedWebId,
    options.expectedWeb,
    "Railway service",
  );
  const database = exactIdentity(
    options.services,
    options.expectedDatabaseId,
    options.expectedDatabase,
    "Railway service",
  );
  return { project: options.project, environment, web, database };
}

export function assertPublicURLExposed(
  environment: RailwayEnvironment,
  service: RailwayService,
  publicURL: string,
): void {
  let hostname: string;
  try {
    const parsed = new URL(publicURL);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error("not a credential-free HTTPS URL");
    }
    hostname = parsed.hostname;
  } catch {
    throw new Error(
      `public URL ${JSON.stringify(publicURL)} is not a credential-free HTTPS URL`,
    );
  }
  const match = exactServiceDomains(environment, service);
  const domains = [...match.customDomains, ...match.serviceDomains];
  if (!domains.includes(hostname)) {
    throw new Error(
      `Railway service ${service.id} does not expose ${publicURL}; exposed domains: ${domains.length === 0 ? "none" : domains.join(", ")}`,
    );
  }
}

export function railwayProviderPublicURL(
  environment: RailwayEnvironment,
  service: RailwayService,
): string {
  const binding = exactServiceDomains(environment, service);
  const generated = binding.serviceDomains.filter(isRailwayProviderHostname);
  if (generated.length !== 1) {
    throw new Error(
      `expected exactly one generated Railway provider hostname for service ${service.id}, found ${generated.length}`,
    );
  }
  return `https://${generated[0]}`;
}

export function assertPostCutoverDomains(
  environment: RailwayEnvironment,
  service: RailwayService,
): void {
  const binding = exactServiceDomains(environment, service);
  if (
    binding.customDomains.length !== 1 ||
    binding.customDomains[0] !== "wrought.joeytan.dev"
  ) {
    throw new Error(
      `post-cutover Railway domains for service ${service.id} must contain only custom domain wrought.joeytan.dev; found ${binding.customDomains.length === 0 ? "none" : binding.customDomains.join(", ")}`,
    );
  }
  const providerHostname = new URL(
    railwayProviderPublicURL(environment, service),
  ).hostname;
  const serviceLabel = service.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const providerLabel = providerHostname.split(".")[0] ?? "";
  if (
    serviceLabel === "" ||
    (providerLabel !== serviceLabel &&
      !providerLabel.startsWith(`${serviceLabel}-`))
  ) {
    throw new Error(
      `post-cutover Railway provider hostname ${providerHostname} is not aligned with current service name ${JSON.stringify(service.name)}`,
    );
  }
}

export function assertNoActiveDeployment(
  deployments: readonly RailwayDeployment[],
): void {
  for (const deployment of deployments) {
    if (BLOCKING_DEPLOYMENT_STATUSES.has(deployment.status)) {
      throw new Error(
        `Railway deployment ${deployment.id} is already ${deployment.status}; resolve it before deploying`,
      );
    }
    if (!TERMINAL_DEPLOYMENT_STATUSES.has(deployment.status)) {
      throw new Error(
        `Railway deployment ${deployment.id} has unsupported status ${deployment.status}; refusing to overlap it`,
      );
    }
  }
}

export function assertDeploymentManifest(deployment: RailwayDeployment): void {
  if (deployment.manifest?.healthcheckPath !== "/api/health") {
    throw new Error(
      `deployment ${deployment.id} does not expose the expected /api/health check`,
    );
  }
  if (deployment.manifest.numReplicas !== 1) {
    throw new Error(
      `deployment ${deployment.id} has ${deployment.manifest.numReplicas ?? "unknown"} configured web replicas, expected 1`,
    );
  }
  if (deployment.manifest.healthcheckTimeout !== 30) {
    throw new Error(
      `deployment ${deployment.id} has ${deployment.manifest.healthcheckTimeout ?? "unknown"} health-check timeout seconds, expected 30`,
    );
  }
  if (
    deployment.manifest.drainingSeconds === undefined ||
    deployment.manifest.drainingSeconds <= 10
  ) {
    throw new Error(
      `deployment ${deployment.id} has ${deployment.manifest.drainingSeconds ?? "unknown"} draining seconds, expected more than 10`,
    );
  }
}

export interface PollOptions {
  timeoutMs: number;
  pollMs: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onStatus?: (status: string) => void;
}

export async function waitForDeployment(
  deploymentId: string,
  load: () => Promise<readonly RailwayDeployment[]>,
  options: PollOptions,
): Promise<RailwayDeployment> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const startedAt = now();
  let lastStatus = "not visible";
  let reportedStatus = "";
  while (true) {
    throwIfAborted(options.signal);
    const deployment = (await load()).find(({ id }) => id === deploymentId);
    const status = deployment?.status ?? "not visible";
    lastStatus = status;
    if (status !== reportedStatus) {
      options.onStatus?.(status);
      reportedStatus = status;
    }
    if (deployment !== undefined) {
      if (deployment.status === "SUCCESS") return deployment;
      if (FAILED_DEPLOYMENT_STATUSES.has(deployment.status)) {
        throw new Error(
          `Railway deployment ${deploymentId} ended with ${deployment.status}`,
        );
      }
      if (!ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status)) {
        throw new Error(
          `Railway deployment ${deploymentId} returned unsupported status ${deployment.status}`,
        );
      }
    }
    if (now() - startedAt >= options.timeoutMs) {
      throw new Error(
        `Railway deployment ${deploymentId} did not finish within ${options.timeoutMs}ms; last status: ${lastStatus}`,
      );
    }
    await sleep(options.pollMs, options.signal);
  }
}

export async function waitForHealthyServices(
  load: () => Promise<readonly RailwayService[]>,
  options: PollOptions & {
    targetDeploymentId: string;
    webServiceId: string;
    webService: string;
    databaseServiceId: string;
    databaseService: string;
    databaseVolume: string;
  },
): Promise<{ web: RailwayService; database: RailwayService }> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const startedAt = now();
  let lastStatus = "not checked";
  let reportedStatus = "";
  while (true) {
    throwIfAborted(options.signal);
    const services = await load();
    const web = exactIdentity(
      services,
      options.webServiceId,
      options.webService,
      "Railway service",
    );
    const database = exactIdentity(
      services,
      options.databaseServiceId,
      options.databaseService,
      "Railway service",
    );
    const webReady =
      web.deploymentId === options.targetDeploymentId && serviceHealthy(web);
    const databaseReady = databaseHealthy(database, options.databaseVolume);
    const status = `web ${web.replicas.running}/${web.replicas.configured} ${web.status} (${web.deploymentId}); database ${database.replicas.running}/${database.replicas.configured} ${database.status}, volume migrating=${database.volumeMigrating}`;
    lastStatus = status;
    if (status !== reportedStatus) {
      options.onStatus?.(status);
      reportedStatus = status;
    }
    if (webReady && databaseReady) return { web, database };
    if (now() - startedAt >= options.timeoutMs) {
      throw new Error(
        `Railway services did not become healthy within ${options.timeoutMs}ms; last status: ${lastStatus}`,
      );
    }
    await sleep(options.pollMs, options.signal);
  }
}

export function serviceHealthy(service: RailwayService): boolean {
  return (
    service.status === "SUCCESS" &&
    !service.deploymentStopped &&
    service.replicas.configured === 1 &&
    service.replicas.running === 1 &&
    service.replicas.crashed === 0 &&
    service.replicas.exited === 0
  );
}

export function databaseHealthy(
  service: RailwayService,
  expectedVolume: string,
): boolean {
  if (
    !serviceHealthy(service) ||
    service.volumeMigrating ||
    service.volumes.length !== 1
  ) {
    return false;
  }
  const volume = service.volumes[0];
  return (
    volume?.name === expectedVolume &&
    volume.state === "READY" &&
    volume.mountPath === "/var/lib/postgresql/data" &&
    volume.sizeMb >= 5_000
  );
}

export function findDeployment(
  deployments: readonly RailwayDeployment[],
  deploymentId: string,
): RailwayDeployment {
  const deployment = deployments.find(({ id }) => id === deploymentId);
  if (deployment === undefined) {
    throw new Error(`Railway deployment ${deploymentId} was not found`);
  }
  return deployment;
}

const ACTIVE_DEPLOYMENT_STATUSES = new Set([
  "QUEUED",
  "INITIALIZING",
  "BUILDING",
  "DEPLOYING",
  "WAITING",
]);

const BLOCKING_DEPLOYMENT_STATUSES = new Set([
  ...ACTIVE_DEPLOYMENT_STATUSES,
  "NEEDS_APPROVAL",
]);

const FAILED_DEPLOYMENT_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "REMOVED",
  "CANCELED",
  "SKIPPED",
  "NEEDS_APPROVAL",
]);

const TERMINAL_DEPLOYMENT_STATUSES = new Set([
  "SUCCESS",
  "FAILED",
  "CRASHED",
  "REMOVED",
  "CANCELED",
  "SKIPPED",
  "SLEEPING",
]);

function parseManifest(
  source: JSONRecord | undefined,
): DeploymentManifest | undefined {
  if (source === undefined) return undefined;
  const healthcheckPath = optionalString(source.healthcheckPath);
  const healthcheckTimeout = optionalNumber(source.healthcheckTimeout);
  const numReplicas = optionalNumber(source.numReplicas);
  const drainingSeconds = optionalNumber(source.drainingSeconds);
  return {
    ...(healthcheckPath === undefined ? {} : { healthcheckPath }),
    ...(healthcheckTimeout === undefined ? {} : { healthcheckTimeout }),
    ...(numReplicas === undefined ? {} : { numReplicas }),
    ...(drainingSeconds === undefined ? {} : { drainingSeconds }),
  };
}

function parseDomains(values: readonly unknown[], label: string): string[] {
  return values.map((value, index) => {
    const domain = record(value, `${label} ${index}`);
    return string(domain.domain, `${label} ${index} name`);
  });
}

function exactServiceDomains(
  environment: RailwayEnvironment,
  service: RailwayService,
): RailwayServiceDomains {
  const matches = environment.serviceDomains.filter(
    ({ serviceId }) => serviceId === service.id,
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one Railway domain set for service ${service.id}, found ${matches.length}`,
    );
  }
  const match = matches[0] as RailwayServiceDomains;
  if (match.serviceName !== service.name) {
    throw new Error(
      `Railway domain service ${service.id} is named ${JSON.stringify(match.serviceName)}, expected ${JSON.stringify(service.name)}`,
    );
  }
  return match;
}

function isRailwayProviderHostname(hostname: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.up\.railway\.app$/i.test(
    hostname,
  );
}

function exactIdentity<T extends { id: string; name: string }>(
  values: readonly T[],
  expectedId: string | undefined,
  expectedName: string,
  label: string,
): T {
  const matches = values.filter(({ id, name }) =>
    expectedId === undefined ? name === expectedName : id === expectedId,
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one ${label} ${expectedId === undefined ? `named ${JSON.stringify(expectedName)}` : `with ID ${expectedId}`}, found ${matches.length}`,
    );
  }
  const match = matches[0] as T;
  if (match.name !== expectedName) {
    throw new Error(
      `${label} ${match.id} is named ${JSON.stringify(match.name)}, expected ${JSON.stringify(expectedName)}`,
    );
  }
  return match;
}

function record(value: unknown, label: string): JSONRecord {
  const result = optionalRecord(value);
  if (result === undefined) throw new Error(`${label} is not an object`);
  return result;
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JSONRecord)
    : undefined;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label} is not a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} is not a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is not a boolean`);
  return value;
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("deployment operation was aborted");
  }
}

async function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("deployment operation was aborted"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
