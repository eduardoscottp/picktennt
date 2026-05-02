-- Allow users to cancel their own PENDING join requests (only pending, not approved/rejected)
CREATE POLICY "tournament_players_delete_own_pending" ON tournament_players
  FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- Allow users to insert their own profile row (needed for auth callback upsert)
DO $$ BEGIN
  CREATE POLICY "profiles_insert_own" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
