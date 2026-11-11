import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test("match card and score dialog contain long names on mobile", async () => {
  const bundle = await build({ entryPoints: ["tests/e2e/match-layout-fixture.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json" });
  const css = await postcss([tailwindcss()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    for (const width of [320, 375, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: css.css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      assert.equal(await page.getByText("Players in this match").count(), 0);
      assert.equal(await page.getByText("Team a", { exact: true }).count(), 0);
      assert.equal(await page.locator("h3").getByText("Round 1 - Court 1 - Round robin").count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const names = page.locator('p[title]');
      assert.equal(await names.count(), 4);
      assert.equal(await names.first().evaluate(el => getComputedStyle(el).textOverflow), "ellipsis");
      await page.getByRole("button", { name: "Enter and validate score" }).click();
      const dialog = page.getByRole("dialog"), box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `dialog fits at ${width}px`);
      const inputs = dialog.locator('input[type="number"]');
      const first = await inputs.nth(0).boundingBox(), second = await inputs.nth(1).boundingBox();
      assert.ok(first && second && Math.abs(first.y - second.y) <= 1, `scores align at ${width}px`);
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.close();
    }
  } finally { await browser.close(); }
});
