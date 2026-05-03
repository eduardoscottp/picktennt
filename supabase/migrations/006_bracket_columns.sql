-- Bracket progression: each match can point to the next match the winner/loser feeds into
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS bracket_next_winner_match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bracket_next_loser_match_id  UUID REFERENCES matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bracket_winner_fills_side    CHAR(1) CHECK (bracket_winner_fills_side IN ('a','b')),
  ADD COLUMN IF NOT EXISTS bracket_loser_fills_side     CHAR(1) CHECK (bracket_loser_fills_side  IN ('a','b'));
