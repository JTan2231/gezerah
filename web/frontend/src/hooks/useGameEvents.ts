import { useEffect } from "react";

import { gamePath, readSelectedUserId } from "../api/client";

export function useGameEvents(
  gameId: string | undefined,
  onRefresh: () => void,
): void {
  useEffect(() => {
    if (gameId === undefined) return undefined;
    const controller = new AbortController();
    let cursor = "";
    let reconnectTimer: number | undefined;

    async function connect() {
      if (controller.signal.aborted || gameId === undefined) return;
      const headers = new Headers({ Accept: "text/event-stream" });
      const userId = readSelectedUserId();
      if (userId !== "") headers.set("X-DND-User-ID", userId);
      const suffix =
        cursor === "" ? "" : `?after=${encodeURIComponent(cursor)}`;
      try {
        const response = await fetch(`${gamePath(gameId, "events")}${suffix}`, {
          headers,
          signal: controller.signal,
        });
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
        // The polling interval below remains the compatibility fallback.
      }
      if (!controller.signal.aborted) {
        onRefresh();
        reconnectTimer = window.setTimeout(() => void connect(), 1500);
      }
    }

    void connect();
    const pollTimer = window.setInterval(onRefresh, 3000);
    return () => {
      controller.abort();
      window.clearInterval(pollTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
  }, [gameId, onRefresh]);
}
