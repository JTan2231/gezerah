import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import {
  EVIDENCE_TIERS,
  EXPECTED_JOURNEY_SCENARIO_COUNT,
  EXPECTED_SCENARIO_COUNT,
  SCENARIO_IDS,
  SCENARIO_TRACE_REGISTRY,
  validateScenarioTraceRegistry,
  type EvidenceTier,
  type ScenarioId,
  type ScenarioTrace,
} from "./catalog/scenarioTraces";
import { SPINE_BEHAVIOR_SPECS } from "./playwright/spineBehaviors";

export interface UncoveredScenario {
  readonly scenarioId: ScenarioId;
  readonly primaryTier: EvidenceTier;
  readonly executionId: string;
  readonly ownerFile: string;
  readonly reason: string;
}

export interface ScenarioRuntimeVerification {
  /** Catalog registration is structural and is not a claim that a test passed. */
  readonly catalogRegistrationCount: number;
  /** Kept for existing callers; equal to catalogRegistrationCount. */
  readonly scenarioCount: number;
  readonly executableOwnershipCount: number;
  readonly namedCaseCount: number;
  readonly tierCounts: Readonly<Record<EvidenceTier, number>>;
  readonly uncoveredScenarios: readonly UncoveredScenario[];
  readonly runtimePassingEvidence: "not-evaluated";
  readonly lifecycleSpine: Readonly<{
    path: string;
    fixturePath: string;
    checkpointKeys: readonly string[];
    explicitlyMappedScenarioIds: readonly ScenarioId[];
  }>;
}

const EXPECTED_CHECKPOINT_KEYS = [
  "JRN-001/playable-world",
  "JRN-002/ready-player",
  "JRN-003/improvised-round-resolved",
  "JRN-004/status-lifecycle-preserved",
  "JRN-005/spectator-world-visible-safe",
  "JRN-006/editor-authority-bounded",
  "JRN-007/archived-history-readable",
] as const;

const FORBIDDEN_SPINE_SHORTCUTS: readonly Readonly<{
  name: string;
  pattern: RegExp;
}>[] = [
  { name: "page.request", pattern: /\b\w*[Pp]age\.request\b/ },
  { name: "request context", pattern: /\bAPIRequestContext\b/ },
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "addInitScript", pattern: /\baddInitScript\b/ },
  { name: "storage state", pattern: /\bstorageState\b/ },
  { name: "local storage", pattern: /\blocalStorage\b/ },
  { name: "session storage", pattern: /\bsessionStorage\b/ },
  { name: "page.evaluate", pattern: /\.evaluate\s*\(/ },
  { name: "page reload", pattern: /\.reload\s*\(/ },
  { name: "request interception", pattern: /\.route\s*\(/ },
  { name: "controlled-time fixture", pattern: /controlledTime/ },
  { name: "fixed wait", pattern: /\bwaitForTimeout\b/ },
  { name: "forced action", pattern: /\bforce\s*:\s*true\b/ },
  {
    name: "direct Playwright import",
    pattern: /from\s+["']@playwright\/test["']/,
  },
  { name: "unobserved Playwright step", pattern: /\btest\.step\s*\(/ },
];

const SCENARIO_ID_PATTERN = /^[A-Z]{3}-(?:\d{3}|V\d{2})$/;

export function validateLifecycleSpineSource(
  source: string,
): readonly string[] {
  for (const shortcut of FORBIDDEN_SPINE_SHORTCUTS) {
    if (shortcut.pattern.test(source)) {
      throw new Error(
        `lifecycle spine contains forbidden mutation shortcut: ${shortcut.name}`,
      );
    }
  }

  if (!/from\s+["'][^"']*\/src\/scenario["']/.test(source)) {
    throw new Error(
      "lifecycle spine must import the observed scenario fixture",
    );
  }
  const testCount = [...source.matchAll(/\btest\s*\(/g)].length;
  if (testCount !== 1) {
    throw new Error(
      `lifecycle spine must contain exactly one test; found ${testCount}`,
    );
  }
  const checkpointCallCount = [
    ...source.matchAll(/\bscenario\.checkpoint\s*\(/g),
  ].length;
  if (checkpointCallCount !== EXPECTED_CHECKPOINT_KEYS.length) {
    throw new Error(
      `lifecycle spine must contain ${EXPECTED_CHECKPOINT_KEYS.length} observed checkpoints; found ${checkpointCallCount}`,
    );
  }

  const observedKeys = [...source.matchAll(/JRN-[0-9]{3}\/[a-z0-9-]+/g)].map(
    (match) => match[0],
  );
  const counts = new Map<string, number>();
  for (const key of observedKeys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const unexpected = [...counts.keys()].filter(
    (key) => !EXPECTED_CHECKPOINT_KEYS.includes(key as never),
  );
  const missingOrRepeated = EXPECTED_CHECKPOINT_KEYS.filter(
    (key) => counts.get(key) !== 1,
  );
  if (unexpected.length > 0 || missingOrRepeated.length > 0) {
    throw new Error(
      `lifecycle spine checkpoint keys mismatch; missing/repeated: ${
        missingOrRepeated.join(", ") || "none"
      }; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }

  validateLifecycleSpineBehaviorCalls(source);

  return Object.freeze([...EXPECTED_CHECKPOINT_KEYS]);
}

export function validateLifecycleSpineBehaviorCalls(
  source: string,
): readonly string[] {
  const expectedBehaviorIds = SPINE_BEHAVIOR_SPECS.map(({ id }) => id);
  const expected = new Set(expectedBehaviorIds);
  const sourceFile = ts.createSourceFile(
    "lifecycle-spine.spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const behaviorCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "scenario" &&
      node.expression.name.text === "behavior"
    ) {
      behaviorCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const calledBehaviorIds: string[] = [];
  for (const call of behaviorCalls) {
    const [id, perform, validate] = call.arguments;
    if (id === undefined || !ts.isStringLiteral(id)) {
      throw new Error(
        "lifecycle spine behavior calls must use static string literal IDs",
      );
    }
    if (
      call.arguments.length !== 3 ||
      perform === undefined ||
      validate === undefined ||
      (!ts.isArrowFunction(perform) && !ts.isFunctionExpression(perform)) ||
      (!ts.isArrowFunction(validate) && !ts.isFunctionExpression(validate))
    ) {
      throw new Error(
        `lifecycle behavior ${id.text} must declare separate perform and validate callbacks`,
      );
    }
    if (!/\bexpect\s*\(/.test(validate.getText(sourceFile))) {
      throw new Error(
        `lifecycle behavior ${id.text} validate callback must assert its outcome`,
      );
    }
    calledBehaviorIds.push(id.text);
  }

  const counts = new Map<string, number>();
  for (const behaviorId of calledBehaviorIds) {
    counts.set(behaviorId, (counts.get(behaviorId) ?? 0) + 1);
  }
  const missingOrRepeated = expectedBehaviorIds.filter(
    (behaviorId) => counts.get(behaviorId) !== 1,
  );
  const unexpected = [...counts.keys()].filter(
    (behaviorId) => !expected.has(behaviorId),
  );
  if (missingOrRepeated.length > 0 || unexpected.length > 0) {
    throw new Error(
      `lifecycle spine behavior calls mismatch; missing/repeated: ${
        missingOrRepeated.join(", ") || "none"
      }; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
  return Object.freeze(calledBehaviorIds);
}

export function extractJourneyFixtureOwnership(
  source: string,
): ReadonlyMap<string, readonly string[]> {
  const start = source.indexOf("const CHECKPOINT_SCENARIO_IDS");
  const end = source.indexOf("const JOURNEY_SCENARIO_IDS", start);
  if (start < 0 || end < 0) {
    throw new Error(
      "scenario fixture must define CHECKPOINT_SCENARIO_IDS before JOURNEY_SCENARIO_IDS",
    );
  }
  const mappingSource = source.slice(start, end);
  const mapping = new Map<string, readonly string[]>();
  const entryPattern = /["'](JRN-\d{3}\/[a-z0-9-]+)["']\s*:\s*\[([\s\S]*?)\]/g;
  for (const match of mappingSource.matchAll(entryPattern)) {
    const checkpointId = match[1];
    const listSource = match[2];
    if (checkpointId === undefined || listSource === undefined) continue;
    if (mapping.has(checkpointId)) {
      throw new Error(`duplicate journey fixture checkpoint ${checkpointId}`);
    }
    const scenarioIds = [
      ...listSource.matchAll(/["']([A-Z]{3}-(?:\d{3}|V\d{2}))["']/g),
    ].map((scenarioMatch) => scenarioMatch[1] as string);
    mapping.set(checkpointId, Object.freeze(scenarioIds));
  }
  return mapping;
}

export function validateJourneyFixtureOwnership(
  source: string,
  traces: readonly ScenarioTrace[] = SCENARIO_TRACE_REGISTRY,
): readonly ScenarioId[] {
  const mapping = extractJourneyFixtureOwnership(source);
  const actualCheckpointKeys = [...mapping.keys()];
  if (
    actualCheckpointKeys.length !== EXPECTED_CHECKPOINT_KEYS.length ||
    EXPECTED_CHECKPOINT_KEYS.some(
      (key, index) => actualCheckpointKeys[index] !== key,
    )
  ) {
    throw new Error(
      `journey fixture checkpoints mismatch: ${actualCheckpointKeys.join(", ") || "none"}`,
    );
  }

  const journeyTraces = traces.filter(
    (owner) => owner.primaryTier === "journey",
  );
  if (journeyTraces.length !== EXPECTED_JOURNEY_SCENARIO_COUNT) {
    throw new Error(
      `journey registry has ${journeyTraces.length} IDs; expected ${EXPECTED_JOURNEY_SCENARIO_COUNT}`,
    );
  }
  const expectedByCheckpoint = new Map<string, ScenarioId[]>();
  for (const owner of journeyTraces) {
    if (owner.checkpointId === undefined) {
      throw new Error(`journey owner ${owner.scenarioId} has no checkpoint`);
    }
    const checkpointIds = expectedByCheckpoint.get(owner.checkpointId) ?? [];
    checkpointIds.push(owner.scenarioId);
    expectedByCheckpoint.set(owner.checkpointId, checkpointIds);
  }

  const flattened: ScenarioId[] = [];
  const seen = new Set<string>();
  for (const checkpointId of EXPECTED_CHECKPOINT_KEYS) {
    const actual = mapping.get(checkpointId) ?? [];
    const expected = expectedByCheckpoint.get(checkpointId) ?? [];
    if (
      actual.length !== expected.length ||
      expected.some((scenarioId, index) => actual[index] !== scenarioId)
    ) {
      throw new Error(
        `journey fixture ownership mismatch at ${checkpointId}; expected ${expected.join(", ")}; found ${actual.join(", ")}`,
      );
    }
    for (const scenarioId of actual) {
      if (!SCENARIO_ID_PATTERN.test(scenarioId)) {
        throw new Error(`malformed journey fixture scenario ${scenarioId}`);
      }
      if (seen.has(scenarioId)) {
        throw new Error(`duplicate journey fixture owner for ${scenarioId}`);
      }
      seen.add(scenarioId);
      flattened.push(scenarioId as ScenarioId);
    }
  }
  if (flattened.length !== EXPECTED_JOURNEY_SCENARIO_COUNT) {
    throw new Error(
      `journey fixture maps ${flattened.length} IDs; expected ${EXPECTED_JOURNEY_SCENARIO_COUNT}`,
    );
  }
  return Object.freeze(flattened);
}

function assertExactOwnerPath(ownerFile: string): void {
  if (
    ownerFile.trim() !== ownerFile ||
    ownerFile.length === 0 ||
    isAbsolute(ownerFile) ||
    ownerFile.includes("\\") ||
    /[*?{}[\]]/.test(ownerFile) ||
    /\s(?:and|or)\s/.test(ownerFile)
  ) {
    throw new Error(`owner path is not one exact relative file: ${ownerFile}`);
  }
  if (basename(ownerFile).toLowerCase().includes("placeholder")) {
    throw new Error(`owner path is a placeholder: ${ownerFile}`);
  }
}

function containsStringLiteral(source: string, value: string): boolean {
  return [`"${value}"`, `'${value}'`, `\`${value}\``].some((literal) =>
    source.includes(literal),
  );
}

export function validateScenarioOwnerFiles(
  repositoryRoot: string,
  traces: readonly ScenarioTrace[] = SCENARIO_TRACE_REGISTRY,
): void {
  validateScenarioTraceRegistry(traces);
  const sourceCache = new Map<string, string>();
  for (const owner of traces) {
    assertExactOwnerPath(owner.ownerFile);
    const ownerPath = resolve(repositoryRoot, owner.ownerFile);
    const relativeToRoot = relative(repositoryRoot, ownerPath);
    if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
      throw new Error(`owner path escapes repository: ${owner.ownerFile}`);
    }
    let stats;
    try {
      stats = statSync(ownerPath);
    } catch (error: unknown) {
      throw new Error(
        `owner file does not exist for ${owner.scenarioId}: ${owner.ownerFile}`,
        { cause: error },
      );
    }
    if (!stats.isFile()) {
      throw new Error(
        `owner path is not a file for ${owner.scenarioId}: ${owner.ownerFile}`,
      );
    }
    let source = sourceCache.get(owner.ownerFile);
    if (source === undefined) {
      source = readFileSync(ownerPath, "utf8");
      sourceCache.set(owner.ownerFile, source);
    }
    if (
      source.trim().length === 0 ||
      source.trim().toLowerCase() === "placeholder"
    ) {
      throw new Error(`owner file is a placeholder: ${owner.ownerFile}`);
    }
    if (!source.includes(owner.executionMarker)) {
      throw new Error(
        `execution marker for ${owner.scenarioId} is absent from ${owner.ownerFile}: ${owner.executionMarker}`,
      );
    }
    if (owner.evidenceAvailability === "executable") {
      const missingCases = owner.requiredNamedCases.filter(
        (caseId) => !containsStringLiteral(source, caseId),
      );
      if (missingCases.length > 0) {
        throw new Error(
          `executable owner ${owner.ownerFile} is missing named cases for ${owner.scenarioId}: ${missingCases.join(", ")}`,
        );
      }
    }
  }
}

function verifyLifecycleSpineSource(
  repositoryRoot: string,
  traces: readonly ScenarioTrace[],
): ScenarioRuntimeVerification["lifecycleSpine"] {
  const relativePath = "test/specs/scenarios/lifecycle-spine.spec.ts";
  const fixturePath = "test/src/scenario/playwright/scenarioTest.ts";
  let source: string;
  let fixtureSource: string;
  try {
    source = readFileSync(resolve(repositoryRoot, relativePath), "utf8");
    fixtureSource = readFileSync(resolve(repositoryRoot, fixturePath), "utf8");
  } catch (error: unknown) {
    throw new Error("cannot read lifecycle spine ownership sources", {
      cause: error,
    });
  }
  const checkpointKeys = validateLifecycleSpineSource(source);
  const explicitlyMappedScenarioIds = validateJourneyFixtureOwnership(
    fixtureSource,
    traces,
  );

  return Object.freeze({
    path: relativePath,
    fixturePath,
    checkpointKeys,
    explicitlyMappedScenarioIds,
  });
}

export function verifyScenarioRuntime(
  repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url)),
  traces: readonly ScenarioTrace[] = SCENARIO_TRACE_REGISTRY,
): ScenarioRuntimeVerification {
  validateScenarioTraceRegistry(traces);
  const uncoveredOwners = traces.filter(
    ({ evidenceAvailability }) => evidenceAvailability === "uncovered",
  );
  if (uncoveredOwners.length > 0) {
    throw new Error(
      `scenario verification found uncovered primary owners: ${uncoveredOwners
        .map(({ scenarioId }) => scenarioId)
        .join(", ")}`,
    );
  }
  validateScenarioOwnerFiles(repositoryRoot, traces);
  const lifecycleSpine = verifyLifecycleSpineSource(repositoryRoot, traces);
  const tierCounts = Object.fromEntries(
    EVIDENCE_TIERS.map((tier) => [tier, 0]),
  ) as Record<EvidenceTier, number>;
  let namedCaseCount = 0;
  let executableOwnershipCount = 0;
  const uncoveredScenarios: UncoveredScenario[] = [];
  for (const owner of traces) {
    tierCounts[owner.primaryTier] += 1;
    namedCaseCount += owner.requiredNamedCases.length;
    if (owner.evidenceAvailability === "executable") {
      executableOwnershipCount += 1;
    } else {
      uncoveredScenarios.push(
        Object.freeze({
          scenarioId: owner.scenarioId,
          primaryTier: owner.primaryTier,
          executionId: owner.executionId,
          ownerFile: owner.ownerFile,
          reason: owner.gapReason ?? "uncovered",
        }),
      );
    }
  }
  if (traces.length !== EXPECTED_SCENARIO_COUNT) {
    throw new Error("scenario trace verification did not cover the catalog");
  }
  if (new Set(SCENARIO_IDS).size !== EXPECTED_SCENARIO_COUNT) {
    throw new Error("scenario ID catalog contains duplicates");
  }
  return Object.freeze({
    catalogRegistrationCount: traces.length,
    scenarioCount: traces.length,
    executableOwnershipCount,
    namedCaseCount,
    tierCounts: Object.freeze({ ...tierCounts }),
    uncoveredScenarios: Object.freeze(uncoveredScenarios),
    runtimePassingEvidence: "not-evaluated",
    lifecycleSpine,
  });
}
