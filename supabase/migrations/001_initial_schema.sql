-- ============================================================
-- PICKTENNT — Initial Schema
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  age           INTEGER,
  avatar_url    TEXT,
  dupr_id       TEXT,
  dupr_rating   NUMERIC(4,2),
  is_system_admin BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TOURNAMENTS
-- ============================================================
CREATE TABLE tournaments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT UNIQUE NOT NULL,
  created_by            UUID NOT NULL REFERENCES profiles(id),
  court_count           INTEGER NOT NULL CHECK (court_count >= 1),
  max_players           INTEGER NOT NULL CHECK (max_players >= 2),
  type                  TEXT NOT NULL CHECK (type IN ('singles','doubles','mixed')),
  games_per_player      INTEGER,                    -- mixed only
  -- Second round
  second_round_format   TEXT CHECK (second_round_format IN ('round_robin','par_match','none')) DEFAULT 'none',
  advancement_count     INTEGER,                    -- how many advance
  -- Finals
  finals_format         TEXT CHECK (finals_format IN ('top2','top4','none')) DEFAULT 'none',
  finals_trigger        TEXT CHECK (finals_trigger IN ('after_elimination','after_round_robin','none')) DEFAULT 'none',
  -- Meta
  join_code             TEXT UNIQUE DEFAULT upper(substring(gen_random_uuid()::text,1,8)),
  rules_text            TEXT,
  status                TEXT NOT NULL CHECK (status IN ('draft','registration','active','finals','completed')) DEFAULT 'draft',
  is_public             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TOURNAMENT ADMINS (with succession order)
-- ============================================================
CREATE TABLE tournament_admins (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id    UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  succession_order INTEGER NOT NULL,
  granted_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, user_id),
  UNIQUE (tournament_id, succession_order)
);

-- ============================================================
-- TOURNAMENT PLAYERS
-- ============================================================
CREATE TABLE tournament_players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  joined_via    TEXT CHECK (joined_via IN ('code','link','invite','search')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, user_id)
);

-- ============================================================
-- TEAMS (singles = 1 player, doubles = 2, mixed = system-managed)
-- ============================================================
CREATE TABLE teams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name          TEXT,
  seed          INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (team_id, user_id)
);

-- ============================================================
-- ROUNDS
-- ============================================================
CREATE TABLE rounds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number  INTEGER NOT NULL,
  round_type    TEXT NOT NULL CHECK (round_type IN ('round_robin','par_match','elimination','finals_gold','finals_bronze')),
  status        TEXT NOT NULL CHECK (status IN ('pending','active','completed')) DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tournament_id, round_number)
);

-- ============================================================
-- MATCHES
-- ============================================================
CREATE TABLE matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id      UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  court_number  INTEGER,
  -- Singles / Doubles use team references
  team_a_id     UUID REFERENCES teams(id),
  team_b_id     UUID REFERENCES teams(id),
  -- Mixed uses 4 individual player slots
  player_a1_id  UUID REFERENCES profiles(id),
  player_a2_id  UUID REFERENCES profiles(id),
  player_b1_id  UUID REFERENCES profiles(id),
  player_b2_id  UUID REFERENCES profiles(id),
  -- Score
  score_a       INTEGER,
  score_b       INTEGER,
  -- Status
  status        TEXT NOT NULL CHECK (status IN ('scheduled','in_progress','score_entered','validated','disputed')) DEFAULT 'scheduled',
  entered_by    UUID REFERENCES profiles(id),
  validated_by  UUID REFERENCES profiles(id),
  scheduled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STANDINGS (cached for performance, recomputed after each validated match)
-- ============================================================
CREATE TABLE standings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id       UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  -- Either team or player (mixed tracks individuals)
  team_id        UUID REFERENCES teams(id),
  player_id      UUID REFERENCES profiles(id),
  wins           INTEGER NOT NULL DEFAULT 0,
  losses         INTEGER NOT NULL DEFAULT 0,
  points_for     INTEGER NOT NULL DEFAULT 0,
  points_against INTEGER NOT NULL DEFAULT 0,
  rank           INTEGER,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (round_id, team_id),
  UNIQUE (round_id, player_id)
);

-- ============================================================
-- MIXED PAIRING TRACKER (to minimize repeats)
-- ============================================================
CREATE TABLE mixed_pairings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_a_id   UUID NOT NULL REFERENCES profiles(id),
  player_b_id   UUID NOT NULL REFERENCES profiles(id),
  times_as_partner  INTEGER NOT NULL DEFAULT 0,
  times_as_opponent INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tournament_id, player_a_id, player_b_id)
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, first_name, last_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'given_name', split_part(NEW.email,'@',1)),
    NEW.raw_user_meta_data->>'family_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-create tournament admin when tournament is created
CREATE OR REPLACE FUNCTION handle_new_tournament()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tournament_admins (tournament_id, user_id, succession_order, granted_by)
  VALUES (NEW.id, NEW.created_by, 1, NEW.created_by);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_tournament_created
  AFTER INSERT ON tournaments
  FOR EACH ROW EXECUTE FUNCTION handle_new_tournament();

-- Promote next admin when an admin is deleted
CREATE OR REPLACE FUNCTION handle_admin_deleted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  admin_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO admin_count
  FROM tournament_admins
  WHERE tournament_id = OLD.tournament_id;

  -- Reorder succession after deletion
  UPDATE tournament_admins
  SET succession_order = succession_order - 1
  WHERE tournament_id = OLD.tournament_id
    AND succession_order > OLD.succession_order;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER on_admin_deleted
  AFTER DELETE ON tournament_admins
  FOR EACH ROW EXECUTE FUNCTION handle_admin_deleted();

-- Updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tournaments_updated_at BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER matches_updated_at BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mixed_pairings ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read, only owner can update
CREATE POLICY "profiles_read_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Tournaments: public ones readable by all, private by members only
CREATE POLICY "tournaments_read_public" ON tournaments FOR SELECT
  USING (is_public = true OR auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = id
  ));

CREATE POLICY "tournaments_insert_auth" ON tournaments FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "tournaments_update_admin" ON tournaments FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = id
  ));

-- Tournament admins: visible to tournament members
CREATE POLICY "tournament_admins_read" ON tournament_admins FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = tournament_admins.tournament_id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins ta2 WHERE ta2.tournament_id = tournament_admins.tournament_id
  ));

CREATE POLICY "tournament_admins_manage" ON tournament_admins FOR ALL
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = tournament_admins.tournament_id
  ));

-- Tournament players: admin full access, player sees their own + approved list
CREATE POLICY "tournament_players_read" ON tournament_players FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = tournament_players.tournament_id
  ));

CREATE POLICY "tournament_players_insert" ON tournament_players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tournament_players_update_admin" ON tournament_players FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = tournament_players.tournament_id
  ));

-- Teams: visible to tournament members
CREATE POLICY "teams_read" ON teams FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = teams.tournament_id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = teams.tournament_id
  ));

CREATE POLICY "teams_manage_admin" ON teams FOR ALL
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = teams.tournament_id
  ));

-- Rounds, matches, standings: visible to tournament members
CREATE POLICY "rounds_read" ON rounds FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = rounds.tournament_id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = rounds.tournament_id
  ));

CREATE POLICY "rounds_manage_admin" ON rounds FOR ALL
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = rounds.tournament_id
  ));

CREATE POLICY "matches_read" ON matches FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = matches.tournament_id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = matches.tournament_id
  ));

CREATE POLICY "matches_enter_score" ON matches FOR UPDATE
  USING (
    status IN ('scheduled','in_progress','score_entered','disputed')
    AND (
      auth.uid() IN (
        SELECT user_id FROM tournament_admins WHERE tournament_id = matches.tournament_id
      )
      OR auth.uid() IN (
        SELECT tm.user_id FROM team_members tm
        WHERE tm.team_id IN (matches.team_a_id, matches.team_b_id)
      )
      OR auth.uid() IN (matches.player_a1_id, matches.player_a2_id, matches.player_b1_id, matches.player_b2_id)
    )
  );

CREATE POLICY "standings_read" ON standings FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = standings.tournament_id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = standings.tournament_id
  ));

CREATE POLICY "mixed_pairings_read" ON mixed_pairings FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_players WHERE tournament_id = mixed_pairings.tournament_id AND status = 'approved'
  ) OR auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = mixed_pairings.tournament_id
  ));

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_tournament_players_tournament ON tournament_players(tournament_id);
CREATE INDEX idx_tournament_players_user ON tournament_players(user_id);
CREATE INDEX idx_tournament_admins_tournament ON tournament_admins(tournament_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_round ON matches(round_id);
CREATE INDEX idx_standings_round ON standings(round_id);
CREATE INDEX idx_standings_tournament ON standings(tournament_id);
CREATE INDEX idx_mixed_pairings_tournament ON mixed_pairings(tournament_id);
CREATE INDEX idx_teams_tournament ON teams(tournament_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
