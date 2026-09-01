import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

import { repoRoot } from "../../paths";
import { scenarioTestResultsPath } from "../evidence/suiteCoverage";

export interface ScenarioTestResult {
  readonly ownerFile: string;
  readonly title: string;
  readonly executionTitle: string;
  readonly durationMs: number;
  readonly status: TestResult["status"];
  readonly expectedStatus: TestCase["expectedStatus"];
  readonly steps: readonly ScenarioTestStepResult[];
  readonly attachments: readonly ScenarioJSONAttachment[];
}

export interface ScenarioTestStepResult {
  readonly title: string;
  readonly titlePath: readonly string[];
  readonly durationMs: number;
  readonly result: "passed" | "failed" | "skipped";
  readonly steps: readonly ScenarioTestStepResult[];
}

export interface ScenarioJSONAttachment {
  readonly name: "scenario-coverage" | "scenario-timeline";
  readonly contentType: string;
  /** The exact UTF-8 attachment body emitted by the test. */
  readonly body: string;
}

const EVIDENCE_ATTACHMENT_NAMES = new Set<ScenarioJSONAttachment["name"]>([
  "scenario-coverage",
  "scenario-timeline",
]);

class ScenarioReporter implements Reporter {
  readonly #results: ScenarioTestResult[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.#results.push(
      Object.freeze({
        ownerFile: relative(repoRoot, test.location.file).replaceAll("\\", "/"),
        title: test.titlePath().join(" > "),
        executionTitle: test.title,
        durationMs: result.duration,
        status: result.status,
        expectedStatus: test.expectedStatus,
        steps: captureUserSteps(result.steps),
        attachments: result.attachments.flatMap((attachment) => {
          if (!isEvidenceAttachmentName(attachment.name)) return [];
          const body =
            attachment.body ??
            (attachment.path === undefined
              ? undefined
              : readFileSync(attachment.path));
          if (body === undefined) {
            throw new Error(
              `${attachment.name} attachment has neither a body nor a path`,
            );
          }
          return [
            Object.freeze({
              name: attachment.name,
              contentType: attachment.contentType,
              body: body.toString("utf8"),
            }),
          ];
        }),
      }),
    );
  }

  onEnd(_result: FullResult): void {
    mkdirSync(dirname(scenarioTestResultsPath), { recursive: true });
    writeFileSync(
      scenarioTestResultsPath,
      `${JSON.stringify({ tests: this.#results }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

function captureUserSteps(
  steps: readonly TestStep[],
): readonly ScenarioTestStepResult[] {
  return Object.freeze(
    steps.flatMap((step) => {
      const descendants = captureUserSteps(step.steps);
      if (step.category !== "test.step") return descendants;
      const result =
        step.error !== undefined
          ? ("failed" as const)
          : step.annotations.some(({ type }) => type === "skip")
            ? ("skipped" as const)
            : ("passed" as const);
      return [
        Object.freeze({
          title: step.title,
          titlePath: Object.freeze([...step.titlePath()]),
          durationMs: step.duration,
          result,
          steps: descendants,
        }),
      ];
    }),
  );
}

function isEvidenceAttachmentName(
  name: string,
): name is ScenarioJSONAttachment["name"] {
  return EVIDENCE_ATTACHMENT_NAMES.has(name as ScenarioJSONAttachment["name"]);
}

export default ScenarioReporter;
