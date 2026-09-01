import type { Navigate } from "../worldRoutes";
import { HomeChoiceView } from "./HomeChoiceView";
import { useChatGPTWorldStart } from "./useChatGPTWorldStart";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  const buildHref = "/build";
  const worldStart = useChatGPTWorldStart(buildHref);

  return (
    <HomeChoiceView
      playHref="/play"
      buildHref={buildHref}
      onChoosePlay={() => navigate("/play")}
      onChooseBuild={() => navigate(buildHref)}
      worldStart={{
        prompt: worldStart.prompt,
        chatGPTHref: worldStart.chatGPTHref,
        copyStatus: worldStart.copyStatus,
        buildHref,
        onCopyPrompt: () => void worldStart.copyPrompt(),
        onStartBuild: () => navigate(buildHref),
      }}
    />
  );
}
