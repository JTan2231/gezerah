import type { Navigate } from "../worldRoutes";
import { HomeChoiceView } from "./HomeChoiceView";
import { useChatGPTWorldStart } from "./useChatGPTWorldStart";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  void navigate;
  const templateHref = "/play/new";
  const worldStart = useChatGPTWorldStart(templateHref, "template");

  return (
    <HomeChoiceView
      worldStart={{
        variant: "template",
        prompt: worldStart.prompt,
        chatGPTHref: worldStart.chatGPTHref,
        copyStatus: worldStart.copyStatus,
        onCopyPrompt: () => void worldStart.copyPrompt(),
        promptFallback: false,
        footnote:
          "Requires ChatGPT desktop with Site tools. The prompt ends with “My play preference: surprise me.” Replace that phrase in ChatGPT if desired.",
      }}
    />
  );
}
