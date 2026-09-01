import { Brand } from "../components/StudioUI";
import {
  ChatGPTWorldStartView,
  type ChatGPTWorldStartViewProps,
} from "./ChatGPTWorldStartView";

export function HomeChoiceView({
  worldStart,
}: {
  worldStart: ChatGPTWorldStartViewProps;
}) {
  return (
    <main className="home-choice">
      <header>
        <Brand />
        <h1>Play Gezerah with ChatGPT</h1>
      </header>
      <ChatGPTWorldStartView {...worldStart} />
    </main>
  );
}
