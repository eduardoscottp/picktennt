import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { searchDuprPlayers, DuprError } from "@/lib/dupr/client";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: adminRow } = await supabase
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  if (!adminRow) return NextResponse.json({ error: "Not a tournament admin" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.profile_id) return NextResponse.json({ error: "profile_id is required" }, { status: 400 });

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("id, first_name, last_name, email")
    .eq("id", body.profile_id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  if (!name) return NextResponse.json({ error: "Player has no name on file" }, { status: 400 });

  try {
    const results = await searchDuprPlayers(name, 10);
    return NextResponse.json({ ok: true, query: name, results });
  } catch (err) {
    const e = err as DuprError;
    return NextResponse.json(
      { ok: false, error: `DUPR search failed (${e.status})` },
      { status: 502 }
    );
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: adminRow } = await supabase
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  if (!adminRow) return NextResponse.json({ error: "Not a tournament admin" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.profile_id || !body?.dupr_id) {
    return NextResponse.json({ error: "profile_id and dupr_id are required" }, { status: 400 });
  }

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await admin
    .from("profiles")
    .update({ dupr_id: body.dupr_id })
    .eq("id", body.profile_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
