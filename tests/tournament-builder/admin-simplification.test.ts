import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandSnapshot } from '../../lib/tournament-builder/commands';
import { generationProblems } from '../../lib/tournament-builder/generation-readiness';
import { tournamentTeamLabel } from '../../lib/tournament-builder/team-label';

const snapshot = (): CommandSnapshot => ({
  event: { id: 'event', definition_id: 'definition' }, definitions: [], stages: [], rounds: [], matches: [], standings: [], tournament_players: [],
  teams: [{ id: 'a', name: 'Team 1', registration_slot: 1, entry_state: 'approved' }, { id: 'b', name: 'Team 2', registration_slot: 2, entry_state: 'approved' }],
  team_members: [
    { id: 'a1', team_id: 'a', user_id: 'a1', membership_status: 'active', player_slot: 1, display_name: 'Eduardo Scott', consented_at: 'now', consented_definition_id: 'definition' },
    { id: 'a2', team_id: 'a', user_id: 'a2', membership_status: 'active', player_slot: 2, display_name: 'Ana Ravelo', consented_at: 'now', consented_definition_id: 'definition' },
    { id: 'b1', team_id: 'b', user_id: 'b1', membership_status: 'active', player_slot: 1, display_name: 'Sam Smith', consented_at: 'now', consented_definition_id: 'definition' },
    { id: 'b2', team_id: 'b', user_id: 'b2', membership_status: 'active', player_slot: 2, display_name: 'Lee Jones', consented_at: 'now', consented_definition_id: 'definition' },
  ],
});

test('team names follow positions, singles retain full names, and custom and empty names remain stable', () => {
  const s = snapshot();
  assert.equal(tournamentTeamLabel(s, s.teams[0], true, 1), 'Eduardo / Ana');
  assert.equal(tournamentTeamLabel(s, s.teams[0], false, 1), 'Eduardo Scott');
  s.team_members[1].membership_status = 'cancelled';
  assert.equal(tournamentTeamLabel(s, s.teams[0], true, 1), 'Eduardo');
  s.team_members[0].membership_status = 'cancelled';
  assert.equal(tournamentTeamLabel(s, s.teams[0], true, 1), 'Team 1');
  s.teams[0].name = 'The Aces';
  assert.equal(tournamentTeamLabel(s, s.teams[0], true, 1), 'The Aces');
});

test('generation readiness reports incomplete teams and accepts valid administrator enrollment', () => {
  const s = snapshot();
  assert.deepEqual(generationProblems(s, true, 2, 'definition'), []);
  s.team_members[1].membership_status = 'cancelled';
  assert.match(generationProblems(s, true, 2, 'definition').join(' '), /1 team is incomplete/);
  s.team_members[1].membership_status = 'active';
  s.team_members[1].consented_at = null;
  s.team_members[1].admission_source = 'administrator';
  s.teams[0].admin_definition_id = 'definition'; s.teams[0].registered_by = 'admin';
  assert.deepEqual(generationProblems(s, true, 2, 'definition'), []);
  s.teams[1].entry_state = 'pending';
  assert.match(generationProblems(s, true, 2, 'definition').join(' '), /At least 2/);
});
