import { describe, expect, test } from "bun:test";

import {
  minimumPasswordCharacters,
  passwordMeetsMinimumLength,
} from "./password";

describe("password requirements", () => {
  test("requires only a minimum of eight characters", () => {
    expect(minimumPasswordCharacters).toBe(8);
    expect(passwordMeetsMinimumLength("1234567")).toBe(false);
    expect(passwordMeetsMinimumLength("12345678")).toBe(true);
    expect(passwordMeetsMinimumLength("🙂🙂🙂🙂🙂🙂🙂🙂")).toBe(true);
    expect(passwordMeetsMinimumLength("a".repeat(129))).toBe(true);
  });
});
