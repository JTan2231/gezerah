import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "bun:test";

import {
  SCENARIO_TRACE_REGISTRY,
  type ScenarioId,
  type ScenarioTrace,
} from "../catalog/scenarioTraces";
import {
  validateJourneyFixtureOwnership,
  validateScenarioOwnerFiles,
  verifyScenarioRuntime,
} from "../verification";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function replaceOwner(
  scenarioId: ScenarioId,
  replacement: Partial<ScenarioTrace>,
): readonly ScenarioTrace[] {
  return SCENARIO_TRACE_REGISTRY.map((owner) =>
    owner.scenarioId === scenarioId
      ? ({ ...owner, ...replacement } as ScenarioTrace)
      : owner,
  );
}

describe("scenario executable ownership", () => {
  test("resolves every primary owner to one exact file and keeps pass evidence unevaluated", () => {
    validateScenarioOwnerFiles(REPOSITORY_ROOT);
    const verification = verifyScenarioRuntime(REPOSITORY_ROOT);
    assert.equal(
      verification.executableOwnershipCount +
        verification.uncoveredScenarios.length,
      verification.catalogRegistrationCount,
    );
    assert.equal(verification.runtimePassingEvidence, "not-evaluated");
    assert.equal(verification.uncoveredScenarios.length, 0);
    assert.equal(
      verification.executableOwnershipCount,
      verification.catalogRegistrationCount,
    );
  });

  test("strict verification rejects every uncovered primary owner", () => {
    assert.throws(
      () =>
        verifyScenarioRuntime(
          REPOSITORY_ROOT,
          replaceOwner("GLO-004", {
            evidenceAvailability: "uncovered",
            gapReason: "test-only uncovered evidence",
          }),
        ),
      /uncovered primary owners: GLO-004/,
    );
  });

  test("rejects missing files, directories, placeholders, and stale execution markers", () => {
    assert.throws(
      () =>
        validateScenarioOwnerFiles(
          REPOSITORY_ROOT,
          replaceOwner("JRN-001", {
            ownerFile: "test/specs/scenarios/missing.spec.ts",
          }),
        ),
      /owner file does not exist/,
    );
    assert.throws(
      () =>
        validateScenarioOwnerFiles(
          REPOSITORY_ROOT,
          replaceOwner("JRN-001", { ownerFile: "test/specs/contracts" }),
        ),
      /owner path is not a file/,
    );
    assert.throws(
      () =>
        validateScenarioOwnerFiles(
          REPOSITORY_ROOT,
          replaceOwner("JRN-001", {
            ownerFile: "web/static/placeholder.txt",
          }),
        ),
      /owner path is a placeholder/,
    );
    assert.throws(
      () =>
        validateScenarioOwnerFiles(
          REPOSITORY_ROOT,
          replaceOwner("JRN-001", {
            executionMarker: "a test title that is not present",
          }),
        ),
      /execution marker.*is absent/,
    );
  });

  test("requires every named case as a literal in the executable owner", () => {
    assert.throws(
      () =>
        validateScenarioOwnerFiles(
          REPOSITORY_ROOT,
          replaceOwner("INV-V01", {
            ownerFile:
              "test/specs/contracts/access-and-invites.contract.spec.ts",
            executionMarker:
              "contract: invitation secrecy, admission, authorization, and revocation",
          }),
        ),
      /missing named cases for INV-V01.*expired/,
    );
  });

  test("requires all 59 journey IDs in the real fixture mapping", () => {
    const fixtureSource = readFileSync(
      `${REPOSITORY_ROOT}/test/src/scenario/playwright/scenarioTest.ts`,
      "utf8",
    );
    const mapped = validateJourneyFixtureOwnership(fixtureSource);
    assert.equal(mapped.length, 59);
    assert.equal(new Set(mapped).size, 59);

    const onlyCompositeJourneys = `
      const CHECKPOINT_SCENARIO_IDS = Object.freeze({
        "JRN-001/playable-world": ["JRN-001"],
        "JRN-002/ready-player": ["JRN-002"],
        "JRN-003/improvised-round-resolved": ["JRN-003"],
        "JRN-004/status-lifecycle-preserved": ["JRN-004"],
        "JRN-005/spectator-public-table-safe": ["JRN-005"],
        "JRN-006/editor-authority-bounded": ["JRN-006"],
        "JRN-007/archived-history-readable": ["JRN-007"],
      });
      const JOURNEY_SCENARIO_IDS = [];
    `;
    assert.throws(
      () => validateJourneyFixtureOwnership(onlyCompositeJourneys),
      /journey fixture ownership mismatch/,
    );
  });
});
