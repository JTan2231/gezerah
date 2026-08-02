import { Brand } from "../components/StudioUI";
import type { Navigate } from "../worldRoutes";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  return (
    <main className="home-choice">
      <header>
        <Brand />
        <p className="eyebrow">Choose your side of the table</p>
        <h1>What are you here to do?</h1>
      </header>
      <nav className="home-choice-grid" aria-label="Application area">
        <a
          className="home-choice-card home-choice-play"
          href="/play"
          onClick={(event) => {
            event.preventDefault();
            navigate("/play");
          }}
        >
          <span className="home-choice-symbol" aria-hidden="true">
            ✦
          </span>
          <span>
            <small>At the table</small>
            <strong>Play</strong>
            <em>
              Join your table, prepare your character, or return to the story.
            </em>
          </span>
          <b aria-hidden="true">→</b>
        </a>
        <a
          className="home-choice-card home-choice-build"
          href="/build"
          onClick={(event) => {
            event.preventDefault();
            navigate("/build");
          }}
        >
          <span className="home-choice-symbol" aria-hidden="true">
            ◇
          </span>
          <span>
            <small>In the studio</small>
            <strong>Build</strong>
            <em>
              Create a world, define its mechanics, and prepare the table.
            </em>
          </span>
          <b aria-hidden="true">→</b>
        </a>
      </nav>
    </main>
  );
}
