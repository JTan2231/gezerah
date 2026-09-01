import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeChoiceView } from "./HomeChoiceView";

const noop = () => undefined;

test("makes ChatGPT world setup prominent without hiding Play and Build", () => {
  const html = renderToStaticMarkup(
    <HomeChoiceView
      playHref="/play"
      buildHref="/build"
      onChoosePlay={noop}
      onChooseBuild={noop}
      worldStart={{
        prompt: "Starter prompt fixture",
        chatGPTHref:
          "https://chatgpt.com/?surface=work&prompt=Starter+prompt+fixture",
        copyStatus: "idle",
        buildHref: "/build",
        onCopyPrompt: noop,
        onStartBuild: noop,
      }}
    />,
  );

  expect(html).toContain("Start a World with ChatGPT");
  expect(html).toContain("Starter prompt fixture");
  expect(html).toContain("Start in ChatGPT");
  expect(html.indexOf("Start a World with ChatGPT")).toBeLessThan(
    html.indexOf('aria-label="Application area"'),
  );
  expect(html).toContain("Play");
  expect(html).toContain("Build");
});
