import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import { artifactsDir } from "../../paths";
import {
  SCENARIO_TRACE_REGISTRY,
  type ScenarioId,
  type ScenarioTrace,
} from "../catalog/scenarioTraces";
import type {
  ScenarioJSONAttachment,
  ScenarioTestResult,
  ScenarioTestStepResult,
} from "../playwright/scenarioReporter";

export const scenarioTestResultsPath = join(
  artifactsDir,
  "scenario-test-results.json",
);
export const goTestResultsPath = join(artifactsDir, "go-test-results.jsonl");
export const scenarioArchitectureResultsPath = join(
  artifactsDir,
  "scenario-architecture-results.xml",
);
export const suiteCoveragePath = join(artifactsDir, "scenario-coverage.json");

export interface SuiteCoverageRecord {
  readonly scenarioId: ScenarioId;
  readonly namedCases: readonly Readonly<{
    caseId: string;
    result: "passed" | "not-run";
  }>[];
  readonly baseBehaviors: readonly string[];
  readonly changedDimension?: string;
  readonly primaryEvidenceTier: ScenarioTrace["primaryTier"];
  readonly ownerFile: string;
  readonly executionId: string;
  readonly checkpointId?: string;
  readonly outcomeContractIds: readonly string[];
  readonly validatorIds: readonly string[];
  readonly observedSurfaces: readonly string[];
  readonly mutationEpoch: number | null;
  readonly sharedSnapshotId: string | null;
  readonly durationMs: number | null;
  readonly result: "passed" | "not-run";
}

export interface SuiteCoverageInventory {
  readonly catalogSize: number;
  readonly passed: number;
  readonly notRun: number;
  readonly complete: boolean;
  readonly records: readonly SuiteCoverageRecord[];
}

export interface GoTestEvent {
  readonly action: string;
  readonly packageName?: string;
  readonly testName?: string;
  readonly elapsedSeconds?: number;
}

export interface ArchitectureTestResult {
  readonly ownerFile: string;
  readonly title: string;
  readonly durationMs: number;
  readonly result: "passed" | "failed" | "skipped";
}

export interface SuiteCoverageEvidence {
  readonly browserTests: readonly ScenarioTestResult[];
  readonly goTestEvents: readonly GoTestEvent[];
  readonly architectureTests: readonly ArchitectureTestResult[];
}

interface TestResultDocument {
  readonly tests: readonly ScenarioTestResult[];
}

interface RuntimeCoverageRecord {
  readonly scenarioId: string;
  readonly primaryTier: string;
  readonly executionId: string;
  readonly checkpointId?: string;
  readonly result: string;
  readonly durationMs?: number;
  readonly namedCases: readonly Readonly<{
    caseId: string;
    result: string;
  }>[];
  readonly observedScopes: readonly string[];
}

interface RuntimeTimelineEntry {
  readonly sequence?: number;
  readonly result: string;
  readonly phase?: string;
  readonly scenarioIds: readonly string[];
  readonly checkpointId?: string;
  readonly behaviorId?: string;
  readonly contractId?: string;
  readonly mutationEpoch?: number;
}

interface RuntimeTimeline {
  readonly entries: readonly RuntimeTimelineEntry[];
}

interface EvidenceMatch {
  readonly namedCases: ReadonlyMap<string, "passed" | "not-run">;
  readonly baseBehaviors: readonly string[];
  readonly checkpointId?: string;
  readonly outcomeContractIds: readonly string[];
  readonly validatorIds: readonly string[];
  readonly observedSurfaces: readonly string[];
  readonly mutationEpoch: number | null;
  readonly sharedSnapshotId: string | null;
  readonly durationMs: number | null;
}

export async function finalizeSuiteCoverage(options: {
  readonly requireComplete: boolean;
}): Promise<SuiteCoverageInventory> {
  const browserDocument = readJSONFile<TestResultDocument>(
    scenarioTestResultsPath,
    { tests: [] },
  );
  const inventory = buildSuiteCoverageInventory({
    browserTests: Array.isArray(browserDocument.tests)
      ? browserDocument.tests
      : [],
    goTestEvents: parseGoTestResults(readTextFile(goTestResultsPath)),
    architectureTests: parseArchitectureTestResults(
      readTextFile(scenarioArchitectureResultsPath),
    ),
  });
  await mkdir(dirname(suiteCoveragePath), { recursive: true });
  await writeFile(
    suiteCoveragePath,
    `${JSON.stringify(inventory, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  if (options.requireComplete && !inventory.complete) {
    const missing = inventory.records
      .filter(({ result }) => result !== "passed")
      .map(({ scenarioId }) => scenarioId);
    throw new Error(
      `required suite coverage is incomplete: ${missing.join(", ") || "unknown"}`,
    );
  }
  return inventory;
}

export function buildSuiteCoverageInventory(
  evidence: SuiteCoverageEvidence,
): SuiteCoverageInventory {
  const records = SCENARIO_TRACE_REGISTRY.map((trace) => {
    const match = findEvidence(trace, evidence);
    const passed = match !== undefined;
    const namedCases = trace.requiredNamedCases.map((caseId) => ({
      caseId,
      result: match?.namedCases.get(caseId) ?? ("not-run" as const),
    }));
    return Object.freeze({
      scenarioId: trace.scenarioId,
      namedCases: Object.freeze(namedCases.map((item) => Object.freeze(item))),
      baseBehaviors: Object.freeze([...(match?.baseBehaviors ?? [])]),
      ...(trace.changedDimension === undefined
        ? {}
        : { changedDimension: trace.changedDimension }),
      primaryEvidenceTier: trace.primaryTier,
      ownerFile: trace.ownerFile,
      executionId: trace.executionId,
      ...((match?.checkpointId ?? trace.checkpointId) === undefined
        ? {}
        : { checkpointId: match?.checkpointId ?? trace.checkpointId }),
      outcomeContractIds: Object.freeze([...(match?.outcomeContractIds ?? [])]),
      validatorIds: Object.freeze([...(match?.validatorIds ?? [])]),
      observedSurfaces: Object.freeze([...(match?.observedSurfaces ?? [])]),
      mutationEpoch: match?.mutationEpoch ?? null,
      sharedSnapshotId: match?.sharedSnapshotId ?? null,
      durationMs: match?.durationMs ?? null,
      result: passed ? ("passed" as const) : ("not-run" as const),
    });
  });
  const passed = records.filter(({ result }) => result === "passed").length;
  return Object.freeze({
    catalogSize: records.length,
    passed,
    notRun: records.length - passed,
    complete: passed === records.length,
    records: Object.freeze(records),
  });
}

export function parseGoTestResults(contents: string): readonly GoTestEvent[] {
  return Object.freeze(
    contents
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch (error: unknown) {
          throw new Error(
            `invalid Go test JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (!isRecord(value) || typeof value.Action !== "string") {
          throw new Error(`invalid Go test event on line ${index + 1}`);
        }
        return Object.freeze({
          action: value.Action,
          ...(typeof value.Package === "string"
            ? { packageName: value.Package }
            : {}),
          ...(typeof value.Test === "string" ? { testName: value.Test } : {}),
          ...(typeof value.Elapsed === "number"
            ? { elapsedSeconds: value.Elapsed }
            : {}),
        });
      }),
  );
}

export function parseArchitectureTestResults(
  xml: string,
): readonly ArchitectureTestResult[] {
  if (xml.trim().length === 0) return Object.freeze([]);
  const results: ArchitectureTestResult[] = [];
  const testCasePattern =
    /<testcase\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/testcase\s*>)/gu;
  for (const match of xml.matchAll(testCasePattern)) {
    const attributes = parseXMLAttributes(match[1] ?? "");
    const title = attributes.get("name");
    const file = attributes.get("file");
    if (title === undefined || file === undefined) continue;
    const body = match[2] ?? "";
    const result = /<(?:failure|error)\b/u.test(body)
      ? ("failed" as const)
      : /<skipped\b/u.test(body)
        ? ("skipped" as const)
        : ("passed" as const);
    const seconds = Number(attributes.get("time") ?? "0");
    results.push(
      Object.freeze({
        ownerFile: normalizeArchitectureOwner(file),
        title,
        durationMs: Number.isFinite(seconds) ? seconds * 1_000 : 0,
        result,
      }),
    );
  }
  if (results.length === 0 && /<testcase\b/u.test(xml)) {
    throw new Error("architecture JUnit XML contains unreadable test cases");
  }
  return Object.freeze(results);
}

function findEvidence(
  trace: ScenarioTrace,
  evidence: SuiteCoverageEvidence,
): EvidenceMatch | undefined {
  return (
    findAttachmentEvidence(trace, evidence.browserTests) ??
    findStepEvidence(trace, evidence.browserTests) ??
    findGoEvidence(trace, evidence.goTestEvents) ??
    findArchitectureEvidence(trace, evidence.architectureTests)
  );
}

function findAttachmentEvidence(
  trace: ScenarioTrace,
  tests: readonly ScenarioTestResult[],
): EvidenceMatch | undefined {
  for (const test of tests) {
    if (
      !isSuccessfulBrowserTest(test) ||
      test.ownerFile !== trace.ownerFile ||
      test.executionTitle !== trace.executionMarker
    ) {
      continue;
    }
    const coverageAttachments = test.attachments.filter(
      ({ name, contentType }) =>
        name === "scenario-coverage" && contentType === "application/json",
    );
    const timelineAttachments = test.attachments.filter(
      ({ name, contentType }) =>
        name === "scenario-timeline" && contentType === "application/json",
    );
    if (coverageAttachments.length !== 1 || timelineAttachments.length !== 1) {
      continue;
    }
    const coverage = parseCoverageAttachment(coverageAttachments[0]!);
    const timeline = parseTimelineAttachment(timelineAttachments[0]!);
    const runtimeRecord = coverage.find(
      (record) =>
        record.scenarioId === trace.scenarioId &&
        record.primaryTier === trace.primaryTier &&
        record.executionId === trace.executionId &&
        record.result === "passed" &&
        (trace.checkpointId === undefined ||
          record.checkpointId === trace.checkpointId),
    );
    if (runtimeRecord === undefined) continue;
    const timelineEntries = timeline.entries.filter(
      (entry) =>
        entry.result === "passed" &&
        entry.scenarioIds.includes(trace.scenarioId),
    );
    if (timelineEntries.length === 0) continue;

    const namedCases = namedCaseResultsFromRuntime(trace, runtimeRecord);
    if (namedCases === undefined) continue;
    const behaviorEntries = actualBehaviorEntries(
      timeline.entries,
      timelineEntries,
      runtimeRecord.checkpointId ?? trace.checkpointId,
    );
    const mutationEpoch = [...timelineEntries]
      .reverse()
      .find(({ mutationEpoch }) => mutationEpoch !== undefined)?.mutationEpoch;
    const snapshotSequence = timelineEntries.at(-1)?.sequence;
    return Object.freeze({
      namedCases,
      baseBehaviors: uniqueStrings(
        behaviorEntries.flatMap(({ behaviorId }) =>
          behaviorId === undefined ? [] : [behaviorId],
        ),
      ),
      ...(runtimeRecord.checkpointId === undefined
        ? {}
        : { checkpointId: runtimeRecord.checkpointId }),
      outcomeContractIds: uniqueStrings(
        behaviorEntries.flatMap(({ contractId }) =>
          contractId === undefined ? [] : [contractId],
        ),
      ),
      validatorIds: uniqueStrings(
        behaviorEntries.some(
          ({ phase, contractId }) =>
            phase === "validation" && contractId !== undefined,
        )
          ? ["spine.ui-outcome"]
          : [],
      ),
      observedSurfaces: Object.freeze([...runtimeRecord.observedScopes]),
      mutationEpoch: mutationEpoch ?? null,
      sharedSnapshotId:
        snapshotSequence === undefined
          ? null
          : `timeline:${trace.executionId}:${snapshotSequence}`,
      durationMs: runtimeRecord.durationMs ?? null,
    });
  }
  return undefined;
}

function findStepEvidence(
  trace: ScenarioTrace,
  tests: readonly ScenarioTestResult[],
): EvidenceMatch | undefined {
  const matchingTests = tests.filter(
    (test) =>
      isSuccessfulBrowserTest(test) &&
      test.ownerFile === trace.ownerFile &&
      test.executionTitle === trace.executionMarker,
  );
  const scenarioSteps = matchingTests.flatMap((test) =>
    flattenSteps(test.steps).filter(({ title }) =>
      containsScenarioId(title, trace.scenarioId),
    ),
  );
  if (
    scenarioSteps.length === 0 ||
    scenarioSteps.some(({ result }) => result !== "passed")
  ) {
    return undefined;
  }
  const namedCases = new Map<string, "passed" | "not-run">();
  for (const caseId of trace.requiredNamedCases) {
    const caseSteps = scenarioSteps.filter(({ title }) =>
      containsNamedCase(title, trace.scenarioId, caseId),
    );
    const passed =
      caseSteps.length > 0 &&
      caseSteps.every(({ result }) => result === "passed");
    namedCases.set(caseId, passed ? "passed" : "not-run");
    if (!passed) return undefined;
  }
  return Object.freeze({
    namedCases,
    baseBehaviors: Object.freeze([]),
    ...(trace.checkpointId === undefined
      ? {}
      : { checkpointId: trace.checkpointId }),
    outcomeContractIds: Object.freeze([]),
    validatorIds: Object.freeze([]),
    observedSurfaces: stepObservedSurfaces(trace),
    mutationEpoch: null,
    sharedSnapshotId: `step:${trace.ownerFile}:${scenarioSteps[0]?.titlePath.join(" > ") ?? trace.scenarioId}`,
    durationMs: scenarioSteps.reduce(
      (total, { durationMs }) => total + durationMs,
      0,
    ),
  });
}

function findGoEvidence(
  trace: ScenarioTrace,
  events: readonly GoTestEvent[],
): EvidenceMatch | undefined {
  if (!trace.executionId.startsWith("go.")) return undefined;
  const testName = trace.executionId.slice("go.".length);
  const expectedPackage = expectedGoPackage(trace.ownerFile);
  const matching = events.filter(
    (event) =>
      event.packageName === expectedPackage && event.testName === testName,
  );
  const terminal = [...matching]
    .reverse()
    .find(({ action }) => ["pass", "fail", "skip"].includes(action));
  if (terminal?.action !== "pass") return undefined;
  return emptyMatch(
    (terminal.elapsedSeconds ?? 0) * 1_000,
    trace.checkpointId,
    ["RULES"],
    `go:${expectedPackage}:${testName}`,
  );
}

function findArchitectureEvidence(
  trace: ScenarioTrace,
  tests: readonly ArchitectureTestResult[],
): EvidenceMatch | undefined {
  const matching = tests.filter(
    (test) =>
      test.ownerFile === trace.ownerFile &&
      test.title === trace.executionMarker,
  );
  if (
    matching.length === 0 ||
    matching.some(({ result }) => result !== "passed")
  ) {
    return undefined;
  }
  return emptyMatch(
    matching.reduce((total, { durationMs }) => total + durationMs, 0),
    trace.checkpointId,
    ["RUNTIME", "AUDIT"],
    `bun:${trace.ownerFile}:${trace.executionMarker}`,
  );
}

function emptyMatch(
  durationMs: number,
  checkpointId?: string,
  observedSurfaces: readonly string[] = [],
  sharedSnapshotId: string | null = null,
): EvidenceMatch {
  return Object.freeze({
    namedCases: new Map(),
    baseBehaviors: Object.freeze([]),
    ...(checkpointId === undefined ? {} : { checkpointId }),
    outcomeContractIds: Object.freeze([]),
    validatorIds: Object.freeze([]),
    observedSurfaces: Object.freeze([...observedSurfaces]),
    mutationEpoch: null,
    sharedSnapshotId,
    durationMs,
  });
}

function parseCoverageAttachment(
  attachment: ScenarioJSONAttachment,
): readonly RuntimeCoverageRecord[] {
  const document = parseAttachmentJSON(attachment);
  if (!isRecord(document) || !Array.isArray(document.records)) return [];
  return document.records.flatMap((value) => {
    if (
      !isRecord(value) ||
      typeof value.scenarioId !== "string" ||
      typeof value.primaryTier !== "string" ||
      typeof value.executionId !== "string" ||
      typeof value.result !== "string" ||
      !Array.isArray(value.namedCases) ||
      !Array.isArray(value.observedScopes)
    ) {
      return [];
    }
    const namedCases = value.namedCases.flatMap((item) =>
      isRecord(item) &&
      typeof item.caseId === "string" &&
      typeof item.result === "string"
        ? [{ caseId: item.caseId, result: item.result }]
        : [],
    );
    const observedScopes = value.observedScopes.filter(
      (scope): scope is string => typeof scope === "string",
    );
    return [
      Object.freeze({
        scenarioId: value.scenarioId,
        primaryTier: value.primaryTier,
        executionId: value.executionId,
        ...(typeof value.checkpointId === "string"
          ? { checkpointId: value.checkpointId }
          : {}),
        result: value.result,
        ...(typeof value.durationMs === "number"
          ? { durationMs: value.durationMs }
          : {}),
        namedCases: Object.freeze(namedCases),
        observedScopes: Object.freeze(observedScopes),
      }),
    ];
  });
}

function parseTimelineAttachment(
  attachment: ScenarioJSONAttachment,
): RuntimeTimeline {
  const document = parseAttachmentJSON(attachment);
  if (!isRecord(document) || !Array.isArray(document.entries)) {
    return { entries: [] };
  }
  return Object.freeze({
    entries: Object.freeze(
      document.entries.flatMap((value) => {
        if (
          !isRecord(value) ||
          typeof value.result !== "string" ||
          !Array.isArray(value.scenarioIds)
        ) {
          return [];
        }
        const scenarioIds = value.scenarioIds.filter(
          (scenarioId): scenarioId is string => typeof scenarioId === "string",
        );
        return [
          Object.freeze({
            ...(typeof value.sequence === "number"
              ? { sequence: value.sequence }
              : {}),
            result: value.result,
            ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
            scenarioIds: Object.freeze(scenarioIds),
            ...(typeof value.checkpointId === "string"
              ? { checkpointId: value.checkpointId }
              : {}),
            ...(typeof value.behaviorId === "string"
              ? { behaviorId: value.behaviorId }
              : {}),
            ...(typeof value.contractId === "string"
              ? { contractId: value.contractId }
              : {}),
            ...(typeof value.mutationEpoch === "number"
              ? { mutationEpoch: value.mutationEpoch }
              : {}),
          }),
        ];
      }),
    ),
  });
}

function parseAttachmentJSON(attachment: ScenarioJSONAttachment): unknown {
  try {
    return JSON.parse(attachment.body);
  } catch {
    return undefined;
  }
}

function namedCaseResultsFromRuntime(
  trace: ScenarioTrace,
  runtime: RuntimeCoverageRecord,
): ReadonlyMap<string, "passed" | "not-run"> | undefined {
  const result = new Map<string, "passed" | "not-run">();
  for (const caseId of trace.requiredNamedCases) {
    const matching = runtime.namedCases.filter(
      (candidate) => candidate.caseId === caseId,
    );
    const passed = matching.length === 1 && matching[0]?.result === "passed";
    result.set(caseId, passed ? "passed" : "not-run");
    if (!passed) return undefined;
  }
  return result;
}

function actualBehaviorEntries(
  allEntries: readonly RuntimeTimelineEntry[],
  scenarioEntries: readonly RuntimeTimelineEntry[],
  checkpointId?: string,
): readonly RuntimeTimelineEntry[] {
  const direct = scenarioEntries.filter(
    ({ behaviorId }) => behaviorId !== undefined,
  );
  if (direct.length > 0 || checkpointId === undefined) return direct;
  return allEntries.filter(
    (entry) =>
      entry.result === "passed" &&
      entry.checkpointId === checkpointId &&
      entry.behaviorId !== undefined,
  );
}

function flattenSteps(
  steps: readonly ScenarioTestStepResult[],
): readonly ScenarioTestStepResult[] {
  return steps.flatMap((step) => [step, ...flattenSteps(step.steps)]);
}

function containsScenarioId(title: string, scenarioId: string): boolean {
  return new RegExp(
    `(^|[^A-Z0-9])${escapeRegExp(scenarioId)}(?=$|[^A-Z0-9])`,
    "u",
  ).test(title);
}

function containsNamedCase(
  title: string,
  scenarioId: string,
  caseId: string,
): boolean {
  return new RegExp(
    `(^|[^A-Z0-9])${escapeRegExp(scenarioId)}(?:\\s*\\[${escapeRegExp(caseId)}\\]|\\s+${escapeRegExp(caseId)}(?=$|[^A-Za-z0-9-]))`,
    "u",
  ).test(title);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function stepObservedSurfaces(trace: ScenarioTrace): readonly string[] {
  if (trace.ownerFile.startsWith("test/specs/ui-boundaries/")) return ["UI"];
  if (trace.ownerFile.startsWith("test/specs/contracts/")) return ["HTTP"];
  return trace.primaryTier === "harness-policy" ? ["RUNTIME"] : [];
}

function isSuccessfulBrowserTest(test: ScenarioTestResult): boolean {
  return test.status === "passed" && test.expectedStatus === "passed";
}

function expectedGoPackage(ownerFile: string): string {
  return `scryer/${posix.dirname(ownerFile)}`;
}

function normalizeArchitectureOwner(file: string): string {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized.startsWith("test/") ? normalized : `test/${normalized}`;
}

function parseXMLAttributes(source: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const value = match[2] ?? match[3];
    if (name !== undefined && value !== undefined) {
      attributes.set(name, decodeXML(value));
    }
  }
  return attributes;
}

function decodeXML(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isNotFound(error)) return "";
    throw error;
  }
}

function readJSONFile<T>(path: string, fallback: T): T {
  const contents = readTextFile(path);
  return contents.length === 0 ? fallback : (JSON.parse(contents) as T);
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
