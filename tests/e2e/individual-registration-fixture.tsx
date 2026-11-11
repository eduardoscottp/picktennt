import { createRoot } from "react-dom/client";
import { IndividualRegistration } from "../../components/tournament-builder/individual-registration";
import type { CommandSnapshot } from "../../lib/tournament-builder/commands";

const snapshot: CommandSnapshot = {
  event: { id: "event", modular_state: "registration_open", definition_id: "definition" },
  definitions: [{ id: "definition", status: "published", definition: { registration: { max_entries: 2, entry_type: "fixed_doubles", closes_at: "2099-01-01T00:00:00Z" } } }],
  teams: [], team_members: [], tournament_players: [], rounds: [], matches: [], standings: [], stages: [],
};
const commands: { command: string; data: Record<string, unknown> }[] = [];
Object.assign(window, { commands });
createRoot(document.getElementById("root")!).render(<IndividualRegistration snapshot={snapshot} actorId="player" definitionId="definition" doubles maxEntries={2} admin={false} owner={false} matchLabel={id => id} disabled={false} run={async (command, data) => { commands.push({ command, data }); }} />);

