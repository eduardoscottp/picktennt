BEGIN;

CREATE FUNCTION tournament_builder_private.snapshot_legacy_match_players() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE expected integer; roster uuid[]; side text;
BEGIN
 SELECT CASE type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 END INTO expected
 FROM public.tournaments WHERE id=NEW.tournament_id AND engine_version='legacy';
 IF expected IS NULL OR NEW.status NOT IN ('in_progress','score_entered','validated','walkover','disputed') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (OLD.status NOT IN ('scheduled','in_progress') OR OLD.score_a IS NOT NULL OR OLD.score_b IS NOT NULL) THEN RETURN NEW; END IF;
 FOREACH side IN ARRAY ARRAY['a','b'] LOOP
  IF (side='a' AND NEW.player_a1_id IS NULL AND NEW.player_a2_id IS NULL) OR
     (side='b' AND NEW.player_b1_id IS NULL AND NEW.player_b2_id IS NULL) THEN
   SELECT array_agg(m.user_id ORDER BY m.id) INTO roster FROM public.team_members m
   JOIN public.tournament_players p ON p.tournament_id=NEW.tournament_id AND p.user_id=m.user_id AND p.status='approved'
   WHERE m.team_id=CASE side WHEN 'a' THEN NEW.team_a_id ELSE NEW.team_b_id END;
   IF cardinality(roster)=expected THEN
    IF side='a' THEN NEW.player_a1_id:=roster[1]; NEW.player_a2_id:=roster[2];
    ELSE NEW.player_b1_id:=roster[1]; NEW.player_b2_id:=roster[2]; END IF;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.snapshot_legacy_match_players() FROM PUBLIC;
CREATE TRIGGER legacy_snapshot_match_players BEFORE INSERT OR UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.snapshot_legacy_match_players();

CREATE FUNCTION public.legacy_set_team_player(p_tournament_id uuid,p_team_id uuid,p_user_id uuid,p_old_user_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); ev public.tournaments%ROWTYPE; administrator boolean; expected integer; roster uuid[]; prior uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 SELECT * INTO ev FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR ev.engine_version<>'legacy' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 administrator:=ev.created_by=actor OR EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=ev.id AND user_id=actor);
 IF NOT administrator AND (p_old_user_id IS NOT NULL OR p_user_id IS DISTINCT FROM actor OR ev.status<>'registration'
  OR NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=ev.id AND user_id=actor AND status='approved')) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF ev.status NOT IN ('registration','active','finals') OR ev.type NOT IN ('singles','doubles') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF p_user_id IS NULL OR p_user_id IS NOT DISTINCT FROM p_old_user_id THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
 PERFORM 1 FROM public.teams WHERE id=p_team_id AND tournament_id=ev.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 expected:=CASE ev.type WHEN 'singles' THEN 1 ELSE 2 END;
 -- A roster operation must not undo a prior withdrawal or standings exclusion.
 IF EXISTS(SELECT 1 FROM public.tournament_players p WHERE p.tournament_id=ev.id
  AND (p.user_id=p_user_id OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=p_team_id AND m.user_id=p.user_id))
  AND (p.exit_reason IS NOT NULL OR p.nullified_from_standings)) THEN RAISE EXCEPTION 'ROSTER_WITHDRAWN'; END IF;
 IF EXISTS(SELECT 1 FROM public.team_members WHERE tournament_id=ev.id AND user_id=p_user_id) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
 SELECT array_agg(user_id ORDER BY id) INTO roster FROM public.team_members WHERE team_id=p_team_id;
 IF p_old_user_id IS NULL THEN
  IF coalesce(cardinality(roster),0)>=expected THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;
 ELSE
  SELECT id INTO prior FROM public.team_members WHERE team_id=p_team_id AND user_id=p_old_user_id;
  IF NOT FOUND OR cardinality(roster)>expected THEN RAISE EXCEPTION 'STALE_ROSTER'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=ev.id AND user_id=p_old_user_id AND status='approved') THEN RAISE EXCEPTION 'STALE_ROSTER'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=ev.id AND user_id=p_user_id AND status='approved')
  AND (SELECT count(*) FROM public.tournament_players WHERE tournament_id=ev.id AND status='approved')
   -(CASE WHEN p_old_user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=ev.id AND user_id=p_old_user_id AND status='approved') THEN 1 ELSE 0 END) >= ev.max_players THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;

 -- Serialize against scoring before validating or changing a pending lineup.
 PERFORM 1 FROM public.matches WHERE tournament_id=ev.id AND p_team_id IN (team_a_id,team_b_id) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=ev.id AND p_team_id IN (team_a_id,team_b_id)
  AND is_current AND voided_at IS NULL AND (status IN ('in_progress','score_entered','disputed')
   OR (status='scheduled' AND (started_at IS NOT NULL OR score_a IS NOT NULL OR score_b IS NOT NULL)))) THEN RAISE EXCEPTION 'MATCH_IN_PROGRESS'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=ev.id AND p_team_id IN (team_a_id,team_b_id)
  AND (status<>'scheduled' OR started_at IS NOT NULL OR score_a IS NOT NULL OR score_b IS NOT NULL)
  AND CASE WHEN team_a_id=p_team_id THEN player_a1_id IS NULL OR (expected=2 AND (player_a2_id IS NULL OR player_a1_id=player_a2_id))
           ELSE player_b1_id IS NULL OR (expected=2 AND (player_b2_id IS NULL OR player_b1_id=player_b2_id)) END) THEN RAISE EXCEPTION 'AMBIGUOUS_HISTORY'; END IF;

 IF p_old_user_id IS NOT NULL THEN
  UPDATE public.team_members SET user_id=p_user_id WHERE id=prior;
  UPDATE public.tournament_players SET status='rejected' WHERE tournament_id=ev.id AND user_id=p_old_user_id;
 ELSE
  INSERT INTO public.team_members(team_id,tournament_id,user_id) VALUES(p_team_id,ev.id,p_user_id);
 END IF;
 INSERT INTO public.tournament_players(tournament_id,user_id,status,joined_via)
 VALUES(ev.id,p_user_id,'approved',CASE WHEN administrator THEN 'invite' ELSE 'link' END)
 ON CONFLICT(tournament_id,user_id) DO UPDATE SET status='approved',exit_reason=NULL,nullified_from_standings=false;
 SELECT array_agg(user_id ORDER BY id) INTO roster FROM public.team_members WHERE team_id=p_team_id;
 UPDATE public.matches SET
  player_a1_id=CASE WHEN team_a_id=p_team_id THEN roster[1] ELSE player_a1_id END,
  player_a2_id=CASE WHEN team_a_id=p_team_id THEN roster[2] ELSE player_a2_id END,
  player_b1_id=CASE WHEN team_b_id=p_team_id THEN roster[1] ELSE player_b1_id END,
  player_b2_id=CASE WHEN team_b_id=p_team_id THEN roster[2] ELSE player_b2_id END
 WHERE tournament_id=ev.id AND p_team_id IN (team_a_id,team_b_id) AND is_current AND voided_at IS NULL
  AND status='scheduled' AND started_at IS NULL AND score_a IS NULL AND score_b IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.legacy_set_team_player(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.legacy_set_team_player(uuid,uuid,uuid,uuid) TO authenticated;
COMMIT;
