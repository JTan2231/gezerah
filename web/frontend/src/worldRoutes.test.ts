import { describe, expect, test } from "bun:test";

import {
  buildWorldURL,
  inviteURL,
  playWorldURL,
  readLocation,
} from "./worldRoutes";

describe("application routes", () => {
  test("keeps the root as a neutral application choice", () => {
    expect(readLocation("/")).toEqual({ type: "home" });
    expect(readLocation("/play")).toEqual({ type: "play-library" });
    expect(readLocation("/build")).toEqual({ type: "build-library" });
  });

  test("routes play worlds beneath the play entry point", () => {
    const path = playWorldURL("world/1");
    expect(path).toBe("/play/world%2F1");
    expect(readLocation(path)).toEqual({
      type: "play-world",
      worldId: "world/1",
    });
  });

  test("round-trips a selected builder mechanic", () => {
    const path = buildWorldURL("world/1", "capabilities", "skill 1");
    expect(path).toBe("/build/world%2F1/capabilities/skill%201");
    expect(readLocation(path)).toEqual({
      type: "build-world",
      worldId: "world/1",
      section: "capabilities",
      resourceId: "skill 1",
    });
  });

  test("rejects the removed global status catalog route", () => {
    expect(readLocation("/build/world-1/statuses")).toEqual({
      type: "not-found",
    });
  });

  test("keeps invitations in their intended application", () => {
    const path = inviteURL("play", "token value");
    expect(path).toBe("/play/invite/token%20value");
    expect(readLocation(path)).toEqual({
      type: "invite",
      area: "play",
      token: "token value",
    });
  });

  test("canonicalizes bare builder world paths", () => {
    expect(readLocation("/build/world-1")).toEqual({
      type: "redirect",
      path: "/build/world-1/capacities",
    });
  });

  test("does not silently turn unknown paths into a library", () => {
    expect(readLocation("/somewhere-else")).toEqual({ type: "not-found" });
    expect(readLocation("/play/world-1/history")).toEqual({
      type: "not-found",
    });
  });
});
