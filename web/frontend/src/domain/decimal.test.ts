import { describe, expect, test } from "bun:test";

import {
  canonicalDecimalText,
  decimalTextIsNegative,
  isDecimalText,
} from "./decimal";

describe("decimal text", () => {
  test("canonicalizes exact decimals without using JavaScript numbers", () => {
    expect(canonicalDecimalText("9007199254740993.0000000000000001")).toBe(
      "9007199254740993.0000000000000001",
    );
    expect(canonicalDecimalText("-001.2300e+2")).toBe("-123");
    expect(canonicalDecimalText("-.000")).toBe("0");
  });

  test("matches the backend's finite decimal bounds", () => {
    expect(isDecimalText(".25")).toBe(true);
    expect(isDecimalText("1e10000")).toBe(true);
    expect(isDecimalText("1e10001")).toBe(false);
    expect(isDecimalText("1e-10001")).toBe(false);
    expect(isDecimalText(" NaN ")).toBe(false);
  });

  test("determines sign from exact decimal text", () => {
    expect(decimalTextIsNegative("-0")).toBe(false);
    expect(decimalTextIsNegative("-0.0001")).toBe(true);
    expect(decimalTextIsNegative("1e-10000")).toBe(false);
  });
});
