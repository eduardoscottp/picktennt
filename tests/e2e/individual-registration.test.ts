import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

test("choose a position, then accept the rules and confirm registration", async () => {
  const bundle = await build({ entryPoints: ["tests/e2e/individual-registration-fixture.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json" });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const position = page.getByRole("button", { name: "Join team 2 position 1" });
    assert.equal(await position.isEnabled(), true);
    await position.click();
    const dialog = page.getByRole("dialog");
    assert.match(await dialog.innerText(), /Team 2, position 1/);
    assert.equal(await dialog.getByRole("button", { name: "Yes, join" }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands), []);
    await dialog.getByRole("checkbox", { name: "I accept the published rules." }).check();
    await dialog.getByRole("button", { name: "No", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands), []);
    await position.click();
    assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Yes, join" }).click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as { commands: unknown[] }).commands), [{ command: "joinTournament", data: { definition_id: "definition", consent: true, slot_index: 2, position: 1 } }]);
  } finally { await browser.close(); }
});

test("join confirmation stays centered and fully visible on mobile", async () => {
  const bundle = await build({ entryPoints: ["tests/e2e/individual-registration-fixture.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json" });
  const css = await postcss([tailwindcss()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    for (const [width, height] of [[320, 480], [375, 667], [390, 844], [430, 932], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent('<div id="root"></div>');
      await page.addStyleTag({ content: css.css });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.getByRole("button", { name: "Join team 2 position 1" }).click();
      const dialog = page.getByRole("dialog");
      const box = await dialog.boundingBox();
      assert.ok(box, `dialog is visible at ${width}px`);
      assert.ok(box.x >= 0 && box.x + box.width <= width, `dialog fits within ${width}px`);
      assert.ok(Math.abs(box.x + box.width / 2 - width / 2) <= 1, `dialog is centered at ${width}px`);
      assert.ok(box.y >= 0 && box.y + box.height <= height, `dialog fits within ${height}px height`);
      assert.ok(Math.abs(box.y + box.height / 2 - height / 2) <= 1, `dialog is vertically centered at ${height}px`);
      for (const label of ["No", "Yes, join"]) {
        const button = await dialog.getByRole("button", { name: label, exact: true }).boundingBox();
        assert.ok(button && button.x >= 0 && button.x + button.width <= width && button.y >= 0 && button.y + button.height <= height, `${label} is visible at ${width}px`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
