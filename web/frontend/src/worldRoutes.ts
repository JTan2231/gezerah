export type AppArea = "play" | "build";

export interface NavigateOptions {
  replace?: boolean;
}

export type Navigate = (path: string, options?: NavigateOptions) => void;

export type BuildSection =
  | "capacities"
  | "capabilities"
  | "character-fields"
  | "roster"
  | "members"
  | "settings";

type AppLocation =
  | { type: "home" }
  | { type: "play-library" }
  | { type: "play-new-world" }
  | { type: "play-world"; worldId: string }
  | { type: "build-library" }
  | {
      type: "build-world";
      worldId: string;
      section: BuildSection;
      resourceId?: string | undefined;
    }
  | { type: "invite"; area: AppArea; token: string }
  | { type: "redirect"; path: string }
  | { type: "not-found" };

const buildSections: ReadonlySet<string> = new Set([
  "capacities",
  "capabilities",
  "character-fields",
  "roster",
  "members",
  "settings",
]);

export function readLocation(pathname = window.location.pathname): AppLocation {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { type: "home" };

  if (parts[0] === "play") {
    if (parts.length === 1) return { type: "play-library" };
    if (parts[1] === "new" && parts.length === 2)
      return { type: "play-new-world" };
    if (parts[1] === "invite" && parts[2] !== undefined && parts.length === 3)
      return { type: "invite", area: "play", token: parts[2] };
    if (parts[1] !== undefined && parts.length === 2)
      return { type: "play-world", worldId: parts[1] };
    return { type: "not-found" };
  }

  if (parts[0] === "build") {
    if (parts.length === 1) return { type: "build-library" };
    if (parts[1] === "invite" && parts[2] !== undefined && parts.length === 3)
      return { type: "invite", area: "build", token: parts[2] };
    if (parts[1] === undefined) return { type: "not-found" };
    if (parts.length === 2)
      return {
        type: "redirect",
        path: buildWorldURL(parts[1], "capacities"),
      };
    if (parts[2] !== undefined && buildSections.has(parts[2])) {
      const section = parts[2] as BuildSection;
      if (
        parts.length > 3 &&
        section !== "capacities" &&
        section !== "capabilities"
      )
        return { type: "not-found" };
      if (parts.length > 4) return { type: "not-found" };
      return {
        type: "build-world",
        worldId: parts[1],
        section,
        resourceId: parts[3],
      };
    }
    return { type: "not-found" };
  }

  return { type: "not-found" };
}

export function playWorldURL(worldId: string): string {
  return `/play/${encodeURIComponent(worldId)}`;
}

export function playNewWorldURL(): string {
  return "/play/new";
}

export function buildWorldURL(
  worldId: string,
  section: BuildSection,
  resourceId?: string,
): string {
  const base = `/build/${encodeURIComponent(worldId)}/${section}`;
  return resourceId === undefined
    ? base
    : `${base}/${encodeURIComponent(resourceId)}`;
}

export function inviteURL(area: AppArea, token: string): string {
  return `/${area}/invite/${encodeURIComponent(token)}`;
}
