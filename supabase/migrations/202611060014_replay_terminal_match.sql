BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_replay_terminal_match(actor uuid,event uuid,request jsonb,effects jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE ev public.tournaments%ROWTYPE; target public.matches%ROWTYPE; feeder public.matches%ROWTYPE;
 stage public.tournament_stages%ROWTYPE; placement_stage public.tournament_stages%ROWTYPE; a uuid; b uuid; nodes jsonb; roster jsonb; placements jsonb; other_node text; wave integer; size integer;
 expected jsonb; actual jsonb; replacement jsonb; replacement_id uuid; expected_count integer:=2; historical boolean;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 IF ev.modular_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF ev.created_by<>actor AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=event AND user_id=actor) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['match_id','team_a_id','team_b_id','reason','resolution','preview_hash']);
 IF jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000 OR coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' OR request->>'resolution' IS DISTINCT FROM 'invalidate_and_replay' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 a:=(request->>'team_a_id')::uuid; b:=(request->>'team_b_id')::uuid;
 IF a IS NULL OR b IS NULL OR a=b THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO target FROM public.matches m WHERE m.id=(request->>'match_id')::uuid AND m.tournament_id=event AND m.is_current AND m.voided_at IS NULL;
 IF NOT FOUND OR target.status NOT IN ('scheduled','in_progress','score_entered','disputed','validated','walkover') OR (target.status='scheduled' AND target.started_at IS NULL AND target.score_a IS NULL AND target.score_b IS NULL AND target.outcome_kind IS NULL) OR target.bracket_next_winner_match_id IS NOT NULL OR target.bracket_next_loser_match_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 historical:=coalesce(target.started_at IS NOT NULL OR target.status IN ('in_progress','score_entered','disputed') OR target.outcome_kind IN ('played','retirement') OR target.score_a IS NOT NULL OR target.score_b IS NOT NULL,false);
 size:=CASE ev.type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END;
 IF historical AND (size=0 OR num_nonnulls(target.player_a1_id,target.player_a2_id,target.player_b1_id,target.player_b2_id)<>size*2 OR target.player_a1_id IS NULL OR target.player_b1_id IS NULL OR (SELECT count(DISTINCT p) FROM unnest(ARRAY[target.player_a1_id,target.player_a2_id,target.player_b1_id,target.player_b2_id]) p WHERE p IS NOT NULL)<>size*2 OR (size=1 AND (target.player_a2_id IS NOT NULL OR target.player_b2_id IS NOT NULL))) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT * INTO stage FROM public.tournament_stages s WHERE s.id=target.stage_id AND s.tournament_id=event AND s.definition_id=ev.definition_id AND s.module_id='match';
 IF NOT FOUND OR target.logical_key IS DISTINCT FROM stage.node_id||':match' OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event AND m.stage_id=stage.id AND m.is_current AND m.voided_at IS NULL)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT coalesce((SELECT output->'finalizedNodes' FROM public.tournament_stages s WHERE s.tournament_id=event AND s.definition_id=ev.definition_id AND s.module_id='entries'),d.definition->'nodes') INTO nodes FROM public.tournament_definitions d WHERE d.id=ev.definition_id AND d.tournament_id=event AND d.definition->>'schema_version'='2.0';
 IF nodes IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n WHERE n->>'id'=stage.node_id AND n->>'module'='match@1') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n CROSS JOIN LATERAL jsonb_array_elements(coalesce(n->'inputs','[]')||coalesce(n->'side_a','[]')||coalesce(n->'side_b','[]')) input WHERE n->>'id'<>stage.node_id AND input->>'node_id'=stage.node_id) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT n INTO placements FROM jsonb_array_elements(nodes) n WHERE n->>'module'='placements@2';
 SELECT * INTO placement_stage FROM public.tournament_stages s WHERE s.tournament_id=event AND s.definition_id=ev.definition_id AND s.node_id=placements->>'id' AND s.module_id='placements';
 IF NOT FOUND OR placement_stage.id=stage.id THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF placements ? 'bronze' AND stage.node_id IN (placements->>'final',placements->>'bronze') THEN
  other_node:=CASE WHEN stage.node_id=placements->>'final' THEN placements->>'bronze' ELSE placements->>'final' END;
  IF (SELECT count(*) FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id AND s.tournament_id=event AND s.definition_id=ev.definition_id WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND s.node_id=other_node)<>1 OR NOT EXISTS(SELECT 1 FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id AND s.tournament_id=event AND s.definition_id=ev.definition_id WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND s.node_id=other_node AND m.team_a_id IS NOT NULL AND m.team_b_id IS NOT NULL AND a NOT IN (m.team_a_id,m.team_b_id) AND b NOT IN (m.team_a_id,m.team_b_id)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 END IF;
 SELECT output->'entryIds' INTO roster FROM public.tournament_stages s WHERE s.tournament_id=event AND s.definition_id=ev.definition_id AND s.module_id='entries';
 IF jsonb_typeof(roster) IS DISTINCT FROM 'array' OR NOT (roster ? a::text AND roster ? b::text) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=a AND tournament_id=event AND entry_state='approved') OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=b AND tournament_id=event AND entry_state='approved') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF size=0 OR (SELECT count(DISTINCT user_id) FROM public.team_members WHERE tournament_id=event AND team_id=a AND membership_status='active')<>size OR (SELECT count(DISTINCT user_id) FROM public.team_members WHERE tournament_id=event AND team_id=b AND membership_status='active')<>size OR EXISTS(SELECT 1 FROM public.teams t WHERE t.tournament_id=event AND t.id IN (a,b) AND CASE WHEN jsonb_typeof(t.guest_players)='array' THEN jsonb_array_length(t.guest_players)>0 ELSE false END) THEN RAISE EXCEPTION 'INCOMPLETE_ROSTER'; END IF;
 SELECT logical_wave INTO wave FROM public.rounds WHERE id=target.round_id AND tournament_id=event;
 IF wave IS NULL OR EXISTS(SELECT 1 FROM public.matches m JOIN public.rounds r ON r.id=m.round_id AND r.tournament_id=event WHERE m.tournament_id=event AND m.id<>target.id AND m.is_current AND m.voided_at IS NULL AND r.logical_wave=wave AND m.status IN ('scheduled','in_progress') AND (m.team_a_id IS NULL OR m.team_b_id IS NULL OR a IN (m.team_a_id,m.team_b_id) OR b IN (m.team_a_id,m.team_b_id))) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['matches','stages']);
 IF jsonb_array_length(coalesce(effects->'stages','[]'))<>2 OR effects->'stages'->0 IS DISTINCT FROM jsonb_build_object('id',stage.id,'state','ready','input_revision',0,'output_revision',ev.revision+1,'blocked_code',NULL,'output',stage.output||jsonb_build_object('state','ready','entryIds',jsonb_build_array(a,b),'winnerEntryId',NULL,'loserEntryId',NULL,'inputRevision',0,'blockedCode',NULL,'manualMatchEntries',jsonb_build_object('a',a,'b',b))) OR effects->'stages'->1 IS DISTINCT FROM jsonb_build_object('id',placement_stage.id,'state','waiting','output_revision',ev.revision+1,'blocked_code',NULL,'output',jsonb_build_object('state','waiting')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<2 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 actual:=effects->'matches'->0;
 expected:=jsonb_build_object('id',target.id,'is_current',false,'voided_at',actual->'voided_at');
 IF target.started_at IS NOT NULL AND target.ended_at IS NULL THEN expected:=expected||jsonb_build_object('ended_at',actual->'voided_at'); END IF;
 IF actual IS DISTINCT FROM expected OR actual->>'voided_at' IS NULL OR (actual->>'voided_at')::timestamptz IS NULL OR (actual->>'voided_at')::timestamptz<coalesce(target.ended_at,target.started_at,'-infinity'::timestamptz) OR (actual->>'voided_at')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 replacement:=effects->'matches'->1; replacement_id:=(replacement->>'id')::uuid;
 IF replacement_id IS NULL OR EXISTS(SELECT 1 FROM public.matches WHERE id=replacement_id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 expected:=jsonb_build_object('id',replacement_id,'stage_id',target.stage_id,'round_id',target.round_id,'logical_key',target.logical_key,'schedule_generation',target.schedule_generation,'court_number',target.court_number,'team_a_id',a,'team_b_id',b,'is_current',true,'status','scheduled','revision',ev.revision+1,'result_revision',0,'submit_to_dupr',false);
 IF replacement IS DISTINCT FROM expected THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR feeder IN SELECT * FROM public.matches m WHERE m.tournament_id=event AND m.is_current AND m.voided_at IS NULL AND (m.bracket_next_winner_match_id=target.id OR m.bracket_next_loser_match_id=target.id) LOOP
  expected:=jsonb_build_object('id',feeder.id);
  IF feeder.bracket_next_winner_match_id=target.id THEN expected:=expected||jsonb_build_object('bracket_next_winner_match_id',NULL,'bracket_winner_fills_side',NULL); END IF;
  IF feeder.bracket_next_loser_match_id=target.id THEN expected:=expected||jsonb_build_object('bracket_next_loser_match_id',NULL,'bracket_loser_fills_side',NULL); END IF;
  SELECT value INTO actual FROM jsonb_array_elements(coalesce(effects->'matches','[]')) WHERE value->>'id'=feeder.id::text;
  IF actual IS DISTINCT FROM expected OR (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'matches','[]')) WHERE value->>'id'=feeder.id::text)<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_count:=expected_count+1;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_replay_terminal_match(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ARRAY['withdrawPlayer','forcePendingMatch','adminFillPosition','replacePlayer','reviseTournament'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'REPLAY_TERMINAL_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$new$ARRAY['replayTerminalMatch','withdrawPlayer','forcePendingMatch','adminFillPosition','replacePlayer','reviseTournament'$new$);
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$'createDraft','updateDraft','withdrawPlayer','forcePendingMatch','adminFillPosition','replacePlayer','publishTournament'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'REPLAY_TERMINAL_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$'createDraft','updateDraft','replayTerminalMatch','withdrawPlayer','forcePendingMatch','adminFillPosition','replacePlayer','publishTournament'$new$);
 anchor:=$old$IF p_command='forcePendingMatch' THEN PERFORM tournament_builder_private.validate_force_pending_match(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'REPLAY_TERMINAL_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='replayTerminalMatch' THEN PERFORM tournament_builder_private.validate_replay_terminal_match(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 IF p_command='forcePendingMatch' THEN PERFORM tournament_builder_private.validate_force_pending_match(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 EXECUTE source;
END $migration$;
COMMIT;
