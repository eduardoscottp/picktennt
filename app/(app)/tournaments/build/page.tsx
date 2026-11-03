import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderOrigin } from "@/lib/tournament-builder/http";
import { NewTournamentDraft } from "@/components/tournament-builder/new-draft";

export default async function BuildTournamentPage() {
  if (process.env.TOURNAMENT_BUILDER_ENABLED !== "true") notFound();
  const origin = builderOrigin();
  const session = await createClient();
  const { data: { user }, error } = await session.auth.getUser();
  if (error || !user) redirect("/login?redirect=%2Ftournaments%2Fbuild");
  return <NewTournamentDraft actorId={user.id} mcpUrl={`${origin}/api/mcp`} />;
}
