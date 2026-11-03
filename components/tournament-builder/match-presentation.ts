import type { CommandSnapshot, StorageRow } from "@/lib/tournament-builder/commands";
import { isLegalScore } from "@/lib/tournament-builder/policies";
import { graphNodeLabel, graphSourceLabel } from "./graph-review";
import { generateRoundRobin } from "@/lib/tournament-builder/modules/round-robin";
import { resolvedDefinition } from "@/lib/tournament-builder/resolved-definition";

type MatchSchedule = Pick<CommandSnapshot, "rounds" | "matches"> & Partial<Pick<CommandSnapshot, "stages" | "definitions" | "event">>;
function graphMatch(match: StorageRow, schedule: MatchSchedule) {
  const definition = resolvedDefinition({ event: schedule.event ?? null, definitions: schedule.definitions ?? [], stages: schedule.stages ?? [] })?.definition as Record<string, unknown> | undefined;
  if (definition?.schema_version !== "2.0") return;
  const nodeId = schedule.stages?.find((stage) => stage.id === match.stage_id)?.node_id ?? String(match.logical_key ?? "").split(":")[0];
  const node = (definition.nodes as Record<string, unknown>[]).find((node) => node.id === nodeId);
  return node ? { definition, node } : undefined;
}
export function matchEditorKey(match: StorageRow) {
  return [match.id, match.revision, match.result_revision, match.status, match.score_a, match.score_b, match.court_number, match.started_at, match.outcome_kind, match.winner_team_id].join(":");
}
export function matchTitle(match: StorageRow, schedule: MatchSchedule): string {
  const round = schedule.rounds.find((row) => row.id === match.round_id);
  const graph = graphMatch(match, schedule);
  if (graph) {
    if (["round_robin@2", "cross_play@1"].includes(String(graph.node.module))) return `${graphNodeLabel(String(graph.node.id), graph.definition)} · Round ${/:r(\d+):m\d+$/.exec(String(match.logical_key))?.[1] ?? String(round?.round_number ?? "—")}`;
    const placements = (graph.definition.nodes as Record<string, unknown>[]).find((node) => node.module === "placements@2");
    return placements?.final === graph.node.id ? `Final · ${String(graph.node.id)}` : placements?.bronze === graph.node.id ? `Third-place match · ${String(graph.node.id)}` : `Match ${String(graph.node.id)}`;
  }
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
  const graph = graphMatch(match, schedule);
  if (graph?.node.module === "match@1" && Array.isArray(graph.node.inputs)) return graphSourceLabel(graph.node.inputs[side === "a" ? 0 : 1], graph.definition);
  if (graph?.node.module === "round_robin@2" && Array.isArray(graph.node.inputs)) {
    const inputs = graph.node.inputs;
    const fixture = generateRoundRobin(inputs.map((_, index) => ({ id: String(index), playerIds: [String(index)] })), 1, String(graph.node.id)).find((fixture) => fixture.id === match.logical_key);
    const slot = fixture?.[side];
    if (slot?.kind === "entry") return graphSourceLabel(inputs[Number(slot.entryId)], graph.definition);
  }
  if (graph?.node.module === "cross_play@1" && Array.isArray(graph.node.side_a) && Array.isArray(graph.node.side_b)) {
    const sideA = graph.node.side_a, sideB = graph.node.side_b;
    const pairs = sideA.flatMap((_, a) => sideB.map((__, b) => ({ a, b, round: (a + b) % Math.max(sideA.length, sideB.length) + 1 }))).sort((a, b) => a.round - b.round || a.a - b.a);
    const matchNumber = Number(/:m(\d+)$/.exec(String(match.logical_key))?.[1] ?? 0);
    const roundNumber = Number(/:r(\d+):/.exec(String(match.logical_key))?.[1] ?? 0);
    const pair = pairs.filter(item => item.round === roundNumber)[matchNumber - 1];
    if (pair) return graphSourceLabel(side === "a" ? sideA[pair.a] : sideB[pair.b], graph.definition);
  }
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
