import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "bun:test";

import {
  JOURNEY_RIB_SCENARIO_IDS,
  JOURNEY_SCENARIO_IDS,
  SCENARIO_TRACE_REGISTRY,
  type ScenarioId,
} from "../catalog/scenarioTraces";
import {
  SPINE_BEHAVIOR_CATALOG,
  SPINE_BEHAVIOR_SPECS,
} from "../playwright/spineBehaviors";
import { validateLifecycleSpineBehaviorCalls } from "../verification";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("cross-cutting scenario policies", () => {
  test("GLO-004 aggregates executable atomic-failure evidence", () => {
    const atomicFailureScenarios: readonly ScenarioId[] = [
      "WRL-V01",
      "MEC-V01",
      "MEC-V02",
      "MEC-V03",
      "MEC-V04",
      "CHF-V01",
      "RST-V03",
      "RST-V04",
      "RST-V05",
      "INV-V01",
      "INV-V02",
      "PLY-V01",
      "PLY-V02",
      "PLY-V03",
      "PLY-V04",
      "PLY-V05",
      "CON-V01",
      "CON-V02",
      "CON-V03",
      "CON-V04",
      "CON-V05",
      "AUT-V02",
      "AUT-V05",
      "CCY-V01",
      "CCY-V02",
      "CCY-V03",
      "CCY-V04",
      "CCY-V05",
      "CCY-V06",
      "CCY-V07",
      "CCY-V08",
      "CCY-V09",
      "LFC-V01",
      "LFC-V02",
      "LFC-V03",
      "LFC-V04",
      "NAV-V04",
    ];
    assertExecutableOwners(atomicFailureScenarios);
  });

  test("GLO-005 binds every journey outcome to a cataloged UI contract", () => {
    const journeyOutcomes = JOURNEY_SCENARIO_IDS.filter(
      (scenarioId) =>
        !scenarioId.startsWith("JRN-") &&
        !JOURNEY_RIB_SCENARIO_IDS.includes(
          scenarioId as (typeof JOURNEY_RIB_SCENARIO_IDS)[number],
        ),
    );
    const behaviorOutcomes = SPINE_BEHAVIOR_SPECS.flatMap(
      ({ scenarioIds }) => scenarioIds,
    );
    assert.deepEqual([...behaviorOutcomes].sort(), [...journeyOutcomes].sort());
    assert.equal(SPINE_BEHAVIOR_CATALOG.size, SPINE_BEHAVIOR_SPECS.length);
    for (const behavior of SPINE_BEHAVIOR_SPECS) {
      const module = SPINE_BEHAVIOR_CATALOG.getById(behavior.id);
      assert.deepEqual(module.definition.scenarios, behavior.scenarioIds);
      assert.deepEqual(module.contracts.completed?.validatorIds, [
        "spine.ui-outcome",
      ]);
    }
    const fixture = source("test/src/scenario/playwright/scenarioTest.ts");
    assert.match(fixture, /module\.driver\.perform/);
    assert.match(fixture, /contract\.validate/);
    assert.match(fixture, /recordObservedBrowserRequest/);
    const lifecycle = source("test/specs/scenarios/lifecycle-spine.spec.ts");
    const calledBehaviorIds = validateLifecycleSpineBehaviorCalls(lifecycle);
    assert.deepEqual(
      [...calledBehaviorIds].sort(),
      SPINE_BEHAVIOR_SPECS.map(({ id }) => id).sort(),
    );
  });

  test("GLO-006 aggregates every sensitive projection and redaction boundary", () => {
    assertExecutableOwners([
      "INV-002",
      "INV-V01",
      "AUT-003",
      "AUT-004",
      "AUT-006",
      "AUT-008",
      "AUT-V01",
      "AUT-V03",
      "AUT-V04",
      "AUT-V05",
      "PLY-V05",
      "GLO-012",
    ]);
    const eventTests = source("internal/app/interactions_events_test.go");
    assert.match(
      eventTests,
      /TestProjectVisibleWorldEventRedactsAudienceInvalidation/,
    );
    const serverTests = source("internal/app/server_test.go");
    assert.match(
      serverTests,
      /TestRequestAndRecoveryLogsRedactEveryInviteBearerPath/,
    );
    const migrationTests = source("internal/migrations/migrations_test.go");
    assert.match(
      migrationTests,
      /TestWorldInvitePersistenceStoresOnlyTokenDigests/,
    );
  });

  test("GLO-007 forbids privileged entity classes, keys, and seeded vocabulary", () => {
    const productionRoots = ["internal", "web/frontend/src"];
    const forbiddenSchema = [
      /\bentity_class(?:_id)?\b/i,
      /\bmechanic_key\b/i,
      /\bconfigured_key\b/i,
      /\bcanonical_json\b/i,
      /\bseed_vocabulary\b/i,
    ];
    for (const relativeRoot of productionRoots) {
      for (const path of sourceFiles(join(repositoryRoot, relativeRoot))) {
        if (path.endsWith("_test.go") || /\.test\.[cm]?[jt]sx?$/.test(path)) {
          continue;
        }
        const contents = readFileSync(path, "utf8");
        for (const pattern of forbiddenSchema) {
          assert.doesNotMatch(contents, pattern, `${path} contains ${pattern}`);
        }
      }
    }
    const lifecycle = source("test/specs/scenarios/lifecycle-spine.spec.ts");
    for (const authoredName of [
      "Glasswing Courier",
      "Lantern Estuary",
      "Carries Signal",
      "Off Balance",
    ]) {
      assert.equal(
        lifecycle.includes(`${authoredName} \${run}`),
        true,
        `${authoredName} is authored with the run suffix`,
      );
      for (const relativeRoot of productionRoots) {
        for (const path of sourceFiles(join(repositoryRoot, relativeRoot))) {
          if (path.includes("node_modules")) continue;
          assert.equal(
            readFileSync(path, "utf8").includes(authoredName),
            false,
            `${authoredName} leaked into product source ${path}`,
          );
        }
      }
    }
  });

  test("GLO-011 bounds two workers to aggregate-isolated specifications", () => {
    const config = source("test/playwright.config.ts");
    assert.match(config, /fullyParallel:\s*false/);
    assert.match(config, /workers:\s*2/);
    assert.match(config, /retries:\s*0/);

    for (const path of sourceFiles(join(repositoryRoot, "test/specs"))) {
      if (!path.endsWith(".spec.ts")) continue;
      const contents = readFileSync(path, "utf8");
      assert.match(
        contents,
        /randomUUID/,
        `${path} must generate aggregate-owned identities or resources`,
      );
      assert.doesNotMatch(
        contents,
        /\b(?:truncate|delete\s+from)\b/i,
        `${path} contains a shared-database destructive statement`,
      );
    }

    const controlledTime = source("test/src/controlledTime.ts");
    assert.match(controlledTime, /canonicalUUID\.test\(inviteID\)/);
    assert.match(controlledTime, /where id = '\$\{inviteID\}'::uuid/);
    assert.match(controlledTime, /select 1 \/ count\(\*\) from expired/);
  });
});

function assertExecutableOwners(scenarioIds: readonly ScenarioId[]): void {
  for (const scenarioId of scenarioIds) {
    const owner = SCENARIO_TRACE_REGISTRY.find(
      (candidate) => candidate.scenarioId === scenarioId,
    );
    assert.notEqual(owner, undefined, `${scenarioId} has an owner`);
    assert.equal(
      owner?.evidenceAvailability,
      "executable",
      `${scenarioId} has executable evidence`,
    );
  }
}

function source(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function sourceFiles(root: string): readonly string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") result.push(...sourceFiles(path));
      continue;
    }
    if ([".go", ".sql", ".ts", ".tsx"].includes(extname(entry.name))) {
      result.push(path);
    }
  }
  return result;
}
