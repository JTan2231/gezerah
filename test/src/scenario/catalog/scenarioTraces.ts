export const EVIDENCE_TIERS = [
  "journey",
  "ui-boundary",
  "direct-contract",
  "lower-layer",
  "harness-policy",
] as const;

export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export const EVIDENCE_AVAILABILITIES = ["executable", "uncovered"] as const;

export type EvidenceAvailability = (typeof EVIDENCE_AVAILABILITIES)[number];

const JOURNEY_CHECKPOINT_GROUPS = [
  {
    checkpointId: "JRN-001/playable-world",
    scenarioIds: [
      "JRN-001",
      "IDN-001",
      "IDN-004",
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
  },
  {
    checkpointId: "JRN-002/ready-player",
    scenarioIds: [
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
  },
  {
    checkpointId: "JRN-003/improvised-round-resolved",
    scenarioIds: [
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
  },
  {
    checkpointId: "JRN-004/status-lifecycle-preserved",
    scenarioIds: [
      "JRN-004",
      "CON-004",
      "CON-005",
      "CON-006",
      "CON-007",
      "CON-008",
    ],
  },
  {
    checkpointId: "JRN-005/spectator-world-visible-safe",
    scenarioIds: ["JRN-005", "AUT-003", "AUT-004", "AUT-005", "AUT-006"],
  },
  {
    checkpointId: "JRN-006/editor-authority-bounded",
    scenarioIds: ["JRN-006", "WRL-003", "MEC-006", "AUT-002"],
  },
  {
    checkpointId: "JRN-007/archived-history-readable",
    scenarioIds: ["JRN-007", "LFC-004", "LFC-005"],
  },
] as const;

export const JOURNEY_SCENARIO_IDS = Object.freeze(
  JOURNEY_CHECKPOINT_GROUPS.flatMap(({ scenarioIds }) => scenarioIds),
);

const JOURNEY_RIB_SCENARIO_ID_VALUES = Object.freeze([
  "MEC-V01",
  "INV-005",
  "NAV-V04",
] as const);

const UI_BOUNDARY_SCENARIOS = [
  "IDN-005",
  "IDN-006",
  "IDN-007",
  "IDN-008",
  "CHF-001",
  "CHF-003",
  "CHF-004",
  "RST-006",
  "RST-007",
  "PLY-005",
  "PLY-007",
  "CCY-V01",
  "LFC-001",
  "LFC-002",
  "NAV-002",
  "NAV-003",
  "NAV-004",
  "NAV-005",
  "NAV-006",
  "NAV-007",
  "NAV-008",
  "NAV-V01",
  "NAV-V02",
  "NAV-V03",
] as const;

const DIRECT_CONTRACT_SCENARIOS = [
  "IDN-V01",
  "IDN-V02",
  "IDN-V03",
  "IDN-V04",
  "IDN-V05",
  "MEC-V03",
  "CHF-V01",
  "RST-V03",
  "RST-V04",
  "RST-V05",
  "INV-004",
  "INV-V01",
  "INV-V02",
  "PLY-V01",
  "PLY-V02",
  "PLY-V03",
  "PLY-V04",
  "CON-002",
  "CON-V04",
  "CON-V05",
  "AUT-007",
  "AUT-V01",
  "AUT-V02",
  "AUT-V03",
  "AUT-V04",
  "AUT-V05",
  "AUT-V06",
  "AUT-V07",
  "CCY-V02",
  "CCY-V03",
  "CCY-V04",
  "CCY-V05",
  "CCY-V06",
  "CCY-V07",
  "CCY-V08",
  "CCY-V09",
  "LFC-003",
  "LFC-V01",
  "LFC-V02",
  "LFC-V04",
] as const;

const LOWER_LAYER_SCENARIOS = [
  "MEC-004",
  "MEC-V02",
  "MEC-V04",
  "MEC-V05",
  "CON-V02",
  "CON-V03",
] as const;

const HARNESS_POLICY_SCENARIOS = [
  "GLO-001",
  "GLO-002",
  "GLO-003",
  "GLO-004",
  "GLO-005",
  "GLO-006",
  "GLO-007",
  "GLO-008",
  "GLO-009",
  "GLO-010",
  "GLO-011",
  "GLO-012",
] as const;

export const SCENARIO_IDS = [
  ...JOURNEY_SCENARIO_IDS,
  ...UI_BOUNDARY_SCENARIOS,
  ...DIRECT_CONTRACT_SCENARIOS,
  ...LOWER_LAYER_SCENARIOS,
  ...HARNESS_POLICY_SCENARIOS,
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const RETIRED_SCENARIO_IDS = Object.freeze(["IDN-002"] as const);

export const JOURNEY_RIB_SCENARIO_IDS: readonly ScenarioId[] =
  JOURNEY_RIB_SCENARIO_ID_VALUES;

export interface ScenarioTrace {
  readonly scenarioId: ScenarioId;
  readonly scenarioVersion: number;
  readonly primaryTier: EvidenceTier;
  readonly executionId: string;
  readonly ownerFile: string;
  /** A literal test title, function, or fixture symbol present in ownerFile. */
  readonly executionMarker: string;
  readonly evidenceAvailability: EvidenceAvailability;
  readonly gapReason?: string;
  readonly checkpointId?: string;
  readonly requiredNamedCases: readonly string[];
  readonly changedDimension?: string;
}

interface OwnerAssignment {
  readonly primaryTier: EvidenceTier;
  readonly executionId: string;
  readonly ownerFile: string;
  readonly executionMarker: string;
  readonly evidenceAvailability: EvidenceAvailability;
  readonly gapReason?: string;
}

const REQUIRED_NAMED_CASES: Readonly<
  Partial<Record<ScenarioId, readonly string[]>>
> = Object.freeze({
  "IDN-V01": ["invalid", "duplicate-normalized-username"],
  "IDN-V02": ["unknown-username", "wrong-password"],
  "IDN-V03": ["missing", "malformed", "expired", "revoked", "disabled"],
  "IDN-V04": ["password-hash", "session-digest", "response-redaction"],
  "IDN-V05": ["missing-token", "wrong-token", "cross-origin"],
  "INV-V01": ["invalid", "revoked", "expired"],
  "MEC-V03": ["unknown", "cross-world", "archived"],
  "RST-V03": [
    "incomplete-context",
    "archived-context",
    "incomplete-attribution",
    "archived-attribution",
    "incomplete-effect-target",
    "archived-effect-target",
  ],
  "CON-V04": ["stale", "already-removed", "entity-mismatch", "cross-world"],
  "AUT-V02": [
    "player-configure",
    "spectator-configure",
    "player-facilitate",
    "spectator-facilitate",
    "spectator-respond",
    "editor-archive",
  ],
  "AUT-V05": ["mechanic", "entity", "membership", "action", "status-instance"],
  "AUT-V07": ["anonymous-forgery", "authenticated-override"],
  "CCY-V06": ["late-submit", "late-withdraw", "stale-transition"],
  "LFC-V04": [
    "world-mutation",
    "entity-mutation",
    "mechanic-mutation",
    "archived-new-reference",
  ],
});

const CHANGED_DIMENSIONS: Readonly<Partial<Record<ScenarioId, string>>> =
  Object.freeze({
    "IDN-V01": "signup rejection reason",
    "IDN-V02": "credential rejection reason",
    "IDN-V03": "invalid session state",
    "IDN-V04": "credential or session secret",
    "IDN-V05": "CSRF failure mode",
    "INV-V01": "closure reason",
    "MEC-V03": "reference eligibility",
    "RST-V03": "readiness/lifecycle and use site",
    "CON-V04": "target invalidity",
    "AUT-V02": "actor and command family",
    "AUT-V05": "resource kind",
    "AUT-V07": "forged identity attempt",
    "CCY-V06": "stale command kind",
    "LFC-V04": "resource and use kind",
  });

const LIFECYCLE_OWNER = Object.freeze({
  primaryTier: "journey",
  executionId: "journey.complete-world-lifecycle",
  ownerFile: "test/specs/scenarios/lifecycle-spine.spec.ts",
  executionMarker:
    "one rendered lifecycle carries the World from authoring through archive",
  evidenceAvailability: "executable",
} as const satisfies OwnerAssignment);

const UI_ENTRY_OWNER = Object.freeze({
  primaryTier: "ui-boundary",
  executionId: "ui.entry-and-access",
  ownerFile: "test/specs/ui-boundaries/entry-and-access.ui.spec.ts",
  executionMarker:
    "focused entry, narrow-layout, keyboard, and access boundaries stay deliberate",
  evidenceAvailability: "executable",
} as const satisfies OwnerAssignment);

const UI_AUTHORING_OWNER = Object.freeze({
  primaryTier: "ui-boundary",
  executionId: "ui.authoring-control-and-live",
  ownerFile: "test/specs/ui-boundaries/authoring-control-and-live.ui.spec.ts",
  executionMarker:
    "UI boundaries: authored profiles, shared control, live actions, and accessible recovery stay coherent",
  evidenceAvailability: "executable",
} as const satisfies OwnerAssignment);

const UI_SETTINGS_OWNER = Object.freeze({
  primaryTier: "ui-boundary",
  executionId: "ui.settings-and-mechanic-lifecycle",
  ownerFile:
    "test/specs/ui-boundaries/settings-and-mechanic-lifecycle.ui.spec.ts",
  executionMarker:
    "UI boundaries: stale settings, dirty drafts, and mechanic archive order recover visibly",
  evidenceAvailability: "executable",
} as const satisfies OwnerAssignment);

const UI_EVENTS_OWNER = Object.freeze({
  primaryTier: "ui-boundary",
  executionId: "ui.live-event-recovery",
  ownerFile: "test/specs/ui-boundaries/live-event-recovery.ui.spec.ts",
  executionMarker:
    "UI boundaries: interrupted live events resume from the cursor without duplicate history",
  evidenceAvailability: "executable",
} as const satisfies OwnerAssignment);

const UI_AUTH_OWNER = Object.freeze({
  primaryTier: "ui-boundary",
  executionId: "ui.authentication",
  ownerFile: "test/specs/ui-boundaries/authentication.ui.spec.ts",
  executionMarker:
    "UI authentication: signin, password changes, and logout use server sessions",
  evidenceAvailability: "executable",
} as const satisfies OwnerAssignment);

const DIRECT_OWNERS = Object.freeze({
  authentication: {
    primaryTier: "direct-contract",
    executionId: "contract.authentication",
    ownerFile: "test/specs/contracts/authentication.contract.spec.ts",
    executionMarker:
      "contract: password accounts, sessions, CSRF, and forged identity headers are enforced",
    evidenceAvailability: "executable",
  },
  access: {
    primaryTier: "direct-contract",
    executionId: "contract.access-and-invites",
    ownerFile: "test/specs/contracts/access-and-invites.contract.spec.ts",
    executionMarker:
      "contract: invitation secrecy, admission, authorization, and revocation",
    evidenceAvailability: "executable",
  },
  authorization: {
    primaryTier: "direct-contract",
    executionId: "contract.authorization-matrices",
    ownerFile: "test/specs/contracts/authorization-matrices.contract.spec.ts",
    executionMarker:
      "contract: invitation closure and authorization matrices are atomic and private",
    evidenceAvailability: "executable",
  },
  concurrency: {
    primaryTier: "direct-contract",
    executionId: "contract.concurrency-and-status-instance-matrices",
    ownerFile:
      "test/specs/contracts/concurrency-and-status-instance-matrices.contract.spec.ts",
    executionMarker:
      "direct contracts: CON-V04 and CCY-V06 named matrices plus exactly-once resolution",
    evidenceAvailability: "executable",
  },
  profile: {
    primaryTier: "direct-contract",
    executionId: "contract.profile-and-readiness",
    ownerFile: "test/specs/contracts/profile-and-readiness.contract.spec.ts",
    executionMarker:
      "contract: readiness and profile projections preserve authority and privacy",
    evidenceAvailability: "executable",
  },
  resource: {
    primaryTier: "direct-contract",
    executionId: "contract.resource-lifecycle",
    ownerFile: "test/specs/contracts/resource-lifecycle.contract.spec.ts",
    executionMarker:
      "contract: scenario matrices reject invalid and archived resource use atomically",
    evidenceAvailability: "executable",
  },
  rules: {
    primaryTier: "direct-contract",
    executionId: "contract.mechanic-graph-and-status-instances",
    ownerFile:
      "test/specs/contracts/mechanic-graph-and-status-instances.contract.spec.ts",
    executionMarker:
      "world mechanic graph publishes atomically and Status instances change effective values with Resolution receipts",
    evidenceAvailability: "executable",
  },
  gapClosures: {
    primaryTier: "direct-contract",
    executionId: "contract.direct-gap-closures",
    ownerFile: "test/specs/contracts/direct-gap-closures.contract.spec.ts",
    executionMarker:
      "contract: direct scenario gap closures preserve logical input values, privacy, and authority",
    evidenceAvailability: "executable",
  },
} as const satisfies Readonly<Record<string, OwnerAssignment>>);

function trace(
  scenarioId: ScenarioId,
  owner: OwnerAssignment,
  checkpointId?: string,
): ScenarioTrace {
  const requiredNamedCases = REQUIRED_NAMED_CASES[scenarioId] ?? [];
  const changedDimension = CHANGED_DIMENSIONS[scenarioId];
  return Object.freeze({
    scenarioId,
    scenarioVersion: scenarioId === "IDN-003" ? 2 : 1,
    ...owner,
    ...(checkpointId === undefined ? {} : { checkpointId }),
    requiredNamedCases: Object.freeze([...requiredNamedCases]),
    ...(changedDimension === undefined ? {} : { changedDimension }),
  });
}

function traces(
  scenarioIds: readonly ScenarioId[],
  owner: OwnerAssignment,
): ScenarioTrace[] {
  return scenarioIds.map((scenarioId) => trace(scenarioId, owner));
}

const JOURNEY_TRACES = JOURNEY_CHECKPOINT_GROUPS.flatMap(
  ({ checkpointId, scenarioIds }) =>
    scenarioIds.map((scenarioId) =>
      trace(scenarioId, LIFECYCLE_OWNER, checkpointId),
    ),
);

const UI_TRACES = [
  ...traces(["IDN-005", "IDN-006", "IDN-007", "IDN-008"], UI_AUTH_OWNER),
  ...traces(["NAV-002", "NAV-V01"], UI_ENTRY_OWNER),
  ...traces(
    [
      "CHF-001",
      "CHF-003",
      "CHF-004",
      "RST-006",
      "RST-007",
      "PLY-005",
      "PLY-007",
      "NAV-004",
      "NAV-005",
      "NAV-006",
      "NAV-008",
      "NAV-V03",
    ],
    UI_AUTHORING_OWNER,
  ),
  ...traces(["CCY-V01", "LFC-001", "LFC-002", "NAV-003"], UI_SETTINGS_OWNER),
  ...traces(["NAV-007", "NAV-V02"], UI_EVENTS_OWNER),
];

const DIRECT_TRACES = [
  ...traces(
    ["IDN-V01", "IDN-V02", "IDN-V03", "IDN-V04", "IDN-V05", "AUT-V07"],
    DIRECT_OWNERS.authentication,
  ),
  ...traces(
    ["MEC-V03", "RST-V03", "LFC-003", "LFC-V04"],
    DIRECT_OWNERS.resource,
  ),
  ...traces(["INV-V01", "AUT-V02", "AUT-V05"], DIRECT_OWNERS.authorization),
  ...traces(["CHF-V01", "AUT-V03"], DIRECT_OWNERS.profile),
  ...traces(
    [
      "PLY-V04",
      "CON-002",
      "CON-V04",
      "CCY-V06",
      "CCY-V07",
      "CCY-V08",
      "CCY-V09",
    ],
    DIRECT_OWNERS.concurrency,
  ),
  ...traces(["CCY-V03"], DIRECT_OWNERS.rules),
  ...traces(
    [
      "RST-V04",
      "RST-V05",
      "AUT-V06",
      "CCY-V05",
      "INV-004",
      "INV-V02",
      "AUT-007",
      "AUT-V01",
      "PLY-V01",
      "CCY-V02",
      "PLY-V02",
      "LFC-V01",
      "LFC-V02",
      "PLY-V03",
      "CON-V05",
      "AUT-V04",
      "CCY-V04",
    ],
    DIRECT_OWNERS.gapClosures,
  ),
];

const LOWER_TRACES = [
  trace("MEC-004", {
    primaryTier: "lower-layer",
    executionId:
      "go.TestExpressionEvaluationSupportsExactArithmeticBooleanAndConditionalOperators",
    ownerFile: "internal/rules/expression_evaluation_test.go",
    executionMarker:
      "func TestExpressionEvaluationSupportsExactArithmeticBooleanAndConditionalOperators",
    evidenceAvailability: "executable",
  }),
  trace("MEC-V02", {
    primaryTier: "lower-layer",
    executionId:
      "go.TestMechanicGraphInfersTypesAndReportsConcreteExpressionPaths",
    ownerFile: "internal/rules/expression_evaluation_test.go",
    executionMarker:
      "func TestMechanicGraphInfersTypesAndReportsConcreteExpressionPaths",
    evidenceAvailability: "executable",
  }),
  trace("MEC-V04", {
    primaryTier: "lower-layer",
    executionId: "go.TestMechanicGraphRejectsSelfAndMultiNodeCyclesWithPaths",
    ownerFile: "internal/rules/expression_evaluation_test.go",
    executionMarker:
      "func TestMechanicGraphRejectsSelfAndMultiNodeCyclesWithPaths",
    evidenceAvailability: "executable",
  }),
  trace("MEC-V05", {
    primaryTier: "lower-layer",
    executionId:
      "go.TestMECV05DerivedMechanicHasNoStoredOverrideAndIsRejectedByEffects",
    ownerFile: "internal/rules/runtime_transition_test.go",
    executionMarker:
      "func TestMECV05DerivedMechanicHasNoStoredOverrideAndIsRejectedByEffects",
    evidenceAvailability: "executable",
  }),
  trace("CON-V02", {
    primaryTier: "lower-layer",
    executionId:
      "go.TestCONV02DerivedImmutableAndArchivedMechanicsRejectScalarEffects",
    ownerFile: "internal/rules/runtime_transition_test.go",
    executionMarker:
      "func TestCONV02DerivedImmutableAndArchivedMechanicsRejectScalarEffects",
    evidenceAvailability: "executable",
  }),
  trace("CON-V03", {
    primaryTier: "lower-layer",
    executionId:
      "go.TestCONV03InvalidStatusModifiersProduceNoRuntimeTransition",
    ownerFile: "internal/rules/runtime_transition_test.go",
    executionMarker:
      "func TestCONV03InvalidStatusModifiersProduceNoRuntimeTransition",
    evidenceAvailability: "executable",
  }),
];

const HARNESS_TRACES = [
  trace("GLO-001", {
    primaryTier: "harness-policy",
    executionId: "architecture.lifecycle-spine-boundary",
    ownerFile: "test/src/scenario/architecture-tests/catalog.test.ts",
    executionMarker: "enforces the one-test observed lifecycle-spine boundary",
    evidenceAvailability: "executable",
  }),
  trace("GLO-002", {
    ...LIFECYCLE_OWNER,
    primaryTier: "harness-policy",
    executionId: "scenario-fixture.runtime-health",
  }),
  trace("GLO-003", {
    ...DIRECT_OWNERS.authorization,
    primaryTier: "harness-policy",
    executionId: "policy.world-isolation-matrix",
  }),
  trace("GLO-004", {
    primaryTier: "harness-policy",
    executionId: "policy.atomic-failure-aggregation",
    ownerFile: "test/src/scenario/architecture-tests/globalPolicies.test.ts",
    executionMarker: "GLO-004 aggregates executable atomic-failure evidence",
    evidenceAvailability: "executable",
  }),
  trace("GLO-005", {
    primaryTier: "harness-policy",
    executionId: "policy.ui-system-agreement",
    ownerFile: "test/src/scenario/architecture-tests/globalPolicies.test.ts",
    executionMarker:
      "GLO-005 binds every journey outcome to a cataloged UI contract",
    evidenceAvailability: "executable",
  }),
  trace("GLO-006", {
    primaryTier: "harness-policy",
    executionId: "policy.sensitive-projection-aggregation",
    ownerFile: "test/src/scenario/architecture-tests/globalPolicies.test.ts",
    executionMarker:
      "GLO-006 aggregates every sensitive projection and redaction boundary",
    evidenceAvailability: "executable",
  }),
  trace("GLO-007", {
    primaryTier: "harness-policy",
    executionId: "policy.no-privileged-vocabulary",
    ownerFile: "test/src/scenario/architecture-tests/globalPolicies.test.ts",
    executionMarker:
      "GLO-007 forbids privileged entity classes, keys, and seeded vocabulary",
    evidenceAvailability: "executable",
  }),
  trace("GLO-008", {
    primaryTier: "harness-policy",
    executionId: "go.TestMechanicGraphStatusInstancesMigrationContract",
    ownerFile: "internal/migrations/migrations_test.go",
    executionMarker: "func TestMechanicGraphStatusInstancesMigrationContract",
    evidenceAvailability: "executable",
  }),
  trace("GLO-009", {
    ...LIFECYCLE_OWNER,
    primaryTier: "harness-policy",
    executionId: "policy.lifecycle-live-convergence",
  }),
  trace("GLO-010", {
    ...UI_AUTHORING_OWNER,
    primaryTier: "harness-policy",
    executionId: "policy.accessible-core-interaction",
  }),
  trace("GLO-011", {
    primaryTier: "harness-policy",
    executionId: "architecture.deterministic-spine",
    ownerFile: "test/src/scenario/architecture-tests/catalog.test.ts",
    executionMarker: "enforces the one-test observed lifecycle-spine boundary",
    evidenceAvailability: "executable",
  }),
  trace("GLO-012", {
    primaryTier: "harness-policy",
    executionId: "architecture.redacted-diagnostics",
    ownerFile: "test/src/scenario/architecture-tests/evidence.test.ts",
    executionMarker:
      "redacts explicit secrets, sensitive keys, and invitation URLs",
    evidenceAvailability: "executable",
  }),
];

export const SCENARIO_TRACE_REGISTRY: readonly ScenarioTrace[] = Object.freeze([
  ...JOURNEY_TRACES,
  ...UI_TRACES,
  ...DIRECT_TRACES,
  ...LOWER_TRACES,
  ...HARNESS_TRACES,
]);

export const EXPECTED_SCENARIO_COUNT = 141;
export const EXPECTED_JOURNEY_SCENARIO_COUNT = 59;

const EXPECTED_FAMILY_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  AUT: 15,
  CCY: 9,
  CHF: 5,
  CON: 13,
  GLO: 12,
  IDN: 12,
  INV: 7,
  JRN: 7,
  LFC: 9,
  MEC: 11,
  NAV: 12,
  PLY: 13,
  RST: 12,
  WRL: 4,
});

export function validateScenarioTraceRegistry(
  registry: readonly ScenarioTrace[] = SCENARIO_TRACE_REGISTRY,
): void {
  if (registry.length !== EXPECTED_SCENARIO_COUNT) {
    throw new Error(
      `scenario registry has ${registry.length} records; expected ${EXPECTED_SCENARIO_COUNT}`,
    );
  }

  const expectedIds = new Set<string>(SCENARIO_IDS);
  for (const retiredId of RETIRED_SCENARIO_IDS) {
    if (expectedIds.has(retiredId)) {
      throw new Error(`retired scenario ${retiredId} remains active`);
    }
  }
  const seen = new Set<string>();
  const tiers = new Set<EvidenceTier>();
  const familyCounts = new Map<string, number>();
  for (const owner of registry) {
    if (seen.has(owner.scenarioId)) {
      throw new Error(`duplicate primary owner for ${owner.scenarioId}`);
    }
    if (!expectedIds.has(owner.scenarioId)) {
      throw new Error(`unknown scenario id ${owner.scenarioId}`);
    }
    seen.add(owner.scenarioId);
    if (!Number.isInteger(owner.scenarioVersion) || owner.scenarioVersion < 1) {
      throw new Error(`invalid scenario version for ${owner.scenarioId}`);
    }
    tiers.add(owner.primaryTier);
    const family = owner.scenarioId.split("-")[0];
    if (family === undefined) {
      throw new Error(`malformed scenario id ${owner.scenarioId}`);
    }
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);

    const expectedCases = REQUIRED_NAMED_CASES[owner.scenarioId] ?? [];
    if (
      owner.requiredNamedCases.length !== expectedCases.length ||
      expectedCases.some(
        (caseId, index) => owner.requiredNamedCases[index] !== caseId,
      )
    ) {
      throw new Error(`incomplete named cases for ${owner.scenarioId}`);
    }
    if (
      owner.evidenceAvailability === "uncovered" &&
      (owner.gapReason === undefined || owner.gapReason.trim().length === 0)
    ) {
      throw new Error(
        `uncovered scenario ${owner.scenarioId} has no gap reason`,
      );
    }
    if (
      owner.evidenceAvailability === "executable" &&
      owner.gapReason !== undefined
    ) {
      throw new Error(
        `executable scenario ${owner.scenarioId} has a gap reason`,
      );
    }
  }

  const missing = [...expectedIds].filter(
    (scenarioId) => !seen.has(scenarioId),
  );
  if (missing.length > 0) {
    throw new Error(`missing primary owners: ${missing.join(", ")}`);
  }
  for (const tier of EVIDENCE_TIERS) {
    if (!tiers.has(tier)) {
      throw new Error(`scenario registry has no ${tier} evidence owner`);
    }
  }
  for (const [family, expected] of Object.entries(EXPECTED_FAMILY_COUNTS)) {
    const actual = familyCounts.get(family) ?? 0;
    if (actual !== expected) {
      throw new Error(
        `scenario family ${family} has ${actual} records; expected ${expected}`,
      );
    }
  }
}
