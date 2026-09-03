import { playNewWorldURL, type Navigate } from "../worldRoutes";
import { HomeChoiceView } from "./HomeChoiceView";
import { useChatGPTWorldStart } from "./useChatGPTWorldStart";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  void navigate;
  const templateHref = playNewWorldURL();
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
          "Opens ChatGPT on the web and requests that Wrought be attached. The prompt ends with “My play preference: surprise me.” Replace that phrase in ChatGPT if desired.",
      }}
    />
  );
}
