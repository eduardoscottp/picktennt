"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserMinus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  removePlayerSimple,
  removePlayerWithWalkovers,
  deleteAllRoundsAndRemovePlayer,
  processWithdrawal,
  processRetirement,
} from "@/lib/tournament/player-removal";

interface Props {
  tournamentPlayerId: string;
  tournamentId: string;
  playerName: string;
  /** A = no rounds; B = rounds exist, 0 games played; C = 1+ games played */
  path: "A" | "B" | "C";
  /** Path B: is any score recorded anywhere in this tournament? */
  anyTournamentScores: boolean;
  /** Path C: how many games has this player completed */
  gamesPlayed: number;
  /** Path C2: ID of the in-progress match, or null if retiring between games */
  inProgressMatchId: string | null;
}

type DialogStep = "closed" | "path-a" | "path-b" | "path-c-reason" | "path-c-score";

export function RemovePlayerDialog({
  tournamentPlayerId,
  tournamentId,
  playerName,
  path,
  anyTournamentScores,
  gamesPlayed,
  inProgressMatchId,
}: Props) {
  const [step, setStep] = useState<DialogStep>("closed");
  const [loading, setLoading] = useState(false);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const router = useRouter();
  const { toast } = useToast();

  function open() {
    setScoreA("");
    setScoreB("");
    if (path === "A") setStep("path-a");
    else if (path === "B") setStep("path-b");
    else setStep("path-c-reason");
  }

  function close() {
    setStep("closed");
    setLoading(false);
  }

  async function run(action: () => Promise<void>, successMsg: string) {
    setLoading(true);
    try {
      await action();
      toast(successMsg, "success");
      router.refresh();
      close();
    } catch (e: any) {
      toast(e.message ?? "Something went wrong", "error");
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger button */}
      <Button
        size="icon"
        variant="ghost"
        onClick={open}
        className="h-8 w-8 text-red-400"
        title={`Remove ${playerName}`}
      >
        <UserMinus className="h-4 w-4" />
      </Button>

      {/* Modal overlay */}
      {step !== "closed" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">

            {/* Path A */}
            {step === "path-a" && (
              <>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  <h2 className="text-base font-semibold text-gray-900">Remove {playerName}?</h2>
                </div>
                <p className="text-sm text-gray-500">
                  This removes them from the tournament. This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="ghost" onClick={close} disabled={loading}>Cancel</Button>
                  <Button
                    variant="danger"
                    loading={loading}
                    onClick={() => run(() => removePlayerSimple(tournamentPlayerId), "Player removed")}
                  >
                    Remove Player
                  </Button>
                </div>
              </>
            )}

            {/* Path B */}
            {step === "path-b" && (
              <>
                <h2 className="text-base font-semibold text-gray-900">
                  {playerName} has no games played
                </h2>
                {anyTournamentScores ? (
                  <>
                    <p className="text-sm text-gray-500">
                      Other matches already have scores recorded.{" "}
                      {playerName}&apos;s scheduled matches will be recorded as walkovers (0–0).
                    </p>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={close} disabled={loading}>Cancel</Button>
                      <Button
                        variant="danger"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => removePlayerWithWalkovers(tournamentPlayerId),
                            "Player removed, matches recorded as walkovers"
                          )
                        }
                      >
                        Remove &amp; Record Walkovers
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">
                      How do you want to handle their scheduled matches?
                    </p>
                    <div className="flex flex-col gap-2 pt-1">
                      <Button
                        className="w-full justify-start text-left"
                        variant="ghost"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => deleteAllRoundsAndRemovePlayer(tournamentPlayerId, tournamentId),
                            "Schedule deleted — regenerate with the updated roster"
                          )
                        }
                      >
                        Regenerate schedule without this player
                      </Button>
                      <Button
                        className="w-full"
                        variant="danger"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => removePlayerWithWalkovers(tournamentPlayerId),
                            "Player removed, matches recorded as walkovers"
                          )
                        }
                      >
                        Record their matches as walkovers (0–0)
                      </Button>
                    </div>
                    <Button variant="ghost" onClick={close} disabled={loading} className="w-full">
                      Cancel
                    </Button>
                  </>
                )}
              </>
            )}

            {/* Path C — choose reason */}
            {step === "path-c-reason" && (
              <>
                <h2 className="text-base font-semibold text-gray-900">
                  Why is {playerName} leaving?
                </h2>
                <p className="text-sm text-gray-500">
                  They have played {gamesPlayed} game{gamesPlayed !== 1 ? "s" : ""}.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    className="w-full"
                    loading={loading}
                    onClick={() =>
                      run(
                        () => processWithdrawal(tournamentPlayerId),
                        "Player marked as withdrawn"
                      )
                    }
                  >
                    Withdrawal — left voluntarily
                  </Button>
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => setStep("path-c-score")}
                    disabled={loading}
                  >
                    Retirement — stopped during a match
                  </Button>
                </div>
                <Button variant="ghost" onClick={close} disabled={loading} className="w-full">
                  Cancel
                </Button>
              </>
            )}

            {/* Path C2 — retirement score entry */}
            {step === "path-c-score" && (
              <>
                <h2 className="text-base font-semibold text-gray-900">
                  {playerName} retired mid-match
                </h2>
                {inProgressMatchId ? (
                  <>
                    <p className="text-sm text-gray-500">
                      Enter the final score at the time of retirement:
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">{playerName}</label>
                        <input
                          type="number"
                          min={0}
                          value={scoreA}
                          onChange={(e) => setScoreA(e.target.value)}
                          placeholder="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                      <span className="text-gray-400 font-semibold mt-4">–</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-1 block">Opponent</label>
                        <input
                          type="number"
                          min={0}
                          value={scoreB}
                          onChange={(e) => setScoreB(e.target.value)}
                          placeholder="0"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={() => setStep("path-c-reason")} disabled={loading}>
                        Back
                      </Button>
                      <Button
                        variant="danger"
                        loading={loading}
                        onClick={() => {
                          const a = parseInt(scoreA, 10);
                          const b = parseInt(scoreB, 10);
                          if (isNaN(a) || isNaN(b)) return;
                          run(
                            () => processRetirement(tournamentPlayerId, inProgressMatchId, a, b),
                            "Player marked as retired"
                          );
                        }}
                      >
                        Confirm Retirement
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">
                      No active match found. The player will be marked as retired and all remaining
                      scheduled matches recorded as walkovers.
                    </p>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="ghost" onClick={() => setStep("path-c-reason")} disabled={loading}>
                        Back
                      </Button>
                      <Button
                        variant="danger"
                        loading={loading}
                        onClick={() =>
                          run(
                            () => processRetirement(tournamentPlayerId, null, 0, 0),
                            "Player marked as retired"
                          )
                        }
                      >
                        Confirm Retirement
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
