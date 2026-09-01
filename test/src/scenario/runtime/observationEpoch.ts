export type ObservationSurface = "browser" | "http" | "postgres" | "server-log";

export interface ObservationKey {
  readonly actorId: string;
  readonly resource: string;
  readonly projection: string;
  readonly surface: ObservationSurface;
  readonly sensitivity?: "public" | "sensitive";
}

export interface ObservationCacheStats {
  readonly epoch: number;
  readonly loads: number;
  readonly hits: number;
  readonly entries: number;
  readonly snapshots: number;
}

function cacheKey(epoch: number, key: ObservationKey): string {
  return JSON.stringify([
    epoch,
    key.actorId,
    key.resource,
    key.projection,
    key.surface,
    key.sensitivity ?? "public",
  ]);
}

function freezeObservation<T>(value: T): Readonly<T> {
  if (typeof value === "object" && value !== null) {
    return Object.freeze(value);
  }
  return value;
}

export interface ObservationSnapshot {
  readonly id: string;
  readonly epoch: number;
  observe<T>(key: ObservationKey, load: () => Promise<T>): Promise<Readonly<T>>;
}

export class MutationEpochObservations {
  #epoch = 0;
  #loads = 0;
  #hits = 0;
  #snapshots = 0;
  #activeSnapshot: string | undefined;
  readonly #cache = new Map<string, Promise<Readonly<unknown>>>();

  get epoch(): number {
    return this.#epoch;
  }

  advance(reason: string): number {
    if (this.#activeSnapshot !== undefined) {
      throw new Error(
        `cannot advance mutation epoch during snapshot ${this.#activeSnapshot}: ${reason}`,
      );
    }
    this.#epoch += 1;
    this.#cache.clear();
    return this.#epoch;
  }

  async observe<T>(
    key: ObservationKey,
    load: () => Promise<T>,
  ): Promise<Readonly<T>> {
    const id = cacheKey(this.#epoch, key);
    const existing = this.#cache.get(id);
    if (existing !== undefined) {
      this.#hits += 1;
      return existing as Promise<Readonly<T>>;
    }

    this.#loads += 1;
    const pending = load()
      .then(freezeObservation)
      .catch((error: unknown) => {
        this.#cache.delete(id);
        throw error;
      });
    this.#cache.set(id, pending as Promise<Readonly<unknown>>);
    return pending;
  }

  async snapshot<T>(
    id: string,
    evaluate: (snapshot: ObservationSnapshot) => Promise<T>,
  ): Promise<T> {
    if (this.#activeSnapshot !== undefined) {
      throw new Error(
        `observation snapshot ${this.#activeSnapshot} is already active`,
      );
    }
    this.#activeSnapshot = id;
    this.#snapshots += 1;
    const epoch = this.#epoch;
    try {
      return await evaluate(
        Object.freeze({
          id,
          epoch,
          observe: <Value>(key: ObservationKey, load: () => Promise<Value>) => {
            if (this.#epoch !== epoch) {
              throw new Error(
                `snapshot ${id} was invalidated by mutation epoch ${this.#epoch}`,
              );
            }
            return this.observe(key, load);
          },
        }),
      );
    } finally {
      this.#activeSnapshot = undefined;
    }
  }

  stats(): ObservationCacheStats {
    return Object.freeze({
      epoch: this.#epoch,
      loads: this.#loads,
      hits: this.#hits,
      entries: this.#cache.size,
      snapshots: this.#snapshots,
    });
  }
}
