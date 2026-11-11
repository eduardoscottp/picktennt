import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

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

