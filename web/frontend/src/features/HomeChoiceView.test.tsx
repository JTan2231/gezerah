import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeChoiceView } from "./HomeChoiceView";

const noop = () => undefined;

test("makes ChatGPT on the web the sole public interface", () => {
  const html = renderToStaticMarkup(
    <HomeChoiceView
      worldStart={{
        variant: "template",
        prompt: "Starter prompt fixture",
        chatGPTHref:
          "https://chatgpt.com/?surface=work&prompt=Starter+prompt+fixture",
        copyStatus: "idle",
        onCopyPrompt: noop,
        promptFallback: false,
        manualHref: "/wrought/play/new",
        onStartManually: noop,
      }}
    />,
  );

  expect(html).toContain("Play Wrought with ChatGPT");
  expect(html).toContain("Start playing with ChatGPT");
  expect(html).toContain("three complete World templates");
  expect(html).toContain("Open in ChatGPT");
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).not.toContain("Starter prompt fixture");
  expect(html).not.toContain("Copy starter prompt");
  expect(html).not.toContain("Choose a World yourself");
  expect(html).not.toContain('href="/play"');
  expect(html).not.toContain('href="/build"');
});
