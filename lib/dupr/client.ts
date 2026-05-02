/**
 * DUPR API client stub.
 * Replace DUPR_API_KEY and DUPR_API_BASE_URL in .env.local to activate.
 *
 * DUPR docs: https://developer.dupr.com
 */

const BASE = process.env.DUPR_API_BASE_URL ?? "https://api.dupr.gg";
const KEY  = process.env.DUPR_API_KEY ?? "";

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${KEY}`,
  };
}

export interface DuprPlayer {
  id: string;
  email: string;
  singlesRating: number | null;
  doublesRating: number | null;
  displayName: string;
}

export interface DuprMatchResult {
  matchId: string;
  winnerId: string;
  loserId: string;
  winnerScore: number;
  loserScore: number;
  matchDate: string;
}

/** Pull player rating by email */
export async function getDuprPlayerByEmail(email: string): Promise<DuprPlayer | null> {
  if (!KEY) {
    console.warn("[DUPR] API key not set — skipping player lookup");
    return null;
  }
  try {
    const res = await fetch(`${BASE}/v1/player/search?email=${encodeURIComponent(email)}`, {
      headers: headers(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.player ?? null;
  } catch {
    return null;
  }
}

/** Submit match results to DUPR */
export async function submitDuprMatch(result: DuprMatchResult): Promise<boolean> {
  if (!KEY) {
    console.warn("[DUPR] API key not set — match not submitted");
    return false;
  }
  try {
    const res = await fetch(`${BASE}/v1/match`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(result),
    });
    return res.ok;
  } catch {
    return false;
  }
}
