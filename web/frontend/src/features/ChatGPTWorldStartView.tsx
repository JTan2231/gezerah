import { useId } from "react";

export type StarterPromptCopyStatus = "idle" | "copied" | "failed";
export type ChatGPTWorldStartVariant = "template" | "build";

export interface ChatGPTWorldStartViewProps {
  variant: ChatGPTWorldStartVariant;
  prompt: string;
  chatGPTHref: string;
  copyStatus: StarterPromptCopyStatus;
  onCopyPrompt: () => void;
  manualHref?: string;
  onStartManually?: () => void;
  footnote?: string;
  promptFallback?: boolean;
}

export function ChatGPTWorldStartView({
  variant,
  prompt,
  chatGPTHref,
  copyStatus,
  onCopyPrompt,
  manualHref,
  onStartManually,
  footnote,
  promptFallback = true,
}: ChatGPTWorldStartViewProps) {
  const titleID = useId();
  const copyStatusID = useId();
  const copyMessage =
    copyStatus === "copied"
      ? "Starter prompt copied. Paste it into ChatGPT to begin."
      : copyStatus === "failed"
        ? "Could not copy the prompt. Select the prompt text and copy it instead."
        : "";
  const content =
    variant === "template"
      ? {
          eyebrow: "Three ready-to-play Worlds",
          title: "Start playing with ChatGPT",
          definition:
            "Choose one of three complete World templates, then play as one of its Characters.",
          description:
            "Open ChatGPT, sign in on the attached Gezerah page, optionally replace the prefilled play preference, then send the prompt. ChatGPT will recommend a World and Character, make your copy, and begin Play.",
          manualLabel: "Choose a World yourself",
          actionLabel: "Open in ChatGPT",
        }
      : {
          eyebrow: "Custom World",
          title: "Start a World with ChatGPT",
          definition: "A World is your world setting and continuing history.",
          description:
            "Start in ChatGPT or copy the prompt below. It will help shape your idea, then guide you while you create the World in Build.",
          manualLabel: "Create manually",
          actionLabel: "Start in ChatGPT",
        };

  return (
    <section className="chatgpt-world-start" aria-labelledby={titleID}>
      <span className="chatgpt-world-start-eyebrow">{content.eyebrow}</span>
      <h2 id={titleID}>{content.title}</h2>
      <p className="chatgpt-world-start-definition">{content.definition}</p>
      <p>{content.description}</p>
      {promptFallback ? (
        <blockquote className="chatgpt-world-start-prompt">
          <p>{prompt}</p>
        </blockquote>
      ) : null}
      <div className="chatgpt-world-start-actions">
        <a className="button button-primary" href={chatGPTHref}>
          {content.actionLabel}
        </a>
        {promptFallback ? (
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
        ) : null}
        {!promptFallback ||
        manualHref === undefined ||
        onStartManually === undefined ? null : (
          <a
            className="button button-quiet"
            href={manualHref}
            onClick={(event) => {
              event.preventDefault();
              onStartManually();
            }}
          >
            {content.manualLabel}
          </a>
        )}
      </div>
      {promptFallback ? (
        <p
          className="chatgpt-world-start-status"
          id={copyStatusID}
          role="status"
          aria-live="polite"
        >
          {copyMessage}
        </p>
      ) : null}
      {footnote === undefined ? null : (
        <p className="chatgpt-world-start-footnote">{footnote}</p>
      )}
    </section>
  );
}
