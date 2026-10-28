-- Administrator enrollment references existing Picktennt profiles; never creates identities or consent.
BEGIN;
ALTER TABLE public.teams ADD admin_definition_id uuid, ADD registered_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.teams ADD FOREIGN KEY(admin_definition_id,tournament_id) REFERENCES public.tournament_definitions(id,tournament_id),
 ADD CONSTRAINT tb_administrator_definition CHECK ((admin_definition_id IS NULL)=(registered_by IS NULL));
ALTER TABLE public.team_members ADD admission_source text NOT NULL DEFAULT 'self' CHECK(admission_source IN ('self','administrator'));
DO $registered$
DECLARE source text; old text; new text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
 ($a$'publishTournament','addGuestEntry','requestEntry'$a$,$b$'publishTournament','addGuestEntry','addRegisteredEntry','requestEntry'$b$),
 ($a$p_command IN ('addGuestEntry','requestEntry','acceptPartner','approveEntry','rejectEntry')$a$,$b$p_command IN ('addRegisteredEntry','addGuestEntry','requestEntry','acceptPartner','approveEntry','rejectEntry')$b$),
 ($a$rest_override boolean := false;$a$,$b$rest_override boolean := false; registered_ids uuid[]; profile_id uuid; registered_team uuid; expected_count integer; candidate jsonb;$b$),
 ($a$ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id']$a$,$b$ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id','admin_definition_id','registered_by']$b$),
 ($a$withdrawal_reason,guest_players,guest_definition_id) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason,guest_players,guest_definition_id$a$,$b$withdrawal_reason,guest_players,guest_definition_id,admin_definition_id,registered_by) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason,guest_players,guest_definition_id,admin_definition_id,registered_by$b$),
 ($a$guest_definition_id=excluded.guest_definition_id;$a$,$b$guest_definition_id=excluded.guest_definition_id,admin_definition_id=excluded.admin_definition_id,registered_by=excluded.registered_by;$b$),
 ($a$ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status']$a$,$b$ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status','admission_source']$b$),
 ($a$jsonb_build_object('id',gen_random_uuid(),'membership_status','active')$a$,$b$jsonb_build_object('id',gen_random_uuid(),'membership_status','active','admission_source','self')$b$),
 ($a$public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status) SELECT id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status$a$,$b$public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status,admission_source) SELECT id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status,admission_source$b$),
 ($a$membership_status=excluded.membership_status;$a$,$b$membership_status=excluded.membership_status,admission_source=excluded.admission_source;$b$)
 ) patches(old_text,new_text) LOOP
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REGISTERED_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 old:=$anchor$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);$anchor$;
 new:=$guard$ IF p_command='addRegisteredEntry' THEN
  IF event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_request,ARRAY['definition_id','player_ids','entry_name','reason']);
  IF p_request->>'definition_id' IS DISTINCT FROM event_row.definition_id::text THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
  SELECT definition INTO definition_row FROM public.tournament_definitions WHERE id=event_row.definition_id AND tournament_id=p_tournament_id AND status='published';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF (definition_row#>>'{registration,closes_at}')::timestamptz<=now() THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
  expected_count:=CASE WHEN definition_row#>>'{registration,entry_type}'='singles' THEN 1 ELSE 2 END;
  IF jsonb_typeof(p_request->'player_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF jsonb_array_length(p_request->'player_ids')<>expected_count OR jsonb_typeof(p_request->'entry_name') IS DISTINCT FROM 'string' OR length(p_request->>'entry_name') NOT BETWEEN 1 AND 120 OR (p_request->>'entry_name') !~ '[^[:space:]]' OR jsonb_typeof(p_request->'reason') IS DISTINCT FROM 'string' OR length(p_request->>'reason') NOT BETWEEN 1 AND 1000 OR (p_request->>'reason') !~ '[^[:space:]]' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  registered_ids:=ARRAY[]::uuid[];
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_request->'player_ids') LOOP
   IF jsonb_typeof(candidate) IS DISTINCT FROM 'string' OR (candidate#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
   profile_id:=(candidate#>>'{}')::uuid;
   IF profile_id=ANY(registered_ids) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=profile_id) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
   registered_ids:=array_append(registered_ids,profile_id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.team_members m JOIN public.teams t ON t.id=m.team_id WHERE m.tournament_id=p_tournament_id AND m.user_id=ANY(registered_ids) AND m.membership_status IN ('active','pending') AND t.entry_state NOT IN ('cancelled','withdrawn','rejected')) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
  IF (SELECT count(*) FROM public.teams WHERE tournament_id=p_tournament_id AND entry_state='approved') >= (definition_row#>>'{registration,max_entries}')::integer THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','teams','team_members','tournament_players']);
  PERFORM tournament_builder_private.assert_keys(coalesce(p_effects->'event','{}'),ARRAY['roster_revision']);
  IF p_effects#>>'{event,roster_revision}' IS DISTINCT FROM (event_row.roster_revision+1)::text OR jsonb_array_length(coalesce(p_effects->'teams','[]'))<>1 OR jsonb_array_length(coalesce(p_effects->'team_members','[]'))<>expected_count OR jsonb_array_length(coalesce(p_effects->'tournament_players','[]'))<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  row_data:=p_effects->'teams'->0;
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','entry_state','admin_definition_id','registered_by']);
  registered_team:=(row_data->>'id')::uuid;
  IF registered_team IS NULL OR EXISTS(SELECT 1 FROM public.teams WHERE id=registered_team) OR row_data->>'name' IS DISTINCT FROM btrim(p_request->>'entry_name') OR row_data->>'entry_state' IS DISTINCT FROM 'approved' OR row_data->>'admin_definition_id' IS DISTINCT FROM event_row.definition_id::text OR row_data->>'registered_by' IS DISTINCT FROM p_actor_id::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_effects->'team_members') LOOP
   PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','team_id','user_id','membership_status','admission_source','consented_at','consented_definition_id']);
   IF candidate->>'team_id' IS DISTINCT FROM registered_team::text OR NOT coalesce((candidate->>'user_id')::uuid=ANY(registered_ids),false) OR candidate->>'membership_status' IS DISTINCT FROM 'active' OR candidate->>'admission_source' IS DISTINCT FROM 'administrator' OR candidate->>'consented_at' IS NOT NULL OR candidate->>'consented_definition_id' IS NOT NULL OR EXISTS(SELECT 1 FROM public.team_members WHERE id=(candidate->>'id')::uuid) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'user_id')::uuid) FROM jsonb_array_elements(p_effects->'team_members'))<>expected_count OR (SELECT count(DISTINCT (value->>'id')::uuid) FROM jsonb_array_elements(p_effects->'team_members'))<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_effects->'tournament_players') LOOP
   PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','user_id','status','joined_via']);
   IF NOT coalesce((candidate->>'user_id')::uuid=ANY(registered_ids),false) OR candidate->>'status' IS DISTINCT FROM 'approved' OR EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(candidate->>'id')::uuid AND (tournament_id<>p_tournament_id OR user_id<>(candidate->>'user_id')::uuid)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (value->>'user_id')::uuid) FROM jsonb_array_elements(p_effects->'tournament_players'))<>expected_count OR (SELECT count(DISTINCT (value->>'id')::uuid) FROM jsonb_array_elements(p_effects->'tournament_players'))<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
$guard$||old;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REGISTERED_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$team$  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id','admin_definition_id','registered_by']);$team$;
 new:=old||E'\n  IF (row_data ? ''admin_definition_id'' OR row_data ? ''registered_by'') AND p_command<>''addRegisteredEntry'' THEN RAISE EXCEPTION ''INVALID_EFFECTS''; END IF;';
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REGISTERED_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$member$  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status','admission_source']);$member$;
 new:=old||E'\n  IF row_data ? ''admission_source'' AND p_command<>''addRegisteredEntry'' THEN RAISE EXCEPTION ''INVALID_EFFECTS''; END IF;';
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REGISTERED_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 EXECUTE source;
END $registered$;
COMMIT;
