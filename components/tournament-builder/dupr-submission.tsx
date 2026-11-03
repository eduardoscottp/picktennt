"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AdminUploadDupr } from "@/components/tournament/admin-upload-dupr";
import type { StorageRow } from "@/lib/tournament-builder/commands";

export function DuprSubmission({ tournamentId, revision, matches, underReview, disabled, label, run }: {
  tournamentId: string; revision: number; matches: StorageRow[]; underReview: boolean; disabled: boolean;
  label: (id: unknown) => string; run: (command: string, data: Record<string, unknown>) => Promise<void>;
}) {
  const eligible = matches.filter(match => match.is_current === true && !match.voided_at && !match.excluded_at && match.status === "validated" && match.outcome_kind === "played");
  return <div className="space-y-4"><Card><CardHeader><CardTitle>DUPR submission</CardTitle></CardHeader><CardContent className="space-y-3">
    {underReview ? <p className="text-sm text-amber-800">Resolve results under review before selecting or submitting matches to DUPR.</p> : <>
      <p className="text-sm text-gray-600">Select validated, played matches to include. Then review the players, DUPR profiles and scores before confirming the upload.</p>
      {eligible.length === 0 && <p className="text-sm text-gray-500">No eligible played matches.</p>}
      <fieldset disabled={disabled} className="space-y-2 disabled:opacity-60">{eligible.map(match => <label key={match.id} className="flex items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={match.submit_to_dupr === true} onChange={event => void run("setDuprSubmission", { match_id: match.id, enabled: event.target.checked })} /><span>{label(match.team_a_id)} vs {label(match.team_b_id)} · {String(match.score_a)}–{String(match.score_b)}</span></label>)}</fieldset>
    </>}
  </CardContent></Card>{!underReview && eligible.some(match => match.submit_to_dupr === true) && <AdminUploadDupr key={revision} tournamentId={tournamentId} />}</div>;
}
