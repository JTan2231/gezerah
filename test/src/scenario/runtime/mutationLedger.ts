export type RuntimePhase =
  "idle" | "frontend-driver" | "validation" | "checkpoint";

export interface MutationRecord {
  readonly sequence: number;
  readonly actorId: string;
  readonly behaviorId: string;
  readonly method: string;
  readonly sanitizedURL: string;
  readonly phase: RuntimePhase;
}

export interface MutationViolation {
  readonly message: string;
  readonly method?: string;
  readonly sanitizedURL?: string;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class MutationLedger {
  #phase: RuntimePhase = "idle";
  #activeActor: string | undefined;
  #activeBehavior: string | undefined;
  #sequence = 0;
  readonly #mutations: MutationRecord[] = [];
  readonly #violations: MutationViolation[] = [];

  get phase(): RuntimePhase {
    return this.#phase;
  }

  async frontendAction<T>(
    actorId: string,
    behaviorId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    this.#enter("frontend-driver", actorId, behaviorId);
    try {
      return await action();
    } finally {
      this.#leave();
    }
  }

  async validation<T>(action: () => Promise<T>): Promise<T> {
    this.#enter("validation");
    try {
      return await action();
    } finally {
      this.#leave();
    }
  }

  async checkpoint<T>(action: () => Promise<T>): Promise<T> {
    this.#enter("checkpoint");
    try {
      return await action();
    } finally {
      this.#leave();
    }
  }

  recordBrowserRequest(method: string, sanitizedURL: string): void {
    const normalized = method.toUpperCase();
    if (READ_METHODS.has(normalized)) {
      return;
    }
    if (
      this.#phase !== "frontend-driver" ||
      this.#activeActor === undefined ||
      this.#activeBehavior === undefined
    ) {
      const violation = Object.freeze({
        message: `browser mutation ${normalized} occurred during ${this.#phase}`,
        method: normalized,
        sanitizedURL,
      });
      this.#violations.push(violation);
      throw new Error(violation.message);
    }
    this.#mutations.push(
      Object.freeze({
        sequence: ++this.#sequence,
        actorId: this.#activeActor,
        behaviorId: this.#activeBehavior,
        method: normalized,
        sanitizedURL,
        phase: this.#phase,
      }),
    );
  }

  recordObservedBrowserRequest(
    actorId: string,
    behaviorId: string | undefined,
    method: string,
    sanitizedURL: string,
  ): void {
    const normalized = method.toUpperCase();
    if (READ_METHODS.has(normalized)) {
      return;
    }
    if (behaviorId === undefined || behaviorId.length === 0) {
      this.#violations.push(
        Object.freeze({
          message: `browser mutation ${normalized} from ${actorId} occurred outside a named behavior`,
          method: normalized,
          sanitizedURL,
        }),
      );
      return;
    }
    this.#mutations.push(
      Object.freeze({
        sequence: ++this.#sequence,
        actorId,
        behaviorId,
        method: normalized,
        sanitizedURL,
        phase: "frontend-driver",
      }),
    );
  }

  assertReadOnlyHTTP(method: string): void {
    const normalized = method.toUpperCase();
    if (!READ_METHODS.has(normalized)) {
      const violation = Object.freeze({
        message: `validator HTTP method ${normalized} is not read-only`,
        method: normalized,
      });
      this.#violations.push(violation);
      throw new Error(violation.message);
    }
  }

  assertReadOnlySQL(readOnly: boolean): void {
    if (!readOnly) {
      const violation = Object.freeze({
        message: "validator SQL transaction is not read-only",
      });
      this.#violations.push(violation);
      throw new Error(violation.message);
    }
  }

  mutations(): readonly MutationRecord[] {
    return Object.freeze([...this.#mutations]);
  }

  violations(): readonly MutationViolation[] {
    return Object.freeze([...this.#violations]);
  }

  assertClean(): void {
    const first = this.#violations[0];
    if (first !== undefined) {
      throw new Error(first.message);
    }
  }

  #enter(phase: RuntimePhase, actorId?: string, behaviorId?: string): void {
    if (this.#phase !== "idle") {
      throw new Error(`cannot enter ${phase} while ${this.#phase} is active`);
    }
    this.#phase = phase;
    this.#activeActor = actorId;
    this.#activeBehavior = behaviorId;
  }

  #leave(): void {
    this.#phase = "idle";
    this.#activeActor = undefined;
    this.#activeBehavior = undefined;
  }
}
