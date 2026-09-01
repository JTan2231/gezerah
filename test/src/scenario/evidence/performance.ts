export interface PerformanceSpan {
  readonly name: string;
  readonly category: "stage" | "checkpoint" | "behavior" | "scenario";
  readonly durationMs: number;
}

export interface PerformanceCounters {
  readonly requests: number;
  readonly queries: number;
  readonly observationLoads: number;
  readonly observationCacheHits: number;
  readonly mutationEpochs: number;
  readonly artifactBytes: number;
}

export interface PerformanceReport {
  readonly budgetMs: number;
  readonly totalMs: number;
  readonly underBudget: boolean;
  readonly spans: readonly PerformanceSpan[];
  readonly counters: PerformanceCounters;
}

type CounterName = keyof PerformanceCounters;

export class PerformanceReporter {
  readonly #startedAt: number;
  readonly #spans: PerformanceSpan[] = [];
  readonly #now: () => number;
  readonly #counters: Record<CounterName, number> = {
    requests: 0,
    queries: 0,
    observationLoads: 0,
    observationCacheHits: 0,
    mutationEpochs: 0,
    artifactBytes: 0,
  };

  constructor(
    readonly budgetMs = 30_000,
    now: () => number = () => performance.now(),
  ) {
    this.#now = now;
    this.#startedAt = this.#now();
  }

  start(
    name: string,
    category: PerformanceSpan["category"] = "stage",
  ): () => number {
    const startedAt = this.#now();
    let stopped = false;
    return () => {
      if (stopped) {
        throw new Error(`performance span ${name} already stopped`);
      }
      stopped = true;
      const durationMs = Math.max(0, this.#now() - startedAt);
      this.#spans.push(Object.freeze({ name, category, durationMs }));
      return durationMs;
    };
  }

  async measure<T>(
    name: string,
    category: PerformanceSpan["category"],
    operation: () => Promise<T>,
  ): Promise<T> {
    const stop = this.start(name, category);
    try {
      return await operation();
    } finally {
      stop();
    }
  }

  increment(counter: CounterName, amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`invalid ${counter} increment ${amount}`);
    }
    this.#counters[counter] += amount;
  }

  report(
    totalMs = Math.max(0, this.#now() - this.#startedAt),
  ): PerformanceReport {
    return Object.freeze({
      budgetMs: this.budgetMs,
      totalMs,
      underBudget: totalMs < this.budgetMs,
      spans: Object.freeze([...this.#spans]),
      counters: Object.freeze({ ...this.#counters }),
    });
  }

  assertUnderBudget(totalMs?: number): PerformanceReport {
    const report = this.report(totalMs);
    if (!report.underBudget) {
      throw new Error(
        `scenario suite took ${report.totalMs.toFixed(1)}ms; budget is strictly under ${report.budgetMs.toFixed(1)}ms`,
      );
    }
    return report;
  }
}
