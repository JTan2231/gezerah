import { playNewWorldURL } from "../worldRoutes";
import { HomeChoiceView } from "./HomeChoiceView";
import { useChatGPTWorldStart } from "./useChatGPTWorldStart";

export function HomeChoice() {
  const templateHref = playNewWorldURL();
  const worldStart = useChatGPTWorldStart(templateHref, "template");

  return <HomeChoiceView chatGPTHref={worldStart.chatGPTHref} />;
}
