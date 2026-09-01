export type ValidationSurface =
  "ui" | "browser" | "http" | "postgres" | "server-log";

export interface ValidatorDefinition<Context> {
  readonly id: string;
  readonly description: string;
  readonly surface: ValidationSurface;
  readonly sensitivity: "public" | "sensitive";
  validate(context: Context): Promise<void>;
}

export function defineValidator<Context>(
  validator: ValidatorDefinition<Context>,
): ValidatorDefinition<Context> {
  if (validator.id.length === 0) {
    throw new Error("validator id must not be empty");
  }
  return Object.freeze({ ...validator });
}

export type AnyValidatorDefinition = ValidatorDefinition<unknown>;
