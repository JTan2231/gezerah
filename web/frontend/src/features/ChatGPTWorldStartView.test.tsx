import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatGPTWorldStartView } from "./ChatGPTWorldStartView";
import {
  createChatGPTWorldStartPrompt,
  createChatGPTWorldStartURL,
} from "./useChatGPTWorldStart";

const noop = () => undefined;

describe("ChatGPTWorldStartView", () => {
  test("offers an honest, copyable route through Build", () => {
    const prompt = createChatGPTWorldStartPrompt(
      "https://scryer.example/build",
    );
    const chatGPTHref = createChatGPTWorldStartURL(prompt);
    const html = renderToStaticMarkup(
      <ChatGPTWorldStartView
        prompt={prompt}
        chatGPTHref={chatGPTHref}
        copyStatus="idle"
        buildHref="/build"
        onCopyPrompt={noop}
        onStartBuild={noop}
      />,
    );

    expect(html).toContain("Start a World with ChatGPT");
    expect(html).toContain(
      "A World is your world setting and continuing history.",
    );
    expect(html).toContain("https://scryer.example/build");
    expect(html).toContain("I will sign in and make each change myself.");
    expect(html).toContain("help me choose ChatGPT as Facilitator");
    expect(html).toContain("Start in ChatGPT");
    expect(html).toContain("https://chatgpt.com/?surface=work&amp;prompt=");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Copy starter prompt");
    expect(html).toContain("Start manually in Build");
    expect(html).toContain('href="/build"');
    expect(html).toContain('aria-live="polite"');
  });

  test("reports copy success and failure accessibly", () => {
    const copied = renderToStaticMarkup(
      <ChatGPTWorldStartView
        prompt="Starter prompt"
        chatGPTHref="https://chatgpt.com/?surface=work&prompt=Starter+prompt"
        copyStatus="copied"
        buildHref="/build"
        onCopyPrompt={noop}
        onStartBuild={noop}
      />,
    );
    const failed = renderToStaticMarkup(
      <ChatGPTWorldStartView
        prompt="Starter prompt"
        chatGPTHref="https://chatgpt.com/?surface=work&prompt=Starter+prompt"
        copyStatus="failed"
        buildHref="/build"
        onCopyPrompt={noop}
        onStartBuild={noop}
      />,
    );

    expect(copied).toContain("Starter prompt copied. Paste it into ChatGPT");
    expect(failed).toContain(
      "Could not copy the prompt. Select the prompt text and copy it instead.",
    );
    expect(failed).toContain('role="status"');
  });

  test("builds the official ChatGPT Work web handoff", () => {
    expect(
      createChatGPTWorldStartURL("Start a World & ask me questions."),
    ).toBe(
      "https://chatgpt.com/?surface=work&prompt=Start+a+World+%26+ask+me+questions.",
    );
  });
});
