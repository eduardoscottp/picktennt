-- Reviewed website-only full-team forfeits share the command audit, CAS and retry boundary.
BEGIN;
CREATE FUNCTION tournament_builder_private.validate_team_forfeit(actor uuid, client text, event uuid, request jsonb, effects jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.tournaments%ROWTYPE; entry public.teams%ROWTYPE; game public.matches%ROWTYPE; candidate jsonb; opponent uuid; affected integer:=0;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 IF client<>'web' OR (ev.created_by<>actor AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=event AND user_id=actor)) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF ev.modular_state NOT IN ('active','completed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF ev.modular_state='completed' AND ev.created_by<>actor THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['entry_id','reason','policy','preview_hash','confirmed_forfeit']);
 IF request->>'policy' IS DISTINCT FROM 'all_matches_0_11' OR request->'confirmed_forfeit' IS DISTINCT FROM 'true'::jsonb OR coalesce(request->>'reason','') !~ '[^[:space:]]' OR length(request->>'reason')>1000 OR coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO entry FROM public.teams WHERE id=(request->>'entry_id')::uuid AND tournament_id=event AND entry_state='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','teams','team_members','tournament_players','matches','stages','rounds','standings','replace_standings_stage_ids']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['modular_state','completed_at','result_version','results_under_review','status']);
 IF NOT coalesce(effects#>>'{event,modular_state}' IN ('active','completed'),false) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF effects#>>'{event,modular_state}'='completed' AND (effects#>>'{event,result_version}')::bigint IS DISTINCT FROM ev.result_version+1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF jsonb_array_length(coalesce(effects->'teams','[]'))<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 candidate:=effects#>'{teams,0}';
 PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','entry_state','eligibility_version','withdrawn_at','withdrawal_reason']);
 IF candidate->>'id' IS DISTINCT FROM entry.id::text OR candidate->>'entry_state' IS DISTINCT FROM 'withdrawn' OR (candidate->>'eligibility_version')::bigint IS DISTINCT FROM entry.eligibility_version+1 OR candidate->>'withdrawn_at' IS NULL OR candidate->>'withdrawal_reason' IS DISTINCT FROM trim(request->>'reason') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF (SELECT count(*) FROM public.team_members WHERE tournament_id=event AND team_id=entry.id AND membership_status IN ('active','pending')) <> jsonb_array_length(coalesce(effects->'team_members','[]')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(effects->'team_members','[]')))<>jsonb_array_length(coalesce(effects->'team_members','[]')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(effects->'team_members','[]')) LOOP
  IF candidate->>'membership_status' IS DISTINCT FROM 'withdrawn' OR NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=(candidate->>'id')::uuid AND m.tournament_id=event AND m.team_id=entry.id AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT p.id) FROM public.tournament_players p JOIN public.team_members m ON m.tournament_id=p.tournament_id AND m.user_id=p.user_id WHERE p.tournament_id=event AND m.team_id=entry.id AND m.membership_status IN ('active','pending')) <> jsonb_array_length(coalesce(effects->'tournament_players','[]')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]')))<>jsonb_array_length(coalesce(effects->'tournament_players','[]')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]')) LOOP
  IF candidate->>'status' IS DISTINCT FROM 'rejected' OR candidate->>'exit_reason' IS DISTINCT FROM 'withdrew' OR candidate->'nullified_from_standings' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR game IN SELECT * FROM public.matches WHERE tournament_id=event AND is_current AND voided_at IS NULL AND entry.id IN (team_a_id,team_b_id) LOOP
  affected:=affected+1;
  opponent:=CASE WHEN game.team_a_id=entry.id THEN game.team_b_id ELSE game.team_a_id END;
  IF opponent IS NULL THEN RAISE EXCEPTION 'UNRESOLVED_OPPONENT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=opponent AND tournament_id=event AND entry_state='approved') THEN RAISE EXCEPTION 'OPPONENT_WITHDRAWN'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'matches','[]')) p WHERE p->>'id'=game.id::text)<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  SELECT value INTO candidate FROM jsonb_array_elements(effects->'matches') WHERE value->>'id'=game.id::text;
  PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','status','outcome_kind','winner_team_id','score_a','score_b','submit_to_dupr','excluded_at','submitted_entry_id','entered_by','validated_by','ended_at','result_revision','revision','bracket_next_winner_match_id','bracket_next_loser_match_id','bracket_winner_fills_side','bracket_loser_fills_side']);
  IF candidate->>'status' IS DISTINCT FROM 'validated' OR candidate->>'outcome_kind' IS DISTINCT FROM 'administrative_score' OR candidate->>'winner_team_id' IS DISTINCT FROM opponent::text OR candidate->'submit_to_dupr' IS DISTINCT FROM 'false'::jsonb OR candidate->'excluded_at' IS DISTINCT FROM 'null'::jsonb OR candidate->'submitted_entry_id' IS DISTINCT FROM 'null'::jsonb OR candidate->'entered_by' IS DISTINCT FROM 'null'::jsonb OR candidate->>'validated_by' IS DISTINCT FROM actor::text OR (candidate->>'result_revision')::bigint IS DISTINCT FROM ev.revision+1 OR (candidate->>'revision')::bigint IS DISTINCT FROM ev.revision+1 OR (candidate->>'score_a')::integer IS DISTINCT FROM (CASE WHEN game.team_a_id=entry.id THEN 0 ELSE 11 END) OR (candidate->>'score_b')::integer IS DISTINCT FROM (CASE WHEN game.team_b_id=entry.id THEN 0 ELSE 11 END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF game.ended_at IS NOT NULL AND (candidate->>'ended_at')::timestamptz IS DISTINCT FROM game.ended_at THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF affected=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 -- Runtime may reseed pending dependents, but cannot overwrite other recorded games.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(effects->'matches','[]')) p JOIN public.matches m ON m.id=(p->>'id')::uuid WHERE m.tournament_id=event AND (NOT m.is_current OR m.voided_at IS NOT NULL OR (entry.id NOT IN (coalesce(m.team_a_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(m.team_b_id,'00000000-0000-0000-0000-000000000000'::uuid)) AND (m.status<>'scheduled' OR m.started_at IS NOT NULL OR m.score_a IS NOT NULL OR m.score_b IS NOT NULL))) AND p ?| ARRAY['status','outcome_kind','winner_team_id','score_a','score_b','team_a_id','team_b_id','is_current','voided_at','excluded_at']) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_team_forfeit(uuid,text,uuid,jsonb,jsonb) FROM PUBLIC;

DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$(p_command='withdrawEntry' AND event_row.modular_state NOT IN ('registration_open','registration_closed','ready','active'))$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'TEAM_FORFEIT_STATE_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$(p_command='withdrawEntry' AND event_row.modular_state NOT IN ('registration_open','registration_closed','ready','active') AND NOT (event_row.modular_state='completed' AND p_request->>'policy'='all_matches_0_11' AND p_client_id='web' AND event_row.created_by=p_actor_id))$new$);
 anchor:=$old$IF row_data->>'outcome_kind'='administrative_score' AND p_command<>'bulkAdjudicate' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'TEAM_FORFEIT_SCORE_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF row_data->>'outcome_kind'='administrative_score' AND p_command<>'bulkAdjudicate' AND NOT (p_command='withdrawEntry' AND p_request->>'policy'='all_matches_0_11') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;$new$);
 anchor:=$old$ IF p_command='withdrawEntry' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'TEAM_FORFEIT_VALIDATOR_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$ IF p_command='withdrawEntry' AND p_request->>'policy'='all_matches_0_11' THEN
  PERFORM tournament_builder_private.validate_team_forfeit(p_actor_id,p_client_id,p_tournament_id,p_request,p_effects);
 END IF;
 IF p_command='withdrawEntry' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP$new$);
 EXECUTE source;
END $migration$;
COMMIT;
