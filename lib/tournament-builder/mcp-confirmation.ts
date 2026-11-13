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
  if (name === 'admin_preview_player_replacement' && (count(source.unknown_history_match_ids) || count(source.blocked_future_match_ids))) return undefined;
  if (name === 'admin_preview_player_replacement' || name === 'admin_replace_player') return `Replace this player on the same team, keeping past results and using the replacement in future games?`;
  if (name === 'admin_preview_player_withdrawal' && (count(source.live_match_ids) || count(source.unknown_history_match_ids) || count(source.inconsistent_pending_match_ids))) return undefined;
  if (name === 'admin_preview_player_withdrawal' || name === 'admin_withdraw_player') return 'Withdraw this player, keep the team and historical results, and leave the position vacant?';
  if (name === 'admin_preview_force_pending_match' || name === 'admin_force_pending_match') return 'Replace the teams in this pending match and disconnect the reviewed feeder routes while preserving completed results?';
  if (name === 'admin_preview_replay_terminal_match' || name === 'admin_replay_terminal_match') return 'Invalidate this match, keep its prior players and score in the history, and create the reviewed replay?';
  if (name === 'admin_preview_append_terminal_match' || name === 'admin_append_terminal_match') return 'Add the reviewed placement match, preserve all completed games and recalculate final placements after it is played?';
  if (name === 'admin_preview_schedule' || name === 'admin_lock_roster') return `Close player positions and generate the reviewed schedule${count(source.fixtures) ? ` of ${count(source.fixtures)} games` : ''}?`;
  if (name === 'admin_preview_next_stage') {
    const automatic = Array.isArray(source.fixtures) && source.fixtures.some(fixture => {
      const item = record(fixture);
      return ['walkover', 'no_contest'].includes(String(item.automatic_outcome)) || (item.match_id === null && ['walkover', 'no_contest'].includes(String(item.outcome_kind)));
    });
    return source.state === 'ready' ? `Generate the reviewed next stage${count(source.fixtures) ? ` of ${count(source.fixtures)} games` : ''}${automatic ? ', including the automatic walkovers or no-contests shown' : ''}?${source.no_eligible_champion === true ? ' No eligible champion will be determined; final placements will remain blocked for review.' : ''}` : undefined;
  }
  if (name === 'admin_generate_next_stage') return 'Generate the reviewed next stage and its dependent games?';
  if (name === 'admin_preview_correction') return source.requires_reopen === true ? 'The owner must reopen completed results before this correction. Review the affected games first?' : 'After reviewing the affected games, which available resolution should be used?';
  if (name === 'admin_commit_correction') return record(args.data).resolution === 'void_and_replay' ? 'Correct this result and invalidate the reviewed dependent games for replay?' : 'Apply the reviewed correction and its stated effects on dependent games?';
  if (name === 'admin_preview_bulk_adjudication') return `Apply administrative results to ${count(source.selected_matches)} selected games${count(source.archived_matches) ? ` and archive ${count(source.archived_matches)} dependent games for regeneration` : ''}?${source.dupr_history_unknown === true ? ' Previously submitted DUPR results may require separate review.' : ''}`;
  if (name === 'admin_commit_bulk_adjudication') return 'Apply the reviewed administrative results and any specified schedule regeneration?';
  if (name === 'admin_preview_withdrawal' && source.round_robin_results_excluded === true) return 'Withdraw this entry and exclude its round-robin results from the standings while keeping the match history?';
  if (name === 'admin_preview_withdrawal' || name === 'admin_withdraw_entry') return 'Withdraw this entry and apply the reviewed effects on games, standings and qualification?';
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
    admin_fill_position: 'Enroll the selected Picktennt account in the selected open tournament position?',
  };
  return questions[name];
}
