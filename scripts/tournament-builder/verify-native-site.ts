import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { planCommand, type CommandSnapshot } from '../../lib/tournament-builder/commands';
import { previewDefinition } from '../../lib/tournament-builder/preview';

async function main() {
  const definition = JSON.parse(readFileSync('project-docs/examples/four-groups-definition.json', 'utf8'));
  const actor = { id: randomUUID(), clientId: 'web' }, eventId = randomUUID();
  const snapshot: CommandSnapshot = { event: null, definitions: [], teams: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [], admins: [] };
  function apply(command: string, data: Record<string, unknown>) {
    const plan = planCommand(snapshot, actor, command, data, { now: '2026-10-29T12:00:00Z', id: randomUUID });
    if (!snapshot.event) snapshot.event = { id: eventId, created_by: actor.id, revision: 0, join_code: 'PICK2026' };
    Object.assign(snapshot.event, plan.effects.event, { revision: Number(snapshot.event.revision) + 1 });
    for (const table of ['teams', 'team_members', 'tournament_players', 'stages', 'rounds', 'matches'] as const) for (const patch of plan.effects[table] ?? []) { const prior = snapshot[table].find(row => row.id === patch.id); if (prior) Object.assign(prior, patch); else snapshot[table].push(patch); }
    if (plan.effects.definition) { const prior = snapshot.definitions.find(row => row.id === plan.effects.definition!.id); if (prior) Object.assign(prior, plan.effects.definition); else snapshot.definitions.push(plan.effects.definition); }
    snapshot.team_members.forEach((member,index) => { member.display_name = ['Alicia Player', 'Ben Partner', 'Carla Player', 'Diego Partner'][index] ?? 'Registered Player'; });
    return plan;
  }
  apply('createDraft', { definition });
  const preview = previewDefinition(definition, 1);
  apply('publishTournament', { reviewed_definition_hash: preview.definitionHash, acknowledged_warning_codes: preview.warningCodes });
  apply('addRegisteredEntry', { definition_id: snapshot.event!.definition_id, player_ids: [randomUUID(), randomUUID()], entry_name: 'Sunset Pair', reason: 'Synthetic browser fixture' });
  const playerId = String(snapshot.team_members[0].user_id);
  const commands: string[] = [];
  const bundle = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AppRouterContext} from 'next/dist/shared/lib/app-router-context.shared-runtime';
    import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
    import {TournamentBuilder} from './components/tournament-builder/builder';
    import {Navbar} from './components/layout/navbar'; import {ToastProvider} from './components/ui/toast';
    const d=window.fixture;const router={push:url=>location.assign(url),replace:url=>location.replace(url),refresh:()=>location.reload(),prefetch:()=>{},back:()=>history.back(),forward:()=>history.forward()};
    createRoot(document.getElementById('root')).render(<AppRouterContext.Provider value={router}><PathnameContext.Provider value={location.pathname}><ToastProvider><Navbar profile={null}/><TournamentBuilder actorId={d.actorId} initialSnapshot={d.snapshot} initialPreview={d.preview} view={d.view}/></ToastProvider></PathnameContext.Provider></AppRouterContext.Provider>);
  `, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_APP_URL': '"https://app.picktennt.com"' }, banner: { js: 'var process={env:{NODE_ENV:"production"}};' }, logLevel: 'silent' });
  const css = (await postcss([tailwind()]).process(readFileSync('app/globals.css', 'utf8'), { from: resolve('app/globals.css') })).css;
  const current = () => ({ snapshot, preview: previewDefinition(definition, Number(snapshot.event!.revision)) });
  const server = createServer(async (request,response) => {
    try {
      const url = new URL(request.url!, 'http://localhost');
      if (url.pathname === '/fixture.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles[0].contents); return; }
      if (url.pathname === '/images/logo.png' || url.pathname === '/_next/image') { response.setHeader('Content-Type','image/png'); response.end(readFileSync('public/images/logo.png')); return; }
      if (request.method === 'POST') {
        const chunks: Buffer[]=[];for await(const chunk of request) chunks.push(Buffer.from(chunk));
        const envelope=JSON.parse(Buffer.concat(chunks).toString());
        assert.equal(envelope.expected_revision,snapshot.event!.revision);
        const command=url.searchParams.get('command')!;
        const plan=apply(command,envelope.data);commands.push(command);
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify({operation_id:envelope.operation_id,tournament_id:eventId,revision:snapshot.event!.revision,status:'applied',data:plan.result}));return;
      }
      if (url.pathname.startsWith('/api/')) { response.setHeader('Content-Type','application/json');response.end(JSON.stringify(current()));return; }
      const view=url.pathname.endsWith('/matches')?'matches':url.pathname.endsWith('/admin')?'admin':url.pathname.endsWith('/leaderboard')?'standings':'overview';
      const data={...current(),actorId:url.searchParams.has('player')?playerId:actor.id,view,snapshot:{...snapshot,caller_role:url.searchParams.has('player')?'player':'owner'}};
      response.setHeader('Content-Type','text/html');response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify(data).replaceAll('<','\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
    } catch(error) {response.statusCode=400;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({code:'INVALID_REQUEST',message:String(error)}));}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}/tournaments/${eventId}`;
  const browser=await chromium.launch({headless:true,...(existsSync(chromium.executablePath())?{}:{channel:'chrome'})});
  mkdirSync('docs/evidence',{recursive:true});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>Object.defineProperty(navigator,'share',{value:undefined,configurable:true}));
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      for(const suffix of ['', '/matches','/leaderboard','/admin']) {
        await page.goto(base+suffix);await page.getByRole('heading',{name:'Four groups of four',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No overflow ${suffix} at ${width}`);
        if(suffix==='/matches') {await page.getByText('Planned tournament · registration draft').waitFor();await page.getByText('Alicia Player & Ben Partner',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Save & Validate'}).count(),0);}
        if(suffix==='/admin') {await page.getByText('Register existing Picktennt players',{exact:true}).waitFor();await page.getByText('Edit tournament setup and teams',{exact:true}).click();assert.ok(await page.getByRole('option',{name:'Alicia Player',exact:true}).count());}
        if(!suffix) {await page.getByRole('button',{name:'Share Tournament · Code PICK2026'}).click();await page.getByText('https://app.picktennt.com/join/PICK2026',{exact:true}).waitFor();await page.keyboard.press('Escape');}
        await page.screenshot({path:`docs/evidence/native-tournament-${suffix.slice(1)||'overview'}-${width}.png`,fullPage:true});
      }
    }
    await page.goto(base+'/matches?player=1');await page.getByText('Sunset Pair · Your entry',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Admin',exact:true}).count(),0);
    await page.goto(base+'/admin');await page.getByRole('button',{name:'Close registration',exact:true}).click();await page.getByText('registration closed',{exact:true}).waitFor();
    assert.deepEqual(commands,['closeRegistration']);assert.equal(snapshot.matches.length,0);assert.deepEqual(errors,[]);
    console.log('PASS: eight hydrated desktop/mobile views, canonical share link, real player names, admin edits, player permissions and close-registration command with zero fixtures. Synthetic fixture; no production writes.');
  } finally {await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
