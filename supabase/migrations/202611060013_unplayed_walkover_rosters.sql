BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.snapshot_match_players() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_type text; players uuid[]; side text; expected integer;
BEGIN
 IF OLD.status NOT IN ('scheduled','in_progress') OR NEW.status NOT IN ('in_progress','score_entered','validated','walkover')
    OR NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=NEW.tournament_id AND engine_version='modular_v1') THEN RETURN NEW; END IF;
 SELECT type INTO event_type FROM public.tournaments WHERE id=NEW.tournament_id;
 expected:=CASE event_type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END;
 FOREACH side IN ARRAY ARRAY['a','b'] LOOP
  IF (side='a' AND NEW.player_a1_id IS NULL AND NEW.player_a2_id IS NULL) OR (side='b' AND NEW.player_b1_id IS NULL AND NEW.player_b2_id IS NULL) THEN
   SELECT array_agg(user_id ORDER BY player_slot NULLS LAST, id) INTO players FROM public.team_members
    WHERE tournament_id=NEW.tournament_id AND team_id=CASE side WHEN 'a' THEN NEW.team_a_id ELSE NEW.team_b_id END AND membership_status='active';
   IF cardinality(players)=expected OR (NEW.outcome_kind='walkover' AND NEW.started_at IS NULL AND NEW.score_a IS NULL AND NEW.score_b IS NULL AND cardinality(players) BETWEEN 1 AND expected) THEN
    IF side='a' THEN NEW.player_a1_id:=players[1]; NEW.player_a2_id:=players[2];
    ELSE NEW.player_b1_id:=players[1]; NEW.player_b2_id:=players[2]; END IF;
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DO $migration$
DECLARE source text; anchor text; proc regprocedure;
BEGIN
 FOREACH proc IN ARRAY ARRAY['tournament_builder_private.validate_player_replacement(uuid,uuid,jsonb,jsonb)'::regprocedure,'tournament_builder_private.validate_admin_fill_position(uuid,uuid,jsonb,jsonb)'::regprocedure] LOOP
  SELECT pg_get_functiondef(proc) INTO source;
  anchor:=$old$m.status IN ('in_progress','score_entered','validated','walkover','disputed'))$old$;
  IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'UNPLAYED_WALKOVER_GUARD_SOURCE_MISMATCH'; END IF;
  source:=replace(source,anchor,$new$m.status IN ('in_progress','score_entered','validated','walkover','disputed')) AND NOT coalesce(m.outcome_kind='walkover' AND m.started_at IS NULL AND m.score_a IS NULL AND m.score_b IS NULL,false)$new$);
  EXECUTE source;
 END LOOP;
END $migration$;
COMMIT;
