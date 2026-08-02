export type WorldSection =
  "capacities" | "capabilities" | "people" | "settings" | "play";

type AppLocation =
  | { type: "worlds" }
  | { type: "invite"; token: string }
  | {
      type: "world";
      worldId: string;
      section: WorldSection;
      resourceId?: string | undefined;
    };

export function readLocation(pathname = window.location.pathname): AppLocation {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "invite" && parts[1] !== undefined)
    return { type: "invite", token: parts[1] };
  if (parts[0] === "worlds" && parts[1] !== undefined) {
    const section = parts[2];
    if (
      section === "capacities" ||
      section === "capabilities" ||
      section === "people" ||
      section === "settings" ||
      section === "play"
    ) {
      return {
        type: "world",
        worldId: parts[1],
        section,
        resourceId: parts[3],
      };
    }
    return {
      type: "world",
      worldId: parts[1],
      section: "capacities",
    };
  }
  return { type: "worlds" };
}

export function worldURL(
  worldId: string,
  section: WorldSection,
  resourceId?: string,
): string {
  const base = `/worlds/${encodeURIComponent(worldId)}/${section}`;
  return resourceId === undefined
    ? base
    : `${base}/${encodeURIComponent(resourceId)}`;
}
