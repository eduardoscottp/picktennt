import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SetupDupr } from "@/components/auth/setup-dupr";

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, dupr_id")
    .eq("id", user.id)
    .single();

  if (profile?.dupr_id) redirect("/dashboard");

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <SetupDupr
        profileId={user.id}
        firstName={profile?.first_name ?? null}
        lastName={profile?.last_name ?? null}
      />
    </div>
  );
}
