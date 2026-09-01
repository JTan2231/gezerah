import { redact, type RedactionOptions } from "./redaction";

export type TimelinePhase =
  "driver" | "validation" | "checkpoint" | "coverage" | "harness";

export type TimelineResult = "started" | "passed" | "failed" | "blocked";

export interface TimelineEntryInput {
  readonly phase: TimelinePhase;
  readonly result: TimelineResult;
  readonly actorId?: string;
  readonly checkpointId?: string;
  readonly scenarioIds?: readonly string[];
  readonly behaviorId?: string;
  readonly outcome?: string;
  readonly contractId?: string;
  readonly mutationEpoch?: number;
  readonly durationMs?: number;
  readonly details?: unknown;
}

export interface TimelineEntry extends TimelineEntryInput {
  readonly sequence: number;
  readonly timestampMs: number;
  readonly details?: unknown;
}

export class EvidenceTimeline {
  #sequence = 0;
  readonly #entries: TimelineEntry[] = [];
  readonly #now: () => number;
  readonly #redaction: RedactionOptions;

  constructor(
    readonly journeyId: string,
    now: () => number = () => Date.now(),
    redaction: RedactionOptions = {},
  ) {
    this.#now = now;
    this.#redaction = redaction;
  }

  append(input: TimelineEntryInput): TimelineEntry {
    const details =
      input.details === undefined
        ? undefined
        : redact(input.details, this.#redaction);
    const entry = Object.freeze({
      ...input,
      sequence: ++this.#sequence,
      timestampMs: this.#now(),
      ...(details === undefined ? {} : { details }),
    });
    this.#entries.push(entry);
    return entry;
  }

  entries(): readonly TimelineEntry[] {
    return Object.freeze([...this.#entries]);
  }

  toJSON(): Readonly<{
    journeyId: string;
    entries: readonly TimelineEntry[];
  }> {
    return Object.freeze({
      journeyId: this.journeyId,
      entries: this.entries(),
    });
  }
}
