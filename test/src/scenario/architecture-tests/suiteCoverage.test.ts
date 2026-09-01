import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import {
  SCENARIO_TRACE_REGISTRY,
  type ScenarioTrace,
} from "../catalog/scenarioTraces";
import {
  buildSuiteCoverageInventory,
  expectedGoPackage as expectedGoPackageForOwnerFile,
  parseArchitectureTestResults,
  parseGoTestResults,
  type ArchitectureTestResult,
  type GoTestEvent,
  type SuiteCoverageEvidence,
} from "../evidence/suiteCoverage";
import type {
  ScenarioJSONAttachment,
  ScenarioTestResult,
  ScenarioTestStepResult,
} from "../playwright/scenarioReporter";

describe("whole-suite scenario coverage", () => {
  test("accepts 141 exact terminal evidence rows without synthesizing fields", () => {
    const inventory = buildSuiteCoverageInventory(completeEvidence());

    assert.equal(inventory.catalogSize, 141);
    assert.equal(
      inventory.passed,
      141,
      `not run: ${inventory.records
        .filter(({ result }) => result !== "passed")
        .map(({ scenarioId }) => scenarioId)
        .join(", ")}`,
    );
    assert.equal(inventory.notRun, 0);
    assert.equal(inventory.complete, true);
    assert.equal(
      inventory.records
        .flatMap(({ namedCases }) => namedCases)
        .every(({ result }) => result === "passed"),
      true,
    );
    const journey = inventory.records.find(
      ({ scenarioId }) => scenarioId === "JRN-001",
    );
    assert.deepEqual(journey?.baseBehaviors, ["world.create"]);
    assert.deepEqual(journey?.outcomeContractIds, ["world.create.completed"]);
    assert.deepEqual(journey?.validatorIds, ["spine.ui-outcome"]);
    assert.deepEqual(journey?.observedSurfaces, ["UI", "RUNTIME"]);
    assert.equal(journey?.mutationEpoch, 7);
    assert.equal(journey?.durationMs, 3);
  });

  test("a passing owner file or skipped scenario step never creates per-ID evidence", () => {
    const trace = browserStepTrace();
    const fileOnly = browserTest(trace, []);
    const skipped = browserTest(trace, [scenarioStep(trace, "skipped")]);

    assert.equal(
      recordFor(trace, { browserTests: [fileOnly] }).result,
      "not-run",
    );
    assert.equal(
      recordFor(trace, { browserTests: [skipped] }).result,
      "not-run",
    );
  });

  test("browser steps require the exact owner, execution marker, and scenario token", () => {
    const trace = browserStepTrace();
    const wrongOwner = {
      ...browserTest(trace, [scenarioStep(trace)]),
      ownerFile: "test/specs/wrong.spec.ts",
    };
    const wrongExecution = {
      ...browserTest(trace, [scenarioStep(trace)]),
      executionTitle: `${trace.executionMarker} almost`,
    };
    const nearMiss = browserTest(trace, [userStep(`${trace.scenarioId}X`)]);
    const nested = browserTest(trace, [
      userStep("outer", "passed", [scenarioStep(trace)]),
    ]);

    assert.equal(
      recordFor(trace, { browserTests: [wrongOwner] }).result,
      "not-run",
    );
    assert.equal(
      recordFor(trace, { browserTests: [wrongExecution] }).result,
      "not-run",
    );
    assert.equal(
      recordFor(trace, { browserTests: [nearMiss] }).result,
      "not-run",
    );
    assert.equal(recordFor(trace, { browserTests: [nested] }).result, "passed");
  });

  test("attachments require exact scenario, tier, execution, named cases, and timeline", () => {
    const trace = SCENARIO_TRACE_REGISTRY.find(
      ({ primaryTier }) => primaryTier === "journey",
    );
    assert.notEqual(trace, undefined);
    const valid = attachmentTest([trace!]);
    assert.equal(recordFor(trace!, { browserTests: [valid] }).result, "passed");

    for (const patch of [
      { scenarioId: `${trace!.scenarioId}-wrong` },
      { primaryTier: "ui-boundary" },
      { executionId: `${trace!.executionId}-wrong` },
      { result: "failed" },
    ]) {
      const invalid = patchCoverage(valid, patch);
      assert.equal(
        recordFor(trace!, { browserTests: [invalid] }).result,
        "not-run",
      );
    }
    assert.equal(
      recordFor(trace!, {
        browserTests: [
          { ...valid, attachments: valid.attachments.slice(0, 1) },
        ],
      }).result,
      "not-run",
    );
  });

  test("every required named case needs its own successful runtime step", () => {
    const trace = SCENARIO_TRACE_REGISTRY.find(
      ({ requiredNamedCases, ownerFile }) =>
        requiredNamedCases.length > 1 && ownerFile.startsWith("test/specs/"),
    );
    assert.notEqual(trace, undefined);
    const steps = [
      scenarioStep(trace!),
      ...trace!.requiredNamedCases.map((caseId) =>
        userStep(`${trace!.scenarioId}[${caseId}]`),
      ),
    ];
    const complete = browserTest(trace!, steps);
    const incomplete = browserTest(trace!, steps.slice(0, -1));
    const failed = browserTest(trace!, [
      ...steps.slice(0, -1),
      userStep(
        `${trace!.scenarioId}[${trace!.requiredNamedCases.at(-1)}]`,
        "failed",
      ),
    ]);

    assert.equal(
      recordFor(trace!, { browserTests: [complete] }).result,
      "passed",
    );
    assert.equal(
      recordFor(trace!, { browserTests: [incomplete] }).result,
      "not-run",
    );
    assert.equal(
      recordFor(trace!, { browserTests: [failed] }).result,
      "not-run",
    );
    const spacedCases = browserTest(trace!, [
      scenarioStep(trace!),
      ...trace!.requiredNamedCases.map((caseId) =>
        userStep(`${trace!.scenarioId} ${caseId} assertions`),
      ),
    ]);
    assert.equal(
      recordFor(trace!, { browserTests: [spacedCases] }).result,
      "passed",
    );
  });

  test("Go JSONL and Bun JUnit only accept exact successful test records", () => {
    const goTrace = SCENARIO_TRACE_REGISTRY.find(({ executionId }) =>
      executionId.startsWith("go."),
    );
    const architectureTrace = SCENARIO_TRACE_REGISTRY.find(({ ownerFile }) =>
      ownerFile.startsWith("test/src/scenario/architecture-tests/"),
    );
    assert.notEqual(goTrace, undefined);
    assert.notEqual(architectureTrace, undefined);

    const goEvents = parseGoTestResults(
      `${JSON.stringify({ Action: "pass", Package: expectedGoPackage(goTrace!), Test: goTrace!.executionId.slice(3), Elapsed: 0.004 })}\n`,
    );
    assert.equal(
      recordFor(goTrace!, { goTestEvents: goEvents }).result,
      "passed",
    );
    assert.equal(
      recordFor(goTrace!, {
        goTestEvents: [{ ...goEvents[0]!, packageName: "gezerah/wrong" }],
      }).result,
      "not-run",
    );
    assert.equal(
      recordFor(goTrace!, {
        goTestEvents: [{ ...goEvents[0]!, action: "skip" }],
      }).result,
      "not-run",
    );

    const junit = parseArchitectureTestResults(`<?xml version="1.0"?>
      <testsuite>
        <testcase name="${architectureTrace!.executionMarker}" file="${architectureTrace!.ownerFile.slice(5)}" time="0.002" />
      </testsuite>`);
    assert.equal(
      recordFor(architectureTrace!, { architectureTests: junit }).result,
      "passed",
    );
    const failedJUnit = parseArchitectureTestResults(`<testsuite>
      <testcase name="${architectureTrace!.executionMarker}" file="${architectureTrace!.ownerFile.slice(5)}" time="0.002"><failure /></testcase>
    </testsuite>`);
    assert.equal(
      recordFor(architectureTrace!, { architectureTests: failedJUnit }).result,
      "not-run",
    );
  });
});

function completeEvidence(): SuiteCoverageEvidence {
  const attachmentTraces = SCENARIO_TRACE_REGISTRY.filter(
    (trace) =>
      trace.primaryTier === "journey" ||
      trace.executionId === "journey.complete-world-lifecycle" ||
      trace.executionId === "scenario-fixture.runtime-health" ||
      trace.executionId === "policy.lifecycle-live-convergence",
  );
  const attached = new Set(
    attachmentTraces.map(({ scenarioId }) => scenarioId),
  );
  const goTestEvents: GoTestEvent[] = [];
  const architectureTests: ArchitectureTestResult[] = [];
  const browserGroups = new Map<string, ScenarioTrace[]>();
  for (const trace of SCENARIO_TRACE_REGISTRY) {
    if (attached.has(trace.scenarioId)) continue;
    if (trace.executionId.startsWith("go.")) {
      goTestEvents.push({
        action: "pass",
        packageName: expectedGoPackage(trace),
        testName: trace.executionId.slice(3),
        elapsedSeconds: 0.001,
      });
      continue;
    }
    if (trace.ownerFile.startsWith("test/src/scenario/architecture-tests/")) {
      architectureTests.push({
        ownerFile: trace.ownerFile,
        title: trace.executionMarker,
        durationMs: 1,
        result: "passed",
      });
      continue;
    }
    const key = `${trace.ownerFile}\u0000${trace.executionMarker}`;
    browserGroups.set(key, [...(browserGroups.get(key) ?? []), trace]);
  }
  const browserTests = [
    attachmentTest(attachmentTraces),
    ...[...browserGroups.values()].map((traces) =>
      browserTest(
        traces[0]!,
        traces.flatMap((trace) => [
          scenarioStep(trace),
          ...trace.requiredNamedCases.map((caseId) =>
            userStep(`${trace.scenarioId}[${caseId}]`),
          ),
        ]),
      ),
    ),
  ];
  return { browserTests, goTestEvents, architectureTests };
}

function recordFor(
  trace: ScenarioTrace,
  patch: Partial<SuiteCoverageEvidence>,
) {
  return buildSuiteCoverageInventory({
    browserTests: patch.browserTests ?? [],
    goTestEvents: patch.goTestEvents ?? [],
    architectureTests: patch.architectureTests ?? [],
  }).records.find(({ scenarioId }) => scenarioId === trace.scenarioId)!;
}

function browserStepTrace(): ScenarioTrace {
  const trace = SCENARIO_TRACE_REGISTRY.find(
    ({ ownerFile, requiredNamedCases, executionId }) =>
      ownerFile.startsWith("test/specs/") &&
      executionId !== "journey.complete-world-lifecycle" &&
      requiredNamedCases.length === 0,
  );
  assert.notEqual(trace, undefined);
  return trace!;
}

function browserTest(
  trace: ScenarioTrace,
  steps: readonly ScenarioTestStepResult[],
): ScenarioTestResult {
  return {
    ownerFile: trace.ownerFile,
    title: trace.executionMarker,
    executionTitle: trace.executionMarker,
    durationMs: 10,
    status: "passed",
    expectedStatus: "passed",
    steps,
    attachments: [],
  };
}

function attachmentTest(traces: readonly ScenarioTrace[]): ScenarioTestResult {
  const executionMarker = traces[0]?.executionMarker ?? "lifecycle";
  const records = traces.map((trace) => ({
    scenarioId: trace.scenarioId,
    primaryTier: trace.primaryTier,
    executionId: trace.executionId,
    ...(trace.checkpointId === undefined
      ? { checkpointId: "JRN-001/playable-world" }
      : { checkpointId: trace.checkpointId }),
    result: "passed",
    durationMs: 3,
    namedCases: trace.requiredNamedCases.map((caseId) => ({
      caseId,
      result: "passed",
    })),
    observedScopes: ["UI", "RUNTIME"],
  }));
  const entries = traces.flatMap((trace) => [
    {
      result: "passed",
      phase: trace.scenarioId.startsWith("JRN-") ? "checkpoint" : "validation",
      scenarioIds: [trace.scenarioId],
      checkpointId: trace.checkpointId ?? "JRN-001/playable-world",
      mutationEpoch: 7,
    },
    ...(trace.scenarioId === "JRN-001"
      ? [
          {
            result: "passed",
            phase: "validation",
            scenarioIds: ["WRL-001"],
            checkpointId: trace.checkpointId,
            behaviorId: "world.create",
            contractId: "world.create.completed",
            mutationEpoch: 7,
          },
        ]
      : []),
  ]);
  return {
    ownerFile: "test/specs/scenarios/lifecycle-spine.spec.ts",
    title: executionMarker,
    executionTitle: executionMarker,
    durationMs: 10,
    status: "passed",
    expectedStatus: "passed",
    steps: [],
    attachments: [
      jsonAttachment("scenario-coverage", { records }),
      jsonAttachment("scenario-timeline", { entries }),
    ],
  };
}

function jsonAttachment(
  name: ScenarioJSONAttachment["name"],
  body: unknown,
): ScenarioJSONAttachment {
  return {
    name,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function patchCoverage(
  testResult: ScenarioTestResult,
  patch: Readonly<Record<string, unknown>>,
): ScenarioTestResult {
  const attachment = testResult.attachments.find(
    ({ name }) => name === "scenario-coverage",
  )!;
  const body = JSON.parse(attachment.body) as {
    records: Record<string, unknown>[];
  };
  return {
    ...testResult,
    attachments: testResult.attachments.map((candidate) =>
      candidate === attachment
        ? jsonAttachment("scenario-coverage", {
            records: body.records.map((record, index) =>
              index === 0 ? { ...record, ...patch } : record,
            ),
          })
        : candidate,
    ),
  };
}

function scenarioStep(
  trace: ScenarioTrace,
  result: ScenarioTestStepResult["result"] = "passed",
): ScenarioTestStepResult {
  return userStep(trace.scenarioId, result);
}

function userStep(
  title: string,
  result: ScenarioTestStepResult["result"] = "passed",
  steps: readonly ScenarioTestStepResult[] = [],
): ScenarioTestStepResult {
  return {
    title,
    titlePath: [title],
    durationMs: 1,
    result,
    steps,
  };
}

function expectedGoPackage(trace: ScenarioTrace): string {
  return expectedGoPackageForOwnerFile(trace.ownerFile);
}
