BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_admin_fill_position(actor uuid,event uuid,request jsonb,effects jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE ev public.tournaments%ROWTYPE; target public.teams%ROWTYPE; prior public.team_members%ROWTYPE; player public.tournament_players%ROWTYPE;
 uid uuid; slot integer; pos integer; capacity integer; size integer; team_patch jsonb; member_patch jsonb; player_patch jsonb; team_id uuid;
 match_row public.matches%ROWTYPE; expected_patch jsonb; actual_patch jsonb; expected_updates integer:=0; assigned integer; active_count integer;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 IF NOT coalesce(ev.modular_state IN ('registration_open','registration_closed','ready','active'),false) OR ev.definition_id IS NULL OR NOT coalesce(ev.type IN ('singles','doubles'),false) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['user_id','slot_index','position','reason']);
 uid:=(request->>'user_id')::uuid; slot:=(request->>'slot_index')::integer; pos:=(request->>'position')::integer;
 SELECT (definition#>>'{registration,max_entries}')::integer INTO capacity FROM public.tournament_definitions WHERE id=ev.definition_id AND tournament_id=event;
 size:=CASE ev.type WHEN 'singles' THEN 1 ELSE 2 END;
 IF uid IS NULL OR NOT coalesce(slot BETWEEN 1 AND capacity AND pos BETWEEN 1 AND size,false) OR jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.team_members WHERE tournament_id=event AND user_id=uid AND membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
 SELECT * INTO player FROM public.tournament_players p WHERE p.tournament_id=event AND p.user_id=uid;
 IF player.status IS DISTINCT FROM 'approved' AND (SELECT count(*) FROM public.tournament_players p WHERE p.tournament_id=event AND p.status='approved')>=capacity*size THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;
 SELECT * INTO target FROM public.teams WHERE tournament_id=event AND registration_slot=slot;
 IF target.id IS NULL AND EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
 IF target.id IS NOT NULL AND target.entry_state IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF target.id IS NOT NULL AND (EXISTS(SELECT 1 FROM public.team_members WHERE team_id=target.id AND membership_status IN ('active','pending') AND (player_slot=pos OR (player_slot IS NULL AND pos=1))) OR (SELECT count(*) FROM public.team_members WHERE team_id=target.id AND membership_status IN ('active','pending'))>=size) THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;
 IF target.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND target.id IN (m.team_a_id,m.team_b_id) AND (m.started_at IS NOT NULL OR m.score_a IS NOT NULL OR m.score_b IS NOT NULL OR m.status IN ('in_progress','score_entered','validated','walkover','disputed')) AND CASE WHEN m.team_a_id=target.id THEN num_nonnulls(m.player_a1_id,m.player_a2_id)<>size OR (m.player_a1_id IS NOT NULL AND m.player_a1_id=m.player_a2_id) ELSE num_nonnulls(m.player_b1_id,m.player_b2_id)<>size OR (m.player_b1_id IS NOT NULL AND m.player_b1_id=m.player_b2_id) END) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
 IF target.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND target.id IN (m.team_a_id,m.team_b_id) AND (m.status='in_progress' OR (m.status='scheduled' AND (m.started_at IS NOT NULL OR m.score_a IS NOT NULL OR m.score_b IS NOT NULL)))) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','teams','team_members','tournament_players','matches']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['roster_revision']);
 IF effects#>>'{event,roster_revision}' IS DISTINCT FROM (ev.roster_revision+1)::text OR jsonb_array_length(coalesce(effects->'teams','[]'))<>1 OR jsonb_array_length(coalesce(effects->'team_members','[]'))<>1 OR jsonb_array_length(coalesce(effects->'tournament_players','[]'))<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 team_patch:=effects->'teams'->0; member_patch:=effects->'team_members'->0; player_patch:=effects->'tournament_players'->0;
 PERFORM tournament_builder_private.assert_keys(team_patch,ARRAY['id','name','entry_state','registration_slot','admin_definition_id','registered_by']);
 PERFORM tournament_builder_private.assert_keys(member_patch,ARRAY['id','team_id','user_id','membership_status','admission_source','player_slot','consented_at','consented_definition_id']);
 PERFORM tournament_builder_private.assert_keys(player_patch,ARRAY['id','user_id','status','joined_via','exit_reason','nullified_from_standings']);
 team_id:=(team_patch->>'id')::uuid;
 IF team_id IS NULL OR team_patch->>'admin_definition_id' IS DISTINCT FROM ev.definition_id::text OR team_patch->>'registered_by' IS DISTINCT FROM actor::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF target.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.teams WHERE id=team_id) OR team_patch->>'name' IS DISTINCT FROM ('Team '||slot) OR team_patch->>'entry_state' IS DISTINCT FROM 'approved' OR (team_patch->>'registration_slot')::integer IS DISTINCT FROM slot THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 ELSE
  IF team_id IS DISTINCT FROM target.id OR team_patch ? 'name' OR team_patch ? 'entry_state' OR team_patch ? 'registration_slot' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
 SELECT * INTO prior FROM public.team_members m WHERE m.team_id=team_id AND m.user_id=uid;
 IF member_patch->>'team_id' IS DISTINCT FROM team_id::text OR member_patch->>'user_id' IS DISTINCT FROM uid::text OR member_patch->>'membership_status' IS DISTINCT FROM 'active' OR member_patch->>'admission_source' IS DISTINCT FROM 'administrator' OR (member_patch->>'player_slot')::integer IS DISTINCT FROM pos OR (member_patch->>'consented_at')::timestamptz IS DISTINCT FROM prior.consented_at OR (member_patch->>'consented_definition_id')::uuid IS DISTINCT FROM prior.consented_definition_id OR (prior.id IS NOT NULL AND (member_patch->>'id')::uuid IS DISTINCT FROM prior.id) OR (prior.id IS NULL AND ((member_patch->>'id')::uuid IS NULL OR EXISTS(SELECT 1 FROM public.team_members WHERE id=(member_patch->>'id')::uuid))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF player_patch->>'user_id' IS DISTINCT FROM uid::text OR player_patch->>'status' IS DISTINCT FROM 'approved' OR player_patch->>'joined_via' IS DISTINCT FROM coalesce(player.joined_via,'link') OR player_patch->>'exit_reason' IS NOT NULL OR player_patch->>'nullified_from_standings' IS DISTINCT FROM 'false' OR (player.id IS NOT NULL AND (player_patch->>'id')::uuid IS DISTINCT FROM player.id) OR (player.id IS NULL AND ((player_patch->>'id')::uuid IS NULL OR EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(player_patch->>'id')::uuid))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT count(*) INTO active_count FROM public.team_members m WHERE m.team_id=team_id AND m.membership_status='active';
 FOR match_row IN SELECT * FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND m.status='scheduled' AND team_id IN (m.team_a_id,m.team_b_id) LOOP
  assigned:=CASE WHEN match_row.team_a_id=team_id THEN num_nonnulls(match_row.player_a1_id,match_row.player_a2_id) ELSE num_nonnulls(match_row.player_b1_id,match_row.player_b2_id) END;
  IF assigned=0 THEN CONTINUE; END IF;
  IF assigned<>active_count OR assigned>=size OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.membership_status='pending') OR (CASE WHEN match_row.team_a_id=team_id THEN (match_row.player_a1_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.membership_status='active' AND m.user_id=match_row.player_a1_id)) OR (match_row.player_a2_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.membership_status='active' AND m.user_id=match_row.player_a2_id)) OR (match_row.player_a1_id IS NOT NULL AND match_row.player_a1_id=match_row.player_a2_id) ELSE (match_row.player_b1_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.membership_status='active' AND m.user_id=match_row.player_b1_id)) OR (match_row.player_b2_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=team_id AND m.membership_status='active' AND m.user_id=match_row.player_b2_id)) OR (match_row.player_b1_id IS NOT NULL AND match_row.player_b1_id=match_row.player_b2_id) END) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
  expected_patch:=jsonb_build_object('id',match_row.id);
  IF match_row.team_a_id=team_id THEN expected_patch:=expected_patch||jsonb_build_object(CASE WHEN match_row.player_a1_id IS NULL THEN 'player_a1_id' ELSE 'player_a2_id' END,uid);
  ELSE expected_patch:=expected_patch||jsonb_build_object(CASE WHEN match_row.player_b1_id IS NULL THEN 'player_b1_id' ELSE 'player_b2_id' END,uid); END IF;
  SELECT value INTO actual_patch FROM jsonb_array_elements(coalesce(effects->'matches','[]')) WHERE value->>'id'=match_row.id::text;
  IF actual_patch IS DISTINCT FROM expected_patch THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_updates:=expected_updates+1;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<>expected_updates THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_admin_fill_position(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ARRAY['replacePlayer','reviseTournament','updateEventDetails','addRegisteredEntry'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ADMIN_FILL_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$new$ARRAY['adminFillPosition','replacePlayer','reviseTournament','updateEventDetails','addRegisteredEntry'$new$);
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$'createDraft','updateDraft','replacePlayer','publishTournament'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ADMIN_FILL_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$'createDraft','updateDraft','adminFillPosition','replacePlayer','publishTournament'$new$);
 anchor:=$old$p_command NOT IN ('addRegisteredEntry','reviseTournament','placeRegisteredPlayer','replacePlayer')$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>2 THEN RAISE EXCEPTION 'ADMIN_FILL_ADMISSION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$p_command NOT IN ('addRegisteredEntry','reviseTournament','placeRegisteredPlayer','replacePlayer','adminFillPosition')$new$);
 anchor:=$old$IF p_command='replacePlayer' THEN PERFORM tournament_builder_private.validate_player_replacement(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ADMIN_FILL_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='adminFillPosition' THEN PERFORM tournament_builder_private.validate_admin_fill_position(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 IF p_command='replacePlayer' THEN PERFORM tournament_builder_private.validate_player_replacement(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 anchor:=$old$IF p_command<>'replacePlayer' AND (row_data ? 'player_a1_id'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ADMIN_FILL_MATCH_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command NOT IN ('replacePlayer','adminFillPosition') AND (row_data ? 'player_a1_id'$new$);
 EXECUTE source;
END $migration$;
COMMIT;
