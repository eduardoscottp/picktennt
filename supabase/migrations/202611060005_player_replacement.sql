BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_player_replacement(actor uuid,event uuid,request jsonb,effects jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE ev public.tournaments%ROWTYPE; old_member public.team_members%ROWTYPE; prior_member public.team_members%ROWTYPE;
 old_player public.tournament_players%ROWTYPE; new_player public.tournament_players%ROWTYPE;
 team_id uuid; old_id uuid; new_id uuid; old_patch jsonb; new_patch jsonb; team_patch jsonb; old_projection jsonb; new_projection jsonb;
 match_row public.matches%ROWTYPE; expected_patch jsonb; actual_patch jsonb; expected_updates integer:=0;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 IF NOT coalesce(ev.modular_state IN ('registration_open','registration_closed','ready','active'),false) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF NOT coalesce(ev.type IN ('singles','doubles'),false) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['team_id','old_user_id','new_user_id','reason','preview_hash']);
 IF jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000 OR coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 team_id:=(request->>'team_id')::uuid; old_id:=(request->>'old_user_id')::uuid; new_id:=(request->>'new_user_id')::uuid;
 IF team_id IS NULL OR old_id IS NULL OR new_id IS NULL OR old_id=new_id THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.teams t WHERE t.id=team_id AND t.tournament_id=event AND t.entry_state='approved') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 SELECT * INTO old_member FROM public.team_members m WHERE m.team_id=team_id AND m.tournament_id=event AND m.user_id=old_id AND m.membership_status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.team_members m WHERE m.tournament_id=event AND m.user_id=old_id AND m.id<>old_member.id AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=new_id) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.team_members m WHERE m.tournament_id=event AND m.user_id=new_id AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
 SELECT * INTO prior_member FROM public.team_members m WHERE m.team_id=team_id AND m.user_id=new_id LIMIT 1;
 SELECT * INTO old_player FROM public.tournament_players p WHERE p.tournament_id=event AND p.user_id=old_id;
 SELECT * INTO new_player FROM public.tournament_players p WHERE p.tournament_id=event AND p.user_id=new_id;
 IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND team_id IN (m.team_a_id,m.team_b_id)
  AND (m.started_at IS NOT NULL OR m.score_a IS NOT NULL OR m.score_b IS NOT NULL OR m.status IN ('in_progress','score_entered','validated','walkover','disputed'))
  AND CASE WHEN m.team_a_id=team_id THEN (m.player_a1_id IS NULL OR (ev.type='doubles' AND (m.player_a2_id IS NULL OR m.player_a2_id=m.player_a1_id)))
           ELSE (m.player_b1_id IS NULL OR (ev.type='doubles' AND (m.player_b2_id IS NULL OR m.player_b2_id=m.player_b1_id))) END
 ) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND m.status='scheduled' AND m.started_at IS NULL AND m.score_a IS NULL AND m.score_b IS NULL AND team_id IN (m.team_a_id,m.team_b_id) AND CASE WHEN m.team_a_id=team_id THEN
  num_nonnulls(m.player_a1_id,m.player_a2_id)>0 AND (num_nonnulls(m.player_a1_id,m.player_a2_id)<>(CASE ev.type WHEN 'singles' THEN 1 ELSE 2 END) OR (m.player_a1_id IS NOT NULL AND m.player_a1_id=m.player_a2_id) OR NOT coalesce(old_id IN (m.player_a1_id,m.player_a2_id),false))
 ELSE num_nonnulls(m.player_b1_id,m.player_b2_id)>0 AND (num_nonnulls(m.player_b1_id,m.player_b2_id)<>(CASE ev.type WHEN 'singles' THEN 1 ELSE 2 END) OR (m.player_b1_id IS NOT NULL AND m.player_b1_id=m.player_b2_id) OR NOT coalesce(old_id IN (m.player_b1_id,m.player_b2_id),false)) END) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','teams','team_members','tournament_players','matches']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['roster_revision']);
 IF effects#>>'{event,roster_revision}' IS DISTINCT FROM (ev.roster_revision+1)::text OR jsonb_array_length(coalesce(effects->'teams','[]'))<>1 OR jsonb_array_length(coalesce(effects->'team_members','[]'))<>2 OR jsonb_array_length(coalesce(effects->'tournament_players','[]'))<>2 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 team_patch:=effects->'teams'->0;
 PERFORM tournament_builder_private.assert_keys(team_patch,ARRAY['id','admin_definition_id','registered_by']);
 IF team_patch->>'id' IS DISTINCT FROM team_id::text OR team_patch->>'admin_definition_id' IS DISTINCT FROM ev.definition_id::text OR team_patch->>'registered_by' IS DISTINCT FROM actor::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT value INTO old_patch FROM jsonb_array_elements(effects->'team_members') WHERE value->>'id'=old_member.id::text;
 SELECT value INTO new_patch FROM jsonb_array_elements(effects->'team_members') WHERE value->>'user_id'=new_id::text;
 IF old_patch IS NULL OR new_patch IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 PERFORM tournament_builder_private.assert_keys(old_patch,ARRAY['id','membership_status']);
 PERFORM tournament_builder_private.assert_keys(new_patch,ARRAY['id','team_id','user_id','membership_status','admission_source','consented_at','consented_definition_id','player_slot']);
 IF jsonb_typeof(new_patch->'id') IS DISTINCT FROM 'string' OR old_patch->>'membership_status' IS DISTINCT FROM 'cancelled' OR new_patch->>'team_id' IS DISTINCT FROM team_id::text OR new_patch->>'membership_status' IS DISTINCT FROM 'active' OR new_patch->>'admission_source' IS DISTINCT FROM 'administrator' OR (new_patch->>'player_slot')::integer IS DISTINCT FROM old_member.player_slot OR (new_patch->>'consented_at')::timestamptz IS DISTINCT FROM prior_member.consented_at OR (new_patch->>'consented_definition_id')::uuid IS DISTINCT FROM prior_member.consented_definition_id OR (prior_member.id IS NOT NULL AND (new_patch->>'id')::uuid IS DISTINCT FROM prior_member.id) OR (prior_member.id IS NULL AND EXISTS(SELECT 1 FROM public.team_members WHERE id=(new_patch->>'id')::uuid)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT value INTO old_projection FROM jsonb_array_elements(effects->'tournament_players') WHERE value->>'user_id'=old_id::text;
 SELECT value INTO new_projection FROM jsonb_array_elements(effects->'tournament_players') WHERE value->>'user_id'=new_id::text;
 IF old_projection IS NULL OR new_projection IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 PERFORM tournament_builder_private.assert_keys(old_projection,ARRAY['id','user_id','status','joined_via']);
 PERFORM tournament_builder_private.assert_keys(new_projection,ARRAY['id','user_id','status','joined_via']);
 IF jsonb_typeof(old_projection->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(new_projection->'id') IS DISTINCT FROM 'string' OR old_projection->>'id'=new_projection->>'id' OR old_projection->>'status' IS DISTINCT FROM 'rejected' OR new_projection->>'status' IS DISTINCT FROM 'approved' OR old_projection->>'joined_via' IS DISTINCT FROM coalesce(old_player.joined_via,'link') OR new_projection->>'joined_via' IS DISTINCT FROM coalesce(new_player.joined_via,'link') OR (old_player.id IS NOT NULL AND old_projection->>'id' IS DISTINCT FROM old_player.id::text) OR (new_player.id IS NOT NULL AND new_projection->>'id' IS DISTINCT FROM new_player.id::text) OR (old_player.id IS NULL AND EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(old_projection->>'id')::uuid)) OR (new_player.id IS NULL AND EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(new_projection->>'id')::uuid)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR match_row IN SELECT * FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND m.status='scheduled' AND m.started_at IS NULL AND m.score_a IS NULL AND m.score_b IS NULL AND team_id IN (m.team_a_id,m.team_b_id) LOOP
  expected_patch:=jsonb_build_object('id',match_row.id);
  IF match_row.team_a_id=team_id AND match_row.player_a1_id=old_id THEN expected_patch:=expected_patch||jsonb_build_object('player_a1_id',new_id); END IF;
  IF match_row.team_a_id=team_id AND match_row.player_a2_id=old_id THEN expected_patch:=expected_patch||jsonb_build_object('player_a2_id',new_id); END IF;
  IF match_row.team_b_id=team_id AND match_row.player_b1_id=old_id THEN expected_patch:=expected_patch||jsonb_build_object('player_b1_id',new_id); END IF;
  IF match_row.team_b_id=team_id AND match_row.player_b2_id=old_id THEN expected_patch:=expected_patch||jsonb_build_object('player_b2_id',new_id); END IF;
  IF expected_patch IS DISTINCT FROM jsonb_build_object('id',match_row.id) THEN
   expected_updates:=expected_updates+1;
   SELECT value INTO actual_patch FROM jsonb_array_elements(coalesce(effects->'matches','[]')) WHERE value->>'id'=match_row.id::text;
   IF actual_patch IS DISTINCT FROM expected_patch THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<>expected_updates THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_player_replacement(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ARRAY['reviseTournament','updateEventDetails','addRegisteredEntry'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_REPLACEMENT_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$new$ARRAY['replacePlayer','reviseTournament','updateEventDetails','addRegisteredEntry'$new$);
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$'createDraft','updateDraft','publishTournament'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_REPLACEMENT_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$'createDraft','updateDraft','replacePlayer','publishTournament'$new$);
 anchor:=$old$p_command NOT IN ('addRegisteredEntry','reviseTournament','placeRegisteredPlayer')$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>2 THEN RAISE EXCEPTION 'PLAYER_REPLACEMENT_ADMISSION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$p_command NOT IN ('addRegisteredEntry','reviseTournament','placeRegisteredPlayer','replacePlayer')$new$);
 anchor:=$old$IF p_command='reviseTournament' THEN PERFORM tournament_builder_private.validate_revision(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_REPLACEMENT_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='replacePlayer' THEN PERFORM tournament_builder_private.validate_player_replacement(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 IF p_command='reviseTournament' THEN PERFORM tournament_builder_private.validate_revision(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 anchor:=$old$PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_id','court_number'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_REPLACEMENT_MATCH_KEYS_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command<>'replacePlayer' AND (row_data ? 'player_a1_id' OR row_data ? 'player_a2_id' OR row_data ? 'player_b1_id' OR row_data ? 'player_b2_id') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','player_a1_id','player_a2_id','player_b1_id','player_b2_id','round_id','court_number'$new$);
 anchor:=$old$ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,court_number=excluded.court_number$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'PLAYER_REPLACEMENT_MATCH_UPDATE_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$ON CONFLICT(id) DO UPDATE SET player_a1_id=excluded.player_a1_id,player_a2_id=excluded.player_a2_id,player_b1_id=excluded.player_b1_id,player_b2_id=excluded.player_b2_id,round_id=excluded.round_id,court_number=excluded.court_number$new$);
 EXECUTE source;
END $migration$;
COMMIT;
