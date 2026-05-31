/**
 * DUPR API client.
 *
 * Auth: PUT /auth/v1.0/login/ with { email, password } → { accessToken }.
 * Token cached in module scope; refreshed on 401/403.
 *
 * Match submission: PUT /club/{clubId}/match/v1.0/save
 * (schema verified against https://api.dupr.gg/v3/api-docs/internal — MatchRequest + Team)
 *
 * Players are identified by NUMERIC `id` (int64), not the short referral code
 * stored as `dupr_id` in our profiles table. We resolve via the club roster.
 *
 * Env: DUPR_EMAIL, DUPR_PASSWORD, DUPR_GROUP_ID, DUPR_API_BASE_URL (default https://api.dupr.gg).
 */

const BASE = process.env.DUPR_API_BASE_URL ?? "https://api.dupr.gg";

let cachedToken: string | null = null;
let cachedClubRoster: { clubId: string; loadedAt: number; members: DuprClubMember[] } | null = null;
const CLUB_ROSTER_TTL_MS = 5 * 60 * 1000;

class DuprError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface DuprClubMember {
  id: number;
  duprId: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface DuprMatchTeam {
  player1: number;
  player2?: number;
  game1: number;
  game2?: number;
  game3?: number;
  game4?: number;
  game5?: number;
  winner: boolean;
}

export interface DuprMatchPayload {
  eventDate: string; // yyyy-MM-dd
  format: "SINGLES" | "DOUBLES";
  matchType?: "SIDE_ONLY" | "RALLY";
  notify?: boolean;
  metadata?: Record<string, string>;
  event?: string;
  clubId: number;
  team1: DuprMatchTeam;
  team2: DuprMatchTeam;
  scores: { first: number; second: number }[];
}

async function loginDupr(): Promise<string> {
  const email = process.env.DUPR_EMAIL;
  const password = process.env.DUPR_PASSWORD;
  if (!email || !password) {
    throw new DuprError("DUPR_EMAIL/DUPR_PASSWORD not set", 0, null);
  }
  const res = await fetch(`${BASE}/auth/v1.0/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new DuprError(`DUPR login failed: ${res.status}`, res.status, body);
  }
  const token = (body as any)?.result?.accessToken ?? (body as any)?.accessToken ?? null;
  if (!token) throw new DuprError("DUPR login: no accessToken", res.status, body);
  cachedToken = token as string;
  return cachedToken;
}

async function authedFetch(path: string, init: RequestInit & { _retried?: boolean } = {}): Promise<Response> {
  if (!cachedToken) await loginDupr();
  const headers = {
    ...(init.headers ?? {}),
    "Content-Type": "application/json",
    Authorization: `Bearer ${cachedToken}`,
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if ((res.status === 401 || res.status === 403) && !init._retried) {
    cachedToken = null;
    await loginDupr();
    return authedFetch(path, { ...init, _retried: true });
  }
  return res;
}

export interface DuprSubmitResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function submitDuprMatch(clubId: number, payload: DuprMatchPayload): Promise<DuprSubmitResult> {
  const res = await authedFetch(`/club/${clubId}/match/v1.0/save`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/** Fetch full club roster (paginated). Cached for 5 minutes per clubId. */
export async function getClubMembers(clubId: string | number, query: string = "*"): Promise<DuprClubMember[]> {
  const clubIdStr = String(clubId);
  if (
    cachedClubRoster &&
    cachedClubRoster.clubId === clubIdStr &&
    Date.now() - cachedClubRoster.loadedAt < CLUB_ROSTER_TTL_MS &&
    query === "*"
  ) {
    return cachedClubRoster.members;
  }

  const members: DuprClubMember[] = [];
  let offset = 0;
  const limit = 25; // DUPR enforces max 25
  for (let i = 0; i < 100; i++) {
    const res = await authedFetch(`/club/${clubId}/members/v1.0/all`, {
      method: "POST",
      body: JSON.stringify({ exclude: [], limit, offset, query }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new DuprError(`DUPR club members failed: ${res.status}`, res.status, body);
    const hits = ((body as any)?.result?.hits ?? []) as DuprClubMember[];
    members.push(...hits);
    if (hits.length < limit) break;
    offset += limit;
  }

  if (query === "*") {
    cachedClubRoster = { clubId: clubIdStr, loadedAt: Date.now(), members };
  }
  return members;
}

/** Map DUPR referral codes (text) → numeric internal IDs via club roster. */
export async function resolveDuprNumericIds(
  clubId: string | number,
  duprCodes: string[]
): Promise<Map<string, number>> {
  const roster = await getClubMembers(clubId);
  const map = new Map<string, number>();
  for (const code of duprCodes) {
    const m = roster.find((r) => r.duprId?.toLowerCase() === code.toLowerCase());
    if (m) map.set(code, m.id);
  }
  return map;
}

export interface DuprPlayerSearchResult {
  id: number;
  duprId: string;
  fullName: string;
  shortAddress: string | null;
  ratings?: {
    singles?: number | null;
    doubles?: number | null;
  };
}

export async function searchDuprPlayers(query: string, limit = 10): Promise<DuprPlayerSearchResult[]> {
  const res = await authedFetch("/player/v1.0/search", {
    method: "POST",
    body: JSON.stringify({ query, limit, offset: 0, exclude: [], filter: {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new DuprError(`DUPR player search failed: ${res.status}`, res.status, body);
  const hits = ((body as any)?.result?.hits ?? []) as any[];
  return hits.map((h) => ({
    id: h.id,
    duprId: h.duprId ?? "",
    fullName: h.fullName ?? "",
    shortAddress: h.shortAddress ?? null,
    ratings: h.ratings ?? null,
  }));
}

export function clearDuprToken() {
  cachedToken = null;
}

export function clearDuprClubRoster() {
  cachedClubRoster = null;
}

/** Resolve DUPR referral codes → numeric IDs via player search (no club membership required). */
export async function resolveDuprNumericIdsBySearch(
  duprCodes: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const code of duprCodes) {
    const results = await searchDuprPlayers(code, 10);
    const match = results.find((r) => r.duprId?.toLowerCase() === code.toLowerCase());
    if (match) map.set(code, match.id);
  }
  return map;
}

export { DuprError };
