import { describe, expect, test } from "bun:test";

import { formatRelativeDate, humanize } from "./display";

describe("display helpers", () => {
  test("turns API vocabulary into display copy", () => {
    expect(humanize("weapons-handling")).toBe("Weapons Handling");
  });

  test("describes past and future timestamps", () => {
    expect(
      formatRelativeDate(new Date(Date.now() - 2 * 60_000).toISOString()),
    ).toBe("2m ago");
    expect(
      formatRelativeDate(new Date(Date.now() + 2 * 60_000).toISOString()),
    ).toBe("in 2m");
  });
});
