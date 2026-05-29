import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchDuprPlayers, DuprError } from "@/lib/dupr/client";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const query = body?.query?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  try {
    const results = await searchDuprPlayers(query, 10);
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    const e = err as DuprError;
    return NextResponse.json(
      { ok: false, error: `DUPR search failed (${e.status})` },
      { status: 502 }
    );
  }
}
