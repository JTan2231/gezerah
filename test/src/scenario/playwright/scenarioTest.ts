import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from "@playwright/test";

import { readBaseURL } from "../../runtime";
import type { ScenarioId } from "../catalog/scenarioTraces";
import { CoverageLedger } from "../evidence/coverage";
import { PerformanceReporter } from "../evidence/performance";
import {
  sanitizeText,
  sanitizeURL as sanitizeEvidenceURL,
} from "../evidence/redaction";
import { EvidenceTimeline } from "../evidence/timeline";
import { MutationLedger } from "../runtime/mutationLedger";
import { MutationEpochObservations } from "../runtime/observationEpoch";
import {
  SPINE_BEHAVIOR_CATALOG,
  SPINE_BEHAVIOR_SPECS,
  spineValidationContext,
  spineBehaviorSpec,
  type SpineBehaviorId,
  type SpineBehaviorInput,
} from "./spineBehaviors";

export type ScenarioActorId = "owner" | "editor" | "player" | "spectator";

export interface ScenarioActors {
  readonly owner: Page;
  readonly editor: Page;
  readonly player: Page;
  readonly spectator: Page;
}

export interface ScenarioExecution {
  readonly baseURL: string;
  readonly actors: ScenarioActors;
  checkpoint<T>(id: string, action: () => Promise<T>): Promise<T>;
  behavior(
    id: SpineBehaviorId,
    perform: () => Promise<void>,
    validate: () => Promise<void>,
  ): Promise<void>;
  rib<T>(id: string, action: () => Promise<T>): Promise<T>;
}

interface ScenarioFixtures {
  readonly scenario: ScenarioExecution;
}

interface RuntimeFailure {
  readonly actorId: ScenarioActorId;
  readonly kind:
    "console-error" | "page-error" | "server-error" | "failed-asset";
  readonly detail: string;
}

const ACTOR_IDS = ["owner", "editor", "player", "spectator"] as const;

const CHECKPOINT_ACTORS: Readonly<Record<string, readonly ScenarioActorId[]>> =
  Object.freeze({
    "JRN-001/playable-world": ["owner"],
    "JRN-002/ready-player": ["owner", "editor", "player", "spectator"],
    "JRN-003/improvised-round-resolved": [
      "owner",
      "editor",
      "player",
      "spectator",
    ],
    "JRN-004/status-lifecycle-preserved": ["editor", "player", "spectator"],
    "JRN-005/spectator-public-table-safe": [
      "owner",
      "editor",
      "player",
      "spectator",
    ],
    "JRN-006/editor-authority-bounded": ["editor"],
    "JRN-007/archived-history-readable": [
      "owner",
      "editor",
      "player",
      "spectator",
    ],
  });

const CHECKPOINT_SCENARIO_IDS: Readonly<Record<string, readonly ScenarioId[]>> =
  Object.freeze({
    "JRN-001/playable-world": [
      "JRN-001",
      "IDN-001",
      "IDN-002",
      "WRL-001",
      "WRL-V01",
      "MEC-001",
      "MEC-002",
      "MEC-003",
      "MEC-005",
      "MEC-V01",
      "CHF-002",
      "RST-001",
      "RST-002",
      "NAV-001",
    ],
    "JRN-002/ready-player": [
      "JRN-002",
      "IDN-003",
      "WRL-002",
      "RST-003",
      "RST-004",
      "RST-005",
      "RST-V01",
      "RST-V02",
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-005",
      "AUT-001",
    ],
    "JRN-003/improvised-round-resolved": [
      "JRN-003",
      "PLY-001",
      "PLY-002",
      "PLY-003",
      "PLY-004",
      "PLY-006",
      "PLY-008",
      "PLY-V05",
      "CON-001",
      "CON-003",
      "CON-V01",
      "AUT-008",
      "LFC-V03",
      "NAV-V04",
    ],
    "JRN-004/status-lifecycle-preserved": [
      "JRN-004",
      "CON-004",
      "CON-005",
      "CON-006",
      "CON-007",
      "CON-008",
    ],
    "JRN-005/spectator-public-table-safe": [
      "JRN-005",
      "AUT-003",
      "AUT-004",
      "AUT-005",
      "AUT-006",
    ],
    "JRN-006/editor-authority-bounded": [
      "JRN-006",
      "WRL-003",
      "MEC-006",
      "AUT-002",
    ],
    "JRN-007/archived-history-readable": ["JRN-007", "LFC-004", "LFC-005"],
  });

const JOURNEY_SCENARIO_IDS = Object.freeze(
  Object.values(CHECKPOINT_SCENARIO_IDS).flat(),
);

const LIFECYCLE_RUNTIME_SCENARIO_IDS = Object.freeze([
  ...JOURNEY_SCENARIO_IDS,
  "GLO-002",
  "GLO-009",
] as const satisfies readonly ScenarioId[]);

const RIB_SCENARIOS: Readonly<
  Record<
    string,
    Readonly<{ scenarioId: ScenarioId; actorIds: readonly ScenarioActorId[] }>
  >
> = Object.freeze({
  "MEC-V01/invalid-bounds": {
    scenarioId: "MEC-V01",
    actorIds: ["owner"],
  },
  "INV-005/revoke-used-invite": {
    scenarioId: "INV-005",
    actorIds: ["owner"],
  },
  "NAV-V04/archive-command-failure": {
    scenarioId: "NAV-V04",
    actorIds: ["owner"],
  },
});

class ScenarioRuntime {
  readonly #timeline = new EvidenceTimeline("journey.complete-world-lifecycle");
  readonly #coverage = new CoverageLedger();
  readonly #performance = new PerformanceReporter(20_000);
  readonly #mutations = new MutationLedger();
  readonly #observations = new MutationEpochObservations();
  readonly #failures: RuntimeFailure[] = [];
  readonly #navigationCounts = new Map<ScenarioActorId, number>();
  readonly #actorIdentityIds = new Map<ScenarioActorId, string>();
  readonly #actorWorldIds = new Map<ScenarioActorId, string>();
  readonly #checkpointStack: string[] = [];
  readonly #completedCheckpoints = new Set<string>();
  readonly #completedBehaviors = new Set<string>();
  readonly #startedAt = performance.now();
  #failureCause: ScenarioId | undefined;
  #activeBehaviorId: string | undefined;
  #lastAdvancedMutationCount = 0;
  #requestCount = 0;

  constructor(
    readonly baseURL: string,
    readonly actors: ScenarioActors,
  ) {
    for (const actorId of ACTOR_IDS) {
      this.#navigationCounts.set(actorId, 0);
      this.#observePage(actorId, actors[actorId]);
    }
  }

  async checkpoint<T>(id: string, action: () => Promise<T>): Promise<T> {
    const scenarioIds = CHECKPOINT_SCENARIO_IDS[id];
    const actorIds = CHECKPOINT_ACTORS[id];
    if (scenarioIds === undefined || actorIds === undefined) {
      throw new Error(`unknown lifecycle checkpoint ${id}`);
    }
    const scenarioId = scenarioIds[0];
    if (scenarioId === undefined || !scenarioId.startsWith("JRN-")) {
      throw new Error(`checkpoint ${id} has no primary journey scenario`);
    }
    if (this.#completedCheckpoints.has(id)) {
      throw new Error(`lifecycle checkpoint ${id} ran more than once`);
    }

    return base.step(id, async () => {
      const stop = this.#performance.start(id, "checkpoint");
      let durationMs: number | undefined;
      const finishSpan = () => {
        durationMs ??= stop();
        return durationMs;
      };
      this.#checkpointStack.push(id);
      this.#timeline.append({
        phase: "checkpoint",
        result: "started",
        checkpointId: id,
        scenarioIds,
        mutationEpoch: this.#observations.epoch,
      });
      try {
        const result = await action();
        const mutationCount = this.#mutations.mutations().length;
        const wrote = mutationCount > this.#lastAdvancedMutationCount;
        if (wrote) {
          this.#observations.advance(id);
          this.#lastAdvancedMutationCount = mutationCount;
        }
        await this.#observeCheckpoint(id, actorIds);
        this.#assertHealthy();
        const durationMs = finishSpan();
        const missingEvidence = scenarioIds
          .slice(1)
          .filter(
            (coveredScenarioId) =>
              this.#coverage.get(coveredScenarioId).result !== "passed",
          );
        if (missingEvidence.length > 0) {
          throw new Error(
            `checkpoint ${id} lacks behavior evidence for ${missingEvidence.join(", ")}`,
          );
        }
        this.#coverage.pass(scenarioId, {
          actors: actorIds,
          checkpointId: id,
          durationMs,
          observedScopes: ["UI", "RUNTIME"],
        });
        if (id === "JRN-003/improvised-round-resolved") {
          this.#coverage.pass("GLO-009", {
            actors: actorIds,
            checkpointId: id,
            durationMs,
            observedScopes: ["UI", "RUNTIME"],
          });
          this.#timeline.append({
            phase: "harness",
            result: "passed",
            checkpointId: id,
            scenarioIds: ["GLO-009"],
            mutationEpoch: this.#observations.epoch,
            durationMs,
          });
        }
        this.#completedCheckpoints.add(id);
        this.#timeline.append({
          phase: "checkpoint",
          result: "passed",
          checkpointId: id,
          scenarioIds,
          mutationEpoch: this.#observations.epoch,
          durationMs,
        });
        return result;
      } catch (error: unknown) {
        const durationMs = finishSpan();
        this.#failureCause ??= scenarioId;
        this.#coverage.fail(scenarioId, {
          actors: actorIds,
          checkpointId: id,
          durationMs,
          observedScopes: ["UI", "RUNTIME"],
          error: error instanceof Error ? error.name : "scenario failure",
        });
        this.#timeline.append({
          phase: "checkpoint",
          result: "failed",
          checkpointId: id,
          scenarioIds,
          mutationEpoch: this.#observations.epoch,
          durationMs,
          details: {
            errorType: error instanceof Error ? error.name : "unknown",
          },
        });
        throw error;
      } finally {
        const active = this.#checkpointStack.pop();
        if (active !== id) {
          throw new Error(`checkpoint stack corruption: expected ${id}`);
        }
      }
    });
  }

  async behavior(
    id: SpineBehaviorId,
    perform: () => Promise<void>,
    validate: () => Promise<void>,
  ): Promise<void> {
    const behaviorSpec = spineBehaviorSpec(id);
    if (this.#completedBehaviors.has(id)) {
      throw new Error(`lifecycle behavior ${id} ran more than once`);
    }
    const module = SPINE_BEHAVIOR_CATALOG.getById(id);
    const contract = module.contracts.completed;
    if (contract === undefined) {
      throw new Error(`lifecycle behavior ${id} has no completed contract`);
    }
    const actorId = behaviorSpec.actorIds[0];
    if (actorId === undefined) {
      throw new Error(`lifecycle behavior ${id} has no actor`);
    }
    const input: SpineBehaviorInput = { perform };

    await base.step(id, async () => {
      const stop = this.#performance.start(id, "behavior");
      let durationMs: number | undefined;
      const finishSpan = () => {
        durationMs ??= stop();
        return durationMs;
      };
      const activeCheckpointId = this.#checkpointStack.at(-1);
      this.#timeline.append({
        phase: "driver",
        result: "started",
        actorId,
        ...(activeCheckpointId === undefined
          ? {}
          : { checkpointId: activeCheckpointId }),
        scenarioIds: behaviorSpec.scenarioIds,
        behaviorId: id,
        outcome: "completed",
        contractId: contract.id,
        mutationEpoch: this.#observations.epoch,
      });
      try {
        this.#activeBehaviorId = id;
        try {
          await module.driver.perform(
            { actorId, ui: this.actors, actionId: id },
            input,
          );
        } finally {
          this.#activeBehaviorId = undefined;
        }
        const mutationCount = this.#mutations.mutations().length;
        if (mutationCount > this.#lastAdvancedMutationCount) {
          this.#observations.advance(id);
          this.#lastAdvancedMutationCount = mutationCount;
        }
        this.#assertHealthy();
        await this.#mutations.validation(async () =>
          contract.validate({
            actorId,
            behaviorId: id,
            outcome: "completed",
            mutationEpoch: this.#observations.epoch,
            input,
            validation: spineValidationContext(validate),
          }),
        );
        if (id === "consequence.resolve") {
          await this.#validateEventProjection();
        }
        const finishedMs = finishSpan();
        for (const coveredScenarioId of behaviorSpec.scenarioIds) {
          const checkpointId =
            SPINE_BEHAVIOR_CATALOG.getTrace(coveredScenarioId).checkpointId;
          this.#coverage.pass(coveredScenarioId, {
            actors: behaviorSpec.actorIds,
            ...(checkpointId === undefined ? {} : { checkpointId }),
            durationMs: finishedMs,
            observedScopes: ["UI", "RUNTIME"],
          });
        }
        this.#completedBehaviors.add(id);
        this.#timeline.append({
          phase: "validation",
          result: "passed",
          actorId,
          ...(activeCheckpointId === undefined
            ? {}
            : { checkpointId: activeCheckpointId }),
          scenarioIds: behaviorSpec.scenarioIds,
          behaviorId: id,
          outcome: "completed",
          contractId: contract.id,
          mutationEpoch: this.#observations.epoch,
          durationMs: finishedMs,
        });
      } catch (error: unknown) {
        const finishedMs = finishSpan();
        const cause = behaviorSpec.scenarioIds[0];
        if (cause !== undefined) this.#failureCause ??= cause;
        for (const coveredScenarioId of behaviorSpec.scenarioIds) {
          const checkpointId =
            SPINE_BEHAVIOR_CATALOG.getTrace(coveredScenarioId).checkpointId;
          this.#coverage.fail(coveredScenarioId, {
            actors: behaviorSpec.actorIds,
            ...(checkpointId === undefined ? {} : { checkpointId }),
            durationMs: finishedMs,
            observedScopes: ["UI", "RUNTIME"],
            error,
          });
        }
        this.#timeline.append({
          phase: "validation",
          result: "failed",
          actorId,
          ...(activeCheckpointId === undefined
            ? {}
            : { checkpointId: activeCheckpointId }),
          scenarioIds: behaviorSpec.scenarioIds,
          behaviorId: id,
          outcome: "completed",
          contractId: contract.id,
          mutationEpoch: this.#observations.epoch,
          durationMs: finishedMs,
          details: {
            errorType: error instanceof Error ? error.name : "unknown",
          },
        });
        throw error;
      }
    });
  }

  async rib<T>(id: string, action: () => Promise<T>): Promise<T> {
    const rib = RIB_SCENARIOS[id];
    if (rib === undefined) throw new Error(`unknown lifecycle rib ${id}`);
    return base.step(id, async () => {
      const stop = this.#performance.start(id, "scenario");
      let durationMs: number | undefined;
      const finishSpan = () => {
        durationMs ??= stop();
        return durationMs;
      };
      const checkpointId = this.#checkpointStack.at(-1);
      const enclosingBehaviorId = this.#activeBehaviorId;
      try {
        this.#activeBehaviorId = id;
        let result: T;
        try {
          result = await action();
        } finally {
          this.#activeBehaviorId = enclosingBehaviorId;
        }
        const mutationCount = this.#mutations.mutations().length;
        if (mutationCount > this.#lastAdvancedMutationCount) {
          this.#observations.advance(id);
          this.#lastAdvancedMutationCount = mutationCount;
        }
        this.#assertHealthy();
        const durationMs = finishSpan();
        this.#coverage.pass(rib.scenarioId, {
          actors: rib.actorIds,
          ...(checkpointId === undefined ? {} : { checkpointId }),
          durationMs,
          observedScopes: ["UI", "RUNTIME"],
        });
        this.#timeline.append({
          phase: "coverage",
          result: "passed",
          ...(checkpointId === undefined ? {} : { checkpointId }),
          scenarioIds: [rib.scenarioId],
          ...(enclosingBehaviorId === undefined
            ? {}
            : { behaviorId: enclosingBehaviorId }),
          durationMs,
          mutationEpoch: this.#observations.epoch,
        });
        return result;
      } catch (error: unknown) {
        const durationMs = finishSpan();
        this.#coverage.fail(rib.scenarioId, {
          actors: rib.actorIds,
          ...(checkpointId === undefined ? {} : { checkpointId }),
          durationMs,
          observedScopes: ["UI", "RUNTIME"],
          error: error instanceof Error ? error.name : "scenario failure",
        });
        throw error;
      }
    });
  }

  async attach(testInfo: TestInfo): Promise<void> {
    if (this.#failureCause !== undefined) {
      for (const scenarioId of LIFECYCLE_RUNTIME_SCENARIO_IDS) {
        if (this.#coverage.get(scenarioId).result === "not-run") {
          this.#coverage.block(scenarioId, this.#failureCause, {
            observedScopes: ["RUNTIME"],
          });
        }
      }
    }
    const observationStats = this.#observations.stats();
    if (testInfo.status === testInfo.expectedStatus) {
      this.#assertHealthy();
      const runtimeDurationMs = performance.now() - this.#startedAt;
      this.#coverage.pass("GLO-002", {
        actors: ACTOR_IDS,
        durationMs: runtimeDurationMs,
        observedScopes: ["RUNTIME"],
      });
      this.#timeline.append({
        phase: "harness",
        result: "passed",
        scenarioIds: ["GLO-002"],
        mutationEpoch: this.#observations.epoch,
        durationMs: runtimeDurationMs,
      });
      const missingBehaviors = SPINE_BEHAVIOR_SPECS.filter(
        ({ id }) => !this.#completedBehaviors.has(id),
      ).map(({ id }) => id);
      if (missingBehaviors.length > 0) {
        throw new Error(
          `lifecycle behaviors not run: ${missingBehaviors.join(", ")}`,
        );
      }
      this.#coverage.assertTerminal(LIFECYCLE_RUNTIME_SCENARIO_IDS);
    }
    this.#performance.increment("requests", this.#requestCount);
    this.#performance.increment("observationLoads", observationStats.loads);
    this.#performance.increment("observationCacheHits", observationStats.hits);
    this.#performance.increment("mutationEpochs", observationStats.epoch);

    const attachments = [
      ["scenario-timeline", this.#timeline.toJSON()],
      [
        "scenario-mutations",
        {
          records: this.#mutations.mutations(),
          violations: this.#mutations.violations(),
        },
      ],
      [
        "scenario-coverage",
        {
          records: this.#coverage
            .results()
            .filter(({ scenarioId }) =>
              LIFECYCLE_RUNTIME_SCENARIO_IDS.includes(scenarioId),
            ),
        },
      ],
      [
        "scenario-runtime-health",
        {
          failures: this.#failures,
          navigationCounts: Object.fromEntries(this.#navigationCounts),
          observations: observationStats,
        },
      ],
    ] as const;
    this.#performance.increment(
      "artifactBytes",
      attachments.reduce(
        (total, [, value]) => total + Buffer.byteLength(JSON.stringify(value)),
        0,
      ),
    );
    await Promise.all(
      attachments.map(async ([name, value]) =>
        attachJSON(testInfo, name, value),
      ),
    );
    const performanceReport =
      testInfo.status === testInfo.expectedStatus
        ? this.#performance.assertUnderBudget()
        : this.#performance.report();
    await attachJSON(testInfo, "scenario-performance", performanceReport);
    this.#mutations.assertClean();
  }

  #observePage(actorId: ScenarioActorId, page: Page): void {
    page.on("request", (request) => this.#recordRequest(actorId, request));
    page.on("response", (response) => this.#recordResponse(actorId, response));
    page.on("pageerror", (error) => {
      this.#failures.push({
        actorId,
        kind: "page-error",
        detail: sanitizeText(error.message),
      });
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const detail = message.text();
      if (detail.startsWith("Failed to load resource:")) return;
      this.#failures.push({
        actorId,
        kind: "console-error",
        detail: sanitizeText(detail),
      });
    });
    page.on("requestfailed", (request) => {
      if (!isStaticAsset(request)) return;
      this.#failures.push({
        actorId,
        kind: "failed-asset",
        detail: `${request.method()} ${sanitizeURL(request.url())}: ${sanitizeText(
          request.failure()?.errorText ?? "unknown failure",
        )}`,
      });
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.#navigationCounts.set(
          actorId,
          (this.#navigationCounts.get(actorId) ?? 0) + 1,
        );
      }
    });
  }

  #recordRequest(actorId: ScenarioActorId, request: Request): void {
    const requestURL = new URL(request.url());
    const applicationURL = new URL(this.baseURL);
    if (requestURL.origin !== applicationURL.origin) return;
    const identityId = request.headers()["x-dnd-user-id"];
    if (identityId !== undefined && identityId !== "") {
      this.#actorIdentityIds.set(actorId, identityId);
    }
    const worldMatch = requestURL.pathname.match(
      /^\/api\/worlds\/([0-9a-f-]{36})(?:\/|$)/i,
    );
    if (worldMatch?.[1] !== undefined) {
      this.#actorWorldIds.set(actorId, worldMatch[1]);
    }
    this.#requestCount += 1;
    this.#mutations.recordObservedBrowserRequest(
      actorId,
      this.#activeBehaviorId,
      request.method(),
      sanitizeURL(request.url()),
    );
  }

  #recordResponse(actorId: ScenarioActorId, response: Response): void {
    if (response.status() < 500) return;
    const responseURL = new URL(response.url());
    if (responseURL.origin !== new URL(this.baseURL).origin) return;
    this.#failures.push({
      actorId,
      kind: "server-error",
      detail: `${response.status()} ${sanitizeURL(response.url())}`,
    });
  }

  async #observeCheckpoint(
    id: string,
    actorIds: readonly ScenarioActorId[],
  ): Promise<void> {
    await this.#observations.snapshot(id, async (snapshot) => {
      await Promise.all(
        actorIds.flatMap((actorId) => {
          const key = {
            actorId,
            resource: "current-page",
            projection: id,
            surface: "browser" as const,
          };
          const load = async () => ({
            url: sanitizeURL(this.actors[actorId].url()),
            navigationCount: this.#navigationCounts.get(actorId) ?? 0,
          });
          return [snapshot.observe(key, load), snapshot.observe(key, load)];
        }),
      );
    });
  }

  async #validateEventProjection(): Promise<void> {
    const actorIds = ["editor", "player", "spectator"] as const;
    const projections = await Promise.all(
      actorIds.map(async (actorId) => {
        const identityId = this.#actorIdentityIds.get(actorId);
        const worldId = this.#actorWorldIds.get(actorId);
        if (identityId === undefined || worldId === undefined) {
          throw new Error(
            `event projection identity is unavailable for ${actorId}`,
          );
        }
        return {
          actorId,
          events: await readAvailableWorldEvents(
            this.baseURL,
            worldId,
            identityId,
          ),
        };
      }),
    );
    const allowedKeys = new Set([
      "id",
      "type",
      "interaction_id",
      "submission_id",
      "resolution_id",
      "actor_membership_id",
      "created_at",
    ]);
    for (const { actorId, events } of projections) {
      if (!events.some((event) => event.type === "resolution-applied")) {
        throw new Error(
          `event projection for ${actorId} omitted resolution invalidation`,
        );
      }
      for (const event of events) {
        const unexpectedKeys = Object.keys(event).filter(
          (key) => !allowedKeys.has(key),
        );
        if (unexpectedKeys.length > 0) {
          throw new Error(
            `event projection for ${actorId} exposed unsupported fields`,
          );
        }
      }
      if (actorId === "editor") continue;
      const invalidation = events.find(
        (event) => event.type === "interaction-feed-invalidated",
      );
      if (invalidation === undefined) {
        throw new Error(
          `event projection for ${actorId} omitted private-lifecycle invalidation`,
        );
      }
      for (const key of [
        "interaction_id",
        "submission_id",
        "resolution_id",
        "actor_membership_id",
      ]) {
        if (key in invalidation) {
          throw new Error(
            `event projection for ${actorId} leaked invalidation identifiers`,
          );
        }
      }
    }
  }

  #assertHealthy(): void {
    this.#mutations.assertClean();
    const first = this.#failures[0];
    if (first !== undefined) {
      throw new Error(
        `${first.kind} observed for ${first.actorId}: ${first.detail}`,
      );
    }
  }
}

async function createActorContexts(browser: Browser): Promise<
  Readonly<{
    contexts: readonly BrowserContext[];
    actors: ScenarioActors;
  }>
> {
  const contexts = await Promise.all(
    ACTOR_IDS.map(async () => browser.newContext({ reducedMotion: "reduce" })),
  );
  const pages = await Promise.all(
    contexts.map(async (context) => context.newPage()),
  );
  const [owner, editor, player, spectator] = pages;
  if (
    owner === undefined ||
    editor === undefined ||
    player === undefined ||
    spectator === undefined
  ) {
    throw new Error("scenario actor context creation was incomplete");
  }
  return Object.freeze({
    contexts: Object.freeze(contexts),
    actors: Object.freeze({ owner, editor, player, spectator }),
  });
}

async function attachJSON(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await testInfo.attach(name, { body, contentType: "application/json" });
}

function sanitizeURL(rawURL: string): string {
  const url = new URL(rawURL);
  url.search = "";
  url.hash = "";
  return sanitizeEvidenceURL(url.pathname);
}

function isStaticAsset(request: Request): boolean {
  return ["stylesheet", "script", "image", "font"].includes(
    request.resourceType(),
  );
}

interface ProjectedWorldEvent {
  readonly id: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

async function readAvailableWorldEvents(
  baseURL: string,
  worldId: string,
  identityId: string,
): Promise<readonly ProjectedWorldEvent[]> {
  const controller = new AbortController();
  const response = await fetch(
    `${baseURL}/api/worlds/${worldId}/events?after=0`,
    {
      headers: { "X-DND-User-ID": identityId },
      signal: controller.signal,
    },
  );
  if (response.status !== 200 || response.body === null) {
    controller.abort();
    throw new Error("event projection read failed");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = "";
  try {
    for (let reads = 0; reads < 8; reads += 1) {
      const result = await Promise.race([
        reader.read().then((value) => ({ kind: "data" as const, value })),
        new Promise<Readonly<{ kind: "idle" }>>((resolve) =>
          setTimeout(() => resolve({ kind: "idle" }), 100),
        ),
      ]);
      if (result.kind === "idle" || result.value.done) break;
      source += decoder.decode(result.value.value, { stream: true });
      if (source.includes('"type":"resolution-applied"')) break;
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return Object.freeze(
    source.split("\n\n").flatMap((block): ProjectedWorldEvent[] => {
      const data = block
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data === undefined) return [];
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === "object" && parsed !== null
        ? [parsed as ProjectedWorldEvent]
        : [];
    }),
  );
}

export const test = base.extend<ScenarioFixtures>({
  scenario: async ({ browser }, use, testInfo) => {
    const baseURL = await readBaseURL();
    const { contexts, actors } = await createActorContexts(browser);
    const runtime = new ScenarioRuntime(baseURL, actors);
    try {
      await use({
        baseURL,
        actors,
        checkpoint: async (id, action) => runtime.checkpoint(id, action),
        behavior: async (id, perform, validate) =>
          runtime.behavior(id, perform, validate),
        rib: async (id, action) => runtime.rib(id, action),
      });
    } finally {
      try {
        await runtime.attach(testInfo);
      } finally {
        await Promise.all(contexts.map(async (context) => context.close()));
      }
    }
  },
});

export { expect };
export type { Page };
