import { modularTournamentPage } from "@/lib/tournament-builder/server-page";

export default async function TournamentBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return modularTournamentPage(id, 'builder');
}
