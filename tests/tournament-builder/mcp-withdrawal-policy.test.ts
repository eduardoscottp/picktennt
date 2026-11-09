import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_TOOLS, callAdminTool } from '../../lib/tournament-builder/mcp-admin';
import { MCP_INSTRUCTIONS } from '../../lib/tournament-builder/mcp-security';

test('MCP exposes manual result review and prestart roster changes, but no automatic withdrawals', async () => {
  for (const name of ['admin_preview_withdrawal', 'admin_withdraw_entry', 'admin_preview_player_withdrawal', 'admin_withdraw_player']) {
    assert.ok(!ADMIN_TOOLS.some(tool => tool.name === name));
    let called = false;
    const unexpected = async () => { called = true; return {}; };
    await assert.rejects(callAdminTool(name, { tournament_id: '11111111-1111-4111-8111-111111111111', data: {}, confirmed_structure_change: true }, { snapshot: unexpected, findPlayer: unexpected, previewCorrection: unexpected, previewWithdrawal: unexpected, previewPlayerWithdrawal: unexpected }, unexpected), { code: 'INVALID_REQUEST' });
    assert.equal(called, false);
  }
  for (const name of ['admin_preview_bulk_adjudication', 'admin_commit_bulk_adjudication', 'admin_preview_correction', 'admin_preview_revision', 'admin_revise_tournament']) assert.ok(ADMIN_TOOLS.some(tool => tool.name === name));
  assert.match(MCP_INSTRUCTIONS, /propose explicit manual administrative scores/);
  assert.match(MCP_INSTRUCTIONS, /never submit administrative forfeit scores to DUPR/);
  assert.match(MCP_INSTRUCTIONS, /Before play, teams can be removed or replaced/);
});
