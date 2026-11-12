import { createRoot } from "react-dom/client";
import { IndividualRegistration } from "../../components/tournament-builder/individual-registration";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";

const snapshot: CommandSnapshot = {
  event: { id: "event", modular_state: "active", definition_id: "definition" },
  definitions: [{ id: "definition", status: "published", definition: { registration: { max_entries: 2, entry_type: "fixed_doubles", closes_at: "2099-01-01T00:00:00Z" } } }],
  teams: [{ id: "a", name: "Team 1", registration_slot: 1, entry_state: "approved" }, { id: "b", name: "Extremely long team name without spaces xxxxxxxxxxxxxxxxxxxxxxxxxx", registration_slot: 2, entry_state: "approved" }],
  team_members: [{ id: "a1", team_id: "a", user_id: "a1", membership_status: "active", display_name: "Short Name" }, { id: "a2", team_id: "a", user_id: "a2", membership_status: "active", display_name: "Other Player" }, { id: "b1", team_id: "b", user_id: "b1", membership_status: "active", display_name: "Player One" }, { id: "b2", team_id: "b", user_id: "b2", membership_status: "active", display_name: "Player Two" }],
  tournament_players: [], rounds: [], matches: [], standings: [], stages: [],
};
createRoot(document.getElementById("root")!).render(<main style={{ padding: 16 }}><IndividualRegistration snapshot={snapshot} actorId="viewer" definitionId="definition" doubles maxEntries={2} admin={false} owner={false} matchLabel={id => id} disabled={false} run={async () => {}} /></main>);
