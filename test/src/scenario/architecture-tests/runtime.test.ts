import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import {
  defineBehavior,
  defineOutcomeContract,
  implementBehavior,
  outcome,
  shape,
} from "../core/behavior";
import { BehaviorCatalog } from "../catalog/behaviorCatalog";
import { CoverageLedger } from "../evidence/coverage";
import { PerformanceReporter } from "../evidence/performance";
import { EvidenceTimeline } from "../evidence/timeline";
import {
  defineCheckpoint,
  defineJourney,
  JourneyRunner,
  journeyStep,
} from "../runtime/journey";
import { MutationLedger } from "../runtime/mutationLedger";
import { MutationEpochObservations } from "../runtime/observationEpoch";

interface FakeUI {
  readonly writes: string[];
}

interface FakeValidation {
  readonly observations: MutationEpochObservations;
  readonly fail: boolean;
  readonly state: { value: string };
}

const Create = defineBehavior({
  id: "fixture.create",
  version: 1,
  scenarios: ["WRL-001"],
  input: shape<{ name: string; inviteToken?: string }>(),
  outcomes: { created: outcome<{ handle: string }>() },
  sensitiveInputKeys: ["inviteToken"],
});

function makeModule(ledger: MutationLedger, state: { value: string }) {
  return implementBehavior<typeof Create, FakeUI, FakeValidation>(Create, {
    driver: {
      async perform({ ui }, input) {
        state.value = input.name;
        ui.writes.push(input.name);
        ledger.recordBrowserRequest("POST", "/api/worlds");
      },
    },
    contracts: {
      created: defineOutcomeContract({
        id: "fixture.create.created",
        version: 1,
        validatorIds: [],
        async validate({ input, validation }) {
          assert.equal(validation.state.value, input.name);
          const key = {
            actorId: "owner",
            resource: "world",
            projection: "summary",
            surface: "http" as const,
          };
          const first = await validation.observations.observe(
            key,
            async () => ({
              name: validation.state.value,
            }),
          );
          const second = await validation.observations.observe(
            key,
            async () => ({
              name: "should-not-run",
            }),
          );
          assert.equal(first, second);
          if (validation.fail) {
            throw new Error("contract rejected fixture");
          }
          return { handle: first.name };
        },
      }),
    },
  });
}

describe("journey runtime", () => {
  test("runs a checkpoint, records attribution, and makes output resolvable", async () => {
    const ledger = new MutationLedger();
    const observations = new MutationEpochObservations();
    const state = { value: "" };
    const module = makeModule(ledger, state);
    const coverage = new CoverageLedger();
    const timeline = new EvidenceTimeline("fixture-journey");
    const action = journeyStep({
      id: "create-world",
      actorId: "owner",
      behavior: Create,
      outcome: "created",
      input: { name: "Run-local world" },
      scenarioIds: ["WRL-001"],
    });
    const journey = defineJourney({
      id: "fixture-journey",
      actorIds: ["owner"],
      checkpoints: [
        defineCheckpoint({
          id: "JRN-001/playable-world",
          actorIds: ["owner"],
          scenarioIds: ["JRN-001"],
          steps: [action.step],
          async validate({ snapshot }) {
            const key = {
              actorId: "owner",
              resource: "world",
              projection: "checkpoint",
              surface: "http" as const,
            };
            await Promise.all([
              snapshot.observe(key, async () => state.value),
              snapshot.observe(key, async () => "wrong"),
            ]);
          },
        }),
      ],
    });
    const runner = new JourneyRunner({
      catalog: new BehaviorCatalog({ modules: [module] }),
      actors: { owner: { writes: [] } },
      coverage,
      timeline,
      performance: new PerformanceReporter(),
      observations,
      mutationLedger: ledger,
      createValidationContext: () => ({ observations, fail: false, state }),
    });

    const result = await runner.run(journey);
    assert.equal(result.passed, true);
    assert.deepEqual(result.outputs.resolve(action.output), {
      handle: "Run-local world",
    });
    assert.equal(coverage.get("WRL-001").result, "passed");
    assert.deepEqual(coverage.get("JRN-001").actors, ["owner"]);
    assert.equal(observations.stats().epoch, 1);
    assert.equal(observations.stats().loads, 2);
    assert.equal(observations.stats().hits, 2);
    assert.deepEqual(ledger.mutations()[0], {
      sequence: 1,
      actorId: "owner",
      behaviorId: "fixture.create",
      method: "POST",
      sanitizedURL: "/api/worlds",
      phase: "frontend-driver",
    });
  });

  test("fails the causal checkpoint and blocks every later obligation", async () => {
    const ledger = new MutationLedger();
    const observations = new MutationEpochObservations();
    const state = { value: "" };
    const module = makeModule(ledger, state);
    const first = journeyStep({
      id: "first",
      actorId: "owner",
      behavior: Create,
      outcome: "created",
      input: { name: "fails" },
      scenarioIds: ["WRL-001"],
    });
    const later = journeyStep({
      id: "later",
      actorId: "owner",
      behavior: Create,
      outcome: "created",
      input: { name: "must-not-run" },
      scenarioIds: ["IDN-003"],
    });
    const journey = defineJourney({
      id: "fixture-failure",
      actorIds: ["owner"],
      checkpoints: [
        defineCheckpoint({
          id: "first-checkpoint",
          actorIds: ["owner"],
          scenarioIds: ["JRN-001"],
          steps: [first.step],
        }),
        defineCheckpoint({
          id: "later-checkpoint",
          actorIds: ["owner"],
          scenarioIds: ["JRN-002"],
          steps: [later.step],
        }),
      ],
    });
    const coverage = new CoverageLedger();
    const runner = new JourneyRunner({
      catalog: new BehaviorCatalog({ modules: [module] }),
      actors: { owner: { writes: [] } },
      coverage,
      timeline: new EvidenceTimeline("fixture-failure"),
      performance: new PerformanceReporter(),
      observations,
      mutationLedger: ledger,
      createValidationContext: () => ({ observations, fail: true, state }),
    });

    const result = await runner.run(journey);
    assert.equal(result.passed, false);
    assert.equal(result.failure?.kind, "contract-failure");
    assert.equal(coverage.get("WRL-001").result, "failed");
    assert.equal(coverage.get("JRN-001").result, "failed");
    assert.equal(coverage.get("IDN-003").result, "blocked-by");
    assert.equal(coverage.get("IDN-003").blockedBy, "WRL-001");
    assert.equal(coverage.get("JRN-002").result, "blocked-by");
    assert.throws(() => result.outputs.resolve(first.output), /not available/);
    assert.equal(state.value, "fails");
  });
});

describe("mutation epochs", () => {
  test("deduplicates concurrent loads by actor and invalidates after mutation", async () => {
    const observations = new MutationEpochObservations();
    let loads = 0;
    const key = {
      actorId: "owner",
      resource: "world",
      projection: "summary",
      surface: "http" as const,
    };
    const [first, second] = await Promise.all([
      observations.observe(key, async () => ++loads),
      observations.observe(key, async () => ++loads),
    ]);
    assert.equal(first, second);
    assert.equal(loads, 1);
    observations.advance("next behavior");
    await observations.observe(key, async () => ++loads);
    assert.equal(loads, 2);
    assert.deepEqual(observations.stats(), {
      epoch: 1,
      loads: 2,
      hits: 1,
      entries: 1,
      snapshots: 0,
    });
  });

  test("rejects validator writes", async () => {
    const ledger = new MutationLedger();
    await assert.rejects(
      () =>
        ledger.validation(async () => {
          ledger.assertReadOnlyHTTP("POST");
        }),
      /not read-only/,
    );
    assert.equal(ledger.violations().length, 1);
  });

  test("attributes observed browser writes and rejects writes outside a behavior", () => {
    const ledger = new MutationLedger();
    ledger.recordObservedBrowserRequest(
      "player",
      "JRN-003/improvised-round-resolved",
      "POST",
      "/api/worlds/[world]/interactions",
    );
    ledger.recordObservedBrowserRequest(
      "spectator",
      undefined,
      "DELETE",
      "/api/worlds/[world]",
    );
    assert.deepEqual(ledger.mutations()[0], {
      sequence: 1,
      actorId: "player",
      behaviorId: "JRN-003/improvised-round-resolved",
      method: "POST",
      sanitizedURL: "/api/worlds/[world]/interactions",
      phase: "frontend-driver",
    });
    assert.throws(() => ledger.assertClean(), /outside a named behavior/);
  });
});
