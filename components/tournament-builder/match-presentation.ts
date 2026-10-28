import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import { isLegalScore } from "@/lib/tournament-builder/policies";

type MatchSchedule = Pick<CommandSnapshot, "rounds" | "matches">;
export function matchEditorKey(match: StorageRow) {
  return [match.id, match.revision, match.result_revision, match.status, match.score_a, match.score_b, match.court_number, match.started_at, match.outcome_kind, match.winner_team_id].join(":");
}
export function matchTitle(match: StorageRow, schedule: MatchSchedule): string {
  const round = schedule.rounds.find((row) => row.id === match.round_id);
  if (round?.round_type === "finals_bronze") return "Third-place match";
  if (round?.round_type === "round_robin") return `Round robin · Round ${String(round.round_number)}`;
  let current: StorageRow | undefined = match;
  for (let distance = 0; current && distance < 5; distance++) {
    if (schedule.rounds.find((row) => row.id === current?.round_id)?.round_type === "finals_gold") {
      if (distance === 0) return "Final";
      const name = distance === 1 ? "Semifinal" : distance === 2 ? "Quarterfinal" : "Round of 16";
      const peers = schedule.matches.filter((row) => row.round_id === match.round_id && row.is_current !== false && !row.voided_at).sort((a, b) => String(a.logical_key ?? a.id).localeCompare(String(b.logical_key ?? b.id)));
      const position = /:m(\d+)$/.exec(String(match.logical_key))?.[1];
      return `${name} ${position ?? Math.max(1, peers.findIndex((row) => row.id === match.id) + 1)}`;
    }
    current = schedule.matches.find((row) => row.id === current?.bracket_next_winner_match_id);
  }
  return round?.round_type === "elimination" ? `Elimination · Round ${String(round.round_number)}` : "Match";
}
export function unresolvedSideLabel(match: StorageRow, side: "a" | "b", schedule: MatchSchedule) {
  const winner = schedule.matches.find((row) => row.bracket_next_winner_match_id === match.id && row.bracket_winner_fills_side === side && row.is_current !== false && !row.voided_at);
  if (winner) return `Winner of ${matchTitle(winner, schedule)}`;
  const loser = schedule.matches.find((row) => row.bracket_next_loser_match_id === match.id && row.bracket_loser_fills_side === side && row.is_current !== false && !row.voided_at);
  return loser ? `Loser of ${matchTitle(loser, schedule)}` : "Awaiting qualifier";
}
export function administratorDecisionProblem(input: { kind: string; started: boolean; scoreA: string; scoreB: string; winner: string; reason: string; policy?: { target: number; win_by: number } }) {
  if (input.kind === "walkover" && input.started) return "This match has started. Use retirement instead of walkover.";
  const numbers = input.scoreA !== "" && input.scoreB !== "" && Number.isSafeInteger(Number(input.scoreA)) && Number.isSafeInteger(Number(input.scoreB)) && Number(input.scoreA) >= 0 && Number(input.scoreB) >= 0;
  if (input.kind === "played" && (!numbers || (input.policy && !isLegalScore(Number(input.scoreA), Number(input.scoreB), input.policy)))) return input.policy ? `Enter a completed score to ${input.policy.target}, win by ${input.policy.win_by}, following the published rules.` : "Enter both completed scores as nonnegative whole numbers.";
  if (!["played", "no_contest"].includes(input.kind) && !input.winner) return "Choose the winning entry.";
  if (!input.reason.trim()) return "Enter a decision reason to save and validate this result.";
  return "";
}
