import { useEffect } from "react";

import { readSelectedUserId, worldPath } from "../api/client";

export function useWorldEvents(
  worldId: string | undefined,
  onRefresh: () => void,
): void {
  useEffect(() => {
    if (worldId === undefined) return undefined;
    const controller = new AbortController();
    let cursor = "";
    let reconnectTimer: number | undefined;

    async function connect() {
      if (controller.signal.aborted || worldId === undefined) return;
      const headers = new Headers({ Accept: "text/event-stream" });
      const userId = readSelectedUserId();
      if (userId !== "") headers.set("X-DND-User-ID", userId);
      const suffix =
        cursor === "" ? "" : `?after=${encodeURIComponent(cursor)}`;
      try {
        const response = await fetch(
          `${worldPath(worldId, "events")}${suffix}`,
          {
            headers,
            signal: controller.signal,
          },
        );
        if (!response.ok || response.body === null)
          throw new Error(`event stream failed (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let hasData = false;
            for (const rawLine of frame.split("\n")) {
              const line = rawLine.endsWith("\r")
                ? rawLine.slice(0, -1)
                : rawLine;
              if (line.startsWith("id:")) cursor = line.slice(3).trim();
              if (line.startsWith("data:") && line.slice(5).trim() !== "")
                hasData = true;
            }
            if (hasData) onRefresh();
          }
        }
      } catch {
        // The reconnect below resumes invalidation after a stream failure.
      }
      if (!controller.signal.aborted) {
        onRefresh();
        reconnectTimer = window.setTimeout(() => void connect(), 1500);
      }
    }

    void connect();
    return () => {
      controller.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
  }, [worldId, onRefresh]);
}
