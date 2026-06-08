-- tournament_players: track exit reason and standings nullification
ALTER TABLE tournament_players
  ADD COLUMN exit_reason TEXT CHECK (exit_reason IN ('withdrew', 'retired', 'disqualified')),
  ADD COLUMN nullified_from_standings BOOLEAN NOT NULL DEFAULT FALSE;

-- matches: DUPR submission flag (defaults true for all existing and future matches)
ALTER TABLE matches
  ADD COLUMN submit_to_dupr BOOLEAN NOT NULL DEFAULT TRUE;

-- matches: add 'walkover' to the status enum (drop old constraint, add new one)
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled','in_progress','score_entered','validated','disputed','walkover'));
