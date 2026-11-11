import type { CommandSnapshot } from './commands';

/** Explain common roster problems; the server remains authoritative for generation. */
export function generationProblems(snapshot: CommandSnapshot, doubles: boolean, minimum: number, definitionId: unknown): string[] {
  const teams = snapshot.teams.filter(team => team.entry_state === 'approved');
  const problems: string[] = [];
  if (teams.length < minimum) problems.push(`At least ${minimum} complete teams are required.`);
  const incomplete = teams.filter(team => {
    const roster = snapshot.team_members.filter(member => member.team_id === team.id && member.membership_status === 'active');
    return Boolean(team.guest_definition_id) || (Array.isArray(team.guest_players) && team.guest_players.length > 0) || roster.length !== (doubles ? 2 : 1) || roster.some(member => !(member.consented_at && member.consented_definition_id === definitionId) && !(member.admission_source === 'administrator' && team.admin_definition_id === definitionId && team.registered_by));
  });
  if (incomplete.length) problems.push(`${incomplete.length} team${incomplete.length === 1 ? ' is' : 's are'} incomplete or need${incomplete.length === 1 ? 's' : ''} valid registration.`);
  return problems;
}
