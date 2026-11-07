BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_player_withdrawal(actor uuid,event uuid,request jsonb,effects jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE ev public.tournaments%ROWTYPE; member public.team_members%ROWTYPE; player public.tournament_players%ROWTYPE;
 team_id uuid; uid uuid; size integer; member_patch jsonb; player_patch jsonb; match_row public.matches%ROWTYPE;
 expected jsonb; actual jsonb; updated integer:=0; assigned integer; active_count integer;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 IF NOT coalesce(ev.modular_state IN ('registration_open','registration_closed','ready','active'),false) OR NOT coalesce(ev.type IN ('singles','doubles'),false) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['team_id','user_id','reason','preview_hash']);
 team_id:=(request->>'team_id')::uuid; uid:=(request->>'user_id')::uuid; size:=CASE ev.type WHEN 'singles' THEN 1 ELSE 2 END;
 IF team_id IS NULL OR uid IS NULL OR jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000 OR coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=team_id AND tournament_id=event AND entry_state='approved') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO member FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.user_id=uid AND m.membership_status='active';
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.tournament_id=event AND m.user_id=uid AND m.id<>member.id AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT * INTO player FROM public.tournament_players p WHERE p.tournament_id=event AND p.user_id=uid AND p.status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND team_id IN (m.team_a_id,m.team_b_id)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND m.status='scheduled' AND team_id IN (m.team_a_id,m.team_b_id) AND (m.started_at IS NOT NULL OR m.score_a IS NOT NULL OR m.score_b IS NOT NULL OR m.outcome_kind IS NOT NULL)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND team_id IN (m.team_a_id,m.team_b_id) AND (m.started_at IS NOT NULL OR m.score_a IS NOT NULL OR m.score_b IS NOT NULL OR m.status IN ('in_progress','score_entered','validated','walkover','disputed')) AND NOT coalesce(m.outcome_kind='walkover' AND m.started_at IS NULL AND m.score_a IS NULL AND m.score_b IS NULL,false) AND CASE WHEN m.team_a_id=team_id THEN num_nonnulls(m.player_a1_id,m.player_a2_id)<>size OR (m.player_a1_id IS NOT NULL AND m.player_a1_id=m.player_a2_id) ELSE num_nonnulls(m.player_b1_id,m.player_b2_id)<>size OR (m.player_b1_id IS NOT NULL AND m.player_b1_id=m.player_b2_id) END) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','team_members','tournament_players','matches']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['roster_revision']);
 IF effects#>>'{event,roster_revision}' IS DISTINCT FROM (ev.roster_revision+1)::text OR jsonb_array_length(coalesce(effects->'team_members','[]'))<>1 OR jsonb_array_length(coalesce(effects->'tournament_players','[]'))<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 member_patch:=effects->'team_members'->0; player_patch:=effects->'tournament_players'->0;
 IF member_patch IS DISTINCT FROM jsonb_build_object('id',member.id,'membership_status','cancelled') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF player_patch IS DISTINCT FROM jsonb_build_object('id',player.id,'user_id',uid,'status','rejected','joined_via',coalesce(player.joined_via,'link'),'exit_reason','withdrew','nullified_from_standings',false) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT count(*) INTO active_count FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.membership_status='active';
 FOR match_row IN SELECT * FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND m.status='scheduled' AND m.started_at IS NULL AND m.score_a IS NULL AND m.score_b IS NULL AND m.outcome_kind IS NULL AND team_id IN (m.team_a_id,m.team_b_id) LOOP
  assigned:=CASE WHEN match_row.team_a_id=team_id THEN num_nonnulls(match_row.player_a1_id,match_row.player_a2_id) ELSE num_nonnulls(match_row.player_b1_id,match_row.player_b2_id) END;
  IF assigned=0 THEN CONTINUE; END IF;
  IF assigned<>active_count OR (CASE WHEN match_row.team_a_id=team_id THEN NOT coalesce(uid IN (match_row.player_a1_id,match_row.player_a2_id),false) OR (match_row.player_a1_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.membership_status='active' AND m.user_id=match_row.player_a1_id)) OR (match_row.player_a2_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.membership_status='active' AND m.user_id=match_row.player_a2_id)) OR (match_row.player_a1_id IS NOT NULL AND match_row.player_a1_id=match_row.player_a2_id) ELSE NOT coalesce(uid IN (match_row.player_b1_id,match_row.player_b2_id),false) OR (match_row.player_b1_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.membership_status='active' AND m.user_id=match_row.player_b1_id)) OR (match_row.player_b2_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.membership_status='active' AND m.user_id=match_row.player_b2_id)) OR (match_row.player_b1_id IS NOT NULL AND match_row.player_b1_id=match_row.player_b2_id) END) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  expected:=jsonb_build_object('id',match_row.id);
  IF match_row.team_a_id=team_id AND match_row.player_a1_id=uid THEN expected:=expected||jsonb_build_object('player_a1_id',NULL); END IF;
  IF match_row.team_a_id=team_id AND match_row.player_a2_id=uid THEN expected:=expected||jsonb_build_object('player_a2_id',NULL); END IF;
  IF match_row.team_b_id=team_id AND match_row.player_b1_id=uid THEN expected:=expected||jsonb_build_object('player_b1_id',NULL); END IF;
  IF match_row.team_b_id=team_id AND match_row.player_b2_id=uid THEN expected:=expected||jsonb_build_object('player_b2_id',NULL); END IF;
  SELECT value INTO actual FROM jsonb_array_elements(coalesce(effects->'matches','[]')) WHERE value->>'id'=match_row.id::text;
  IF actual IS DISTINCT FROM expected OR (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'matches','[]')) WHERE value->>'id'=match_row.id::text)<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  updated:=updated+1;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<>updated THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_player_withdrawal(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ARRAY['forcePendingMatch','adminFillPosition','replacePlayer'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_WITHDRAWAL_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$new$ARRAY['withdrawPlayer','forcePendingMatch','adminFillPosition','replacePlayer'$new$);
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$'createDraft','updateDraft','forcePendingMatch','adminFillPosition'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_WITHDRAWAL_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$'createDraft','updateDraft','withdrawPlayer','forcePendingMatch','adminFillPosition'$new$);
 anchor:=$old$IF p_command='forcePendingMatch' THEN PERFORM tournament_builder_private.validate_force_pending_match(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_WITHDRAWAL_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='withdrawPlayer' THEN PERFORM tournament_builder_private.validate_player_withdrawal(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 IF p_command='forcePendingMatch' THEN PERFORM tournament_builder_private.validate_force_pending_match(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 anchor:=$old$p_command NOT IN ('replacePlayer','adminFillPosition') AND (row_data ? 'player_a1_id'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_WITHDRAWAL_MATCH_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$p_command NOT IN ('replacePlayer','adminFillPosition','withdrawPlayer') AND (row_data ? 'player_a1_id'$new$);
 EXECUTE source;
END $migration$;
COMMIT;
