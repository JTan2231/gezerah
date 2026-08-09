import { Brand } from "../components/StudioUI";
import type { Navigate } from "../worldRoutes";

export function HomeChoice({ navigate }: { navigate: Navigate }) {
  return (
    <main className="home-choice">
      <header>
        <Brand />
        <h1>Play or Build</h1>
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
          <strong>Play</strong>
        </a>
        <a
          className="home-choice-card home-choice-build"
          href="/build"
          onClick={(event) => {
            event.preventDefault();
            navigate("/build");
          }}
        >
          <strong>Build</strong>
        </a>
      </nav>
    </main>
  );
}
