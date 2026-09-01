export type TypeToken<T> = Readonly<{
  /** Compile-time only. The property is never populated at runtime. */
  __type?: T;
}>;

export function shape<T>(): TypeToken<T> {
  return Object.freeze({});
}

export type OutcomeDefinition<T> = Readonly<{
  __output?: T;
}>;

export function outcome<T>(): OutcomeDefinition<T> {
  return Object.freeze({});
}

export type OutcomeDefinitions = Readonly<
  Record<string, OutcomeDefinition<unknown>>
>;

export interface BehaviorDefinition<
  Id extends string,
  Input,
  Outcomes extends OutcomeDefinitions,
> {
  readonly id: Id;
  readonly version: number;
  readonly scenarios: readonly string[];
  readonly input: TypeToken<Input>;
  readonly outcomes: Outcomes;
  readonly sensitiveInputKeys: readonly string[];
}

export function defineBehavior<
  const Id extends string,
  Input,
  const Outcomes extends OutcomeDefinitions,
>(definition: {
  id: Id;
  version: number;
  scenarios?: readonly string[];
  input: TypeToken<Input>;
  outcomes: Outcomes;
  sensitiveInputKeys?: readonly string[];
}): BehaviorDefinition<Id, Input, Outcomes> {
  if (definition.id.length === 0) {
    throw new Error("behavior id must not be empty");
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`behavior ${definition.id} must have a positive version`);
  }
  if (Object.keys(definition.outcomes).length === 0) {
    throw new Error(`behavior ${definition.id} must declare an outcome`);
  }

  return Object.freeze({
    ...definition,
    scenarios: Object.freeze([...(definition.scenarios ?? [])]),
    sensitiveInputKeys: Object.freeze([
      ...(definition.sensitiveInputKeys ?? []),
    ]),
  });
}

export type AnyBehaviorDefinition = BehaviorDefinition<
  string,
  unknown,
  OutcomeDefinitions
>;

export type BehaviorInput<D extends AnyBehaviorDefinition> =
  D extends BehaviorDefinition<string, infer Input, OutcomeDefinitions>
    ? Input
    : never;

export type BehaviorOutcome<D extends AnyBehaviorDefinition> = Extract<
  keyof D["outcomes"],
  string
>;

export type BehaviorOutput<
  D extends AnyBehaviorDefinition,
  Name extends BehaviorOutcome<D>,
> =
  D["outcomes"][Name] extends OutcomeDefinition<infer Output> ? Output : never;

export interface FrontendDriverContext<UI> {
  readonly actorId: string;
  readonly ui: UI;
  readonly actionId: string;
}

export interface FrontendDriver<Input, UI> {
  perform(context: FrontendDriverContext<UI>, input: Input): Promise<void>;
}

export interface OutcomeContractContext<ValidationContext, Input> {
  readonly actorId: string;
  readonly behaviorId: string;
  readonly outcome: string;
  readonly mutationEpoch: number;
  readonly input: Input;
  readonly validation: ValidationContext;
}

export interface OutcomeContract<Input, Output, ValidationContext> {
  readonly id: string;
  readonly version: number;
  readonly validatorIds: readonly string[];
  validate(
    context: OutcomeContractContext<ValidationContext, Input>,
  ): Promise<Output>;
}

export function defineOutcomeContract<Input, Output, ValidationContext>(
  contract: OutcomeContract<Input, Output, ValidationContext>,
): OutcomeContract<Input, Output, ValidationContext> {
  if (contract.id.length === 0) {
    throw new Error("contract id must not be empty");
  }
  if (!Number.isInteger(contract.version) || contract.version < 1) {
    throw new Error(`contract ${contract.id} must have a positive version`);
  }
  return Object.freeze({
    ...contract,
    validatorIds: Object.freeze([...contract.validatorIds]),
  });
}

export type ContractMap<D extends AnyBehaviorDefinition, ValidationContext> = {
  readonly [Name in BehaviorOutcome<D>]: OutcomeContract<
    BehaviorInput<D>,
    BehaviorOutput<D, Name>,
    ValidationContext
  >;
};

export interface BehaviorModule<
  D extends AnyBehaviorDefinition,
  UI,
  ValidationContext,
> {
  readonly definition: D;
  readonly driver: FrontendDriver<BehaviorInput<D>, UI>;
  readonly contracts: ContractMap<D, ValidationContext>;
}

export type AnyBehaviorModule<
  UI = unknown,
  ValidationContext = unknown,
> = BehaviorModule<AnyBehaviorDefinition, UI, ValidationContext>;

export function implementBehavior<
  D extends AnyBehaviorDefinition,
  UI,
  ValidationContext,
>(
  definition: D,
  implementation: {
    driver: FrontendDriver<BehaviorInput<D>, UI>;
    contracts: ContractMap<D, ValidationContext>;
  },
): BehaviorModule<D, UI, ValidationContext> {
  return Object.freeze({
    definition,
    driver: implementation.driver,
    contracts: Object.freeze({ ...implementation.contracts }),
  });
}
