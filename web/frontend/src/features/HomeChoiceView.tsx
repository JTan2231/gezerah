import { Brand } from "../components/StudioUI";

export function HomeChoiceView({
  playHref,
  buildHref,
  onChoosePlay,
  onChooseBuild,
}: {
  playHref: string;
  buildHref: string;
  onChoosePlay: () => void;
  onChooseBuild: () => void;
}) {
  return (
    <main className="home-choice">
      <header>
        <Brand />
        <h1>Play or Build</h1>
      </header>
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
