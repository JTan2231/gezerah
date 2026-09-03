import { describe, expect, test } from "bun:test";

import {
  buildWorldURL,
  inviteURL,
  playNewWorldURL,
  playWorldURL,
  readLocation,
} from "./worldRoutes";

describe("application routes", () => {
  test("keeps both exact base-path forms as a neutral application choice", () => {
    expect(readLocation("/wrought")).toEqual({ type: "home" });
    expect(readLocation("/wrought/")).toEqual({ type: "home" });
    expect(readLocation("/wrought/play")).toEqual({ type: "play-library" });
    expect(readLocation("/wrought/build")).toEqual({ type: "build-library" });
  });

  test("routes play worlds beneath the play entry point", () => {
    const path = playWorldURL("world/1");
    expect(path).toBe("/wrought/play/world%2F1");
    expect(readLocation(path)).toEqual({
      type: "play-world",
      worldId: "world/1",
    });
  });

  test("reserves the new-world route before world identifiers", () => {
    expect(playNewWorldURL()).toBe("/wrought/play/new");
    expect(readLocation("/wrought/play/new")).toEqual({
      type: "play-new-world",
    });
  });

  test("round-trips a selected builder mechanic", () => {
    const path = buildWorldURL("world/1", "capabilities", "mechanic 1");
    expect(path).toBe("/wrought/build/world%2F1/capabilities/mechanic%201");
    expect(readLocation(path)).toEqual({
      type: "build-world",
      worldId: "world/1",
      section: "capabilities",
      resourceId: "mechanic 1",
    });
  });

  test("uses members as the only membership section route", () => {
    const path = buildWorldURL("world/1", "members");
    expect(path).toBe("/wrought/build/world%2F1/members");
    expect(readLocation(path)).toEqual({
      type: "build-world",
      worldId: "world/1",
      section: "members",
      resourceId: undefined,
    });
  });

  test("keeps invitations in their intended application", () => {
    const path = inviteURL("play", "token value");
    expect(path).toBe("/wrought/play/invite/token%20value");
    expect(readLocation(path)).toEqual({
      type: "invite",
      area: "play",
      token: "token value",
    });
  });

  test("canonicalizes bare builder world paths", () => {
    expect(readLocation("/wrought/build/world-1")).toEqual({
      type: "redirect",
      path: "/wrought/build/world-1/capacities",
    });
  });

  test("requires the exact application base-path prefix", () => {
    expect(readLocation("/")).toEqual({ type: "not-found" });
    expect(readLocation("/play")).toEqual({ type: "not-found" });
    expect(readLocation("/wroughtly")).toEqual({ type: "not-found" });
    expect(readLocation("/wroughtly/play")).toEqual({ type: "not-found" });
  });

  test("does not silently turn unknown Wrought paths into a library", () => {
    expect(readLocation("/somewhere-else")).toEqual({ type: "not-found" });
    expect(readLocation("/wrought/play/world-1/history")).toEqual({
      type: "not-found",
    });
  });
});
