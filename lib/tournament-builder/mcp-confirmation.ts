const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;

/** Only fixed vocabulary and validated numbers enter user-facing confirmation text. */
export function confirmationQuestion(name: string, value: unknown, args: Record<string, unknown> = {}): string | undefined {
  const source = record(value);
  if (name === 'preview_tournament') {
    const definition = record(source.definition), registration = record(definition.registration), event = record(definition.event);
    const format = registration.entry_type === 'fixed_doubles' ? 'Doubles' : registration.entry_type === 'singles' ? 'Singles' : 'the selected format';
    const capacity = Number(registration.max_entries);
    const date = typeof event.starts_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(event.starts_at) ? event.starts_at.slice(0, 10) : 'the date still to be decided';
    return `Create this ${format} tournament${Number.isInteger(capacity) && capacity > 0 && capacity <= 16 ? ` for up to ${capacity} ${format === 'Doubles' ? 'teams' : 'players'}` : ''} on ${date}, with individual registration opening after publication?`;
  }
  if (name === 'owner_preview_action') return confirmationQuestion(String(args.action), source, args);
  if (name === 'admin_preview_revision' || name === 'admin_revise_tournament') return `Apply these tournament changes, close registration and replace the affected schedule while preserving prior history?`;
  if (name === 'admin_preview_schedule' || name === 'admin_lock_roster') return `Close player positions and generate the reviewed schedule${count(source.fixtures) ? ` of ${count(source.fixtures)} games` : ''}?`;
  if (name === 'admin_preview_correction' || name === 'admin_commit_correction') return `Correct this result and review ${count(source.affected_match_ids)} affected games, including any required replays?`;
  if (name === 'admin_preview_withdrawal' || name === 'admin_withdraw_entry') return `Withdraw this entry and update its affected games and qualification while preserving completed results?`;
  const questions: Record<string, string> = {
    publishTournament: 'Publish this tournament with the reviewed rules and open individual registration?',
    cancelTournament: 'Cancel this tournament and stop its unfinished games while preserving its history?',
    reopenResults: 'Reopen these results for review and withhold final placements until the review is complete?',
    addAdministrator: 'Give this selected account tournament administration access?',
    removeAdministrator: 'Remove tournament administration access from this selected account?',
    admin_close_registration: 'Close registration so no more players can join?',
    admin_reopen_registration: 'Reopen registration so players can join before its deadline?',
    admin_start_tournament: 'Start this tournament using the reviewed schedule?',
    admin_resolve_tie: 'Apply the reviewed draw to decide the tied qualification and seed positions?',
    admin_remove_registered_player: record(args.data).release_only === true ? 'Free this player’s position while keeping them registered in the tournament?' : 'Remove this player from the tournament and free their position while keeping their teammate registered?',
  };
  return questions[name];
}
