import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test("roster headers align with short and long team names", async () => {
  const bundle = await build({ entryPoints: ["tests/e2e/roster-layout-fixture.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json" });
  const css = await postcss([tailwindcss()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    for (const width of [320, 375, 430, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: css.css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const first = page.getByLabel("Team 1"), second = page.getByLabel("Team 2");
      const a = await first.locator("h3").evaluate(el => el.parentElement!.getBoundingClientRect().bottom);
      const b = await second.locator("h3").evaluate(el => el.parentElement!.getBoundingClientRect().bottom);
      assert.ok(Math.abs(a - b) <= 1, `headers align at ${width}px`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const title = second.locator("h3 span").first();
      assert.equal(await title.evaluate(el => getComputedStyle(el).webkitLineClamp), "2");
      await page.close();
    }
  } finally { await browser.close(); }
});
