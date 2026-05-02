export type TournamentType = "singles" | "doubles" | "mixed";
export type TournamentStatus = "draft" | "registration" | "active" | "finals" | "completed";
export type SecondRoundFormat = "round_robin" | "par_match" | "none";
export type FinalsFormat = "top2" | "top4" | "none";
export type FinalsTrigger = "after_elimination" | "after_round_robin" | "none";
export type MatchStatus = "scheduled" | "in_progress" | "score_entered" | "validated" | "disputed";
export type RoundType = "round_robin" | "par_match" | "elimination" | "finals_gold" | "finals_bronze";
export type RoundStatus = "pending" | "active" | "completed";
export type PlayerStatus = "pending" | "approved" | "rejected";
export type JoinVia = "code" | "link" | "invite" | "search";

export interface Profile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  age: number | null;
  avatar_url: string | null;
  dupr_id: string | null;
  dupr_rating: number | null;
  is_system_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tournament {
  id: string;
  name: string;
  created_by: string;
  court_count: number;
  max_players: number;
  type: TournamentType;
  games_per_player: number | null;
  second_round_format: SecondRoundFormat;
  advancement_count: number | null;
  finals_format: FinalsFormat;
  finals_trigger: FinalsTrigger;
  join_code: string;
  rules_text: string | null;
  status: TournamentStatus;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface TournamentAdmin {
  id: string;
  tournament_id: string;
  user_id: string;
  succession_order: number;
  granted_by: string | null;
  created_at: string;
  profile?: Profile;
}

export interface TournamentPlayer {
  id: string;
  tournament_id: string;
  user_id: string;
  status: PlayerStatus;
  joined_via: JoinVia | null;
  created_at: string;
  profile?: Profile;
}

export interface Team {
  id: string;
  tournament_id: string;
  name: string | null;
  seed: number | null;
  created_at: string;
  members?: Profile[];
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  profile?: Profile;
}

export interface Round {
  id: string;
  tournament_id: string;
  round_number: number;
  round_type: RoundType;
  status: RoundStatus;
  created_at: string;
  matches?: Match[];
}

export interface Match {
  id: string;
  tournament_id: string;
  round_id: string;
  court_number: number | null;
  team_a_id: string | null;
  team_b_id: string | null;
  player_a1_id: string | null;
  player_a2_id: string | null;
  player_b1_id: string | null;
  player_b2_id: string | null;
  score_a: number | null;
  score_b: number | null;
  status: MatchStatus;
  entered_by: string | null;
  validated_by: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  team_a?: Team;
  team_b?: Team;
  player_a1?: Profile;
  player_a2?: Profile;
  player_b1?: Profile;
  player_b2?: Profile;
}

export interface Standing {
  id: string;
  tournament_id: string;
  round_id: string;
  team_id: string | null;
  player_id: string | null;
  wins: number;
  losses: number;
  points_for: number;
  points_against: number;
  rank: number | null;
  updated_at: string;
  team?: Team;
  player?: Profile;
}

export interface MixedPairing {
  id: string;
  tournament_id: string;
  player_a_id: string;
  player_b_id: string;
  times_as_partner: number;
  times_as_opponent: number;
}

// Enriched types used in the UI
export interface TournamentWithDetails extends Tournament {
  admins?: TournamentAdmin[];
  players?: TournamentPlayer[];
  rounds?: Round[];
  creator?: Profile;
  player_count?: number;
}

export interface MatchWithPlayers extends Match {
  round?: Round;
}

export interface PlayerStats {
  profile: Profile;
  total_matches: number;
  wins: number;
  losses: number;
  win_rate: number;
  tournaments_played: number;
  tournaments_won: number;
  points_for: number;
  points_against: number;
  recent_matches: MatchWithPlayers[];
}

// Supabase client generic type — uses explicit row types for insert/update safety
// but returns Row as any to avoid inference conflicts in server components
export type Database = {
  public: {
    Tables: {
      profiles:           { Row: any; Insert: any; Update: any };
      tournaments:        { Row: any; Insert: any; Update: any };
      tournament_admins:  { Row: any; Insert: any; Update: any };
      tournament_players: { Row: any; Insert: any; Update: any };
      teams:              { Row: any; Insert: any; Update: any };
      team_members:       { Row: any; Insert: any; Update: any };
      rounds:             { Row: any; Insert: any; Update: any };
      matches:            { Row: any; Insert: any; Update: any };
      standings:          { Row: any; Insert: any; Update: any };
      mixed_pairings:     { Row: any; Insert: any; Update: any };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
