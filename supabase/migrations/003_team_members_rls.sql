-- Allow approved tournament players and admins to read team_members
CREATE POLICY "team_members_read" ON team_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN tournament_players tp ON tp.tournament_id = t.tournament_id
      WHERE t.id = team_members.team_id
        AND tp.user_id = auth.uid()
        AND tp.status = 'approved'
    ) OR
    EXISTS (
      SELECT 1 FROM teams t
      JOIN tournament_admins ta ON ta.tournament_id = t.tournament_id
      WHERE t.id = team_members.team_id
        AND ta.user_id = auth.uid()
    )
  );

-- Allow admins to manage team_members (insert/update/delete)
CREATE POLICY "team_members_manage_admin" ON team_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      JOIN tournament_admins ta ON ta.tournament_id = t.tournament_id
      WHERE t.id = team_members.team_id
        AND ta.user_id = auth.uid()
    )
  );
