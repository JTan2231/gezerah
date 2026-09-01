import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import {
  assertNoActiveDeployment,
  assertDeploymentManifest,
  databaseHealthy,
  parseDeploymentList,
  parseProjectStatus,
  parseServiceList,
  parseUploadOutput,
  RailwayClient,
  selectTarget,
  waitForDeployment,
  waitForHealthyServices,
} from "./railway";

const deploymentID = "86f35ac9-6e76-4eea-970c-9841944042f8";
const previousDeploymentID = "27b630f9-5837-4329-b4d2-e2e9c360fb18";

describe("Railway deployment adapter", () => {
  test("parses the linked project, services, replicas, and public URL", () => {
    const project = parseProjectStatus(projectFixture());
    const services = parseServiceList(serviceFixture(deploymentID));
    const target = selectTarget({
      project,
      services,
      expectedProjectId: "0bc0c39c-c630-4898-b4af-d7f0ebe459db",
      expectedProject: "Gezerah",
      expectedEnvironmentId: "9f15ee7b-a2b6-4fbb-b6dc-966739a8bc08",
      expectedEnvironment: "production",
      expectedWebId: "73261ce4-d382-41a5-a7ac-64dd71c536ab",
      expectedWeb: "gezerah-web",
      expectedDatabaseId: "beb083b4-4ca6-4b3d-b2df-c429e9746f44",
      expectedDatabase: "Postgres",
    });

    assert.equal(target.project.id, "0bc0c39c-c630-4898-b4af-d7f0ebe459db");
    assert.equal(target.environment.name, "production");
    assert.equal(target.web.url, "https://gezerah.com");
    assert.deepEqual(target.web.replicas, {
      configured: 1,
      running: 1,
      crashed: 0,
      exited: 0,
      total: 1,
    });
    assert.deepEqual(target.database.volumes, [
      {
        name: "postgres-volume",
        state: "READY",
        sizeMb: 5000,
        mountPath: "/var/lib/postgresql/data",
      },
    ]);
    assert.equal(databaseHealthy(target.database, "postgres-volume"), true);
    assert.equal(
      databaseHealthy(
        {
          ...target.database,
          volumes: [{ ...target.database.volumes[0]!, state: "ATTACHING" }],
        },
        "postgres-volume",
      ),
      false,
    );
    assert.equal(
      databaseHealthy(
        { ...target.database, volumeMigrating: true },
        "postgres-volume",
      ),
      false,
    );
    assert.equal(
      databaseHealthy(
        {
          ...target.database,
          volumes: [{ ...target.database.volumes[0]!, mountPath: "/wrong" }],
        },
        "postgres-volume",
      ),
      false,
    );
    assert.throws(
      () =>
        selectTarget({
          project,
          services,
          expectedProjectId: "00000000-0000-4000-8000-000000000000",
          expectedProject: "Gezerah",
          expectedEnvironmentId: "9f15ee7b-a2b6-4fbb-b6dc-966739a8bc08",
          expectedEnvironment: "production",
          expectedWebId: "73261ce4-d382-41a5-a7ac-64dd71c536ab",
          expectedWeb: "gezerah-web",
          expectedDatabaseId: "beb083b4-4ca6-4b3d-b2df-c429e9746f44",
          expectedDatabase: "Postgres",
        }),
      /linked Railway project/,
    );
  });

  test("parses deployment manifests and validates release invariants", () => {
    const [deployment] = parseDeploymentList([
      deploymentFixture(deploymentID, "SUCCESS"),
    ]);
    assert.notEqual(deployment, undefined);
    assertDeploymentManifest(deployment!);

    const broken = parseDeploymentList([
      {
        ...deploymentFixture(deploymentID, "SUCCESS"),
        meta: {
          serviceManifest: {
            deploy: {
              healthcheckPath: "/api/health",
              numReplicas: 1,
              drainingSeconds: 10,
            },
          },
        },
      },
    ])[0];
    assert.throws(
      () => assertDeploymentManifest(broken!),
      /expected more than 10/,
    );
  });

  test("extracts a deployment ID from single JSON and Railway JSONL", () => {
    assert.deepEqual(
      parseUploadOutput(
        JSON.stringify({ deploymentId: deploymentID, logsUrl: "https://logs" }),
      ),
      { deploymentId: deploymentID, logsUrl: "https://logs" },
    );
    assert.deepEqual(
      parseUploadOutput(
        `${JSON.stringify({ status: "uploading" })}\n${JSON.stringify({ deploymentId: deploymentID })}\n`,
      ),
      { deploymentId: deploymentID },
    );
    assert.throws(() => parseUploadOutput("{}\n"), /deploymentId/);
    assert.throws(
      () =>
        parseUploadOutput(
          `${JSON.stringify({ deploymentId: deploymentID })}\n${JSON.stringify({ deploymentId: previousDeploymentID })}`,
        ),
      /conflicting/,
    );
  });

  test("passes resolved IDs and a single message argument to railway up", async () => {
    const calls: string[][] = [];
    const client = new RailwayClient("/repo", async (args) => {
      calls.push([...args]);
      return {
        stdout: JSON.stringify({ deploymentId: deploymentID }),
        stderr: "",
      };
    });
    await client.upload({
      projectId: "project-id",
      environmentId: "environment-id",
      serviceId: "service-id",
      message: "Deploy abc123 unique token",
    });
    assert.deepEqual(calls, [
      [
        "up",
        "--project",
        "project-id",
        "--environment",
        "environment-id",
        "--service",
        "service-id",
        "--detach",
        "--json",
        "--message",
        "Deploy abc123 unique token",
      ],
    ]);
  });

  test("waits for the exact deployment through every active state", async () => {
    const statuses = [
      undefined,
      "INITIALIZING",
      "BUILDING",
      "DEPLOYING",
      "SUCCESS",
    ];
    const reported: string[] = [];
    let index = 0;
    let clock = 0;
    const result = await waitForDeployment(
      deploymentID,
      async () => {
        const status = statuses[index++];
        return status === undefined
          ? [deploymentRecord(previousDeploymentID, "SUCCESS")]
          : [
              deploymentRecord(previousDeploymentID, "SUCCESS"),
              deploymentRecord(deploymentID, status),
            ];
      },
      {
        timeoutMs: 100,
        pollMs: 1,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
        onStatus: (status) => reported.push(status),
      },
    );
    assert.equal(result.id, deploymentID);
    assert.deepEqual(reported, [
      "not visible",
      "INITIALIZING",
      "BUILDING",
      "DEPLOYING",
      "SUCCESS",
    ]);
  });

  test("fails closed for unsuccessful and unknown deployment states", async () => {
    await assert.rejects(
      waitForDeployment(
        deploymentID,
        async () => [deploymentRecord(deploymentID, "FAILED")],
        { timeoutMs: 100, pollMs: 1 },
      ),
      /ended with FAILED/,
    );
    await assert.rejects(
      waitForDeployment(
        deploymentID,
        async () => [deploymentRecord(deploymentID, "MYSTERY")],
        { timeoutMs: 100, pollMs: 1 },
      ),
      /unsupported status MYSTERY/,
    );
  });

  test("blocks unresolved and unknown deployments before upload", () => {
    assert.throws(
      () =>
        assertNoActiveDeployment([
          deploymentRecord(deploymentID, "NEEDS_APPROVAL"),
        ]),
      /resolve it before deploying/,
    );
    assert.throws(
      () =>
        assertNoActiveDeployment([deploymentRecord(deploymentID, "MYSTERY")]),
      /refusing to overlap/,
    );
    assert.doesNotThrow(() =>
      assertNoActiveDeployment([
        deploymentRecord(deploymentID, "SUCCESS"),
        deploymentRecord(previousDeploymentID, "FAILED"),
      ]),
    );
  });

  test("waits until the exact web deployment and both services are healthy", async () => {
    let clock = 0;
    let calls = 0;
    const result = await waitForHealthyServices(
      async () => {
        calls += 1;
        return parseServiceList(
          serviceFixture(calls === 1 ? previousDeploymentID : deploymentID),
        );
      },
      {
        targetDeploymentId: deploymentID,
        webServiceId: "73261ce4-d382-41a5-a7ac-64dd71c536ab",
        webService: "gezerah-web",
        databaseServiceId: "beb083b4-4ca6-4b3d-b2df-c429e9746f44",
        databaseService: "Postgres",
        databaseVolume: "postgres-volume",
        timeoutMs: 100,
        pollMs: 1,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds;
        },
      },
    );
    assert.equal(result.web.deploymentId, deploymentID);
    assert.equal(calls, 2);
  });
});

function projectFixture(): unknown {
  return {
    id: "0bc0c39c-c630-4898-b4af-d7f0ebe459db",
    name: "Gezerah",
    environments: {
      edges: [
        {
          node: {
            id: "9f15ee7b-a2b6-4fbb-b6dc-966739a8bc08",
            name: "production",
          },
        },
      ],
    },
  };
}

function serviceFixture(webDeploymentID: string): unknown {
  return [
    {
      id: "beb083b4-4ca6-4b3d-b2df-c429e9746f44",
      name: "Postgres",
      status: "SUCCESS",
      deploymentId: "881dc329-b72d-43f5-8abd-a8eaa3a0dcf0",
      deploymentStopped: false,
      volumeMigrating: false,
      url: null,
      replicas: {
        configured: 1,
        running: 1,
        crashed: 0,
        exited: 0,
        total: 1,
      },
      volumes: [
        {
          name: "postgres-volume",
          state: "READY",
          sizeMb: 5000,
          mountPath: "/var/lib/postgresql/data",
        },
      ],
    },
    {
      id: "73261ce4-d382-41a5-a7ac-64dd71c536ab",
      name: "gezerah-web",
      status: "SUCCESS",
      deploymentId: webDeploymentID,
      deploymentStopped: false,
      volumeMigrating: false,
      url: "https://gezerah.com",
      replicas: {
        configured: 1,
        running: 1,
        crashed: 0,
        exited: 0,
        total: 1,
      },
      volumes: [],
    },
  ];
}

function deploymentFixture(
  id: string,
  status: string,
): Record<string, unknown> {
  return {
    id,
    status,
    createdAt: "2026-08-08T06:34:01.761Z",
    meta: {
      cliMessage: "Deploy abc123 token",
      serviceManifest: {
        deploy: {
          healthcheckPath: "/api/health",
          healthcheckTimeout: 30,
          numReplicas: 1,
          drainingSeconds: 15,
        },
      },
    },
  };
}

function deploymentRecord(id: string, status: string) {
  return {
    id,
    status,
    createdAt: "2026-08-08T06:34:01.761Z",
  };
}
