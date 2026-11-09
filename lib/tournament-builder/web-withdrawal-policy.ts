import type { CommandSnapshot } from './commands';
import { DomainError } from './requests';

/** Historical planners remain available for audit replay, not the removed web actions. */
export function assertWebWithdrawalPolicy(command: string, data: Record<string, unknown>, snapshot?: CommandSnapshot): void {
  if (['attestScore', 'adjudicateDispute', 'commitCorrection'].includes(command) && ['walkover', 'retirement'].includes(String(data.outcome_kind))) {
    throw new DomainError('INVALID_COMMAND', 'Use Retirar equipo in Admin to review and confirm team withdrawal.');
  }
  if (!['withdrawEntry', 'withdrawPlayer'].includes(command)) return;
  const started = ['active', 'completed'].includes(String(snapshot?.event?.modular_state)) || snapshot?.matches.some(match => match.is_current !== false && !match.voided_at && (match.started_at || match.status !== 'scheduled' || match.outcome_kind || match.score_a != null || match.score_b != null));
  if (started && (command === 'withdrawPlayer' || data.policy !== 'all_matches_0_11')) {
    throw new DomainError('INVALID_COMMAND', 'After play begins, use Retirar equipo in Admin to confirm all past and future games as 0–11 losses.');
  }
}
