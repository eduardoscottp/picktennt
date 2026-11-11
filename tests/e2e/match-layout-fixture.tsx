import { createRoot } from "react-dom/client";
import { BuilderMatch } from "../../components/tournament-builder/match-card";

const names: Record<string, string[]> = {
  a: ["Alexandria Verylongunbrokenplayernameeeeeeeeeeeeeeeee", "Short Player"],
  b: ["First Player", "Another Extremely Long Player Name That Must Not Overflow"],
};
createRoot(document.getElementById("root")!).render(<main style={{ padding: 16 }}><BuilderMatch match={{ id: "match", team_a_id: "a", team_b_id: "b", court_number: 1, status: "scheduled" }} label={id => `Team ${String(id)}`} playerNames={id => names[String(id)] ?? []} admin canValidate disabled={false} run={async () => {}} tournamentId="event" revision={1} owner matchLabel={id => id} courts={2} title="Round robin · Round 1" includeStage scorePolicy={{ target: 11, win_by: 2 }} /></main>);
