import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { buildEvidence, serializeEvidence, writeEvidence } from "./evidence";
import type {
  RailwayDeployment,
  RailwayEnvironment,
  RailwayProject,
  RailwayService,
} from "./railway";

const deploymentID = "86f35ac9-6e76-4eea-970c-9841944042f8";

describe("deployment evidence", () => {
  test("serializes only the allowlisted release proof", () => {
    const evidence = fixture();
    const serialized = serializeEvidence(evidence);
    assert.equal(serialized.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(serialized), evidence);
    for (const secret of [
      "postgres://user:password@host/database",
      "PGPASSWORD",
      "Set-Cookie",
      "Authorization",
      "csrf-secret",
    ]) {
      assert.equal(serialized.includes(secret), false);
    }
    const verification = fixture("verify");
    assert.equal(verification.ci, "not-run");
    assert.equal("uploadedCommit" in verification, false);
  });

  test("writes an atomic private record beneath the ignored state directory", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "gezerah-deploy-test-"),
    );
    try {
      const evidence = fixture();
      const destination = await writeEvidence(temporaryRoot, evidence);
      assert.equal(
        destination,
        path.join(
          temporaryRoot,
          ".gezerah",
          "deployments",
          `${deploymentID}.json`,
        ),
      );
      assert.equal(
        await readFile(destination, "utf8"),
        serializeEvidence(evidence),
      );
      assert.equal((await stat(destination)).mode & 0o777, 0o600);
      await assert.rejects(writeEvidence(temporaryRoot, evidence), /EEXIST/);
      assert.equal(
        await readFile(destination, "utf8"),
        serializeEvidence(evidence),
      );

      const firstVerification = await writeEvidence(
        temporaryRoot,
        fixture("verify"),
      );
      const secondVerification = await writeEvidence(
        temporaryRoot,
        fixture("verify"),
      );
      assert.notEqual(firstVerification, destination);
      assert.notEqual(firstVerification, secondVerification);
      assert.match(
        path.basename(firstVerification),
        new RegExp(`^${deploymentID}\\.verify\\.[0-9a-f-]+\\.json$`),
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

function fixture(mode: "deploy" | "verify" = "deploy") {
  const project: RailwayProject = {
    id: "0bc0c39c-c630-4898-b4af-d7f0ebe459db",
    name: "Gezerah",
    environments: [],
  };
  const environment: RailwayEnvironment = {
    id: "9f15ee7b-a2b6-4fbb-b6dc-966739a8bc08",
    name: "production",
  };
  const web = service({
    id: "73261ce4-d382-41a5-a7ac-64dd71c536ab",
    name: "gezerah-web",
    deploymentId: deploymentID,
    url: "https://gezerah.com",
  });
  const database = service({
    id: "beb083b4-4ca6-4b3d-b2df-c429e9746f44",
    name: "Postgres",
    deploymentId: "881dc329-b72d-43f5-8abd-a8eaa3a0dcf0",
    volumes: [
      {
        name: "postgres-volume",
        state: "READY",
        sizeMb: 5000,
        mountPath: "/var/lib/postgresql/data",
      },
    ],
  });
  const deployment: RailwayDeployment = {
    id: deploymentID,
    status: "SUCCESS",
    createdAt: "2026-08-08T06:34:01.761Z",
    manifest: {
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      numReplicas: 1,
      drainingSeconds: 15,
    },
  };
  return buildEvidence({
    mode,
    ci: mode === "deploy" ? "passed" : "not-run",
    project,
    environment,
    web,
    database,
    deployment,
    localCommit: "a".repeat(40),
    publicURL: "https://gezerah.com",
    http: [
      {
        name: "health",
        url: "https://gezerah.com/api/health",
        status: 200,
        contentType: "application/json",
        bytes: 57,
        durationMs: 120,
      },
    ],
    browser: {
      skipped: false,
      title: "Gezerah",
      finalPath: "/play",
      authProbe: true,
      failureCount: 0,
      durationMs: 900,
    },
    startedAt: "2026-08-08T06:34:01.000Z",
    completedAt: "2026-08-08T06:35:01.000Z",
  });
}

function service(options: {
  id: string;
  name: string;
  deploymentId: string;
  url?: string;
  volumes?: RailwayService["volumes"];
}): RailwayService {
  return {
    id: options.id,
    name: options.name,
    status: "SUCCESS",
    deploymentId: options.deploymentId,
    deploymentStopped: false,
    volumeMigrating: false,
    ...(options.url === undefined ? {} : { url: options.url }),
    replicas: {
      configured: 1,
      running: 1,
      crashed: 0,
      exited: 0,
      total: 1,
    },
    volumes: options.volumes ?? [],
  };
}
