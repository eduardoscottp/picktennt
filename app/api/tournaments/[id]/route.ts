import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Not authenticated", 401);

  // Must be a tournament admin
  const { data: adminRow } = await supabase
    .from("tournament_admins")
    .select("id")
    .eq("tournament_id", id)
    .eq("user_id", user.id)
    .single();
  if (!adminRow) return jsonError("Not an admin of this tournament", 403);

  const body = await request.json().catch(() => null);
  if (!body) return jsonError("Invalid request body");

  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await admin
    .from("tournaments")
    .update({
      tournament_date: body.tournament_date ?? null,
      court_name: body.court_name?.trim() || null,
      court_address: body.court_address?.trim() || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ tournament: data });
}
