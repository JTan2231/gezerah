export type AppRoute =
  | "overview"
  | "owner-schemas"
  | "state-variables"
  | "conditions"
  | "problems"
  | "entities"
  | "state"
  | "instances"
  | "runtime"
  | "play";

export const routeLabels: Record<AppRoute, string> = {
  overview: "Setup guide",
  "owner-schemas": "Owner schemas",
  "state-variables": "State variables",
  conditions: "Conditions",
  problems: "Problems",
  entities: "Entities",
  state: "State inspector",
  instances: "Problem instances",
  runtime: "Runtime",
  play: "Play",
};

export function readRoute(): AppRoute {
  const segment = window.location.pathname.split("/").filter(Boolean).at(-1);
  return Object.hasOwn(routeLabels, segment ?? "")
    ? (segment as AppRoute)
    : "overview";
}
