-- Allow tournament admins to delete matches (needed when regenerating schedule)
CREATE POLICY "matches_delete_admin" ON matches FOR DELETE
  USING (
    auth.uid() IN (
      SELECT user_id FROM tournament_admins WHERE tournament_id = matches.tournament_id
    )
  );
