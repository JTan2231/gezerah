import { Brand } from "../components/StudioUI";
import {
  ChatGPTWorldStartView,
  type ChatGPTWorldStartViewProps,
} from "./ChatGPTWorldStartView";

export function HomeChoiceView({
  playHref,
  buildHref,
  onChoosePlay,
  onChooseBuild,
  worldStart,
}: {
  playHref: string;
  buildHref: string;
  onChoosePlay: () => void;
  onChooseBuild: () => void;
  worldStart: ChatGPTWorldStartViewProps;
}) {
  return (
    <main className="home-choice">
      <header>
        <Brand />
        <h1>Play or Build</h1>
      </header>
      <ChatGPTWorldStartView {...worldStart} />
      <nav className="home-choice-grid" aria-label="Application area">
        <a
          className="home-choice-card home-choice-play"
          href={playHref}
          onClick={(event) => {
            event.preventDefault();
            onChoosePlay();
          }}
        >
          <strong>Play</strong>
        </a>
        <a
          className="home-choice-card home-choice-build"
          href={buildHref}
          onClick={(event) => {
            event.preventDefault();
            onChooseBuild();
          }}
        >
          <strong>Build</strong>
        </a>
      </nav>
    </main>
  );
}
