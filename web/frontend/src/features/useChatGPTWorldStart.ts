import { useState } from "react";

import type { StarterPromptCopyStatus } from "./ChatGPTWorldStartView";

export function createChatGPTWorldStartPrompt(buildURL: string): string {
  return [
    `Help me start a new World in Scryer at ${buildURL}.`,
    "Ask me a few short questions about the premise, tone, my Character, and the kinds of difficult choices I enjoy.",
    "Then guide me through the shortest setup in Build, one step at a time. I will sign in and make each change myself.",
    "When my World and Character are ready, guide me into Play, help me choose ChatGPT as Facilitator, and begin.",
  ].join(" ");
}

export function createChatGPTWorldStartURL(prompt: string): string {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("surface", "work");
  url.searchParams.set("prompt", prompt);
  return url.toString();
}

export function useChatGPTWorldStart(buildHref: string) {
  const [copyStatus, setCopyStatus] = useState<StarterPromptCopyStatus>("idle");
  const prompt = createChatGPTWorldStartPrompt(
    new URL(buildHref, window.location.href).toString(),
  );
  const chatGPTHref = createChatGPTWorldStartURL(prompt);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return { prompt, chatGPTHref, copyStatus, copyPrompt };
}
