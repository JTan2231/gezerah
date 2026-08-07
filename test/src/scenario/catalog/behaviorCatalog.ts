import type {
  AnyBehaviorDefinition,
  AnyBehaviorModule,
  BehaviorModule,
} from "../core/behavior";
import type { AnyValidatorDefinition } from "../core/validator";
import {
  SCENARIO_TRACE_REGISTRY,
  validateScenarioTraceRegistry,
  type ScenarioTrace,
} from "./scenarioTraces";

export interface BehaviorCatalogOptions<UI, ValidationContext> {
  readonly modules: readonly AnyBehaviorModule<UI, ValidationContext>[];
  readonly validators?: readonly AnyValidatorDefinition[];
  readonly scenarioTraces?: readonly ScenarioTrace[];
}

export class BehaviorCatalog<UI, ValidationContext> {
  readonly #modules = new Map<
    string,
    AnyBehaviorModule<UI, ValidationContext>
  >();
  readonly #validators = new Map<string, AnyValidatorDefinition>();
  readonly #traces = new Map<string, ScenarioTrace>();

  constructor(options: BehaviorCatalogOptions<UI, ValidationContext>) {
    const traces = options.scenarioTraces ?? SCENARIO_TRACE_REGISTRY;
    validateScenarioTraceRegistry(traces);
    for (const trace of traces) {
      this.#traces.set(trace.scenarioId, trace);
    }

    for (const validator of options.validators ?? []) {
      if (this.#validators.has(validator.id)) {
        throw new Error(`duplicate validator id ${validator.id}`);
      }
      this.#validators.set(validator.id, validator);
    }

    const contractIds = new Set<string>();
    for (const module of options.modules) {
      const { definition } = module;
      if (this.#modules.has(definition.id)) {
        throw new Error(`duplicate behavior id ${definition.id}`);
      }

      const declaredOutcomes = Object.keys(definition.outcomes).sort();
      const implementedOutcomes = Object.keys(module.contracts).sort();
      if (
        declaredOutcomes.length !== implementedOutcomes.length ||
        declaredOutcomes.some(
          (outcome, index) => outcome !== implementedOutcomes[index],
        )
      ) {
        throw new Error(
          `behavior ${definition.id} contracts must exactly match outcomes: ${declaredOutcomes.join(
            ", ",
          )}`,
        );
      }

      for (const scenarioId of definition.scenarios) {
        if (!this.#traces.has(scenarioId)) {
          throw new Error(
            `behavior ${definition.id} references unknown scenario ${scenarioId}`,
          );
        }
      }

      for (const outcome of declaredOutcomes) {
        const contract = module.contracts[outcome];
        if (contract === undefined) {
          throw new Error(
            `behavior ${definition.id} has no contract for ${outcome}`,
          );
        }
        if (contractIds.has(contract.id)) {
          throw new Error(`duplicate contract id ${contract.id}`);
        }
        contractIds.add(contract.id);
        for (const validatorId of contract.validatorIds) {
          if (!this.#validators.has(validatorId)) {
            throw new Error(
              `contract ${contract.id} references unknown validator ${validatorId}`,
            );
          }
        }
      }

      this.#modules.set(definition.id, module);
    }
  }

  get size(): number {
    return this.#modules.size;
  }

  hasScenario(scenarioId: string): boolean {
    return this.#traces.has(scenarioId);
  }

  getTrace(scenarioId: string): ScenarioTrace {
    const trace = this.#traces.get(scenarioId);
    if (trace === undefined) {
      throw new Error(`unknown scenario ${scenarioId}`);
    }
    return trace;
  }

  getById(behaviorId: string): AnyBehaviorModule<UI, ValidationContext> {
    const module = this.#modules.get(behaviorId);
    if (module === undefined) {
      throw new Error(`unregistered behavior ${behaviorId}`);
    }
    return module;
  }

  get<D extends AnyBehaviorDefinition>(
    definition: D,
  ): BehaviorModule<D, UI, ValidationContext> {
    return this.getById(definition.id) as unknown as BehaviorModule<
      D,
      UI,
      ValidationContext
    >;
  }

  list(): readonly AnyBehaviorModule<UI, ValidationContext>[] {
    return Object.freeze([...this.#modules.values()]);
  }
}
