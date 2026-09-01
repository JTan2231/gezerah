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
    `Help me start playing Gezerah using the attached page at ${templateURL}.`,
    "If the page requires authentication, wait while I sign in, then continue autonomously.",
    "Treat the final line of this prompt as my only setup input. Do not ask setup questions, ask me to take control of the browser, or ask me to click, navigate, copy, paste, select, or edit anything in Gezerah.",
    "Use the page's site tools to inspect the three ready-made Worlds, recommend and copy the best match, choose and claim the best-fitting available Character, and present the first Problem.",
    "Once in Play, read and apply Gezerah's Play handbook, then begin directly with the first Problem. Make the chosen World and Character apparent through the opening rather than reporting your selections or setup. Preserve my agency over my Character's Actions: never invent or submit an Action until I tell you what I do. Keep lasting game state in Gezerah.",
    "My play preference: surprise me.",
  ].join(" ");
}

export function createChatGPTLaunchURL(
  browserURL: string,
  prompt: string,
): string {
  const query = new URLSearchParams({
    surface: "work",
    prompt,
    browserUrl: browserURL,
  });
  return `https://chatgpt.com/?${query.toString()}`;
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
  const chatGPTHref = createChatGPTLaunchURL(destinationURL, prompt);

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
