-- Approved revisions retain all prior definitions, stages and fixture history.
BEGIN;
CREATE FUNCTION tournament_builder_private.validate_revision(actor uuid,event uuid,request jsonb,effects jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE e public.tournaments%ROWTYPE; t public.teams%ROWTYPE; m public.team_members%ROWTYPE; patch jsonb; item jsonb; desired jsonb; members jsonb; new_definition uuid; member_count integer; ids uuid[]:=ARRAY[]::uuid[]; uid uuid; removed boolean;
BEGIN
 SELECT * INTO e FROM public.tournaments WHERE id=event;
 IF NOT coalesce(e.modular_state IN ('registration_open','registration_closed','ready','active'),false) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event AND (started_at IS NOT NULL OR status IS DISTINCT FROM 'scheduled' OR outcome_kind IS NOT NULL OR score_a IS NOT NULL OR score_b IS NOT NULL)) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['definition','entries','reason','preview_hash']);
 IF jsonb_typeof(request->'definition') IS DISTINCT FROM 'object' OR jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000 OR coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(coalesce(request->'entries','[]')) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','definition','teams','team_members','tournament_players','stages','rounds','matches']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['definition_id','name','modular_state','roster_revision','court_count','max_players','type','is_public','is_open','timezone','court_name','tournament_date','rules_text','registration_closed_at']);
 new_definition:=(effects#>>'{definition,id}')::uuid;
 IF new_definition IS NULL OR EXISTS(SELECT 1 FROM public.tournament_definitions WHERE id=new_definition) OR effects#>>'{definition,status}' IS DISTINCT FROM 'published' OR effects#>'{definition,definition}' IS DISTINCT FROM request->'definition' OR effects#>>'{event,definition_id}' IS DISTINCT FROM new_definition::text OR effects#>>'{event,modular_state}' IS DISTINCT FROM 'registration_closed' OR effects#>>'{event,roster_revision}' IS DISTINCT FROM (e.roster_revision+1)::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 member_count:=CASE request#>>'{definition,registration,entry_type}' WHEN 'singles' THEN 1 WHEN 'fixed_doubles' THEN 2 ELSE NULL END;
 IF member_count IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF effects#>>'{event,name}' IS DISTINCT FROM request#>>'{definition,event,name}' OR effects#>>'{event,court_count}' IS DISTINCT FROM request#>>'{definition,event,courts}' OR effects#>>'{event,court_name}' IS DISTINCT FROM request#>>'{definition,event,venue_name}' OR effects#>>'{event,timezone}' IS DISTINCT FROM request#>>'{definition,event,timezone}' OR effects#>>'{event,max_players}' IS DISTINCT FROM (((request#>>'{definition,registration,max_entries}')::integer)*member_count)::text OR effects#>>'{event,type}' IS DISTINCT FROM (CASE member_count WHEN 1 THEN 'singles' ELSE 'doubles' END) OR effects#>>'{event,is_public}' IS DISTINCT FROM ((request#>>'{definition,event,visibility}')='public')::text OR effects#>>'{event,is_open}' IS DISTINCT FROM ((request#>>'{definition,registration,mode}')='open')::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(request->'entries','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(item,ARRAY['entry_id','entry_name','player_ids','remove']);
  SELECT * INTO t FROM public.teams WHERE id=(item->>'entry_id')::uuid AND tournament_id=event;
  IF NOT FOUND OR t.entry_state NOT IN ('approved','pending') OR (t.entry_state='pending' AND item->'remove' IS DISTINCT FROM 'true'::jsonb) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF (item ? 'remove' AND jsonb_typeof(item->'remove') IS DISTINCT FROM 'boolean') OR (item->'remove' IS DISTINCT FROM 'true'::jsonb AND (jsonb_typeof(item->'entry_name') IS DISTINCT FROM 'string' OR length(btrim(item->>'entry_name')) NOT BETWEEN 1 AND 120 OR jsonb_typeof(item->'player_ids') IS DISTINCT FROM 'array')) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(request->'entries','[]')))<>(SELECT count(DISTINCT (value->>'entry_id')::uuid) FROM jsonb_array_elements(coalesce(request->'entries','[]'))) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF (SELECT count(*) FROM public.teams existing_team WHERE existing_team.tournament_id=event AND existing_team.entry_state IN ('approved','pending') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(request->'entries','[]')) r WHERE (r->>'entry_id')::uuid=existing_team.id AND r->'remove'='true'))>(request#>>'{definition,registration,max_entries}')::integer THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(effects->'teams','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(item,ARRAY['id','name','seed','entry_state','eligibility_version','admin_definition_id','registered_by']);
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(item->>'id')::uuid AND tournament_id=event AND entry_state IN ('approved','pending')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR t IN SELECT * FROM public.teams WHERE tournament_id=event AND entry_state IN ('approved','pending') LOOP
  SELECT value INTO patch FROM jsonb_array_elements(coalesce(request->'entries','[]')) WHERE (value->>'entry_id')::uuid=t.id;
  removed:=coalesce(patch->'remove'='true',false);
  SELECT value INTO item FROM jsonb_array_elements(coalesce(effects->'teams','[]')) WHERE value->>'id'=t.id::text;
  IF t.entry_state='pending' AND NOT removed THEN
   IF item IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   CONTINUE;
  END IF;
  IF item IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  desired:=to_jsonb(t)||item;
  IF removed THEN
   IF desired->>'entry_state' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSE
   IF desired->>'entry_state' IS DISTINCT FROM 'approved' OR desired->>'admin_definition_id' IS DISTINCT FROM new_definition::text OR desired->>'registered_by' IS DISTINCT FROM actor::text OR desired->>'name' IS DISTINCT FROM coalesce(btrim(patch->>'entry_name'),t.name) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(value),'[]') INTO members FROM jsonb_array_elements(coalesce(effects->'team_members','[]')) WHERE value->>'team_id'=t.id::text AND value->>'membership_status'='active';
  IF removed AND jsonb_array_length(members)<>0 OR NOT removed AND jsonb_array_length(members)<>member_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF NOT removed THEN
   IF patch IS NULL THEN SELECT coalesce(jsonb_agg(user_id::text ORDER BY user_id),'[]') INTO desired FROM public.team_members WHERE team_id=t.id AND membership_status='active';
   ELSE SELECT coalesce(jsonb_agg((value#>>'{}')::uuid::text ORDER BY (value#>>'{}')::uuid),'[]') INTO desired FROM jsonb_array_elements(patch->'player_ids'); END IF;
   IF desired IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value->'user_id' ORDER BY value->'user_id'),'[]') FROM jsonb_array_elements(members)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.team_members old WHERE old.team_id=t.id AND old.membership_status IN ('active','pending') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(effects->'team_members','[]')) v WHERE v->>'id'=old.id::text)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(effects->'team_members','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(item,ARRAY['id','team_id','user_id','membership_status','admission_source','consented_at','consented_definition_id']);
  IF jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'team_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'user_id') IS DISTINCT FROM 'string' OR NOT coalesce(item->>'membership_status' IN ('active','cancelled'),false) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  uid:=(item->>'user_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'teams') v WHERE v->>'id'=item->>'team_id') OR item->>'membership_status' NOT IN ('active','cancelled') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  SELECT * INTO m FROM public.team_members WHERE id=(item->>'id')::uuid;
  IF FOUND THEN
   IF m.tournament_id<>event OR m.team_id::text IS DISTINCT FROM item->>'team_id' OR m.user_id IS DISTINCT FROM uid OR (item ? 'consented_at' AND (item->>'consented_at')::timestamptz IS DISTINCT FROM m.consented_at) OR (item ? 'consented_definition_id' AND (item->>'consented_definition_id')::uuid IS DISTINCT FROM m.consented_definition_id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF item->>'consented_at' IS NOT NULL OR item->>'consented_definition_id' IS NOT NULL OR item->>'membership_status' IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF item->>'membership_status'='active' THEN
   IF item->>'admission_source' IS DISTINCT FROM 'administrator' OR uid=ANY(ids) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF EXISTS(SELECT 1 FROM public.team_members pending_member JOIN public.teams pending_team ON pending_team.id=pending_member.team_id WHERE pending_member.tournament_id=event AND pending_member.user_id=uid AND pending_member.membership_status IN ('active','pending') AND pending_team.entry_state='pending' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(request->'entries','[]')) r WHERE (r->>'entry_id')::uuid=pending_team.id AND r->'remove'='true')) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
   ids:=array_append(ids,uid);
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'teams','[]')))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(effects->'teams','[]'))) OR (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'team_members','[]')))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(effects->'team_members','[]'))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]')))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]'))) OR (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]')))<>(SELECT count(DISTINCT value->>'user_id') FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]'))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF EXISTS(SELECT 1 FROM (
  SELECT historical.user_id FROM public.team_members historical WHERE historical.tournament_id=event AND historical.team_id::text IN (SELECT value->>'id' FROM jsonb_array_elements(coalesce(effects->'teams','[]')))
  UNION SELECT (value->>'user_id')::uuid FROM jsonb_array_elements(coalesce(effects->'team_members','[]'))
 ) affected WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]')) v WHERE (v->>'user_id')::uuid=affected.user_id)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(effects->'tournament_players','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(item,ARRAY['id','user_id','status','joined_via','exit_reason','nullified_from_standings']);
  IF jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'user_id') IS DISTINCT FROM 'string' OR NOT coalesce(item->>'status' IN ('approved','pending','rejected'),false) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF item->>'status' IS DISTINCT FROM (CASE
   WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'team_members') v WHERE v->>'user_id'=item->>'user_id' AND v->>'membership_status'='active') THEN 'approved'
   WHEN EXISTS(SELECT 1 FROM public.team_members retained WHERE retained.tournament_id=event AND retained.user_id=(item->>'user_id')::uuid AND retained.membership_status IN ('pending','active') AND retained.team_id::text NOT IN (SELECT value->>'id' FROM jsonb_array_elements(effects->'teams'))) THEN 'pending'
   ELSE 'rejected' END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF NOT (EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'team_members') v WHERE v->>'user_id'=item->>'user_id') OR EXISTS(SELECT 1 FROM public.team_members historical WHERE historical.tournament_id=event AND historical.user_id::text=item->>'user_id' AND historical.team_id::text IN (SELECT value->>'id' FROM jsonb_array_elements(effects->'teams')))) OR item->>'status' NOT IN ('approved','pending','rejected') OR EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(item->>'id')::uuid AND (tournament_id<>event OR user_id::text<>item->>'user_id')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF jsonb_array_length(effects->'stages') IS DISTINCT FROM jsonb_array_length(request#>'{definition,nodes}') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(effects->'stages'))<>jsonb_array_length(effects->'stages') OR (SELECT count(DISTINCT value->>'node_id') FROM jsonb_array_elements(effects->'stages'))<>jsonb_array_length(effects->'stages') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(effects->'stages') LOOP
  IF EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=(item->>'id')::uuid) OR item->>'definition_id' IS DISTINCT FROM new_definition::text OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request#>'{definition,nodes}') n WHERE n->>'id'=item->>'node_id' AND n->>'module'=(item->>'module_id')||'@'||(item->>'module_version')) OR item->>'state' IS DISTINCT FROM 'waiting' OR item->>'input_revision' IS DISTINCT FROM '0' OR item->>'output_revision' IS DISTINCT FROM '0' OR item->'output' IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(effects->'matches','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(item,ARRAY['id','is_current']);
  IF item->'is_current' IS DISTINCT FROM 'false'::jsonb OR NOT EXISTS(SELECT 1 FROM public.matches WHERE id=(item->>'id')::uuid AND tournament_id=event) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(coalesce(effects->'rounds','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(item,ARRAY['id','is_current']);
  IF item->'is_current' IS DISTINCT FROM 'false'::jsonb OR NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=(item->>'id')::uuid AND tournament_id=event) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_revision(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $revisions$
DECLARE source text; old text; new text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 old:=$a$ARRAY['addRegisteredEntry','approveEntry'$a$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REVISION_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,old,$b$ARRAY['reviseTournament','updateEventDetails','addRegisteredEntry','approveEntry'$b$);
 SELECT pg_get_functiondef('tournament_builder_private.snapshot(uuid)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
 ($a$FROM public.tournament_stages s WHERE s.tournament_id=event$a$,$b$FROM public.tournament_stages s WHERE s.tournament_id=event AND s.definition_id=(SELECT definition_id FROM public.tournaments WHERE id=event)$b$),
 ($a$FROM public.standings s WHERE s.tournament_id=event$a$,$b$FROM public.standings s WHERE s.tournament_id=event AND s.stage_id IN (SELECT id FROM public.tournament_stages WHERE tournament_id=event AND definition_id=(SELECT definition_id FROM public.tournaments WHERE id=event))$b$)
 ) patches(a,b) LOOP
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REVISION_SNAPSHOT_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 EXECUTE source;
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
 ($a$'addAdministrator','removeAdministrator','requestEntry'$a$,$b$'addAdministrator','removeAdministrator','reviseTournament','updateEventDetails','requestEntry'$b$),
 ($a$p_command<>'addRegisteredEntry' THEN RAISE EXCEPTION 'INVALID_EFFECTS';$a$,$b$p_command NOT IN ('addRegisteredEntry','reviseTournament') THEN RAISE EXCEPTION 'INVALID_EFFECTS';$b$)
 ) patches(a,b) LOOP
  IF position(old IN source)=0 THEN RAISE EXCEPTION 'REVISION_COMMAND_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 old:=$a$ next_revision:=coalesce(event_row.revision,0)+1;$a$;
 new:=$b$ IF p_command='reviseTournament' THEN PERFORM tournament_builder_private.validate_revision(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 IF p_command='updateEventDetails' THEN
  IF event_row.modular_state IN ('draft','cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_request,ARRAY['name','venue_name','reason']);
  IF jsonb_typeof(p_request->'name') IS DISTINCT FROM 'string' OR length(btrim(p_request->>'name')) NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_request->'venue_name') IS DISTINCT FROM 'string' OR length(btrim(p_request->>'venue_name')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_request->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_request->>'reason')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event']);
  PERFORM tournament_builder_private.assert_keys(p_effects->'event',ARRAY['name','court_name']);
  IF p_effects#>>'{event,name}' IS DISTINCT FROM btrim(p_request->>'name') OR p_effects#>>'{event,court_name}' IS DISTINCT FROM btrim(p_request->>'venue_name') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
$b$||old;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REVISION_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$  IF EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;$a$;
 new:=old||$b$
  IF EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=(row_data->>'id')::uuid AND (definition_id IS DISTINCT FROM event_row.definition_id OR (row_data ? 'definition_id' AND definition_id IS DISTINCT FROM (row_data->>'definition_id')::uuid))) THEN RAISE EXCEPTION 'HISTORICAL_STAGE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=(row_data->>'id')::uuid) AND (row_data->>'definition_id')::uuid IS DISTINCT FROM coalesce((p_effects#>>'{definition,id}')::uuid,event_row.definition_id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
$b$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REVISION_STAGE_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$ INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),p_tournament_id);$a$;
 new:=old||$b$
 IF p_command='reviseTournament' THEN
  UPDATE public.matches SET is_current=false WHERE tournament_id=p_tournament_id AND is_current;
  UPDATE public.rounds SET is_current=false WHERE tournament_id=p_tournament_id AND is_current;
  -- Release all outgoing active slots before any incoming roster membership is applied.
  UPDATE public.team_members SET membership_status='cancelled' WHERE tournament_id=p_tournament_id AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')));
 END IF;
$b$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REVISION_COMMAND_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,old,new);
END $revisions$;
COMMIT;
