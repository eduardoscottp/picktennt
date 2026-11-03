import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { TournamentBuilder, type TournamentBuilderView } from '../../components/tournament-builder/builder';
import { analyzeGraph } from '../../lib/tournament-builder/graph-runtime';
import type { GraphDefinition } from '../../lib/tournament-builder/graph-types';
import type { FixtureResult } from '../../lib/tournament-builder/types';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';

async function main() {
  const definition = JSON.parse(readFileSync('../examples/four-groups-definition.json', 'utf8')) as GraphDefinition;
  const entries = Array.from({ length: 16 }, (_, index) => ({ id: `entry-${index + 1}`, playerIds: [`player-${index * 2 + 1}`, `player-${index * 2 + 2}`] }));
  const results: FixtureResult[] = [];
  function snapshot(): CommandSnapshot {
    const analysis = analyzeGraph(definition, entries, results);
    const stages = definition.nodes.map(node => ({ id: node.id, node_id: node.id, module_id: node.module.split('@')[0], module_version: Number(node.module.split('@')[1]), state: analysis.graphStages[node.id]?.state ?? (node.module === 'placements@2' ? analysis.placements?.state : 'completed'), output: node.module === 'placements@2' ? analysis.placements : analysis.graphStages[node.id] }));
    return { event: { id: 'render-example', created_by: 'owner', revision: 1, modular_state: analysis.state === 'completed' ? 'completed' : 'active', definition_id: 'definition' }, definitions: [{ id: 'definition', definition }], teams: entries.map((entry, index) => ({ id: entry.id, name: `Pair ${index + 1}`, seed: index + 1, entry_state: 'approved' })), team_members: [], tournament_players: [], stages,
      rounds: analysis.fixtures.map((fixture, index) => ({ id: fixture.id, stage_id: fixture.stageId, round_number: index + 1, logical_wave: fixture.wave })),
      matches: analysis.resolvedFixtures.map(resolved => { const result = results.find(result => result.fixtureId === resolved.fixture.id); return { id: resolved.fixture.id, logical_key: resolved.fixture.id, stage_id: resolved.fixture.stageId, round_id: resolved.fixture.id, court_number: resolved.fixture.court, team_a_id: resolved.entryA, team_b_id: resolved.entryB, status: result ? 'validated' : 'scheduled', score_a: result?.scoreA, score_b: result?.scoreB }; }),
      standings: Object.entries(analysis.graphStages).flatMap(([node, output]) => (output.rows ?? []).map((row, index) => ({ id: `${node}-${row.entryId}`, stage_id: node, team_id: row.entryId, rank: index + 1, wins: row.wins, losses: row.losses, points_for: row.pointsFor, points_against: row.pointsAgainst }))),
    };
  }
  const active = snapshot();
  while (results.length < 27) {
    const next = analyzeGraph(definition, entries, results).resolvedFixtures.find(fixture => fixture.state === 'ready' && fixture.entryA && fixture.entryB);
    assert.ok(next);
    const aWins = entries.findIndex(entry => entry.id === next.entryA) < entries.findIndex(entry => entry.id === next.entryB);
    results.push({ fixtureId: next.fixture.id, accepted: true, outcome: 'played', winnerEntryId: aWins ? next.entryA : next.entryB, scoreA: aWins ? 11 : 2, scoreB: aWins ? 2 : 11 });
  }
  const completed = snapshot();
  assert.equal(completed.event!.modular_state, 'completed');
  function files(path: string): string[] { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]); }
  const staticPath = '.next/static';
  const cssFiles = existsSync(staticPath) ? files(staticPath).filter(file => file.endsWith('.css')) : [];
  assert.ok(cssFiles.length, 'Run the production build first to provide actual generated CSS.');
  const css = cssFiles.map(file => readFileSync(file, 'utf8')).join('\n');
  const evidence = resolve('docs/evidence');
  mkdirSync(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
  const checks: string[] = [];
  try {
    const page = await browser.newPage();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['overview', 'matches', 'standings'] as TournamentBuilderView[]) {
        const data = view === 'standings' ? completed : active;
        const markup = renderToStaticMarkup(createElement(TournamentBuilder, { actorId: 'owner', initialSnapshot: data, initialPreview: previewDefinition(definition, 1), view }));
        await page.setContent(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`, { waitUntil: 'load' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(overflow, false, `${view} overflows horizontally at ${width}px`);
        if (view === 'overview') {
          for (const group of ['A', 'B', 'C', 'D']) await page.getByRole('heading', { name: `Group ${group}`, exact: true }).waitFor();
          for (const label of ['Group A rank 1', 'Group B rank 1', 'Winner of SF1', 'Winner of SF2']) assert.ok((await page.getByText(label, { exact: true }).count()) > 0);
          if (width === 1440) await page.screenshot({ path: join(evidence, 'composable-browser-2026-10-28.png'), fullPage: true });
        }
        if (view === 'matches') {
          assert.equal(await page.locator('#matches h3').filter({ hasNotText: /^Matches$/ }).count(), 27);
          await page.getByRole('heading', { name: 'Final · F', exact: true }).waitFor();
          assert.ok((await page.getByText('Group A rank 1').count()) > 0);
        }
        if (view === 'standings') { assert.equal(await page.locator('table').count(), 4); for (const group of ['A', 'B', 'C', 'D']) await page.getByRole('heading', { name: `Group ${group}`, exact: true }).waitFor(); }
        checks.push(`${view} at ${width}px: labels and horizontal layout passed`);
      }
    }
  } finally { await browser.close(); }
  writeFileSync(join(evidence, 'composable-browser-2026-10-28.md'), `# Composable tournament render evidence\n\nRender-only Playwright check using production CSS and synthetic sixteen-doubles graph data. This does not verify hydration, authentication, server mutations, real accounts, or Claude/MCP interaction.\n\n${checks.map(check => `- ${check}`).join('\n')}\n\nScreenshot: composable-browser-2026-10-28.png\n`);
  console.log(`Render evidence passed: ${checks.length} viewports/views; docs/evidence/composable-browser-2026-10-28.png`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
