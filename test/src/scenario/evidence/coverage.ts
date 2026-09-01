import {
  SCENARIO_TRACE_REGISTRY,
  type ScenarioId,
  type ScenarioTrace,
} from "../catalog/scenarioTraces";

export type CoverageResult = "passed" | "failed" | "blocked-by" | "not-run";

export interface NamedCaseCoverage {
  readonly caseId: string;
  readonly result: CoverageResult;
  readonly durationMs?: number | undefined;
  readonly blockedBy?: string | undefined;
}

export interface ScenarioCoverage {
  readonly scenarioId: ScenarioId;
  readonly primaryTier: ScenarioTrace["primaryTier"];
  readonly executionId: string;
  readonly checkpointId?: string;
  readonly actors: readonly string[];
  readonly result: CoverageResult;
  readonly durationMs?: number;
  readonly blockedBy?: string;
  readonly namedCases: readonly NamedCaseCoverage[];
  readonly observedScopes: readonly string[];
  readonly error?: string;
}

interface MutableNamedCaseCoverage {
  caseId: string;
  result: CoverageResult;
  durationMs?: number | undefined;
  blockedBy?: string | undefined;
}

interface MutableScenarioCoverage {
  trace: ScenarioTrace;
  actors: Set<string>;
  result: CoverageResult;
  durationMs?: number | undefined;
  blockedBy?: string | undefined;
  namedCases: Map<string, MutableNamedCaseCoverage>;
  observedScopes: Set<string>;
  error?: string | undefined;
}

export interface CoverageEvidence {
  readonly actors?: readonly string[];
  readonly checkpointId?: string;
  readonly durationMs?: number;
  readonly observedScopes?: readonly string[];
  readonly error?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CoverageLedger {
  readonly #records = new Map<ScenarioId, MutableScenarioCoverage>();

  constructor(traces: readonly ScenarioTrace[] = SCENARIO_TRACE_REGISTRY) {
    for (const trace of traces) {
      if (this.#records.has(trace.scenarioId)) {
        throw new Error(`duplicate coverage record ${trace.scenarioId}`);
      }
      this.#records.set(trace.scenarioId, {
        trace,
        actors: new Set(),
        result: "not-run",
        namedCases: new Map(
          trace.requiredNamedCases.map((caseId) => [
            caseId,
            { caseId, result: "not-run" as const },
          ]),
        ),
        observedScopes: new Set(),
      });
    }
  }

  pass(scenarioId: ScenarioId, evidence: CoverageEvidence = {}): void {
    const record = this.#get(scenarioId);
    const missingCase = [...record.namedCases.values()].find(
      (caseRecord) => caseRecord.result !== "passed",
    );
    if (missingCase !== undefined) {
      throw new Error(
        `cannot pass ${scenarioId}; named case ${missingCase.caseId} is ${missingCase.result}`,
      );
    }
    this.#applyEvidence(record, evidence);
    record.result = "passed";
    record.blockedBy = undefined;
    record.error = undefined;
  }

  fail(scenarioId: ScenarioId, evidence: CoverageEvidence = {}): void {
    const record = this.#get(scenarioId);
    this.#applyEvidence(record, evidence);
    record.result = "failed";
    record.blockedBy = undefined;
    if (evidence.error !== undefined) {
      record.error = errorMessage(evidence.error);
    }
  }

  block(
    scenarioId: ScenarioId,
    blockedBy: string,
    evidence: CoverageEvidence = {},
  ): void {
    const record = this.#get(scenarioId);
    if (record.result === "passed" || record.result === "failed") {
      return;
    }
    this.#applyEvidence(record, evidence);
    record.result = "blocked-by";
    record.blockedBy = blockedBy;
    for (const caseRecord of record.namedCases.values()) {
      if (caseRecord.result === "not-run") {
        caseRecord.result = "blocked-by";
        caseRecord.blockedBy = blockedBy;
      }
    }
  }

  passCase(
    scenarioId: ScenarioId,
    caseId: string,
    evidence: CoverageEvidence = {},
  ): void {
    const record = this.#get(scenarioId);
    const caseRecord = record.namedCases.get(caseId);
    if (caseRecord === undefined) {
      throw new Error(`${scenarioId} has no required case ${caseId}`);
    }
    this.#applyEvidence(record, evidence);
    caseRecord.result = "passed";
    caseRecord.durationMs = evidence.durationMs;
    caseRecord.blockedBy = undefined;
    if (
      [...record.namedCases.values()].every(
        (candidate) => candidate.result === "passed",
      )
    ) {
      record.result = "passed";
    }
  }

  failCase(
    scenarioId: ScenarioId,
    caseId: string,
    evidence: CoverageEvidence = {},
  ): void {
    const record = this.#get(scenarioId);
    const caseRecord = record.namedCases.get(caseId);
    if (caseRecord === undefined) {
      throw new Error(`${scenarioId} has no required case ${caseId}`);
    }
    this.#applyEvidence(record, evidence);
    caseRecord.result = "failed";
    caseRecord.durationMs = evidence.durationMs;
    record.result = "failed";
    if (evidence.error !== undefined) {
      record.error = errorMessage(evidence.error);
    }
  }

  get(scenarioId: ScenarioId): ScenarioCoverage {
    return this.#freeze(this.#get(scenarioId));
  }

  results(): readonly ScenarioCoverage[] {
    return Object.freeze(
      [...this.#records.values()].map((record) => this.#freeze(record)),
    );
  }

  assertTerminal(scenarioIds: readonly ScenarioId[]): void {
    const incomplete = scenarioIds.filter(
      (scenarioId) => this.#get(scenarioId).result === "not-run",
    );
    if (incomplete.length > 0) {
      throw new Error(`scenario coverage not run: ${incomplete.join(", ")}`);
    }
  }

  #get(scenarioId: ScenarioId): MutableScenarioCoverage {
    const record = this.#records.get(scenarioId);
    if (record === undefined) {
      throw new Error(`unknown coverage scenario ${scenarioId}`);
    }
    return record;
  }

  #applyEvidence(
    record: MutableScenarioCoverage,
    evidence: CoverageEvidence,
  ): void {
    for (const actor of evidence.actors ?? []) {
      record.actors.add(actor);
    }
    for (const scope of evidence.observedScopes ?? []) {
      record.observedScopes.add(scope);
    }
    if (evidence.durationMs !== undefined) {
      record.durationMs = evidence.durationMs;
    }
    if (evidence.checkpointId !== undefined) {
      record.trace = Object.freeze({
        ...record.trace,
        checkpointId: evidence.checkpointId,
      });
    }
  }

  #freeze(record: MutableScenarioCoverage): ScenarioCoverage {
    return Object.freeze({
      scenarioId: record.trace.scenarioId,
      primaryTier: record.trace.primaryTier,
      executionId: record.trace.executionId,
      ...(record.trace.checkpointId === undefined
        ? {}
        : { checkpointId: record.trace.checkpointId }),
      actors: Object.freeze([...record.actors]),
      result: record.result,
      ...(record.durationMs === undefined
        ? {}
        : { durationMs: record.durationMs }),
      ...(record.blockedBy === undefined
        ? {}
        : { blockedBy: record.blockedBy }),
      namedCases: Object.freeze(
        [...record.namedCases.values()].map((caseRecord) =>
          Object.freeze({ ...caseRecord }),
        ),
      ),
      observedScopes: Object.freeze([...record.observedScopes]),
      ...(record.error === undefined ? {} : { error: record.error }),
    });
  }
}
