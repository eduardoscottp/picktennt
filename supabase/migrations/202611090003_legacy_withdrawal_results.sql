BEGIN;
ALTER TABLE public.matches ADD COLUMN legacy_winner_side text CHECK(legacy_winner_side IN ('a','b'));

ALTER TABLE public.teams ADD COLUMN legacy_withdrawn_at timestamptz;
CREATE TABLE public.legacy_team_forfeit_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 team_id uuid NOT NULL REFERENCES public.teams(id), actor_id uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 previous_matches jsonb NOT NULL, previous_players jsonb NOT NULL DEFAULT '[]', previous_team jsonb NOT NULL
);
ALTER TABLE public.legacy_team_forfeit_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_team_forfeit_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.legacy_team_forfeit_audit TO authenticated;
CREATE POLICY legacy_forfeit_audit_admin_read ON public.legacy_team_forfeit_audit FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=tournament_id AND t.created_by=auth.uid()) OR public.is_tournament_admin(tournament_id)
);

CREATE FUNCTION tournament_builder_private.guard_legacy_result_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (NEW.legacy_winner_side,NEW.winner_team_id,NEW.outcome_kind) IS DISTINCT FROM (OLD.legacy_winner_side,OLD.winner_team_id,OLD.outcome_kind)
  AND auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.tournaments WHERE id=NEW.tournament_id AND engine_version='legacy')
  AND NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=NEW.tournament_id AND created_by=auth.uid())
  AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=NEW.tournament_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.guard_legacy_result_fields() FROM PUBLIC;
CREATE TRIGGER legacy_result_fields BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_legacy_result_fields();
-- Propagate resolved legacy results without replacing any played participants.
CREATE FUNCTION tournament_builder_private.reconcile_legacy_bracket(event uuid,previous_matches jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.matches%ROWTYPE; target public.matches%ROWTYPE; edge record; changed boolean;
 a_out boolean; b_out boolean; winner text; source_side text;
 team uuid; p1 uuid; p2 uuid; previous_flag text:=current_setting('app.legacy_reconciling',true);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=event AND engine_version='legacy' FOR UPDATE) THEN RETURN; END IF;
 PERFORM 1 FROM public.matches WHERE tournament_id=event ORDER BY id FOR UPDATE;
 IF EXISTS(WITH RECURSIVE edges AS (
  SELECT id,bracket_next_winner_match_id next FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL AND bracket_next_winner_match_id IS NOT NULL
  UNION ALL SELECT id,bracket_next_loser_match_id FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL AND bracket_next_loser_match_id IS NOT NULL
 ), paths AS (SELECT id,next,ARRAY[id] seen FROM edges UNION ALL SELECT p.id,e.next,p.seen||e.id FROM paths p JOIN edges e ON e.id=p.next WHERE NOT p.next=ANY(p.seen))
 SELECT 1 FROM paths WHERE next=ANY(seen)) THEN RAISE EXCEPTION 'INVALID_BRACKET'; END IF;
 IF EXISTS(SELECT next,side FROM (
  SELECT bracket_next_winner_match_id next,bracket_winner_fills_side side FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL
  UNION ALL SELECT bracket_next_loser_match_id,bracket_loser_fills_side FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL
 ) e WHERE next IS NOT NULL GROUP BY next,side HAVING count(*)>1) THEN RAISE EXCEPTION 'INVALID_BRACKET'; END IF;
 PERFORM set_config('app.legacy_reconciling','true',true);
 LOOP
  changed:=false;
  FOR m IN SELECT * FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL ORDER BY id LOOP
   IF m.status='scheduled' AND m.started_at IS NULL AND m.score_a IS NULL AND m.score_b IS NULL AND m.team_a_id IS NOT NULL AND m.team_b_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.teams WHERE id=m.team_a_id AND legacy_withdrawn_at IS NOT NULL) INTO a_out;
    SELECT EXISTS(SELECT 1 FROM public.teams WHERE id=m.team_b_id AND legacy_withdrawn_at IS NOT NULL) INTO b_out;
    IF a_out AND b_out THEN RAISE EXCEPTION 'OPPONENT_WITHDRAWN'; END IF;
    IF a_out OR b_out THEN
     INSERT INTO public.legacy_team_forfeit_audit(tournament_id,team_id,actor_id,previous_matches,previous_team)
      SELECT event,t.id,auth.uid(),jsonb_build_array(to_jsonb(m)),to_jsonb(t) FROM public.teams t WHERE t.id=CASE WHEN a_out THEN m.team_a_id ELSE m.team_b_id END;
     UPDATE public.matches SET status='walkover',outcome_kind='walkover',legacy_winner_side=CASE WHEN a_out THEN 'b' ELSE 'a' END,
      winner_team_id=CASE WHEN a_out THEN team_b_id ELSE team_a_id END,score_a=CASE WHEN a_out THEN 0 ELSE 11 END,score_b=CASE WHEN a_out THEN 11 ELSE 0 END,
      submit_to_dupr=false,ended_at=coalesce(ended_at,now()) WHERE id=m.id;
     changed:=true;
    END IF;
   END IF;
  END LOOP;
  FOR m IN SELECT * FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL AND status IN ('validated','walkover') ORDER BY id LOOP
   winner:=coalesce(m.legacy_winner_side,CASE WHEN m.winner_team_id=m.team_a_id THEN 'a' WHEN m.winner_team_id=m.team_b_id THEN 'b' END,
    CASE WHEN m.status='validated' AND coalesce(m.outcome_kind,'played')='played' THEN CASE WHEN m.score_a>m.score_b THEN 'a' WHEN m.score_b>m.score_a THEN 'b' END END);
   IF winner IS NULL AND m.outcome_kind IS DISTINCT FROM 'no_contest' THEN CONTINUE; END IF;
   FOR edge IN SELECT m.bracket_next_winner_match_id AS id,m.bracket_winner_fills_side AS side,true AS winning
     UNION ALL SELECT m.bracket_next_loser_match_id,m.bracket_loser_fills_side,false LOOP
    IF edge.id IS NULL THEN CONTINUE; END IF;
    IF edge.side IS NULL OR edge.id=m.id THEN RAISE EXCEPTION 'INVALID_BRACKET'; END IF;
    SELECT * INTO target FROM public.matches WHERE id=edge.id AND tournament_id=event AND is_current AND voided_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_BRACKET'; END IF;
    source_side:=CASE WHEN winner IS NULL THEN NULL WHEN edge.winning THEN winner WHEN winner='a' THEN 'b' ELSE 'a' END;
    team:=CASE source_side WHEN 'a' THEN m.team_a_id WHEN 'b' THEN m.team_b_id END;
    p1:=CASE source_side WHEN 'a' THEN m.player_a1_id WHEN 'b' THEN m.player_b1_id END;
    p2:=CASE source_side WHEN 'a' THEN m.player_a2_id WHEN 'b' THEN m.player_b2_id END;
    -- Existing team identity already resolved: its future lineup may have a legitimate replacement.
    IF team IS NOT NULL AND team IS NOT DISTINCT FROM (CASE edge.side WHEN 'a' THEN target.team_a_id ELSE target.team_b_id END) THEN CONTINUE; END IF;
    IF team IS NULL AND p1 IS NOT DISTINCT FROM (CASE edge.side WHEN 'a' THEN target.player_a1_id ELSE target.player_b1_id END)
       AND p2 IS NOT DISTINCT FROM (CASE edge.side WHEN 'a' THEN target.player_a2_id ELSE target.player_b2_id END)
       AND (CASE edge.side WHEN 'a' THEN target.team_a_id ELSE target.team_b_id END) IS NULL THEN CONTINUE; END IF;
    IF target.status<>'scheduled' OR target.started_at IS NOT NULL OR target.score_a IS NOT NULL OR target.score_b IS NOT NULL THEN
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(previous_matches) prior WHERE prior->>'id'=target.id::text
       AND prior->>'status'='scheduled' AND prior->>'started_at' IS NULL AND prior->>'score_a' IS NULL AND prior->>'score_b' IS NULL) THEN
      RAISE EXCEPTION 'BRACKET_REVIEW_REQUIRED';
     END IF;
     RAISE EXCEPTION 'PLAYED_DESCENDANT';
    END IF;
    IF team IS NOT NULL THEN
     SELECT roster[1],roster[2] INTO p1,p2 FROM (SELECT array_agg(user_id ORDER BY id) roster FROM public.team_members WHERE team_id=team) r;
    END IF;
    UPDATE public.matches SET status='scheduled',outcome_kind=NULL,legacy_winner_side=NULL,winner_team_id=NULL,ended_at=NULL,
     team_a_id=CASE WHEN edge.side='a' THEN team ELSE team_a_id END,team_b_id=CASE WHEN edge.side='b' THEN team ELSE team_b_id END,
     player_a1_id=CASE WHEN edge.side='a' THEN p1 ELSE player_a1_id END,player_a2_id=CASE WHEN edge.side='a' THEN p2 ELSE player_a2_id END,
     player_b1_id=CASE WHEN edge.side='b' THEN p1 ELSE player_b1_id END,player_b2_id=CASE WHEN edge.side='b' THEN p2 ELSE player_b2_id END WHERE id=target.id;
    changed:=true;
   END LOOP;
  END LOOP;
  EXIT WHEN NOT changed;
 END LOOP;
 PERFORM set_config('app.legacy_reconciling',coalesce(previous_flag,''),true);
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.reconcile_legacy_bracket(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION tournament_builder_private.legacy_bracket_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('app.legacy_reconciling',true) IS DISTINCT FROM 'true'
  AND EXISTS(SELECT 1 FROM public.tournaments WHERE id=NEW.tournament_id AND engine_version='legacy') THEN
  PERFORM tournament_builder_private.reconcile_legacy_bracket(NEW.tournament_id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.legacy_bracket_changed() FROM PUBLIC;
CREATE TRIGGER legacy_bracket_changed AFTER UPDATE OF status,team_a_id,team_b_id,player_a1_id,player_b1_id ON public.matches
FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.legacy_bracket_changed();

CREATE FUNCTION public.legacy_forfeit_team(p_tournament_id uuid,p_team_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); ev public.tournaments%ROWTYPE; withdrawn public.teams%ROWTYPE;
 before_matches jsonb; before_players jsonb; affected integer; previous_flag text:=current_setting('app.legacy_reconciling',true);
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 SELECT * INTO ev FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF NOT FOUND OR ev.engine_version<>'legacy' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF ev.created_by<>actor AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=ev.id AND user_id=actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF ev.status NOT IN ('active','finals','completed') OR ev.type NOT IN ('singles','doubles') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT * INTO withdrawn FROM public.teams WHERE id=p_team_id AND tournament_id=ev.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF withdrawn.legacy_withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'TEAM_WITHDRAWN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_members WHERE team_id=p_team_id) THEN RAISE EXCEPTION 'STALE_ROSTER'; END IF;
 PERFORM 1 FROM public.matches WHERE tournament_id=ev.id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=ev.id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=ev.id AND m.is_current AND m.voided_at IS NULL AND p_team_id IN (m.team_a_id,m.team_b_id)
   AND (m.team_a_id IS NULL OR m.team_b_id IS NULL OR m.team_a_id=m.team_b_id)) THEN RAISE EXCEPTION 'INCOMPLETE_OPPONENT'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches m JOIN public.teams opponent ON opponent.id=CASE WHEN m.team_a_id=p_team_id THEN m.team_b_id ELSE m.team_a_id END
  WHERE m.tournament_id=ev.id AND m.is_current AND m.voided_at IS NULL AND p_team_id IN (m.team_a_id,m.team_b_id)
  AND (opponent.legacy_withdrawn_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.team_members tm JOIN public.tournament_players tp ON tp.user_id=tm.user_id AND tp.tournament_id=ev.id
   WHERE tm.team_id=opponent.id AND tp.exit_reason IS NOT NULL))) THEN RAISE EXCEPTION 'OPPONENT_WITHDRAWN'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') INTO before_matches FROM public.matches m WHERE tournament_id=ev.id;
 SELECT coalesce(jsonb_agg(to_jsonb(tp)),'[]') INTO before_players FROM public.tournament_players tp WHERE tournament_id=ev.id
  AND user_id IN (SELECT user_id FROM public.team_members WHERE team_id=p_team_id);
 PERFORM set_config('app.legacy_reconciling','true',true);
 UPDATE public.teams SET legacy_withdrawn_at=now() WHERE id=p_team_id;
 UPDATE public.tournament_players SET status='rejected',exit_reason='withdrew',nullified_from_standings=false WHERE tournament_id=ev.id
  AND user_id IN (SELECT user_id FROM public.team_members WHERE team_id=p_team_id);
 UPDATE public.matches SET score_a=CASE WHEN team_a_id=p_team_id THEN 0 ELSE 11 END,score_b=CASE WHEN team_b_id=p_team_id THEN 0 ELSE 11 END,
  status='walkover',outcome_kind='walkover',legacy_winner_side=CASE WHEN team_a_id=p_team_id THEN 'b' ELSE 'a' END,
  winner_team_id=CASE WHEN team_a_id=p_team_id THEN team_b_id ELSE team_a_id END,submit_to_dupr=false,entered_by=actor,validated_by=actor,
  ended_at=coalesce(ended_at,now()) WHERE tournament_id=ev.id AND is_current AND voided_at IS NULL AND p_team_id IN (team_a_id,team_b_id);
 -- A changed feeder cannot replace participants of any resolved descendant.
 PERFORM tournament_builder_private.reconcile_legacy_bracket(ev.id,before_matches);
 INSERT INTO public.legacy_team_forfeit_audit(tournament_id,team_id,actor_id,previous_matches,previous_players,previous_team)
 SELECT ev.id,p_team_id,actor,coalesce(jsonb_agg(old.row),'[]'),before_players,to_jsonb(withdrawn)
 FROM jsonb_array_elements(before_matches) old(row) JOIN public.matches m ON m.id=(old.row->>'id')::uuid WHERE to_jsonb(m) IS DISTINCT FROM old.row;
 SELECT count(*) INTO affected FROM public.matches WHERE tournament_id=ev.id AND is_current AND voided_at IS NULL AND p_team_id IN (team_a_id,team_b_id);
 -- Materialized legacy standings will be recomputed by their normal readers.
 DELETE FROM public.standings WHERE tournament_id=ev.id;
 PERFORM set_config('app.legacy_reconciling',coalesce(previous_flag,''),true);
 RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.legacy_forfeit_team(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.legacy_forfeit_team(uuid,uuid) TO authenticated;

-- SECURITY DEFINER is necessary because the historical UPDATE RLS policy checks
-- both old and new rows, and excludes the validated state even for an admin.
CREATE FUNCTION public.legacy_record_admin_score(p_match_id uuid,p_score_a integer DEFAULT NULL,p_score_b integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); ev public.tournaments%ROWTYPE; m public.matches%ROWTYPE; sa integer; sb integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 SELECT t.* INTO ev FROM public.tournaments t JOIN public.matches candidate ON candidate.tournament_id=t.id WHERE candidate.id=p_match_id FOR UPDATE OF t;
 IF NOT FOUND OR ev.engine_version<>'legacy' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF ev.created_by<>actor AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=ev.id AND user_id=actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM 1 FROM public.matches WHERE tournament_id=ev.id ORDER BY id FOR UPDATE;
 SELECT * INTO m FROM public.matches WHERE id=p_match_id;
 IF ev.status='cancelled' OR NOT m.is_current OR m.voided_at IS NOT NULL OR m.status='walkover'
  OR ((p_score_a IS NULL OR p_score_b IS NULL) AND m.status<>'score_entered') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.teams WHERE id IN (m.team_a_id,m.team_b_id) AND legacy_withdrawn_at IS NOT NULL) THEN RAISE EXCEPTION 'TEAM_WITHDRAWN'; END IF;
 sa:=coalesce(p_score_a,m.score_a); sb:=coalesce(p_score_b,m.score_b);
 IF (p_score_a IS NULL)<>(p_score_b IS NULL) OR sa IS NULL OR sb IS NULL OR sa<0 OR sb<0 OR sa=sb THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
 UPDATE public.matches SET score_a=sa,score_b=sb,status='validated',outcome_kind='played',legacy_winner_side=CASE WHEN sa>sb THEN 'a' ELSE 'b' END,
  winner_team_id=CASE WHEN sa>sb THEN team_a_id ELSE team_b_id END,validated_by=actor,
  entered_by=CASE WHEN p_score_a IS NULL THEN entered_by ELSE actor END WHERE id=p_match_id;
 UPDATE public.tournaments SET status='active' WHERE id=ev.id AND status IN ('draft','registration');
END $$;
REVOKE ALL ON FUNCTION public.legacy_record_admin_score(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.legacy_record_admin_score(uuid,integer,integer) TO authenticated;
COMMIT;

