import { randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  RailwayDeployment,
  RailwayEnvironment,
  RailwayProject,
  RailwayService,
} from "./railway";
import type { BrowserCheck, HTTPCheck } from "./smoke";

export interface DeploymentEvidence {
  schemaVersion: 1;
  mode: "deploy" | "verify";
  ci: "passed" | "skipped" | "not-run";
  project: { id: string; name: string };
  environment: { id: string; name: string };
  service: { id: string; name: string };
  localCommit: string;
  uploadedCommit?: string;
  deployment: {
    id: string;
    status: string;
    createdAt: string;
    healthcheckPath: string;
    replicas: number;
    drainingSeconds: number;
  };
  publicURL: string;
  railway: {
    web: ServiceEvidence;
    database: ServiceEvidence;
  };
  http: readonly HTTPCheck[];
  browser: BrowserCheck;
  startedAt: string;
  completedAt: string;
}

interface ServiceEvidence {
  id: string;
  name: string;
  status: string;
  deploymentId: string;
  volumeMigrating: boolean;
  replicas: {
    configured: number;
    running: number;
    crashed: number;
  };
  volumes: readonly {
    name: string;
    state: string;
    sizeMb: number;
    mountPath: string;
  }[];
}

export function buildEvidence(options: {
  mode: "deploy" | "verify";
  ci: "passed" | "skipped" | "not-run";
  project: RailwayProject;
  environment: RailwayEnvironment;
  web: RailwayService;
  database: RailwayService;
  deployment: RailwayDeployment;
  localCommit: string;
  publicURL: string;
  http: readonly HTTPCheck[];
  browser: BrowserCheck;
  startedAt: string;
  completedAt: string;
}): DeploymentEvidence {
  const manifest = options.deployment.manifest;
  if (
    manifest?.healthcheckPath === undefined ||
    manifest.numReplicas === undefined ||
    manifest.drainingSeconds === undefined
  ) {
    throw new Error("deployment evidence requires a complete service manifest");
  }
  return {
    schemaVersion: 1,
    mode: options.mode,
    ci: options.ci,
    project: { id: options.project.id, name: options.project.name },
    environment: {
      id: options.environment.id,
      name: options.environment.name,
    },
    service: { id: options.web.id, name: options.web.name },
    localCommit: options.localCommit,
    ...(options.mode === "deploy"
      ? { uploadedCommit: options.localCommit }
      : {}),
    deployment: {
      id: options.deployment.id,
      status: options.deployment.status,
      createdAt: options.deployment.createdAt,
      healthcheckPath: manifest.healthcheckPath,
      replicas: manifest.numReplicas,
      drainingSeconds: manifest.drainingSeconds,
    },
    publicURL: options.publicURL,
    railway: {
      web: serviceEvidence(options.web),
      database: serviceEvidence(options.database),
    },
    http: options.http.map((check) => ({ ...check })),
    browser: { ...options.browser },
    startedAt: options.startedAt,
    completedAt: options.completedAt,
  };
}

export function serializeEvidence(evidence: DeploymentEvidence): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export async function writeEvidence(
  repoRoot: string,
  evidence: DeploymentEvidence,
): Promise<string> {
  if (!isUUID(evidence.deployment.id)) {
    throw new Error("refusing to write evidence for an invalid deployment ID");
  }
  const directory = path.join(repoRoot, ".dnd", "deployments");
  const filename =
    evidence.mode === "deploy"
      ? `${evidence.deployment.id}.json`
      : `${evidence.deployment.id}.verify.${randomUUID()}.json`;
  const destination = path.join(directory, filename);
  const temporary = path.join(
    directory,
    `.${evidence.deployment.id}.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, serializeEvidence(evidence), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await link(temporary, destination);
    await rm(temporary);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return destination;
}

function serviceEvidence(service: RailwayService): ServiceEvidence {
  return {
    id: service.id,
    name: service.name,
    status: service.status,
    deploymentId: service.deploymentId,
    volumeMigrating: service.volumeMigrating,
    replicas: {
      configured: service.replicas.configured,
      running: service.replicas.running,
      crashed: service.replicas.crashed,
    },
    volumes: service.volumes.map((volume) => ({ ...volume })),
  };
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
