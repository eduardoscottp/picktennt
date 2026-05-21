-- Admins can add players directly (search → assign) at any tournament status,
-- and can hard-remove a player row when changing the roster post-start.

CREATE POLICY "tournament_players_admin_insert" ON tournament_players FOR INSERT
  WITH CHECK (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = tournament_players.tournament_id
  ));

CREATE POLICY "tournament_players_admin_delete" ON tournament_players FOR DELETE
  USING (auth.uid() IN (
    SELECT user_id FROM tournament_admins WHERE tournament_id = tournament_players.tournament_id
  ));
