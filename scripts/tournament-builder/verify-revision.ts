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
import { previewRevision } from '../../lib/tournament-builder/revisions';
import { previewSchedule } from '../../lib/tournament-builder/schedule-preview';
import { resolvedDefinition } from '../../lib/tournament-builder/resolved-definition';
import { entryPlayerIds } from '../../lib/tournament-builder/entry-roster';

async function main() {
  const definition = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8'));
  definition.registration.min_entries = 8;
  const actor = { id: randomUUID(), clientId: 'web' };
  const snapshot: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  const context = { now: '2026-10-29T12:00:00Z', id: randomUUID, draw: (ids: readonly string[]) => [...ids] };
  function apply(command: string, data: Record<string, unknown>) {
    const plan = planCommand(snapshot, actor, command, data, context);
    snapshot.event = { id: randomUUID(), created_by: actor.id, revision: 0, roster_revision: 0, ...snapshot.event, ...plan.effects.event };
    snapshot.event.revision = Number(snapshot.event.revision) + 1;
    if (plan.effects.definition) { const prior = snapshot.definitions.find(row => row.id === plan.effects.definition!.id); if (prior) Object.assign(prior, plan.effects.definition); else snapshot.definitions.push(plan.effects.definition); }
    for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches', 'standings'] as const) for (const patch of plan.effects[table] ?? []) { const prior = snapshot[table].find(row => row.id === patch.id); if (prior) Object.assign(prior, patch); else snapshot[table].push(patch); }
    return plan;
  }
  apply('createDraft', { definition });
  const publication = previewDefinition(definition, 1);
  apply('publishTournament', { reviewed_definition_hash: publication.definitionHash, acknowledged_warning_codes: publication.warningCodes });
  for (let i = 0; i < 8; i++) apply('addRegisteredEntry', { definition_id: snapshot.event!.definition_id, player_ids: [randomUUID(), randomUUID()], entry_name: `Team ${i + 1}`, reason: 'Synthetic browser fixture' });
  apply('closeRegistration', {});
  const assignments = Object.fromEntries(['A', 'B', 'C', 'D'].map((group, i) => [group, snapshot.teams.slice(i * 2, i * 2 + 2).map(team => team.id)]));
  apply('lockRoster', { reviewed_roster_revision: snapshot.event!.roster_revision, group_assignments: assignments });
  const oldIds = snapshot.matches.map(match => match.id);
  const oldFirst = entryPlayerIds(snapshot, snapshot.teams[0].id)[0], oldSecond = entryPlayerIds(snapshot, snapshot.teams[1].id)[0];
  const current = () => ({ snapshot, preview: previewDefinition(resolvedDefinition(snapshot)!.definition, Number(snapshot.event!.revision)) });
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TournamentBuilder} from './components/tournament-builder/builder';const d=window.fixture;createRoot(document.getElementById('root')).render(<TournamentBuilder actorId={d.actorId} initialSnapshot={d.snapshot} initialPreview={d.preview} view="admin"/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', banner: { js: 'var process = {env: {NODE_ENV: "production"}};' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = (await postcss([tailwind()]).process(readFileSync('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const commands: string[] = [], previews: string[] = [];
  let scheduleReview: ReturnType<typeof previewSchedule> | undefined;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://localhost');
      if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
      if (req.method === 'POST') {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname.endsWith('/preview')) { const kind = url.searchParams.get('kind')!; previews.push(kind); const result = kind === 'revision' ? previewRevision(snapshot, actor, body) : previewSchedule(snapshot, actor, body, context.now); if (kind === 'schedule') { scheduleReview = result as ReturnType<typeof previewSchedule>; assert.equal(new Set(scheduleReview.fixtures.map(fixture => `${fixture.wave}:${fixture.court}`)).size, scheduleReview.fixtures.length, 'Preview cannot assign two matches to the same court and slot'); } res.end(JSON.stringify(result)); return; }
        const command = url.searchParams.get('command')!;
        assert.equal(body.expected_revision, snapshot.event!.revision);
        const plan = apply(command, body.data); commands.push(command);
        res.end(JSON.stringify({ operation_id: body.operation_id, tournament_id: snapshot.event!.id, revision: snapshot.event!.revision, status: 'applied', data: plan.result })); return;
      }
      if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(current())); return; }
      res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>window.fixture=${JSON.stringify({ actorId: actor.id, ...current() }).replaceAll('<', '\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
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
    await page.getByText('Edit tournament setup and teams', { exact: true }).click();
    await page.locator('#draft-event-name').fill('Revised browser tournament');
    const firstRow = page.getByLabel('Name for entry 1', { exact: true }).locator('..').locator('..');
    const secondRow = page.getByLabel('Name for entry 2', { exact: true }).locator('..').locator('..');
    await firstRow.locator('select').first().selectOption(oldSecond);
    await secondRow.locator('select').first().selectOption(oldFirst);
    await page.getByLabel('Reason for change (required)', { exact: true }).fill('Swap registered players before play');
    await page.getByRole('button', { name: 'Review proposed revision', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm reviewed revision and close registration' }).waitFor();
    await page.getByLabel('Reason for change (required)', { exact: true }).fill('Reviewed swap before play');
    assert.equal(await page.getByRole('button', { name: 'Confirm reviewed revision and close registration' }).count(), 0, 'Any edit invalidates review');
    await page.getByRole('button', { name: 'Review proposed revision', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm reviewed revision and close registration' }).waitFor();
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log(await page.evaluate(() => [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > innerWidth).map(e => ({ tag: e.tagName, cls: e.className, text: e.textContent?.slice(0, 80), right: e.getBoundingClientRect().right })).slice(-20))); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Revision has no horizontal overflow ${width}`); }
    await page.screenshot({ path: join(evidence, 'revision-review-mobile-2026-10-29.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm reviewed revision and close registration' }).click();
    await page.getByText('registration closed', { exact: true }).waitFor();
    assert.equal(snapshot.event!.name, 'Revised browser tournament');
    assert.ok(entryPlayerIds(snapshot, snapshot.teams[0].id).includes(oldSecond));
    assert.ok(snapshot.matches.filter(match => oldIds.includes(match.id)).every(match => match.is_current === false));
    for (let i = 0; i < 8; i++) await page.getByLabel(new RegExp(`^Group for Team ${i + 1}`)).selectOption(['A', 'B', 'C', 'D'][Math.floor(i / 2)]);
    await page.getByRole('checkbox', { name: /I reviewed the current 8 approved entries/ }).check();
    await page.getByRole('button', { name: 'Preview matches and team rest' }).click();
    await page.getByRole('button', { name: 'Confirm reviewed schedule and generate matches' }).waitFor();
    assert.equal(await page.getByRole('table').locator('tbody tr').count(), 8);
    assert.ok(scheduleReview); for (const fixture of scheduleReview.fixtures) assert.equal(await page.getByText(new RegExp(`^Slot ${fixture.wave} · Court ${fixture.court}:`)).count(), 1, 'Rendered schedule matches the reviewed unique court/slot');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Schedule has no mobile overflow');
    await page.screenshot({ path: join(evidence, 'revision-schedule-mobile-2026-10-29.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: join(evidence, 'revision-schedule-desktop-2026-10-29.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm reviewed schedule and generate matches' }).click();
    await page.getByText('ready', { exact: true }).waitFor();
    assert.deepEqual(commands, ['reviseTournament', 'lockRoster']);
    assert.equal(snapshot.matches.filter(match => match.is_current !== false).length, 7);
    assert.deepEqual(errors, []);
    writeFileSync(join(evidence, 'revision-browser-2026-10-29.json'), JSON.stringify({ scope: 'Local hydrated browser fixture using synthetic accounts and HTTP adapter, real revision/schedule previews and command planner. No production auth, database, account lookup, deployment, or MCP tested.', checks: ['Edited setup and swapped two registered players', 'Reason edit invalidated preview', 'Explicit revision confirmation closed registration and preserved inactive old fixtures', '1440px and 390px revision layout without overflow', 'Assigned all actual teams to groups and explicitly reviewed roster', 'Preview showed eight team fairness rows and concrete fixtures', 'Mobile schedule without horizontal overflow', 'Explicit schedule confirmation generated seven current matches', 'No browser page errors'], commands, previews, schedule: scheduleReview?.fixtures.map(({ id, wave, court }) => ({ id, wave, court })) }, null, 2));
    console.log('PASS: hydrated revision, player swap, review invalidation, closed registration, group schedule preview and generation; desktop/mobile.');
  } finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
