import { useState } from "react";

import type {
  ChatGPTWorldStartVariant,
  StarterPromptCopyStatus,
} from "./ChatGPTWorldStartView";

export function createChatGPTWorldStartPrompt(buildURL: string): string {
  return [
    `Help me start a new World in Gezerah at ${buildURL}.`,
    "Ask me a few short questions about the premise, tone, my Character, and the kinds of difficult choices I enjoy.",
    "Then guide me through the shortest setup in Build, one step at a time. I will sign in and make each change myself.",
    "When my World and Character are ready, guide me into Play, help me choose ChatGPT as Facilitator, and begin.",
  ].join(" ");
}

export function createChatGPTTemplateStartPrompt(templateURL: string): string {
  return [
    `Help me start playing one of Gezerah's three ready-made Worlds at ${templateURL}.`,
    "Ask what kind of setting, Character, and difficult choices I enjoy, then help me choose a World and Character from the options there.",
    "I will sign in and make the choices in Gezerah.",
    "Then guide me into Play, help me open that World with ChatGPT as Facilitator, and begin. Keep lasting game state in Gezerah.",
  ].join(" ");
}

export function createChatGPTWorldStartURL(prompt: string): string {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("surface", "work");
  url.searchParams.set("prompt", prompt);
  return url.toString();
}

export function useChatGPTWorldStart(
  destinationHref: string,
  variant: ChatGPTWorldStartVariant,
) {
  const [copyStatus, setCopyStatus] = useState<StarterPromptCopyStatus>("idle");
  const destinationURL = new URL(
    destinationHref,
    window.location.href,
  ).toString();
  const prompt =
    variant === "template"
      ? createChatGPTTemplateStartPrompt(destinationURL)
      : createChatGPTWorldStartPrompt(destinationURL);
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
