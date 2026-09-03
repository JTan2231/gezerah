export function HomeChoiceView({ chatGPTHref }: { chatGPTHref: string }) {
  return (
    <main className="home-choice">
      <h1>Wrought</h1>
      <p className="home-choice-tagline">A generative narrative engine.</p>
      <a className="button button-primary home-choice-play" href={chatGPTHref}>
        <span aria-hidden="true">▶</span>
        Play with ChatGPT
      </a>
    </main>
  );
}
