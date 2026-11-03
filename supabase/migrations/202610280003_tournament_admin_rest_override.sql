-- Explicit administrator rest-only override. Court/player occupancy, immutable definition,
-- expected revision, operation request audit, and stable receipt replay remain enforced.
-- Replaces only tb_apply_command; never reapply 001 or alter its migration history.
BEGIN;
CREATE OR REPLACE FUNCTION public.tb_apply_command(p_actor_id uuid,p_client_id text,p_operation_id uuid,p_request_hash text,p_command text,p_tournament_id uuid,p_expected_revision bigint,p_request jsonb,p_effects jsonb,p_result jsonb,p_grant_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_row public.tournaments%ROWTYPE; op public.tournament_operations%ROWTYPE; row_data jsonb; merged jsonb;
 before_snapshot jsonb; after_snapshot jsonb; receipt jsonb; next_revision bigint; target_state text; match_row public.matches%ROWTYPE; definition_row jsonb; rest_minutes integer; rest_override boolean := false;
BEGIN
 IF p_command<>ALL(ARRAY['createDraft','updateDraft','publishTournament','requestEntry','acceptPartner','approveEntry','rejectEntry','cancelEntry','closeRegistration','reopenRegistration','lockRoster','startTournament','startMatch','submitScore','confirmScore','attestScore','adjudicateDispute','disputeScore','resolveTie','commitCorrection','withdrawEntry','reopenResults','cancelTournament','changeCourt']) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF p_operation_id IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 -- Serialize the receipt scope even when this command creates a previously absent event.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_client_id||':'||p_operation_id::text,0));
 SELECT * INTO event_row FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 PERFORM tournament_builder_private.authorize(p_actor_id,p_client_id,p_tournament_id,p_command,p_request,p_grant_id);
 SELECT * INTO op FROM public.tournament_operations WHERE actor_id=p_actor_id AND client_id=p_client_id AND operation_id=p_operation_id;
 IF FOUND THEN
  IF op.request_hash<>p_request_hash OR op.command<>p_command OR op.tournament_id<>p_tournament_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN op.result;
 END IF;
 IF p_command='createDraft' THEN
  IF event_row.id IS NOT NULL OR p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 ELSE
  IF p_expected_revision IS NULL OR p_expected_revision<>event_row.revision THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 END IF;
 IF (p_command IN ('updateDraft','publishTournament') AND event_row.modular_state IS DISTINCT FROM 'draft') OR
 (p_command IN ('requestEntry','acceptPartner','approveEntry','rejectEntry') AND event_row.modular_state IS DISTINCT FROM 'registration_open') OR
 (p_command='closeRegistration' AND event_row.modular_state IS DISTINCT FROM 'registration_open') OR
 (p_command IN ('reopenRegistration','lockRoster') AND event_row.modular_state IS DISTINCT FROM 'registration_closed') OR
 (p_command='cancelEntry' AND event_row.modular_state NOT IN ('registration_open','registration_closed')) OR
 (p_command='startTournament' AND event_row.modular_state IS DISTINCT FROM 'ready') OR
 (p_command IN ('startMatch','submitScore','confirmScore','attestScore','adjudicateDispute','disputeScore','resolveTie','commitCorrection') AND event_row.modular_state IS DISTINCT FROM 'active') OR
 (p_command='withdrawEntry' AND event_row.modular_state NOT IN ('registration_open','registration_closed','ready','active')) OR
 (p_command='changeCourt' AND event_row.modular_state NOT IN ('ready','active')) OR
 (p_command='reopenResults' AND event_row.modular_state IS DISTINCT FROM 'completed') OR
 (p_command='cancelTournament' AND event_row.modular_state IN ('completed','cancelled')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF p_command='withdrawEntry' AND event_row.modular_state IN ('ready','active') AND event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_command='startMatch' THEN
  IF p_request ? 'rest_override_reason' THEN
   IF event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   IF jsonb_typeof(p_request->'rest_override_reason') IS DISTINCT FROM 'string' OR length(p_request->>'rest_override_reason')>500 OR (p_request->>'rest_override_reason') !~ '[^[:space:]]' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
   rest_override:=true;
  END IF;
  SELECT * INTO match_row FROM public.matches WHERE id=(p_request->>'match_id')::uuid AND tournament_id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR match_row.status<>'scheduled' OR NOT match_row.is_current OR match_row.voided_at IS NOT NULL OR match_row.stage_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=match_row.stage_id AND state IN ('ready','active')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 END IF;
 PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);
 PERFORM tournament_builder_private.assert_keys(coalesce(p_effects->'event','{}'),ARRAY['name','court_count','max_players','type','rules_text','is_public','is_open','court_name','court_address','tournament_date','modular_state','roster_revision','timezone','registration_closed_at','result_version','results_under_review','completed_at','cancelled_at','status','definition_id']);
 next_revision:=coalesce(event_row.revision,0)+1;
 before_snapshot:=tournament_builder_private.snapshot(p_tournament_id);
 INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),p_tournament_id);
 IF p_command='createDraft' THEN
  INSERT INTO public.tournaments(id,name,created_by,court_count,max_players,type,engine_version,modular_state,status,is_public,revision)
   VALUES(p_tournament_id,'draft-'||p_tournament_id,p_actor_id,1,16,'singles','modular_v1','draft','draft',false,0);
 END IF;
 IF p_effects ? 'definition' THEN
  row_data:=p_effects->'definition';
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','schema_version','definition','status','canonical_hash','approved_at']);
  IF EXISTS(SELECT 1 FROM public.tournament_definitions WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  INSERT INTO public.tournament_definitions(id,tournament_id,schema_version,revision,definition,status,canonical_hash,created_by,approved_by,approved_at)
  VALUES((row_data->>'id')::uuid,p_tournament_id,coalesce((row_data->>'schema_version')::integer,1),next_revision,row_data->'definition',coalesce(row_data->>'status','draft'),row_data->>'canonical_hash',p_actor_id,CASE WHEN row_data->>'status'='published' THEN p_actor_id END,(row_data->>'approved_at')::timestamptz)
  ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,definition=excluded.definition,status=excluded.status,canonical_hash=excluded.canonical_hash,approved_by=excluded.approved_by,approved_at=excluded.approved_at;
 END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'stages','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','definition_id','node_id','module_id','module_version','state','input_revision','output_revision','output','blocked_code']);
  IF EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.tournament_stages t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('id',gen_random_uuid(),'input_revision',0,'output','{}'::jsonb,'output_revision',0,'state','pending'))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.tournament_stages(id,tournament_id,definition_id,node_id,module_id,module_version,state,input_revision,output_revision,output,blocked_code) SELECT id,tournament_id,definition_id,node_id,module_id,module_version,state,input_revision,output_revision,output,blocked_code FROM jsonb_populate_record(NULL::public.tournament_stages,merged)
   ON CONFLICT(id) DO UPDATE SET definition_id=excluded.definition_id,node_id=excluded.node_id,module_id=excluded.module_id,module_version=excluded.module_version,state=excluded.state,input_revision=excluded.input_revision,output_revision=excluded.output_revision,output=excluded.output,blocked_code=excluded.blocked_code;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason']);
  IF EXISTS(SELECT 1 FROM public.teams WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.teams t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'eligibility_version',0,'entry_state','pending','id',gen_random_uuid()))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.teams(id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason FROM jsonb_populate_record(NULL::public.teams,merged)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,seed=excluded.seed,entry_state=excluded.entry_state,eligibility_version=excluded.eligibility_version,withdrawn_at=excluded.withdrawn_at,withdrawal_reason=excluded.withdrawal_reason;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status']);
  IF EXISTS(SELECT 1 FROM public.team_members WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.team_members t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('id',gen_random_uuid(),'membership_status','active'))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(merged->>'team_id')::uuid AND tournament_id=p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  INSERT INTO public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status) SELECT id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status FROM jsonb_populate_record(NULL::public.team_members,merged)
   ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,user_id=excluded.user_id,consented_definition_id=excluded.consented_definition_id,consented_at=excluded.consented_at,membership_status=excluded.membership_status;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'tournament_players','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','user_id','status','joined_via','exit_reason','nullified_from_standings']);
  IF EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.tournament_players t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'id',gen_random_uuid(),'nullified_from_standings',false,'status','pending'::text))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.tournament_players(id,tournament_id,user_id,status,joined_via,created_at,exit_reason,nullified_from_standings) SELECT id,tournament_id,user_id,status,joined_via,created_at,exit_reason,nullified_from_standings FROM jsonb_populate_record(NULL::public.tournament_players,merged)
   ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,status=excluded.status,joined_via=excluded.joined_via,exit_reason=excluded.exit_reason,nullified_from_standings=excluded.nullified_from_standings;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'rounds','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_number','round_type','status','stage_id','schedule_generation','logical_wave','is_current']);
  IF EXISTS(SELECT 1 FROM public.rounds WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.rounds t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'id',gen_random_uuid(),'is_current',true,'schedule_generation',0,'status','pending'::text))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.rounds(id,tournament_id,round_number,round_type,status,created_at,stage_id,schedule_generation,logical_wave,is_current) SELECT id,tournament_id,round_number,round_type,status,created_at,stage_id,schedule_generation,logical_wave,is_current FROM jsonb_populate_record(NULL::public.rounds,merged)
   ON CONFLICT(id) DO UPDATE SET round_number=excluded.round_number,round_type=excluded.round_type,status=excluded.status,stage_id=excluded.stage_id,schedule_generation=excluded.schedule_generation,logical_wave=excluded.logical_wave,is_current=excluded.is_current;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_id','court_number','team_a_id','team_b_id','score_a','score_b','status','entered_by','validated_by','scheduled_at','stage_id','logical_key','schedule_generation','is_current','revision','outcome_kind','winner_team_id','submitted_entry_id','result_revision','started_at','ended_at','voided_at','excluded_at','submit_to_dupr','bracket_next_winner_match_id','bracket_next_loser_match_id','bracket_winner_fills_side','bracket_loser_fills_side']);
  IF EXISTS(SELECT 1 FROM public.matches WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.matches t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'id',gen_random_uuid(),'is_current',true,'result_revision',0,'revision',0,'schedule_generation',0,'status','scheduled'::text,'submit_to_dupr',true,'updated_at',now()))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  IF merged->>'status'='in_progress' AND coalesce((merged->>'is_current')::boolean,false) AND merged->>'voided_at' IS NULL AND EXISTS(
   SELECT 1 FROM public.matches WHERE tournament_id=p_tournament_id AND id<>(merged->>'id')::uuid AND status='in_progress' AND is_current AND voided_at IS NULL AND court_number=(merged->>'court_number')::integer
  ) THEN RAISE EXCEPTION 'COURT_BUSY'; END IF;
  INSERT INTO public.matches(id,tournament_id,round_id,court_number,team_a_id,team_b_id,player_a1_id,player_a2_id,player_b1_id,player_b2_id,score_a,score_b,status,entered_by,validated_by,scheduled_at,created_at,updated_at,bracket_next_winner_match_id,bracket_next_loser_match_id,bracket_winner_fills_side,bracket_loser_fills_side,submit_to_dupr,stage_id,logical_key,schedule_generation,is_current,revision,outcome_kind,winner_team_id,submitted_entry_id,result_revision,started_at,ended_at,voided_at,excluded_at) SELECT id,tournament_id,round_id,court_number,team_a_id,team_b_id,player_a1_id,player_a2_id,player_b1_id,player_b2_id,score_a,score_b,status,entered_by,validated_by,scheduled_at,created_at,updated_at,bracket_next_winner_match_id,bracket_next_loser_match_id,bracket_winner_fills_side,bracket_loser_fills_side,submit_to_dupr,stage_id,logical_key,schedule_generation,is_current,revision,outcome_kind,winner_team_id,submitted_entry_id,result_revision,started_at,ended_at,voided_at,excluded_at FROM jsonb_populate_record(NULL::public.matches,merged)
   ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,court_number=excluded.court_number,team_a_id=excluded.team_a_id,team_b_id=excluded.team_b_id,score_a=excluded.score_a,score_b=excluded.score_b,status=excluded.status,entered_by=excluded.entered_by,validated_by=excluded.validated_by,scheduled_at=excluded.scheduled_at,stage_id=excluded.stage_id,logical_key=excluded.logical_key,schedule_generation=excluded.schedule_generation,is_current=excluded.is_current,revision=excluded.revision,outcome_kind=excluded.outcome_kind,winner_team_id=excluded.winner_team_id,submitted_entry_id=excluded.submitted_entry_id,result_revision=excluded.result_revision,started_at=excluded.started_at,ended_at=excluded.ended_at,voided_at=excluded.voided_at,excluded_at=excluded.excluded_at,submit_to_dupr=excluded.submit_to_dupr,bracket_next_winner_match_id=excluded.bracket_next_winner_match_id,bracket_next_loser_match_id=excluded.bracket_next_loser_match_id,bracket_winner_fills_side=excluded.bracket_winner_fills_side,bracket_loser_fills_side=excluded.bracket_loser_fills_side;
 END LOOP;
 IF p_effects ? 'replace_standings_stage_ids' THEN
  DELETE FROM public.standings WHERE tournament_id=p_tournament_id AND stage_id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_effects->'replace_standings_stage_ids'));
 END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'standings','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_id','team_id','player_id','wins','losses','points_for','points_against','rank','stage_id','input_revision','eligible','tie_group']);
  IF EXISTS(SELECT 1 FROM public.standings WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.standings t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('eligible',true,'id',gen_random_uuid(),'input_revision',0,'losses',0,'points_against',0,'points_for',0,'updated_at',now(),'wins',0))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.standings(id,tournament_id,round_id,team_id,player_id,wins,losses,points_for,points_against,rank,updated_at,stage_id,input_revision,eligible,tie_group) SELECT id,tournament_id,round_id,team_id,player_id,wins,losses,points_for,points_against,rank,updated_at,stage_id,input_revision,eligible,tie_group FROM jsonb_populate_record(NULL::public.standings,merged)
   ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,team_id=excluded.team_id,player_id=excluded.player_id,wins=excluded.wins,losses=excluded.losses,points_for=excluded.points_for,points_against=excluded.points_against,rank=excluded.rank,stage_id=excluded.stage_id,input_revision=excluded.input_revision,eligible=excluded.eligible,tie_group=excluded.tie_group;
 END LOOP;
 -- Composite constraints also protect downstream bracket references, which predate modular events.
 IF EXISTS(SELECT 1 FROM public.matches m JOIN public.matches dependency ON dependency.id IN (m.bracket_next_winner_match_id,m.bracket_next_loser_match_id) WHERE m.tournament_id=p_tournament_id AND dependency.tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
 IF p_command='withdrawEntry' AND event_row.modular_state IN ('ready','active') AND event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_command='startMatch' THEN
  SELECT * INTO match_row FROM public.matches WHERE id=(p_request->>'match_id')::uuid AND tournament_id=p_tournament_id;
  IF NOT FOUND OR NOT match_row.is_current OR match_row.voided_at IS NOT NULL OR match_row.status<>'in_progress' OR match_row.team_a_id IS NULL OR match_row.team_b_id IS NULL OR match_row.court_number IS NULL OR match_row.court_number<1 OR match_row.court_number>(SELECT court_count FROM public.tournaments WHERE id=p_tournament_id) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND m.court_number=match_row.court_number) THEN RAISE EXCEPTION 'COURT_BUSY'; END IF;
  IF EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND a.membership_status='active' AND b.membership_status='active') THEN RAISE EXCEPTION 'PLAYER_BUSY'; END IF;
  SELECT d.definition INTO definition_row FROM public.tournament_definitions d JOIN public.tournaments t ON t.definition_id=d.id WHERE t.id=p_tournament_id;
  rest_minutes:=coalesce((definition_row#>>'{scheduling,minimum_rest_minutes}')::integer,0);
  IF NOT rest_override AND EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND rest_minutes>0 AND m.started_at IS NOT NULL AND m.ended_at>now()-make_interval(mins=>rest_minutes) AND a.membership_status='active' AND b.membership_status='active') THEN RAISE EXCEPTION 'REST_REQUIRED'; END IF;
 END IF;
 merged:=to_jsonb((SELECT t FROM public.tournaments t WHERE t.id=p_tournament_id))||coalesce(p_effects->'event','{}');
 target_state:=merged->>'modular_state';
 IF (p_command='createDraft' AND target_state<>'draft') OR (p_command='updateDraft' AND target_state<>'draft') OR
 (p_command='publishTournament' AND target_state<>'registration_open') OR (p_command='closeRegistration' AND target_state<>'registration_closed') OR
 (p_command='reopenRegistration' AND target_state<>'registration_open') OR (p_command='lockRoster' AND target_state<>'ready') OR
 (p_command IN ('startTournament','reopenResults') AND target_state<>'active') OR (p_command='cancelTournament' AND target_state<>'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 UPDATE public.tournaments SET name=merged->>'name',court_count=(merged->>'court_count')::integer,max_players=(merged->>'max_players')::integer,type=merged->>'type',rules_text=merged->>'rules_text',is_public=(merged->>'is_public')::boolean,is_open=(merged->>'is_open')::boolean,court_name=merged->>'court_name',court_address=merged->>'court_address',tournament_date=(merged->>'tournament_date')::date,modular_state=target_state,revision=next_revision,definition_id=(merged->>'definition_id')::uuid,roster_revision=(merged->>'roster_revision')::bigint,timezone=merged->>'timezone',registration_closed_at=(merged->>'registration_closed_at')::timestamptz,result_version=(merged->>'result_version')::integer,results_under_review=(merged->>'results_under_review')::boolean,completed_at=(merged->>'completed_at')::timestamptz,cancelled_at=(merged->>'cancelled_at')::timestamptz,
 status=CASE target_state WHEN 'draft' THEN 'draft' WHEN 'registration_open' THEN 'registration' WHEN 'registration_closed' THEN 'registration' WHEN 'ready' THEN 'registration' WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE CASE WHEN merged->>'status'='finals' THEN 'finals' ELSE 'active' END END
 WHERE id=p_tournament_id;
 after_snapshot:=tournament_builder_private.snapshot(p_tournament_id);
 receipt:=jsonb_build_object('operation_id',p_operation_id,'tournament_id',p_tournament_id,'revision',next_revision,'status',target_state,'data',p_result);
 INSERT INTO public.tournament_operations(operation_id,actor_id,client_id,tournament_id,command,request_hash,request,result,prior_revision,revision,before_facts,after_facts,reason)
 VALUES(p_operation_id,p_actor_id,p_client_id,p_tournament_id,p_command,p_request_hash,p_request,receipt,coalesce(event_row.revision,0),next_revision,before_snapshot,after_snapshot,p_request->>'reason');
 DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current() AND event_id=p_tournament_id;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid) TO service_role;
COMMIT;
