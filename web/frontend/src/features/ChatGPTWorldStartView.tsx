import { useId } from "react";

export type StarterPromptCopyStatus = "idle" | "copied" | "failed";

export interface ChatGPTWorldStartViewProps {
  prompt: string;
  chatGPTHref: string;
  copyStatus: StarterPromptCopyStatus;
  buildHref: string;
  onCopyPrompt: () => void;
  onStartBuild: () => void;
  footnote?: string;
}

export function ChatGPTWorldStartView({
  prompt,
  chatGPTHref,
  copyStatus,
  buildHref,
  onCopyPrompt,
  onStartBuild,
  footnote,
}: ChatGPTWorldStartViewProps) {
  const titleID = useId();
  const copyStatusID = useId();
  const copyMessage =
    copyStatus === "copied"
      ? "Starter prompt copied. Paste it into ChatGPT to begin."
      : copyStatus === "failed"
        ? "Could not copy the prompt. Select the prompt text and copy it instead."
        : "";

  return (
    <section className="chatgpt-world-start" aria-labelledby={titleID}>
      <span className="chatgpt-world-start-eyebrow">Recommended</span>
      <h2 id={titleID}>Start a World with ChatGPT</h2>
      <p className="chatgpt-world-start-definition">
        A World is your world setting and continuing history.
      </p>
      <p>
        Start in ChatGPT or copy the prompt below. It will help shape your idea,
        then guide you while you create the World in Build.
      </p>
      <blockquote className="chatgpt-world-start-prompt">
        <p>{prompt}</p>
      </blockquote>
      <div className="chatgpt-world-start-actions">
        <a
          className="button button-primary"
          href={chatGPTHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Start in ChatGPT
        </a>
        <button
          className="button button-quiet"
          type="button"
          onClick={onCopyPrompt}
          aria-describedby={copyStatusID}
        >
          {copyStatus === "copied"
            ? "Starter prompt copied"
            : "Copy starter prompt"}
        </button>
        <a
          className="button button-quiet"
          href={buildHref}
          onClick={(event) => {
            event.preventDefault();
            onStartBuild();
          }}
        >
          Start manually in Build
        </a>
      </div>
      <p
        className="chatgpt-world-start-status"
        id={copyStatusID}
        role="status"
        aria-live="polite"
      >
        {copyMessage}
      </p>
      {footnote === undefined ? null : (
        <p className="chatgpt-world-start-footnote">{footnote}</p>
      )}
    </section>
  );
}
