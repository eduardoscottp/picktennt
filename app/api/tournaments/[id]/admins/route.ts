import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Not authenticated", 401);

  const { data: callerAdmin } = await supabase
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  if (!callerAdmin) return jsonError("Not a tournament admin", 403);

  const body = await request.json().catch(() => null);
  if (!body?.user_id) return jsonError("user_id is required");
  const isPlaying = body.is_playing !== false;

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: existing } = await admin
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", body.user_id)
    .single();
  if (existing) return jsonError("User is already an admin", 409);

  const { data: maxOrder } = await admin
    .from("tournament_admins")
    .select("succession_order")
    .eq("tournament_id", id)
    .order("succession_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = (maxOrder?.succession_order ?? 0) + 1;

  const { error: insertErr } = await admin.from("tournament_admins").insert({
    tournament_id: id,
    user_id: body.user_id,
    succession_order: nextOrder,
    granted_by: user.id,
    is_playing: isPlaying,
  });
  if (insertErr) return jsonError(insertErr.message, 500);

  if (isPlaying) {
    const { data: tournament } = await admin
      .from("tournaments")
      .select("type")
      .eq("id", id)
      .single();

    await admin.from("tournament_players").upsert({
      tournament_id: id,
      user_id: body.user_id,
      status: "approved",
      joined_via: "invite",
    }, { onConflict: "tournament_id,user_id" });

    if (tournament?.type === "singles") {
      const { data: profile } = await admin
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("id", body.user_id)
        .single();
      const teamName = profile
        ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
        : "Player";
      const { data: team } = await admin
        .from("teams")
        .insert({ tournament_id: id, name: teamName })
        .select()
        .single();
      if (team) {
        await admin.from("team_members").insert({ team_id: team.id, user_id: body.user_id });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Not authenticated", 401);

  const { data: callerAdmin } = await supabase
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  if (!callerAdmin) return jsonError("Not a tournament admin", 403);

  const body = await request.json().catch(() => null);
  if (!body?.admin_id) return jsonError("admin_id is required");
  if (typeof body.is_playing !== "boolean") return jsonError("is_playing must be a boolean");

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await admin
    .from("tournament_admins")
    .update({ is_playing: body.is_playing })
    .eq("id", body.admin_id)
    .eq("tournament_id", id);
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Not authenticated", 401);

  const { data: callerAdmin } = await supabase
    .from("tournament_admins")
    .select("succession_order")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  if (!callerAdmin) return jsonError("Not a tournament admin", 403);

  const body = await request.json().catch(() => null);
  if (!body?.admin_id) return jsonError("admin_id is required");

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: targetAdmin } = await admin
    .from("tournament_admins")
    .select("id, succession_order")
    .eq("id", body.admin_id)
    .eq("tournament_id", id)
    .single();
  if (!targetAdmin) return jsonError("Admin not found", 404);

  if (targetAdmin.succession_order === 1) return jsonError("Cannot remove the primary admin", 400);

  const { error } = await admin
    .from("tournament_admins")
    .delete()
    .eq("id", body.admin_id);
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}
