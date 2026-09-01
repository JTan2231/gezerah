export interface ProjectedWorldEvent {
  readonly id: number;
  readonly type: string;
  readonly interaction_id?: string;
  readonly action_id?: string;
  readonly resolution_id?: string;
  readonly actor_membership_id?: string;
  readonly actor_source?: string;
  readonly created_at?: string;
}

export function parseCompleteWorldEvents(
  chunks: readonly string[],
): readonly ProjectedWorldEvent[] {
  const source = chunks.join("");
  const separator = /\r\n\r\n|\n\n|\r\r/g;
  const events: ProjectedWorldEvent[] = [];
  let frameStart = 0;

  for (
    let match = separator.exec(source);
    match !== null;
    match = separator.exec(source)
  ) {
    const frame = source.slice(frameStart, match.index);
    frameStart = match.index + match[0].length;
    const dataLines = frame
      .split(/\r\n|\n|\r/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => {
        const value = line.slice("data:".length);
        return value.startsWith(" ") ? value.slice(1) : value;
      });
    if (dataLines.length === 0) continue;

    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (typeof parsed === "object" && parsed !== null) {
      events.push(parsed as ProjectedWorldEvent);
    }
  }

  return events;
}
