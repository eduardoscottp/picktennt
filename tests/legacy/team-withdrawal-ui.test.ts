import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamWithdrawalConfirmation } from '../../components/tournament/team-withdrawal-dialog';
import { TeamWithdrawal } from '../../components/tournament-builder/team-withdrawal';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';

test('team withdrawal confirmation names players and cannot commit before explicit acknowledgment', () => {
  let calls = 0;
  const html = renderToStaticMarkup(createElement(TeamWithdrawalConfirmation, { teamName: 'Ana / Luis', busy: false, onConfirm() { calls++; }, onCancel() {} }));
  assert.match(html, /Ana \/ Luis/);
  assert.match(html, /pasados y futuros/);
  assert.match(html, /0–11/);
  assert.match(html, /11–0/);
  assert.match(html, /Se reemplazarán los marcadores/);
  assert.match(html, /no permite deshacer/);
  assert.match(html, /no se enviarán a DUPR/);
  assert.match(html, /<input type="checkbox"/);
  const confirm = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].find(button => button[2].includes('Confirmar retiro 0–11'));
  assert.ok(confirm); assert.match(confirm[1], /disabled/); assert.equal(calls, 0);
});

test('modular team withdrawal starts without a selected team or an apply button', () => {
  let calls = 0;
  const snapshot: CommandSnapshot = { event: { id: 'event', revision: 2 }, teams: [{ id: 'a', entry_state: 'approved' }, { id: 'b', entry_state: 'withdrawn' }], definitions: [], team_members: [], tournament_players: [], stages: [], rounds: [], matches: [], standings: [] };
  const html = renderToStaticMarkup(createElement(TeamWithdrawal, { snapshot, disabled: false, label: id => id === 'a' ? 'Ana / Luis' : 'Other', run: async () => { calls++; } }));
  assert.match(html, /Equipo a retirar/); assert.match(html, /Ana \/ Luis/);
  assert.doesNotMatch(html, /<option value="b"/);
  assert.doesNotMatch(html, /Confirmar retiro 0–11|walkover|Retirement/);
  assert.equal(calls, 0);
});
