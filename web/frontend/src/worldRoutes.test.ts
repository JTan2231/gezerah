import { describe, expect, test } from "bun:test";

import { readLocation, worldURL } from "./worldRoutes";

describe("world routes", () => {
  test("keeps invite tokens available before identity selection", () => {
    expect(readLocation("/invite/token%20value")).toEqual({
      type: "invite",
      token: "token value",
    });
  });

  test("defaults a world to its capacity configuration", () => {
    expect(readLocation("/worlds/world-1")).toEqual({
      type: "world",
      worldId: "world-1",
      section: "capacities",
    });
  });

  test("round-trips a selected mechanic", () => {
    const path = worldURL("world/1", "capabilities", "skill 1");
    expect(path).toBe("/worlds/world%2F1/capabilities/skill%201");
    expect(readLocation(path)).toEqual({
      type: "world",
      worldId: "world/1",
      section: "capabilities",
      resourceId: "skill 1",
    });
  });

  test("routes to world-authored character fields", () => {
    const path = worldURL("world-1", "character-fields");
    expect(path).toBe("/worlds/world-1/character-fields");
    expect(readLocation(path)).toEqual({
      type: "world",
      worldId: "world-1",
      section: "character-fields",
      resourceId: undefined,
    });
  });
});
