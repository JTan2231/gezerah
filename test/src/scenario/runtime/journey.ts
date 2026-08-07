import type {
  AnyBehaviorModule,
  AnyBehaviorDefinition,
  BehaviorInput,
  BehaviorOutcome,
  BehaviorOutput,
} from "../core/behavior";
import type { BehaviorCatalog } from "../catalog/behaviorCatalog";
import type { ScenarioId } from "../catalog/scenarioTraces";
import type { CoverageLedger } from "../evidence/coverage";
import type { PerformanceReporter } from "../evidence/performance";
import type { EvidenceTimeline } from "../evidence/timeline";
import { MutationLedger } from "./mutationLedger";
import {
  MutationEpochObservations,
  type ObservationSnapshot,
} from "./observationEpoch";

export interface JourneyOutputRef<T> {
  readonly key: string;
  readonly __output?: T;
}

export class JourneyOutputs {
  readonly #values = new Map<string, unknown>();

  publish<T>(reference: JourneyOutputRef<T>, value: T): void {
    if (this.#values.has(reference.key)) {
      throw new Error(`journey output ${reference.key} was already published`);
    }
    this.#values.set(reference.key, value);
  }

  resolve<T>(reference: JourneyOutputRef<T>): T {
    if (!this.#values.has(reference.key)) {
      throw new Error(`journey output ${reference.key} is not available`);
    }
    return this.#values.get(reference.key) as T;
  }
}

type InputResolver<Input> =
  Readonly<Input> | ((outputs: JourneyOutputs) => Readonly<Input>);

export interface JourneyStepSpec {
  readonly id: string;
  readonly actorId: string;
  readonly behaviorId: string;
  readonly outcome: string;
  readonly scenarioIds: readonly ScenarioId[];
  readonly output: JourneyOutputRef<unknown>;
  resolveInput(outputs: JourneyOutputs): unknown;
}

export function journeyStep<
  D extends AnyBehaviorDefinition,
  Name extends BehaviorOutcome<D>,
>(options: {
  id: string;
  actorId: string;
  behavior: D;
  outcome: Name;
  input: InputResolver<BehaviorInput<D>>;
  scenarioIds?: readonly ScenarioId[];
}): Readonly<{
  step: JourneyStepSpec;
  output: JourneyOutputRef<BehaviorOutput<D, Name>>;
}> {
  const output: JourneyOutputRef<BehaviorOutput<D, Name>> = Object.freeze({
    key: options.id,
  });
  const resolveInput =
    typeof options.input === "function"
      ? (options.input as (
          outputs: JourneyOutputs,
        ) => Readonly<BehaviorInput<D>>)
      : () => options.input;
  const scenarioIds = Object.freeze([
    ...(options.scenarioIds ?? (options.behavior.scenarios as ScenarioId[])),
  ]);
  return Object.freeze({
    step: Object.freeze({
      id: options.id,
      actorId: options.actorId,
      behaviorId: options.behavior.id,
      outcome: options.outcome,
      scenarioIds,
      output,
      resolveInput,
    }),
    output,
  });
}

export interface JourneyCheckpointContext {
  readonly id: string;
  readonly snapshot: ObservationSnapshot;
  readonly outputs: JourneyOutputs;
}

export interface JourneyCheckpointSpec {
  readonly id: string;
  readonly scenarioIds: readonly ScenarioId[];
  readonly actorIds: readonly string[];
  readonly steps: readonly JourneyStepSpec[];
  validate?(context: JourneyCheckpointContext): Promise<void>;
}

export function defineCheckpoint(
  checkpoint: JourneyCheckpointSpec,
): JourneyCheckpointSpec {
  if (checkpoint.id.length === 0) {
    throw new Error("checkpoint id must not be empty");
  }
  return Object.freeze({
    ...checkpoint,
    scenarioIds: Object.freeze([...checkpoint.scenarioIds]),
    actorIds: Object.freeze([...checkpoint.actorIds]),
    steps: Object.freeze([...checkpoint.steps]),
  });
}

export interface JourneyDefinition {
  readonly id: string;
  readonly actorIds: readonly string[];
  readonly checkpoints: readonly JourneyCheckpointSpec[];
}

export function defineJourney(journey: JourneyDefinition): JourneyDefinition {
  const actorIds = new Set(journey.actorIds);
  if (actorIds.size !== journey.actorIds.length) {
    throw new Error(`journey ${journey.id} has duplicate actors`);
  }
  const checkpointIds = new Set<string>();
  const stepIds = new Set<string>();
  for (const checkpoint of journey.checkpoints) {
    if (checkpointIds.has(checkpoint.id)) {
      throw new Error(
        `journey ${journey.id} has duplicate checkpoint ${checkpoint.id}`,
      );
    }
    checkpointIds.add(checkpoint.id);
    for (const actorId of checkpoint.actorIds) {
      if (!actorIds.has(actorId)) {
        throw new Error(
          `checkpoint ${checkpoint.id} uses unknown actor ${actorId}`,
        );
      }
    }
    for (const step of checkpoint.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`journey ${journey.id} has duplicate step ${step.id}`);
      }
      stepIds.add(step.id);
      if (!actorIds.has(step.actorId)) {
        throw new Error(`step ${step.id} uses unknown actor ${step.actorId}`);
      }
    }
  }
  return Object.freeze({
    ...journey,
    actorIds: Object.freeze([...journey.actorIds]),
    checkpoints: Object.freeze([...journey.checkpoints]),
  });
}

export interface JourneyValidationFactoryContext {
  readonly actorId: string;
  readonly behaviorId: string;
  readonly outcome: string;
  readonly observations: MutationEpochObservations;
  readonly ledger: MutationLedger;
}

export interface JourneyRunnerOptions<UI, ValidationContext> {
  readonly catalog: BehaviorCatalog<UI, ValidationContext>;
  readonly actors: Readonly<Record<string, UI>>;
  readonly coverage: CoverageLedger;
  readonly timeline: EvidenceTimeline;
  readonly performance: PerformanceReporter;
  readonly observations?: MutationEpochObservations;
  readonly mutationLedger?: MutationLedger;
  createValidationContext(
    context: JourneyValidationFactoryContext,
  ): ValidationContext;
  readonly now?: () => number;
}

export interface JourneyRunFailure {
  readonly kind: "driver-failure" | "contract-failure" | "checkpoint-failure";
  readonly causeId: string;
  readonly error: unknown;
}

export interface JourneyRunResult {
  readonly passed: boolean;
  readonly outputs: JourneyOutputs;
  readonly failure?: JourneyRunFailure;
}

function uniqueScenarioIds(checkpoint: JourneyCheckpointSpec): ScenarioId[] {
  return [
    ...new Set([
      ...checkpoint.scenarioIds,
      ...checkpoint.steps.flatMap((step) => step.scenarioIds),
    ]),
  ];
}

export class JourneyRunner<UI, ValidationContext> {
  readonly observations: MutationEpochObservations;
  readonly mutationLedger: MutationLedger;
  readonly #now: () => number;

  constructor(readonly options: JourneyRunnerOptions<UI, ValidationContext>) {
    this.observations = options.observations ?? new MutationEpochObservations();
    this.mutationLedger = options.mutationLedger ?? new MutationLedger();
    this.#now = options.now ?? (() => performance.now());
  }

  async run(journey: JourneyDefinition): Promise<JourneyRunResult> {
    const outputs = new JourneyOutputs();
    for (
      let checkpointIndex = 0;
      checkpointIndex < journey.checkpoints.length;
      checkpointIndex += 1
    ) {
      const checkpoint = journey.checkpoints[checkpointIndex];
      if (checkpoint === undefined) {
        continue;
      }
      const result = await this.#runCheckpoint(checkpoint, outputs);
      if (result !== undefined) {
        this.#blockRemaining(
          journey.checkpoints.slice(checkpointIndex + 1),
          result.causeId,
        );
        return Object.freeze({ passed: false, outputs, failure: result });
      }
    }
    return Object.freeze({ passed: true, outputs });
  }

  async #runCheckpoint(
    checkpoint: JourneyCheckpointSpec,
    outputs: JourneyOutputs,
  ): Promise<JourneyRunFailure | undefined> {
    for (
      let stepIndex = 0;
      stepIndex < checkpoint.steps.length;
      stepIndex += 1
    ) {
      const step = checkpoint.steps[stepIndex];
      if (step === undefined) {
        continue;
      }
      const failure = await this.#runStep(step, checkpoint.id, outputs);
      if (failure !== undefined) {
        for (const scenarioId of checkpoint.scenarioIds) {
          this.options.coverage.fail(scenarioId, {
            actors: checkpoint.actorIds,
            checkpointId: checkpoint.id,
            error: failure.error,
          });
        }
        const laterSteps = checkpoint.steps.slice(stepIndex + 1);
        for (const laterStep of laterSteps) {
          for (const scenarioId of laterStep.scenarioIds) {
            this.options.coverage.block(scenarioId, failure.causeId, {
              actors: [laterStep.actorId],
              checkpointId: checkpoint.id,
            });
          }
        }
        return failure;
      }
    }

    const startedAt = this.#now();
    this.options.timeline.append({
      phase: "checkpoint",
      result: "started",
      checkpointId: checkpoint.id,
      scenarioIds: checkpoint.scenarioIds,
      mutationEpoch: this.observations.epoch,
    });
    try {
      await this.options.performance.measure(checkpoint.id, "checkpoint", () =>
        this.mutationLedger.checkpoint(() =>
          this.observations.snapshot(checkpoint.id, async (snapshot) => {
            await checkpoint.validate?.({
              id: checkpoint.id,
              snapshot,
              outputs,
            });
          }),
        ),
      );
      const durationMs = this.#now() - startedAt;
      for (const scenarioId of checkpoint.scenarioIds) {
        this.options.coverage.pass(scenarioId, {
          actors: checkpoint.actorIds,
          checkpointId: checkpoint.id,
          durationMs,
        });
      }
      this.options.timeline.append({
        phase: "checkpoint",
        result: "passed",
        checkpointId: checkpoint.id,
        scenarioIds: checkpoint.scenarioIds,
        mutationEpoch: this.observations.epoch,
        durationMs,
      });
      return undefined;
    } catch (error: unknown) {
      const durationMs = this.#now() - startedAt;
      const causeId = checkpoint.scenarioIds[0] ?? checkpoint.id;
      for (const scenarioId of checkpoint.scenarioIds) {
        this.options.coverage.fail(scenarioId, {
          actors: checkpoint.actorIds,
          checkpointId: checkpoint.id,
          durationMs,
          error,
        });
      }
      this.options.timeline.append({
        phase: "checkpoint",
        result: "failed",
        checkpointId: checkpoint.id,
        scenarioIds: checkpoint.scenarioIds,
        mutationEpoch: this.observations.epoch,
        durationMs,
        details: { error },
      });
      return Object.freeze({
        kind: "checkpoint-failure",
        causeId,
        error,
      });
    }
  }

  async #runStep(
    step: JourneyStepSpec,
    checkpointId: string,
    outputs: JourneyOutputs,
  ): Promise<JourneyRunFailure | undefined> {
    const startedAt = this.#now();
    const ui = this.options.actors[step.actorId];
    if (ui === undefined) {
      return this.#recordStepFailure(
        "driver-failure",
        step,
        checkpointId,
        `${step.behaviorId}.${step.outcome}`,
        startedAt,
        new Error(`actor ${step.actorId} has no UI session`),
      );
    }
    let module: AnyBehaviorModule<UI, ValidationContext>;
    try {
      module = this.options.catalog.getById(step.behaviorId);
    } catch (error: unknown) {
      return this.#recordStepFailure(
        "driver-failure",
        step,
        checkpointId,
        `${step.behaviorId}.${step.outcome}`,
        startedAt,
        error,
      );
    }
    const contract = module.contracts[step.outcome];
    if (contract === undefined) {
      return this.#recordStepFailure(
        "contract-failure",
        step,
        checkpointId,
        `${step.behaviorId}.${step.outcome}`,
        startedAt,
        new Error(`behavior ${step.behaviorId} has no outcome ${step.outcome}`),
      );
    }

    const input = step.resolveInput(outputs);
    this.options.timeline.append({
      phase: "driver",
      result: "started",
      actorId: step.actorId,
      checkpointId,
      scenarioIds: step.scenarioIds,
      behaviorId: step.behaviorId,
      outcome: step.outcome,
      contractId: contract.id,
      mutationEpoch: this.observations.epoch,
      details: { input },
    });

    try {
      try {
        await this.options.performance.measure(
          step.behaviorId,
          "behavior",
          () =>
            this.mutationLedger.frontendAction(
              step.actorId,
              step.behaviorId,
              () =>
                module.driver.perform(
                  {
                    actorId: step.actorId,
                    ui,
                    actionId: step.id,
                  },
                  input,
                ),
            ),
        );
      } finally {
        this.observations.advance(step.behaviorId);
        this.options.performance.increment("mutationEpochs");
      }
    } catch (error: unknown) {
      return this.#recordStepFailure(
        "driver-failure",
        step,
        checkpointId,
        contract.id,
        startedAt,
        error,
      );
    }

    this.options.timeline.append({
      phase: "driver",
      result: "passed",
      actorId: step.actorId,
      checkpointId,
      scenarioIds: step.scenarioIds,
      behaviorId: step.behaviorId,
      outcome: step.outcome,
      contractId: contract.id,
      mutationEpoch: this.observations.epoch,
    });

    try {
      const validation = this.options.createValidationContext({
        actorId: step.actorId,
        behaviorId: step.behaviorId,
        outcome: step.outcome,
        observations: this.observations,
        ledger: this.mutationLedger,
      });
      this.options.timeline.append({
        phase: "validation",
        result: "started",
        actorId: step.actorId,
        checkpointId,
        scenarioIds: step.scenarioIds,
        behaviorId: step.behaviorId,
        outcome: step.outcome,
        contractId: contract.id,
        mutationEpoch: this.observations.epoch,
      });
      const output = await this.options.performance.measure(
        `${step.id}:validation`,
        "behavior",
        () =>
          this.mutationLedger.validation(() =>
            contract.validate({
              actorId: step.actorId,
              behaviorId: step.behaviorId,
              outcome: step.outcome,
              mutationEpoch: this.observations.epoch,
              input,
              validation,
            }),
          ),
      );
      outputs.publish(step.output, output);
      const durationMs = this.#now() - startedAt;
      for (const scenarioId of step.scenarioIds) {
        this.options.coverage.pass(scenarioId, {
          actors: [step.actorId],
          checkpointId,
          durationMs,
        });
      }
      this.options.timeline.append({
        phase: "validation",
        result: "passed",
        actorId: step.actorId,
        checkpointId,
        scenarioIds: step.scenarioIds,
        behaviorId: step.behaviorId,
        outcome: step.outcome,
        contractId: contract.id,
        mutationEpoch: this.observations.epoch,
        durationMs,
        details: { output },
      });
      return undefined;
    } catch (error: unknown) {
      return this.#recordStepFailure(
        "contract-failure",
        step,
        checkpointId,
        contract.id,
        startedAt,
        error,
      );
    }
  }

  #recordStepFailure(
    kind: JourneyRunFailure["kind"],
    step: JourneyStepSpec,
    checkpointId: string,
    contractId: string,
    startedAt: number,
    error: unknown,
  ): JourneyRunFailure {
    const causeId = step.scenarioIds[0] ?? step.behaviorId;
    const durationMs = this.#now() - startedAt;
    for (const scenarioId of step.scenarioIds) {
      this.options.coverage.fail(scenarioId, {
        actors: [step.actorId],
        checkpointId,
        durationMs,
        error,
      });
    }
    this.options.timeline.append({
      phase: kind === "driver-failure" ? "driver" : "validation",
      result: "failed",
      actorId: step.actorId,
      checkpointId,
      scenarioIds: step.scenarioIds,
      behaviorId: step.behaviorId,
      outcome: step.outcome,
      contractId,
      mutationEpoch: this.observations.epoch,
      durationMs,
      details: { kind, error },
    });
    return Object.freeze({ kind, causeId, error });
  }

  #blockRemaining(
    checkpoints: readonly JourneyCheckpointSpec[],
    blockedBy: string,
  ): void {
    for (const checkpoint of checkpoints) {
      for (const scenarioId of uniqueScenarioIds(checkpoint)) {
        this.options.coverage.block(scenarioId, blockedBy, {
          actors: checkpoint.actorIds,
          checkpointId: checkpoint.id,
        });
      }
      this.options.timeline.append({
        phase: "checkpoint",
        result: "blocked",
        checkpointId: checkpoint.id,
        scenarioIds: uniqueScenarioIds(checkpoint),
        details: { blockedBy },
      });
    }
  }
}
