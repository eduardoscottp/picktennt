-- Core-only, schema-only staging baseline captured from catalog on 2026-10-28.
-- Not a production migration and not the entire shared mobile database.
-- Managed Supabase auth.users/auth.uid and API roles must already exist.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $guard$
DECLARE project_ref text := current_setting('tournament_builder.staging_project_ref',true);
BEGIN
 IF project_ref IS NULL OR project_ref !~ '^[a-z0-9]{20}$' OR project_ref='qmiljmxnnryhuaudpuff' THEN RAISE EXCEPTION 'STAGING_ONLY: explicit non-production project ref required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e'))
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e'))
 OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='tournament_builder_private') THEN RAISE EXCEPTION 'EMPTY_PROJECT_REQUIRED: public core/custom routines or builder schema already exist'; END IF;
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'STAGING_ONLY: managed Supabase Auth required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'EMPTY_PROJECT_REQUIRED: auth users already exist'; END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='auth' AND c.relname='users' AND pn.nspname='public' AND NOT t.tgisinternal) THEN RAISE EXCEPTION 'EMPTY_PROJECT_REQUIRED: custom auth triggers already exist'; END IF;
END $guard$;

CREATE TABLE public.profiles (
 id uuid NOT NULL,
 email text NOT NULL,
 first_name text,
 last_name text,
 age integer,
 avatar_url text,
 dupr_id text,
 dupr_rating numeric(4,2),
 is_system_admin boolean DEFAULT false,
 created_at timestamp with time zone DEFAULT now(),
 updated_at timestamp with time zone DEFAULT now(),
 username text,
 time_zone text
);

CREATE TABLE public.tournaments (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL,
 created_by uuid NOT NULL,
 court_count integer NOT NULL,
 max_players integer NOT NULL,
 type text NOT NULL,
 games_per_player integer,
 second_round_format text DEFAULT 'none'::text,
 advancement_count integer,
 finals_format text DEFAULT 'none'::text,
 finals_trigger text DEFAULT 'none'::text,
 join_code text DEFAULT upper("substring"((gen_random_uuid())::text, 1, 8)),
 rules_text text,
 status text NOT NULL DEFAULT 'draft'::text,
 is_public boolean DEFAULT true,
 created_at timestamp with time zone DEFAULT now(),
 updated_at timestamp with time zone DEFAULT now(),
 tournament_date date,
 court_name text,
 court_address text,
 is_open boolean NOT NULL DEFAULT false
);

CREATE TABLE public.tournament_admins (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 user_id uuid NOT NULL,
 succession_order integer NOT NULL,
 granted_by uuid,
 created_at timestamp with time zone DEFAULT now(),
 is_playing boolean NOT NULL DEFAULT true
);

CREATE TABLE public.tournament_players (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending'::text,
 joined_via text,
 created_at timestamp with time zone DEFAULT now(),
 exit_reason text,
 nullified_from_standings boolean NOT NULL DEFAULT false
);

CREATE TABLE public.teams (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 name text,
 seed integer,
 created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.team_members (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL,
 user_id uuid NOT NULL
);

CREATE TABLE public.rounds (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 round_number integer NOT NULL,
 round_type text NOT NULL,
 status text NOT NULL DEFAULT 'pending'::text,
 created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.matches (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 round_id uuid NOT NULL,
 court_number integer,
 team_a_id uuid,
 team_b_id uuid,
 player_a1_id uuid,
 player_a2_id uuid,
 player_b1_id uuid,
 player_b2_id uuid,
 score_a integer,
 score_b integer,
 status text NOT NULL DEFAULT 'scheduled'::text,
 entered_by uuid,
 validated_by uuid,
 scheduled_at timestamp with time zone,
 created_at timestamp with time zone DEFAULT now(),
 updated_at timestamp with time zone DEFAULT now(),
 bracket_next_winner_match_id uuid,
 bracket_next_loser_match_id uuid,
 bracket_winner_fills_side character(1),
 bracket_loser_fills_side character(1),
 submit_to_dupr boolean NOT NULL DEFAULT true
);

CREATE TABLE public.standings (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 round_id uuid NOT NULL,
 team_id uuid,
 player_id uuid,
 wins integer NOT NULL DEFAULT 0,
 losses integer NOT NULL DEFAULT 0,
 points_for integer NOT NULL DEFAULT 0,
 points_against integer NOT NULL DEFAULT 0,
 rank integer,
 updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.mixed_pairings (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,
 player_a_id uuid NOT NULL,
 player_b_id uuid NOT NULL,
 times_as_partner integer NOT NULL DEFAULT 0,
 times_as_opponent integer NOT NULL DEFAULT 0
);
ALTER TABLE public.matches ADD CONSTRAINT matches_bracket_loser_fills_side_check CHECK ((bracket_loser_fills_side = ANY (ARRAY['a'::bpchar, 'b'::bpchar])));
ALTER TABLE public.matches ADD CONSTRAINT matches_bracket_winner_fills_side_check CHECK ((bracket_winner_fills_side = ANY (ARRAY['a'::bpchar, 'b'::bpchar])));
ALTER TABLE public.matches ADD CONSTRAINT matches_pkey PRIMARY KEY (id);
ALTER TABLE public.matches ADD CONSTRAINT matches_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'score_entered'::text, 'validated'::text, 'disputed'::text, 'walkover'::text])));
ALTER TABLE public.mixed_pairings ADD CONSTRAINT mixed_pairings_pkey PRIMARY KEY (id);
ALTER TABLE public.mixed_pairings ADD CONSTRAINT mixed_pairings_tournament_id_player_a_id_player_b_id_key UNIQUE (tournament_id, player_a_id, player_b_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.rounds ADD CONSTRAINT rounds_pkey PRIMARY KEY (id);
ALTER TABLE public.rounds ADD CONSTRAINT rounds_round_type_check CHECK ((round_type = ANY (ARRAY['round_robin'::text, 'par_match'::text, 'elimination'::text, 'finals_gold'::text, 'finals_bronze'::text])));
ALTER TABLE public.rounds ADD CONSTRAINT rounds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'completed'::text])));
ALTER TABLE public.rounds ADD CONSTRAINT rounds_tournament_id_round_number_key UNIQUE (tournament_id, round_number);
ALTER TABLE public.standings ADD CONSTRAINT standings_pkey PRIMARY KEY (id);
ALTER TABLE public.standings ADD CONSTRAINT standings_round_id_player_id_key UNIQUE (round_id, player_id);
ALTER TABLE public.standings ADD CONSTRAINT standings_round_id_team_id_key UNIQUE (round_id, team_id);
ALTER TABLE public.team_members ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);
ALTER TABLE public.team_members ADD CONSTRAINT team_members_team_id_user_id_key UNIQUE (team_id, user_id);
ALTER TABLE public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE public.tournament_admins ADD CONSTRAINT tournament_admins_pkey PRIMARY KEY (id);
ALTER TABLE public.tournament_admins ADD CONSTRAINT tournament_admins_tournament_id_succession_order_key UNIQUE (tournament_id, succession_order);
ALTER TABLE public.tournament_admins ADD CONSTRAINT tournament_admins_tournament_id_user_id_key UNIQUE (tournament_id, user_id);
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_exit_reason_check CHECK ((exit_reason = ANY (ARRAY['withdrew'::text, 'retired'::text, 'disqualified'::text])));
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_joined_via_check CHECK ((joined_via = ANY (ARRAY['code'::text, 'link'::text, 'invite'::text, 'search'::text])));
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_pkey PRIMARY KEY (id);
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_tournament_id_user_id_key UNIQUE (tournament_id, user_id);
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_court_count_check CHECK ((court_count >= 1));
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_finals_format_check CHECK ((finals_format = ANY (ARRAY['top2'::text, 'top4'::text, 'none'::text])));
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_finals_trigger_check CHECK ((finals_trigger = ANY (ARRAY['after_elimination'::text, 'after_round_robin'::text, 'none'::text])));
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_join_code_key UNIQUE (join_code);
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_max_players_check CHECK ((max_players >= 2));
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_name_key UNIQUE (name);
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_pkey PRIMARY KEY (id);
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_second_round_format_check CHECK ((second_round_format = ANY (ARRAY['round_robin'::text, 'par_match'::text, 'none'::text])));
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'registration'::text, 'active'::text, 'finals'::text, 'completed'::text])));
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_type_check CHECK ((type = ANY (ARRAY['singles'::text, 'doubles'::text, 'mixed'::text])));
ALTER TABLE public.matches ADD CONSTRAINT matches_bracket_next_loser_match_id_fkey FOREIGN KEY (bracket_next_loser_match_id) REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_bracket_next_winner_match_id_fkey FOREIGN KEY (bracket_next_winner_match_id) REFERENCES matches(id) ON DELETE SET NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES profiles(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_player_a1_id_fkey FOREIGN KEY (player_a1_id) REFERENCES profiles(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_player_a2_id_fkey FOREIGN KEY (player_a2_id) REFERENCES profiles(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_player_b1_id_fkey FOREIGN KEY (player_b1_id) REFERENCES profiles(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_player_b2_id_fkey FOREIGN KEY (player_b2_id) REFERENCES profiles(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_round_id_fkey FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE;
ALTER TABLE public.matches ADD CONSTRAINT matches_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES teams(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES teams(id);
ALTER TABLE public.matches ADD CONSTRAINT matches_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.matches ADD CONSTRAINT matches_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES profiles(id);
ALTER TABLE public.mixed_pairings ADD CONSTRAINT mixed_pairings_player_a_id_fkey FOREIGN KEY (player_a_id) REFERENCES profiles(id);
ALTER TABLE public.mixed_pairings ADD CONSTRAINT mixed_pairings_player_b_id_fkey FOREIGN KEY (player_b_id) REFERENCES profiles(id);
ALTER TABLE public.mixed_pairings ADD CONSTRAINT mixed_pairings_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.standings ADD CONSTRAINT standings_player_id_fkey FOREIGN KEY (player_id) REFERENCES profiles(id);
ALTER TABLE public.standings ADD CONSTRAINT standings_round_id_fkey FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE;
ALTER TABLE public.standings ADD CONSTRAINT standings_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
ALTER TABLE public.standings ADD CONSTRAINT standings_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.teams ADD CONSTRAINT teams_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.tournament_admins ADD CONSTRAINT tournament_admins_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id);
ALTER TABLE public.tournament_admins ADD CONSTRAINT tournament_admins_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.tournament_admins ADD CONSTRAINT tournament_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
ALTER TABLE public.tournament_players ADD CONSTRAINT tournament_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
CREATE INDEX idx_matches_round ON public.matches USING btree (round_id);
CREATE INDEX idx_matches_tournament ON public.matches USING btree (tournament_id);
CREATE INDEX idx_mixed_pairings_tournament ON public.mixed_pairings USING btree (tournament_id);
CREATE UNIQUE INDEX profiles_username_lower_unique ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX idx_standings_round ON public.standings USING btree (round_id);
CREATE INDEX idx_standings_tournament ON public.standings USING btree (tournament_id);
CREATE INDEX idx_team_members_team ON public.team_members USING btree (team_id);
CREATE INDEX idx_team_members_user ON public.team_members USING btree (user_id);
CREATE INDEX idx_teams_tournament ON public.teams USING btree (tournament_id);
CREATE INDEX idx_tournament_admins_tournament ON public.tournament_admins USING btree (tournament_id);
CREATE INDEX idx_tournament_players_tournament ON public.tournament_players USING btree (tournament_id);
CREATE INDEX idx_tournament_players_user ON public.tournament_players USING btree (user_id);
CREATE OR REPLACE FUNCTION public.handle_admin_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.handle_new_tournament()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO tournament_admins (tournament_id, user_id, succession_order, granted_by)
  VALUES (NEW.id, NEW.created_by, 1, NEW.created_by);
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
    insert into public.profiles (
        id,
        email,
        first_name,
        last_name,
        avatar_url
    )
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(new.raw_user_meta_data->>'given_name', split_part(coalesce(new.email, ''), '@', 1)),
        new.raw_user_meta_data->>'family_name',
        coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
    )
    on conflict (id) do update
    set email = excluded.email
    where public.profiles.email is distinct from excluded.email;

    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.is_tournament_admin(t_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tournament_admins
    WHERE tournament_id = t_id AND user_id = auth.uid()
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_tournament_member(t_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM tournament_players
    WHERE tournament_id = t_id AND user_id = auth.uid() AND status = 'approved'
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_valid_profile_time_zone(value text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT value IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = value
  );
$function$;
CREATE OR REPLACE FUNCTION public.profile_time_zone_from_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE selected_zone text := NEW.raw_user_meta_data->>'time_zone';
BEGIN
  IF public.is_valid_profile_time_zone(selected_zone) THEN
    UPDATE public.profiles SET time_zone = selected_zone
    WHERE id = NEW.id AND time_zone IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.profiles_guard_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
 if current_user in ('anon','authenticated') then
  if (tg_op = 'INSERT' and coalesce(new.is_system_admin,false)) or
     (tg_op = 'UPDATE' and new.is_system_admin is distinct from old.is_system_admin) then
   raise exception 'ADMIN_FLAG_REQUIRES_SERVICE_ROLE' using errcode='42501';
  end if;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.validate_profile_time_zone()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.time_zone IS NOT NULL AND NOT public.is_valid_profile_time_zone(NEW.time_zone) THEN
    RAISE EXCEPTION 'Choose a valid IANA time zone.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mixed_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matches_delete_admin" ON public.matches AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() IN ( SELECT tournament_admins.user_id
   FROM tournament_admins
  WHERE (tournament_admins.tournament_id = matches.tournament_id))));
CREATE POLICY "matches_enter_score" ON public.matches AS PERMISSIVE FOR UPDATE TO public USING ((is_tournament_admin(tournament_id) OR is_tournament_member(tournament_id)));
CREATE POLICY "matches_insert_admin" ON public.matches AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() IN ( SELECT tournament_admins.user_id
   FROM tournament_admins
  WHERE (tournament_admins.tournament_id = matches.tournament_id))));
CREATE POLICY "matches_read" ON public.matches AS PERMISSIVE FOR SELECT TO public USING ((is_tournament_member(tournament_id) OR is_tournament_admin(tournament_id)));
CREATE POLICY "mixed_pairings_read" ON public.mixed_pairings AS PERMISSIVE FOR SELECT TO public USING ((is_tournament_member(tournament_id) OR is_tournament_admin(tournament_id)));
CREATE POLICY "profiles_insert_own" ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = id));
CREATE POLICY "profiles_read_own" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "profiles_update_own" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));
CREATE POLICY "rounds_manage_admin" ON public.rounds AS PERMISSIVE FOR ALL TO public USING (is_tournament_admin(tournament_id));
CREATE POLICY "rounds_read" ON public.rounds AS PERMISSIVE FOR SELECT TO public USING ((is_tournament_member(tournament_id) OR is_tournament_admin(tournament_id)));
CREATE POLICY "standings_read" ON public.standings AS PERMISSIVE FOR SELECT TO public USING ((is_tournament_member(tournament_id) OR is_tournament_admin(tournament_id)));
CREATE POLICY "team_members_manage_admin" ON public.team_members AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM (teams t
     JOIN tournament_admins ta ON ((ta.tournament_id = t.tournament_id)))
  WHERE ((t.id = team_members.team_id) AND (ta.user_id = auth.uid())))));
CREATE POLICY "team_members_read" ON public.team_members AS PERMISSIVE FOR SELECT TO public USING (((EXISTS ( SELECT 1
   FROM (teams t
     JOIN tournament_players tp ON ((tp.tournament_id = t.tournament_id)))
  WHERE ((t.id = team_members.team_id) AND (tp.user_id = auth.uid()) AND (tp.status = 'approved'::text)))) OR (EXISTS ( SELECT 1
   FROM (teams t
     JOIN tournament_admins ta ON ((ta.tournament_id = t.tournament_id)))
  WHERE ((t.id = team_members.team_id) AND (ta.user_id = auth.uid()))))));
CREATE POLICY "team_members_self_join" ON public.team_members AS PERMISSIVE FOR INSERT TO public WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (teams t
     JOIN tournament_players tp ON ((tp.tournament_id = t.tournament_id)))
  WHERE ((t.id = team_members.team_id) AND (tp.user_id = auth.uid()) AND (tp.status = 'approved'::text))))));
CREATE POLICY "teams_manage_admin" ON public.teams AS PERMISSIVE FOR ALL TO public USING (is_tournament_admin(tournament_id));
CREATE POLICY "teams_read" ON public.teams AS PERMISSIVE FOR SELECT TO public USING ((is_tournament_member(tournament_id) OR is_tournament_admin(tournament_id)));
CREATE POLICY "tournament_admins_manage" ON public.tournament_admins AS PERMISSIVE FOR ALL TO public USING (is_tournament_admin(tournament_id));
CREATE POLICY "tournament_admins_read" ON public.tournament_admins AS PERMISSIVE FOR SELECT TO public USING ((is_tournament_admin(tournament_id) OR is_tournament_member(tournament_id)));
CREATE POLICY "tournament_players_admin_delete" ON public.tournament_players AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() IN ( SELECT tournament_admins.user_id
   FROM tournament_admins
  WHERE (tournament_admins.tournament_id = tournament_players.tournament_id))));
CREATE POLICY "tournament_players_admin_insert" ON public.tournament_players AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() IN ( SELECT tournament_admins.user_id
   FROM tournament_admins
  WHERE (tournament_admins.tournament_id = tournament_players.tournament_id))));
CREATE POLICY "tournament_players_delete_own_pending" ON public.tournament_players AS PERMISSIVE FOR DELETE TO public USING (((auth.uid() = user_id) AND (status = 'pending'::text)));
CREATE POLICY "tournament_players_insert" ON public.tournament_players AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "tournament_players_insert_admin" ON public.tournament_players AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() IN ( SELECT tournament_admins.user_id
   FROM tournament_admins
  WHERE (tournament_admins.tournament_id = tournament_players.tournament_id))));
CREATE POLICY "tournament_players_read" ON public.tournament_players AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = user_id) OR is_tournament_admin(tournament_id)));
CREATE POLICY "tournament_players_update_admin" ON public.tournament_players AS PERMISSIVE FOR UPDATE TO public USING (is_tournament_admin(tournament_id));
CREATE POLICY "tournaments_insert_auth" ON public.tournaments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = created_by));
CREATE POLICY "tournaments_read_public" ON public.tournaments AS PERMISSIVE FOR SELECT TO public USING (((is_public = true) OR is_tournament_member(id) OR is_tournament_admin(id)));
CREATE POLICY "tournaments_update_admin" ON public.tournaments AS PERMISSIVE FOR UPDATE TO public USING (is_tournament_admin(id));
CREATE TRIGGER matches_updated_at BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER profiles_guard_admin BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION profiles_guard_admin();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER profiles_validate_time_zone BEFORE INSERT OR UPDATE OF time_zone ON public.profiles FOR EACH ROW EXECUTE FUNCTION validate_profile_time_zone();
CREATE TRIGGER on_admin_deleted AFTER DELETE ON public.tournament_admins FOR EACH ROW EXECUTE FUNCTION handle_admin_deleted();
CREATE TRIGGER on_tournament_created AFTER INSERT ON public.tournaments FOR EACH ROW EXECUTE FUNCTION handle_new_tournament();
CREATE TRIGGER tournaments_updated_at BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER z_profile_time_zone_from_auth AFTER INSERT OR UPDATE OF raw_user_meta_data, email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION profile_time_zone_from_auth();
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
REVOKE ALL ON public.matches FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.matches TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
REVOKE ALL ON public.mixed_pairings FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.mixed_pairings TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.mixed_pairings TO authenticated;
GRANT ALL ON public.mixed_pairings TO service_role;
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE,UPDATE ON public.profiles TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
REVOKE ALL ON public.rounds FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.rounds TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.rounds TO authenticated;
GRANT ALL ON public.rounds TO service_role;
REVOKE ALL ON public.standings FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.standings TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.standings TO authenticated;
GRANT ALL ON public.standings TO service_role;
REVOKE ALL ON public.team_members FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.team_members TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
REVOKE ALL ON public.teams FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.teams TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
REVOKE ALL ON public.tournament_admins FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tournament_admins TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tournament_admins TO authenticated;
GRANT ALL ON public.tournament_admins TO service_role;
REVOKE ALL ON public.tournament_players FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tournament_players TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tournament_players TO authenticated;
GRANT ALL ON public.tournament_players TO service_role;
REVOKE ALL ON public.tournaments FROM PUBLIC,anon,authenticated,service_role;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tournaments TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tournaments TO authenticated;
GRANT ALL ON public.tournaments TO service_role;
REVOKE ALL ON FUNCTION public.handle_admin_deleted() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.handle_admin_deleted() TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_tournament() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_tournament() TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE ALL ON FUNCTION public.is_tournament_admin(t_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(t_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(t_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(t_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_admin(t_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_tournament_member(t_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_tournament_member(t_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_tournament_member(t_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_tournament_member(t_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_member(t_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.is_valid_profile_time_zone(value text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_profile_time_zone(value text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_valid_profile_time_zone(value text) TO anon;
GRANT EXECUTE ON FUNCTION public.is_valid_profile_time_zone(value text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_profile_time_zone(value text) TO service_role;
REVOKE ALL ON FUNCTION public.profile_time_zone_from_auth() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.profile_time_zone_from_auth() TO service_role;
REVOKE ALL ON FUNCTION public.profiles_guard_admin() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.profiles_guard_admin() TO service_role;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.validate_profile_time_zone() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.validate_profile_time_zone() TO service_role;
COMMIT;



