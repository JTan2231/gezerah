import { existsSync } from "node:fs";

import { chromium } from "@playwright/test";

import { runCommand } from "./command";
import { testRoot } from "./paths";

export async function ensureBrowser(
  signal?: AbortSignal,
): Promise<string | undefined> {
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return undefined;

  for (const candidate of systemBrowserCandidates()) {
    if (existsSync(candidate)) return candidate;
  }

  process.stdout.write("\n==> Browser: installing Playwright Chromium\n");
  await runCommand("bunx", ["playwright", "install", "chromium"], {
    cwd: testRoot,
    ...(signal === undefined ? {} : { signal }),
  });
  if (!existsSync(chromium.executablePath())) {
    throw new Error(
      "Playwright Chromium installation completed without a browser executable",
    );
  }
  return undefined;
}

function systemBrowserCandidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
    ];
    return roots
      .filter((root): root is string => root !== undefined)
      .map((root) => `${root}\\Google\\Chrome\\Application\\chrome.exe`);
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}
