import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeChoiceView } from "./HomeChoiceView";

test("makes ChatGPT on the web the sole public interface", () => {
  const html = renderToStaticMarkup(
    <HomeChoiceView chatGPTHref="https://chatgpt.com/?surface=work&prompt=Starter+prompt+fixture" />,
  );

  expect(html).toMatch(/<h1[^>]*>Wrought<\/h1>/);
  expect(html).toContain("A generative narrative engine.");
  expect(html).toContain("Play with ChatGPT");
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).not.toContain("Play Wrought with ChatGPT");
  expect(html).not.toContain("Start playing with ChatGPT");
  expect(html).not.toContain("Three ready-to-play Worlds");
  expect(html).not.toContain("three complete World templates");
  expect(html).not.toContain("Open ChatGPT, sign in");
  expect(html).not.toContain("My play preference: surprise me.");
  expect(html).not.toContain("Open in ChatGPT");
  expect(html).not.toContain("Starter prompt fixture");
  expect(html).not.toContain("Copy starter prompt");
  expect(html).not.toContain("Choose a World yourself");
  expect(html).not.toContain('href="/play"');
  expect(html).not.toContain('href="/build"');
});
