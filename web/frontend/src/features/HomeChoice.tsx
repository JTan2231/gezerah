import type { Navigate } from "../worldRoutes";
import { HomeChoiceView } from "./HomeChoiceView";
import { useChatGPTWorldStart } from "./useChatGPTWorldStart";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  const buildHref = "/build";
  const templateHref = "/play/new";
  const worldStart = useChatGPTWorldStart(templateHref, "template");

  return (
    <HomeChoiceView
      playHref="/play"
      buildHref={buildHref}
      onChoosePlay={() => navigate("/play")}
      onChooseBuild={() => navigate(buildHref)}
      worldStart={{
        variant: "template",
        prompt: worldStart.prompt,
        chatGPTHref: worldStart.chatGPTHref,
        copyStatus: worldStart.copyStatus,
        onCopyPrompt: () => void worldStart.copyPrompt(),
        manualHref: templateHref,
        onStartManually: () => navigate(templateHref),
      }}
    />
  );
}
