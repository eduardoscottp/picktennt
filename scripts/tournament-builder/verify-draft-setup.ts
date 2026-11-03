import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';

async function main() {
  const original = JSON.parse(readFileSync('tests/tournament-builder/fixtures/tournament-definition.json', 'utf8'));
  const partial = structuredClone(original);
  delete partial.event.expected_end_at;
  delete partial.registration.closes_at;
  delete partial.registration.partner_consent;
  delete partial.registration.organizer_plays;
  delete partial.scheduling;
  const actor = { id: randomUUID(), clientId: 'web' }, eventId = randomUUID(), definitionId = randomUUID();
  const snapshot: CommandSnapshot = { event: { id: eventId, created_by: actor.id, modular_state: 'draft', revision: 5, roster_revision: 0, definition_id: definitionId }, definitions: [{ id: definitionId, definition: partial, status: 'draft' }], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  const current = () => ({ snapshot, preview: previewDefinition(snapshot.definitions[0].definition, Number(snapshot.event!.revision)) });
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TournamentBuilder} from './components/tournament-builder/builder';const data=window.fixture;createRoot(document.getElementById('root')).render(<TournamentBuilder actorId={data.actorId} initialSnapshot={data.snapshot} initialPreview={data.preview}/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', banner: { js: 'var process = {env: {NODE_ENV: "production"}};' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = (await postcss([tailwind()]).process(readFileSync('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const commands: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://localhost');
      if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
      if (req.method === 'POST') {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const envelope = JSON.parse(Buffer.concat(chunks).toString());
        const command = url.searchParams.get('command')!;
        assert.equal(envelope.expected_revision, snapshot.event!.revision);
        const plan = planCommand(snapshot, actor, command, envelope.data, { now: '2026-10-29T12:00:00Z', id: randomUUID });
        Object.assign(snapshot.event!, plan.effects.event, { revision: Number(snapshot.event!.revision) + 1 });
        if (plan.effects.definition) Object.assign(snapshot.definitions[0], plan.effects.definition);
        snapshot.stages.push(...(plan.effects.stages ?? []));
        commands.push(command);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ operation_id: envelope.operation_id, tournament_id: eventId, revision: snapshot.event!.revision, status: 'applied', data: plan.result })); return;
      }
      if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(current())); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>window.fixture=${JSON.stringify({ actorId: actor.id, ...current() }).replaceAll('<', '\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
    } catch (error) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 'INVALID_REQUEST', message: String(error) })); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
  const evidence = resolve('docs/evidence'); mkdirSync(evidence, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('#draft-event-expected_end_at').waitFor({ timeout: 5000 }).catch(error => { throw new Error(`${error.message}; browser errors: ${JSON.stringify(errors)}`); });
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 7);
    assert.equal(await page.getByRole('button', { name: 'Approve rules and open registration' }).isEnabled(), false);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal overflow at ${width}px`);
    }
    await page.screenshot({ path: join(evidence, 'draft-required-fields-mobile-2026-10-29.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#draft-event-expected_end_at').fill(original.event.expected_end_at.slice(0, 16));
    await page.locator('#draft-registration-closes_at').fill(original.registration.closes_at.slice(0, 16));
    await page.locator('#draft-registration-partner_consent').selectOption('true');
    await page.locator('#draft-registration-organizer_plays').selectOption('false');
    await page.locator('#draft-scheduling-estimated_slot_minutes').fill('30');
    await page.locator('#draft-scheduling-minimum_rest_minutes').fill('0');
    await page.locator('#draft-scheduling-contingency_minutes').fill('30');
    assert.equal(await page.locator('[aria-invalid="true"]').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Approve rules and open registration' }).isEnabled(), false, 'Unsaved setup cannot advance');
    await page.getByRole('button', { name: 'Save changes and refresh review' }).click();
    await page.getByText('Saved. The tournament is up to date.', { exact: true }).waitFor();
    assert.equal(previewDefinition(snapshot.definitions[0].definition, 6).valid, true);
    for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
    assert.equal(await page.getByRole('button', { name: 'Approve rules and open registration' }).isEnabled(), true);
    await page.screenshot({ path: join(evidence, 'draft-required-fields-complete-2026-10-29.png'), fullPage: true });
    await page.getByRole('button', { name: 'Approve rules and open registration' }).click();
    await page.getByText('registration open', { exact: true }).waitFor();
    assert.deepEqual(commands, ['updateDraft', 'publishTournament']);
    assert.equal(snapshot.event!.modular_state, 'registration_open');
    assert.equal(snapshot.teams.length, 0);
    assert.deepEqual(errors, []);
    writeFileSync(join(evidence, 'draft-required-fields-browser-2026-10-29.json'), JSON.stringify({ scope: 'Isolated hydrated browser fixture, synthetic HTTP adapter with real command planner; no production authentication, database or deployment.', checks: ['Seven required controls highlighted initially', '1440px and 390px without horizontal overflow', 'All seven fields completed interactively; red feedback clears', 'Unsaved edits block publication', 'Save through real command planner and refresh review', 'Explicit review enables publication; registration opens without players', 'Zero browser page errors'], commands }, null, 2));
    console.log('PASS: hydrated required-field completion, save, review and registration publication; desktop/mobile layout.');
  } finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
