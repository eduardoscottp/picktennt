-- Allow tournament admins to insert matches
CREATE POLICY "matches_insert_admin" ON matches FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT user_id FROM tournament_admins WHERE tournament_id = matches.tournament_id
    )
  );
