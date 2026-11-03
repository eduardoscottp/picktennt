"use client";
import { Button } from "@/components/ui/button";
import { RANKING_KEYS, type RankingKey } from "@/lib/tournament-builder/definition";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rankingLabels: Record<RankingKey, string> = { wins_desc: "Wins (most first)", differential_desc: "Point differential (highest first)",
  points_for_desc: "Points scored (most first)", points_against_asc: "Fewest points conceded", points_for_in_losses_desc: "Points scored in losses (most first)" };
export const rankingChoices = RANKING_KEYS.map((key) => ({ key, label: rankingLabels[key] }));
type PolicyChoice = { kind: "ranking"; order: RankingKey[] } | { kind: "confirmation" } | { kind: "correction" };
export function applyDraftPolicyChoice(definition: Record<string, unknown>, choice: PolicyChoice): Record<string, unknown> {
  const policies = object(definition.policies);
  const value = choice.kind === "ranking"
    ? { ...object(policies.ranking), version: 1, order: [...choice.order], final_tie: "recorded_draw" }
    : choice.kind === "confirmation" ? "opponent_or_admin_v1" : "impact_review_void_and_replay_v1";
  return { ...definition, policies: { ...policies, [choice.kind]: value } };
}

export function DraftPolicyEditor({ definition, disabled, onChange }: { definition: Record<string, unknown>; disabled: boolean; onChange: (definition: Record<string, unknown>) => void }) {
  const policies = object(definition.policies), ranking = object(policies.ranking);
  const rawOrder = Array.isArray(ranking.order) ? ranking.order : [];
  const validOrder = rawOrder.length > 0 && rawOrder[0] === "wins_desc" && new Set(rawOrder).size === rawOrder.length
    && rawOrder.every((key) => rankingChoices.some((choice) => choice.key === key));
  const order = validOrder ? rawOrder as RankingKey[] : [];
  function choose(choice: PolicyChoice) { onChange(applyDraftPolicyChoice(definition, choice)); }
  function move(index: number, direction: -1 | 1) {
    const changed = [...order];
    [changed[index], changed[index + direction]] = [changed[index + direction], changed[index]];
    choose({ kind: "ranking", order: changed });
  }
  const selectClass = "mt-1 block w-full rounded-xl border border-gray-200 bg-white p-3 text-sm";
  return <fieldset disabled={disabled} className="space-y-5 rounded-xl border bg-gray-50 p-4 disabled:opacity-60"><legend className="px-1 text-sm font-semibold">Ranking and result policies</legend>
    <div className="space-y-3"><h3 className="text-sm font-semibold">Ranking order</h3><p className="text-sm text-gray-600">Wins must be first. Choose optional tie breakers in the order they should apply. Any remaining exact tie uses a recorded draw.</p>
      {!validOrder ? <><p className="text-sm text-amber-800">{rawOrder.length ? "This ranking order needs supported, unique criteria with wins first." : "No ranking order has been chosen."}</p><Button size="sm" variant="outline" onClick={() => choose({ kind: "ranking", order: ["wins_desc"] })}>Start ranking with wins</Button></>
        : <><ol className="space-y-2">{order.map((key, index) => { const label = rankingChoices.find((choice) => choice.key === key)!.label; return <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-3"><span className="text-sm">{index + 1}. {label}</span>{index > 0 && <div className="flex gap-2"><Button size="sm" variant="outline" aria-label={`Move ${label} up`} disabled={disabled || index === 1} onClick={() => move(index, -1)}>Up</Button><Button size="sm" variant="outline" aria-label={`Move ${label} down`} disabled={disabled || index === order.length - 1} onClick={() => move(index, 1)}>Down</Button><Button size="sm" variant="outline" aria-label={`Remove ${label}`} onClick={() => choose({ kind: "ranking", order: order.filter((item) => item !== key) })}>Remove</Button></div>}</li>; })}</ol>
          {order.length < rankingChoices.length && <label className="block text-sm font-medium">Add a tie breaker<select className={selectClass} value="" onChange={(event) => { const key = rankingChoices.find((choice) => choice.key === event.target.value)?.key; if (key && !order.includes(key)) choose({ kind: "ranking", order: [...order, key] }); }}><option value="">Choose a ranking criterion</option>{rankingChoices.filter((choice) => !order.includes(choice.key)).map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select></label>}</>}
    </div>
    <label className="block text-sm font-medium">Score confirmation<select className={selectClass} value={policies.confirmation === "opponent_or_admin_v1" ? policies.confirmation : ""} onChange={() => choose({ kind: "confirmation" })}><option value="" disabled>Choose a confirmation policy</option><option value="opponent_or_admin_v1">Opponent confirms or administrator decides</option></select><span className="mt-2 block font-normal text-gray-600">A provisional score counts after the opposing entry confirms it or an administrator records a reasoned decision. This is the supported confirmation policy.</span></label>
    <label className="block text-sm font-medium">Result corrections<select className={selectClass} value={policies.correction === "impact_review_void_and_replay_v1" ? policies.correction : ""} onChange={() => choose({ kind: "correction" })}><option value="" disabled>Choose a correction policy</option><option value="impact_review_void_and_replay_v1">Review impact, then explicitly void and replay affected matches</option></select><span className="mt-2 block font-normal text-gray-600">Review affected matches before changing an accepted result. Started dependent matches require an explicit void and replay decision; history is retained. Completed results require the owner to reopen review first. This is the supported correction policy.</span></label>
    <p className="text-xs text-gray-500">Selections are draft edits. Save changes below, then review the updated rules before approving publication.</p>
  </fieldset>;
}
