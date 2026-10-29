-- The native list includes pending players as well as owners and current admins.
-- Resolve related rows without recursive RLS evaluation; identity comes from auth.
BEGIN;
CREATE OR REPLACE FUNCTION public.can_view_tournament_listing(t_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tournaments t WHERE t.id = t_id AND (
      t.is_public OR t.created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.tournament_admins a
        WHERE a.tournament_id = t.id AND a.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tournament_players p
        WHERE p.tournament_id = t.id AND p.user_id = auth.uid()
          AND p.status IN ('pending', 'approved'))
      OR EXISTS (SELECT 1 FROM public.team_members m
        WHERE m.tournament_id = t.id AND m.user_id = auth.uid()
          AND m.membership_status IN ('pending', 'active'))
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_tournament_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_tournament_listing(uuid) TO authenticated;

DROP POLICY IF EXISTS tournaments_read_public ON public.tournaments;
CREATE POLICY tournaments_read_public ON public.tournaments FOR SELECT TO authenticated
USING (public.can_view_tournament_listing(id));
-- Preserve existing public reads for anonymous clients.
CREATE POLICY tournaments_read_anonymous ON public.tournaments FOR SELECT TO anon
USING (is_public = true);
COMMIT;
