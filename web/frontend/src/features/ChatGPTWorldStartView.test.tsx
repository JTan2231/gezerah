import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatGPTWorldStartView } from "./ChatGPTWorldStartView";
import {
  createChatGPTTemplateStartPrompt,
  createChatGPTWorldStartPrompt,
  createChatGPTLaunchURL,
} from "./useChatGPTWorldStart";

const noop = () => undefined;

describe("ChatGPTWorldStartView", () => {
  test("offers the custom World route from Build", () => {
    const prompt = createChatGPTWorldStartPrompt(
      "https://gezerah.example/build",
    );
    const chatGPTHref = createChatGPTLaunchURL(
      "https://gezerah.example/build",
      prompt,
    );
    const html = renderToStaticMarkup(
      <ChatGPTWorldStartView
        variant="build"
        prompt={prompt}
        chatGPTHref={chatGPTHref}
        copyStatus="idle"
        onCopyPrompt={noop}
      />,
    );

    expect(html).toContain("Start a World with ChatGPT");
    expect(html).toContain(
      "A World is your world setting and continuing history.",
    );
    expect(html).toContain("https://gezerah.example/build");
    expect(html).toContain("I will sign in and make each change myself.");
    expect(html).toContain("help me choose ChatGPT as Facilitator");
    expect(html).toContain("Start in ChatGPT");
    expect(html).toContain("codex://threads/new?prompt=");
    expect(html).toContain("browserUrl=https%3A%2F%2Fgezerah.example%2Fbuild");
    expect(html).toContain("Copy starter prompt");
    expect(html).not.toContain("Choose a World yourself");
    expect(html).toContain('aria-live="polite"');
  });

  test("offers a copyable route through the three World templates", () => {
    const prompt = createChatGPTTemplateStartPrompt(
      "https://gezerah.example/play/new",
    );
    const html = renderToStaticMarkup(
      <ChatGPTWorldStartView
        variant="template"
        prompt={prompt}
        chatGPTHref={createChatGPTLaunchURL(
          "https://gezerah.example/play/new",
          prompt,
        )}
        copyStatus="idle"
        onCopyPrompt={noop}
        manualHref="/play/new"
        onStartManually={noop}
      />,
    );

    expect(html).toContain("Start playing with ChatGPT");
    expect(html).toContain("three complete World templates");
    expect(html).toContain("final line of this prompt as my only setup input");
    expect(html).toContain("https://gezerah.example/play/new");
    expect(html).toContain("Keep lasting game state in Gezerah");
    expect(html).toContain("My play preference: surprise me.");
    expect(html).toContain("never invent or submit an Action");
    expect(html).toContain("Choose a World yourself");
    expect(html).toContain('href="/play/new"');
  });

  test("reports copy success and failure accessibly", () => {
    const copied = renderToStaticMarkup(
      <ChatGPTWorldStartView
        variant="template"
        prompt="Starter prompt"
        chatGPTHref="https://chatgpt.com/?surface=work&prompt=Starter+prompt"
        copyStatus="copied"
        onCopyPrompt={noop}
      />,
    );
    const failed = renderToStaticMarkup(
      <ChatGPTWorldStartView
        variant="template"
        prompt="Starter prompt"
        chatGPTHref="https://chatgpt.com/?surface=work&prompt=Starter+prompt"
        copyStatus="failed"
        onCopyPrompt={noop}
      />,
    );

    expect(copied).toContain("Starter prompt copied. Paste it into ChatGPT");
    expect(failed).toContain(
      "Could not copy the prompt. Select the prompt text and copy it instead.",
    );
    expect(failed).toContain('role="status"');
  });

  test("builds one desktop launch with the prompt and attached page", () => {
    expect(
      createChatGPTLaunchURL(
        "https://gezerah.example/play/new",
        "Start a World & ask me questions.",
      ),
    ).toBe(
      "codex://threads/new?prompt=Start+a+World+%26+ask+me+questions.&browserUrl=https%3A%2F%2Fgezerah.example%2Fplay%2Fnew",
    );
  });

  test("can expose only the desktop launch without a prompt fallback", () => {
    const html = renderToStaticMarkup(
      <ChatGPTWorldStartView
        variant="template"
        prompt="Hidden prompt"
        chatGPTHref="codex://threads/new?prompt=Hidden"
        copyStatus="idle"
        onCopyPrompt={noop}
        promptFallback={false}
        manualHref="/play/new"
        onStartManually={noop}
      />,
    );

    expect(html).toContain("Open in ChatGPT");
    expect(html).not.toContain("Hidden prompt");
    expect(html).not.toContain("Copy starter prompt");
    expect(html).not.toContain("Choose a World yourself");
  });
});
