import type { DecimalText } from "../api/types";

const maximumDecimalExponent = 10_000;
const decimalPattern =
  /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

export function canonicalDecimalText(value: string): DecimalText | undefined {
  if (value === "" || value.trim() !== value) return undefined;
  const match = decimalPattern.exec(value);
  if (match === null) return undefined;

  const exponent = boundedExponent(match[5]);
  if (exponent === undefined) return undefined;

  const integer = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  let digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (digits === "") return "0";

  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > maximumDecimalExponent) return undefined;
  if (scale >= digits.length)
    digits = `${"0".repeat(scale - digits.length + 1)}${digits}`;

  let canonical: string;
  if (scale === 0) {
    canonical = digits;
  } else {
    const split = digits.length - scale;
    canonical = `${digits.slice(0, split)}.${digits.slice(split)}`;
    canonical = canonical.replace(/0+$/, "").replace(/\.$/, "");
  }
  canonical = canonical.replace(/^0+/, "");
  if (canonical.startsWith(".")) canonical = `0${canonical}`;
  if (canonical === "") canonical = "0";
  return match[1] === "-" && canonical !== "0" ? `-${canonical}` : canonical;
}

export function isDecimalText(value: string): value is DecimalText {
  return canonicalDecimalText(value) !== undefined;
}

export function decimalTextIsNegative(value: DecimalText): boolean {
  return canonicalDecimalText(value)?.startsWith("-") ?? false;
}

function boundedExponent(value: string | undefined): number | undefined {
  if (value === undefined) return 0;
  const negative = value.startsWith("-");
  const firstDigit = value.startsWith("-") || value.startsWith("+") ? 1 : 0;
  let exponent = 0;
  for (let index = firstDigit; index < value.length; index += 1) {
    const digit = value.charCodeAt(index) - 48;
    exponent = exponent * 10 + digit;
    if (exponent > maximumDecimalExponent) return undefined;
  }
  return negative ? -exponent : exponent;
}
