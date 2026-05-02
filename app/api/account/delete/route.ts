import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Block deletion if user has created tournaments (FK constraint on created_by)
  const { data: createdTournaments } = await supabase
    .from("tournaments")
    .select("id")
    .eq("created_by", user.id)
    .limit(1);

  if ((createdTournaments ?? []).length > 0) {
    return NextResponse.json(
      { error: "You have tournaments you created. Delete or transfer them before deleting your account." },
      { status: 400 }
    );
  }

  // Use service-role admin client to delete auth user
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
