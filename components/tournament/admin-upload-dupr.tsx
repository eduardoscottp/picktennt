"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { AlertCircle, AlertTriangle, CheckCircle2, Upload } from "lucide-react";

interface MissingPlayer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface NotInClubPlayer extends MissingPlayer {
  duprId: string;
}

interface PreviewMatch {
  matchId: string;
  teamALabel: string;
  teamBLabel: string;
  scoreA: number;
  scoreB: number;
  isTie: boolean;
}

interface PreflightResponse {
  ok: boolean;
  validatedMatchCount: number;
  totalPlayers: number;
  missing: MissingPlayer[];
  notInClub: NotInClubPlayer[];
  clubLookupError: string | null;
  preview: PreviewMatch[];
}

interface FailedMatch {
  matchId: string;
  teamALabel: string;
  teamBLabel: string;
  scoreA: number;
  scoreB: number;
  status: number;
  reason: string;
  rawMessage: string | null;
}

interface UploadResponse {
  ok: boolean;
  reason?: string;
  missing?: MissingPlayer[];
  submittedCount?: number;
  failedCount?: number;
  failed?: FailedMatch[];
  error?: string;
}

export function AdminUploadDupr({ tournamentId }: { tournamentId: string }) {
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [loadingPreflight, setLoadingPreflight] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const { toast } = useToast();

  async function fetchPreflight() {
    const res = await fetch(`/api/tournaments/${tournamentId}/upload-dupr/preflight`);
    return (await res.json()) as PreflightResponse;
  }

  async function loadPreflight(options?: { showLoading?: boolean }) {
    if (options?.showLoading ?? true) setLoadingPreflight(true);
    try {
      setPreflight(await fetchPreflight());
    } catch (err: any) {
      toast(err.message ?? "Preflight failed", "error");
    } finally {
      setLoadingPreflight(false);
    }
  }

  const loadPreflightEffect = useEffectEvent(async () => {
    setLoadingPreflight(true);
    try {
      setPreflight(await fetchPreflight());
    } catch (err: any) {
      toast(err.message ?? "Preflight failed", "error");
    } finally {
      setLoadingPreflight(false);
    }
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadPreflightEffect();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [tournamentId]);

  async function upload() {
    setUploading(true);
    setResult(null);
    setConfirmOpen(false);
    setConfirmText("");
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/upload-dupr`, { method: "POST" });
      const body = (await res.json()) as UploadResponse;
      setResult(body);
      if (body.ok) {
        toast(`Uploaded ${body.submittedCount} match(es) to DUPR`, "success");
      } else if (body.reason === "missing_dupr_ids") {
        toast("Cannot upload — some players missing DUPR ID", "error");
        await loadPreflight();
      } else if (body.failedCount && body.failedCount > 0) {
        toast(`${body.failedCount} match(es) failed to upload`, "error");
      } else {
        toast(body.error ?? "Upload failed", "error");
      }
    } catch (err: any) {
      toast(err.message ?? "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  function openConfirm() {
    setConfirmText("");
    setConfirmOpen(true);
  }

  const tieCount = preflight?.preview?.filter((p) => p.isTie).length ?? 0;
  const confirmReady = confirmText.trim().toUpperCase() === "UPLOAD";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4 text-brand-500" />
          DUPR Upload
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadingPreflight && (
          <p className="text-sm text-gray-400">Checking player DUPR IDs…</p>
        )}

        {!loadingPreflight && preflight && (
          <>
            <p className="text-xs text-gray-500">
              {preflight.validatedMatchCount} validated match(es) · {preflight.totalPlayers} player(s)
            </p>

            {preflight.missing.length > 0 ? (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2 text-xs text-red-800">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span className="font-semibold">
                    Cannot upload — {preflight.missing.length} player(s) missing DUPR ID
                  </span>
                </div>
                <ul className="space-y-1 pl-5">
                  {preflight.missing.map((p) => (
                    <li key={p.id} className="text-xs text-red-700">
                      <span className="font-medium">
                        {(p.first_name ?? "") + " " + (p.last_name ?? "")}
                      </span>
                      <span className="text-red-500"> · {p.email}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-red-600 pl-5">
                  Ask each player to add their DUPR ID in their profile, then refresh.
                </p>
                <Button variant="outline" size="sm" onClick={() => { void loadPreflight(); }} className="w-full">
                  Refresh
                </Button>
              </div>
            ) : preflight.notInClub.length > 0 ? (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2 text-xs text-red-800">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span className="font-semibold">
                    Cannot upload — {preflight.notInClub.length} player(s) not in DUPR club
                  </span>
                </div>
                <ul className="space-y-1 pl-5">
                  {preflight.notInClub.map((p) => (
                    <li key={p.id} className="text-xs text-red-700">
                      <span className="font-medium">
                        {(p.first_name ?? "") + " " + (p.last_name ?? "")}
                      </span>
                      <span className="text-red-500"> · DUPR {p.duprId}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-red-600 pl-5">
                  Add these players to the DUPR club, or correct their DUPR ID in profile.
                </p>
                <Button variant="outline" size="sm" onClick={() => { void loadPreflight(); }} className="w-full">
                  Refresh
                </Button>
              </div>
            ) : preflight.clubLookupError ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{preflight.clubLookupError}</span>
              </div>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2.5 flex items-start gap-2 text-xs text-green-800">
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  All {preflight.totalPlayers} player(s) have a DUPR ID. Ready to upload.
                </span>
              </div>
            )}

            <Button
              onClick={openConfirm}
              loading={uploading}
              disabled={!preflight.ok || preflight.validatedMatchCount === 0}
              className="w-full"
            >
              Review &amp; Upload to DUPR
            </Button>
          </>
        )}

        {result && (result.submittedCount ?? 0) > 0 && (result.failed?.length ?? 0) === 0 && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2.5 text-xs text-green-800 flex items-start gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>All {result.submittedCount} match(es) uploaded to DUPR.</span>
          </div>
        )}

        {result && result.failed && result.failed.length > 0 && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-3 space-y-3">
            <div className="flex items-start gap-2 text-xs text-red-800">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span className="font-semibold">
                {result.failed.length} match(es) failed{(result.submittedCount ?? 0) > 0 ? ` · ${result.submittedCount} succeeded` : ""}
              </span>
            </div>
            <ul className="space-y-2">
              {result.failed.map((f) => (
                <li key={f.matchId} className="rounded-lg bg-white border border-red-100 p-2.5 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-900">
                      {f.teamALabel} <span className="text-gray-400">vs</span> {f.teamBLabel}
                    </div>
                    <div className="font-mono text-xs font-bold text-gray-700">
                      {f.scoreA}–{f.scoreB}
                    </div>
                  </div>
                  <div className="text-[11px] text-red-700">{f.reason}</div>
                  {f.rawMessage && f.rawMessage !== f.reason && (
                    <div className="text-[10px] text-red-400 font-mono break-all">DUPR: {f.rawMessage}</div>
                  )}
                </li>
              ))}
            </ul>
            <a
              href={`/tournaments/${tournamentId}/matches`}
              className="block text-center text-xs font-semibold text-brand-600 hover:underline"
            >
              Edit match scores →
            </a>
            <Button variant="outline" size="sm" onClick={upload} loading={uploading} className="w-full">
              Retry upload
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirm DUPR upload
            </DialogTitle>
            <DialogDescription>
              This action is <span className="font-bold text-red-600">FINAL</span>. Matches submitted to DUPR cannot be undone from Picktennt. Player ratings will update based on these results.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs font-semibold text-gray-700">
              {preflight?.preview?.length ?? 0} match(es) will be sent:
            </div>
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {preflight?.preview?.map((m) => (
                <li
                  key={m.matchId}
                  className={`rounded-lg border px-3 py-2 ${m.isTie ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-900">
                      {m.teamALabel} <span className="text-gray-400">vs</span> {m.teamBLabel}
                    </div>
                    <div className="font-mono text-sm font-bold text-gray-700">
                      {m.scoreA}–{m.scoreB}
                    </div>
                  </div>
                  {m.isTie && (
                    <div className="text-[11px] text-red-700 mt-0.5">
                      ⚠ Tie score — DUPR will reject this match.
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {tieCount > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{tieCount} match(es) have tied scores and will fail. Fix them first or expect failures.</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Type <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">UPLOAD</span> to confirm:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="UPLOAD"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                autoFocus
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={upload}
                loading={uploading}
                disabled={!confirmReady}
                className="flex-1"
              >
                Submit to DUPR
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
