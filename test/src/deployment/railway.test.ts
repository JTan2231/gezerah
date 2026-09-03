import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import {
  assertPostCutoverDomains,
  assertNoActiveDeployment,
  assertDeploymentManifest,
  assertPublicURLExposed,
  databaseHealthy,
  parseDeploymentList,
  parseProjectStatus,
  parseServiceList,
  parseUploadOutput,
  railwayProviderPublicURL,
  RailwayClient,
  selectTarget,
  waitForDeployment,
  waitForHealthyServices,
} from "./railway";

const deploymentID = "55555555-5555-4555-8555-555555555555";
const previousDeploymentID = "77777777-7777-4777-8777-777777777777";
const projectID = "11111111-1111-4111-8111-111111111111";
const environmentID = "22222222-2222-4222-8222-222222222222";
const webServiceID = "33333333-3333-4333-8333-333333333333";
const databaseServiceID = "44444444-4444-4444-8444-444444444444";

describe("Railway deployment adapter", () => {
  test("parses the linked project, services, replicas, and domains", () => {
    const project = parseProjectStatus(projectFixture());
    const services = parseServiceList(serviceFixture(deploymentID));
    const target = selectTarget({
      project,
      services,
      expectedProjectId: undefined,
      expectedProject: "Wrought",
      expectedEnvironmentId: undefined,
      expectedEnvironment: "production",
      expectedWebId: undefined,
      expectedWeb: "wrought-web",
      expectedDatabaseId: undefined,
      expectedDatabase: "Postgres",
    });

    assert.equal(target.project.id, projectID);
    assert.equal(target.environment.name, "production");
    assert.equal(
      target.web.url,
      "https://wrought-web-production.up.railway.app",
    );
    assert.deepEqual(target.environment.serviceDomains, [
      {
        serviceId: webServiceID,
        serviceName: "wrought-web",
        customDomains: ["wrought.joeytan.dev"],
        serviceDomains: ["wrought-web-production.up.railway.app"],
      },
      {
        serviceId: databaseServiceID,
        serviceName: "Postgres",
        customDomains: [],
        serviceDomains: [],
      },
    ]);
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
          expectedProject: "Wrought",
          expectedEnvironmentId: environmentID,
          expectedEnvironment: "production",
          expectedWebId: webServiceID,
          expectedWeb: "wrought-web",
          expectedDatabaseId: databaseServiceID,
          expectedDatabase: "Postgres",
        }),
      /linked Railway project/,
    );
  });

  test("binds public origins to the exact environment and service", () => {
    const project = parseProjectStatus(projectFixture());
    const environment = project.environments[0]!;
    const web = parseServiceList(serviceFixture(deploymentID)).find(
      ({ id }) => id === webServiceID,
    )!;

    assert.doesNotThrow(() =>
      assertPublicURLExposed(environment, web, "https://wrought.joeytan.dev"),
    );
    assert.doesNotThrow(() =>
      assertPublicURLExposed(
        environment,
        web,
        "https://wrought-web-production.up.railway.app",
      ),
    );
    assert.throws(
      () =>
        assertPublicURLExposed(
          environment,
          web,
          "https://unattached.wrought.test",
        ),
      /does not expose/,
    );

    const domainOnDatabaseOnly = {
      ...environment,
      serviceDomains: environment.serviceDomains.map((binding) =>
        binding.serviceId === webServiceID
          ? { ...binding, customDomains: [] }
          : { ...binding, customDomains: ["wrought.joeytan.dev"] },
      ),
    };
    assert.throws(
      () =>
        assertPublicURLExposed(
          domainOnDatabaseOnly,
          web,
          "https://wrought.joeytan.dev",
        ),
      /does not expose/,
    );

    const missingBinding = {
      ...environment,
      serviceDomains: environment.serviceDomains.filter(
        ({ serviceId }) => serviceId !== webServiceID,
      ),
    };
    assert.throws(
      () =>
        assertPublicURLExposed(
          missingBinding,
          web,
          "https://wrought.joeytan.dev",
        ),
      /exactly one Railway domain set.*found 0/,
    );

    const duplicateBinding = {
      ...environment,
      serviceDomains: [
        ...environment.serviceDomains,
        environment.serviceDomains[0]!,
      ],
    };
    assert.throws(
      () =>
        assertPublicURLExposed(
          duplicateBinding,
          web,
          "https://wrought.joeytan.dev",
        ),
      /exactly one Railway domain set.*found 2/,
    );

    for (const publicURL of [
      "http://wrought.joeytan.dev",
      "https://user@wrought.joeytan.dev",
      "https://wrought.joeytan.dev?query=yes",
    ]) {
      assert.throws(
        () => assertPublicURLExposed(environment, web, publicURL),
        /credential-free HTTPS URL/,
      );
    }
  });

  test("selects the exact generated provider hostname and gates post-cutover domains", () => {
    const project = parseProjectStatus(projectFixture());
    const environment = project.environments[0]!;
    const web = parseServiceList(serviceFixture(deploymentID)).find(
      ({ id }) => id === webServiceID,
    )!;

    assert.equal(
      railwayProviderPublicURL(environment, web),
      "https://wrought-web-production.up.railway.app",
    );
    assert.doesNotThrow(() => assertPostCutoverDomains(environment, web));

    const withUnexpectedCustomDomain = {
      ...environment,
      serviceDomains: environment.serviceDomains.map((binding) =>
        binding.serviceId === webServiceID
          ? {
              ...binding,
              customDomains: ["wrought.joeytan.dev", "retired.example"],
            }
          : binding,
      ),
    };
    assert.throws(
      () => assertPostCutoverDomains(withUnexpectedCustomDomain, web),
      /must contain only custom domain wrought\.joeytan\.dev.*retired\.example/,
    );

    const withMisnamedProvider = {
      ...environment,
      serviceDomains: environment.serviceDomains.map((binding) =>
        binding.serviceId === webServiceID
          ? {
              ...binding,
              serviceDomains: ["retired-web-production.up.railway.app"],
            }
          : binding,
      ),
    };
    assert.equal(
      railwayProviderPublicURL(withMisnamedProvider, web),
      "https://retired-web-production.up.railway.app",
    );
    assert.throws(
      () => assertPostCutoverDomains(withMisnamedProvider, web),
      /provider hostname.*not aligned with current service name/,
    );

    const multipleProviders = {
      ...environment,
      serviceDomains: environment.serviceDomains.map((binding) =>
        binding.serviceId === webServiceID
          ? {
              ...binding,
              serviceDomains: [
                ...binding.serviceDomains,
                "second-production.up.railway.app",
              ],
            }
          : binding,
      ),
    };
    assert.throws(
      () => railwayProviderPublicURL(multipleProviders, web),
      /exactly one generated Railway provider hostname.*found 2/,
    );
  });

  test("rejects duplicate service-domain bindings in project status", () => {
    const serviceInstances = serviceInstanceFixture();
    assert.throws(
      () =>
        parseProjectStatus(
          projectFixture([...serviceInstances, serviceInstances[0]!]),
        ),
      /duplicate service domain bindings/,
    );
  });

  test("parses deployment manifests and validates release invariants", () => {
    const [deployment] = parseDeploymentList([
      deploymentFixture(deploymentID, "SUCCESS"),
    ]);
    assert.notEqual(deployment, undefined);
    assertDeploymentManifest(deployment!);
    assert.equal(deployment?.manifest?.healthcheckTimeout, 30);

    const shortHealthCheck = parseDeploymentList([
      {
        ...deploymentFixture(deploymentID, "SUCCESS"),
        meta: {
          serviceManifest: {
            deploy: {
              healthcheckPath: "/api/health",
              healthcheckTimeout: 29,
              numReplicas: 1,
              drainingSeconds: 15,
            },
          },
        },
      },
    ])[0];
    assert.throws(
      () => assertDeploymentManifest(shortHealthCheck!),
      /health-check timeout seconds, expected 30/,
    );

    const shortDrain = parseDeploymentList([
      {
        ...deploymentFixture(deploymentID, "SUCCESS"),
        meta: {
          serviceManifest: {
            deploy: {
              healthcheckPath: "/api/health",
              healthcheckTimeout: 30,
              numReplicas: 1,
              drainingSeconds: 10,
            },
          },
        },
      },
    ])[0];
    assert.throws(
      () => assertDeploymentManifest(shortDrain!),
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
        webServiceId: webServiceID,
        webService: "wrought-web",
        databaseServiceId: databaseServiceID,
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

function projectFixture(
  serviceInstances: readonly unknown[] = serviceInstanceFixture(),
): unknown {
  return {
    id: projectID,
    name: "Wrought",
    environments: {
      edges: [
        {
          node: {
            id: environmentID,
            name: "production",
            serviceInstances: {
              edges: serviceInstances,
            },
          },
        },
      ],
    },
  };
}

function serviceInstanceFixture(): readonly Record<string, unknown>[] {
  return [
    {
      node: {
        serviceId: webServiceID,
        serviceName: "wrought-web",
        domains: {
          customDomains: [{ domain: "wrought.joeytan.dev" }],
          serviceDomains: [{ domain: "wrought-web-production.up.railway.app" }],
        },
      },
    },
    {
      node: {
        serviceId: databaseServiceID,
        serviceName: "Postgres",
        domains: {
          customDomains: [],
          serviceDomains: [],
        },
      },
    },
  ];
}

function serviceFixture(webDeploymentID: string): unknown {
  return [
    {
      id: databaseServiceID,
      name: "Postgres",
      status: "SUCCESS",
      deploymentId: "66666666-6666-4666-8666-666666666666",
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
      id: webServiceID,
      name: "wrought-web",
      status: "SUCCESS",
      deploymentId: webDeploymentID,
      deploymentStopped: false,
      volumeMigrating: false,
      url: "https://wrought-web-production.up.railway.app",
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
