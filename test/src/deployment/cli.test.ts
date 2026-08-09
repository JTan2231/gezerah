import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { parseArguments, UsageError } from "./cli";

describe("deployment CLI", () => {
  test("defaults to a validated deployment with browser verification", () => {
    assert.deepEqual(parseArguments([]), {
      mode: "deploy",
      skipCI: false,
      browser: true,
      help: false,
    });
  });

  test("supports verification and explicit deployment escape hatches", () => {
    assert.deepEqual(parseArguments(["verify", "--no-browser"]), {
      mode: "verify",
      skipCI: false,
      browser: false,
      help: false,
    });
    assert.deepEqual(parseArguments(["deploy", "--skip-ci"]), {
      mode: "deploy",
      skipCI: true,
      browser: true,
      help: false,
    });
  });

  test("rejects ambiguous and meaningless options", () => {
    assert.throws(() => parseArguments(["deploy", "verify"]), UsageError);
    assert.throws(() => parseArguments(["verify", "--skip-ci"]), UsageError);
    assert.throws(() => parseArguments(["--unknown"]), UsageError);
  });
});
