import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import {
  defineBehavior,
  defineOutcomeContract,
  implementBehavior,
  outcome,
  shape,
  type AnyBehaviorModule,
} from "../core/behavior";
import { BehaviorCatalog } from "../catalog/behaviorCatalog";
import {
  EVIDENCE_TIERS,
  EXPECTED_SCENARIO_COUNT,
  SCENARIO_TRACE_REGISTRY,
  validateScenarioTraceRegistry,
} from "../catalog/scenarioTraces";
import {
  validateLifecycleSpineSource,
  verifyScenarioRuntime,
} from "../verification";
import { SPINE_BEHAVIOR_SPECS } from "../playwright/spineBehaviors";

const ExampleBehavior = defineBehavior({
  id: "example.create",
  version: 1,
  scenarios: ["WRL-001"],
  input: shape<{ name: string }>(),
  outcomes: {
    created: outcome<{ handle: string }>(),
    rejected: outcome<{ field: string }>(),
  },
});

const ExampleModule = implementBehavior(ExampleBehavior, {
  driver: {
    async perform() {},
  },
  contracts: {
    created: defineOutcomeContract({
      id: "example.create.created",
      version: 1,
      validatorIds: [],
      async validate({ input }) {
        return { handle: input.name };
      },
    }),
    rejected: defineOutcomeContract({
      id: "example.create.rejected",
      version: 1,
      validatorIds: [],
      async validate() {
        return { field: "name" };
      },
    }),
  },
});

describe("scenario catalog", () => {
  test("registers all documented IDs, named cases, and evidence tiers", () => {
    validateScenarioTraceRegistry();
    const verification = verifyScenarioRuntime();
    assert.equal(verification.scenarioCount, EXPECTED_SCENARIO_COUNT);
    assert.equal(
      verification.catalogRegistrationCount,
      EXPECTED_SCENARIO_COUNT,
    );
    assert.equal(verification.runtimePassingEvidence, "not-evaluated");
    assert.equal(
      verification.lifecycleSpine.explicitlyMappedScenarioIds.length,
      59,
    );
    assert.equal(verification.namedCaseCount, 34);
    assert.deepEqual(
      Object.keys(verification.tierCounts).sort(),
      [...EVIDENCE_TIERS].sort(),
    );
    assert.equal(
      new Set(SCENARIO_TRACE_REGISTRY.map((trace) => trace.scenarioId)).size,
      EXPECTED_SCENARIO_COUNT,
    );
  });

  test("rejects duplicate scenario and behavior IDs", () => {
    const duplicatedTraces = [
      ...SCENARIO_TRACE_REGISTRY.slice(0, -1),
      SCENARIO_TRACE_REGISTRY[0]!,
    ];
    assert.throws(
      () => validateScenarioTraceRegistry(duplicatedTraces),
      /duplicate primary owner/,
    );
    assert.throws(
      () => new BehaviorCatalog({ modules: [ExampleModule, ExampleModule] }),
      /duplicate behavior id/,
    );
  });

  test("rejects a runtime module with a missing outcome contract", () => {
    const malformed = {
      ...ExampleModule,
      contracts: { created: ExampleModule.contracts.created },
    } as unknown as AnyBehaviorModule<unknown, unknown>;
    assert.throws(
      () => new BehaviorCatalog({ modules: [malformed] }),
      /contracts must exactly match outcomes/,
    );
  });

  test("enforces the one-test observed lifecycle-spine boundary", () => {
    const checkpoints = [
      "JRN-001/playable-world",
      "JRN-002/ready-player",
      "JRN-003/improvised-round-resolved",
      "JRN-004/status-lifecycle-preserved",
      "JRN-005/spectator-public-table-safe",
      "JRN-006/editor-authority-bounded",
      "JRN-007/archived-history-readable",
    ];
    const source = [
      'import { test } from "../../src/scenario";',
      "test('spine', async ({ scenario }) => {",
      ...checkpoints.map(
        (checkpoint) =>
          `  await scenario.checkpoint('${checkpoint}', async () => {});`,
      ),
      ...SPINE_BEHAVIOR_SPECS.map(
        ({ id }) =>
          `  await scenario.behavior('${id}', async () => {}, async () => { expect(true).toBe(true); });`,
      ),
      "});",
    ].join("\n");
    assert.deepEqual(validateLifecycleSpineSource(source), checkpoints);
    assert.throws(
      () => validateLifecycleSpineSource(`${source}\nfetch('/api/worlds')`),
      /forbidden mutation shortcut: fetch/,
    );
    assert.throws(
      () =>
        validateLifecycleSpineSource(
          `${source}\nimport '../../src/controlledTime';`,
        ),
      /forbidden mutation shortcut: controlled-time fixture/,
    );
    assert.throws(
      () =>
        validateLifecycleSpineSource(
          source.replace("});", "});\ntest('again', () => {});"),
        ),
      /exactly one test/,
    );
    assert.throws(
      () =>
        validateLifecycleSpineSource(
          source.replace("identity.enter-builder", "world.create"),
        ),
      /behavior calls mismatch.*identity\.enter-builder.*world\.create/,
    );
    assert.throws(
      () =>
        validateLifecycleSpineSource(
          source.replace(", async () => { expect(true).toBe(true); }", ""),
        ),
      /separate perform and validate callbacks/,
    );
    assert.throws(
      () =>
        validateLifecycleSpineSource(
          source.replace(
            "async () => { expect(true).toBe(true); }",
            "async () => {}",
          ),
        ),
      /validate callback must assert its outcome/,
    );
  });
});
