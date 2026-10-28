-- Website administrator enrollment of tournament-only guests; no auth/profile/consent records.
BEGIN;
ALTER TABLE public.teams ADD guest_players jsonb NOT NULL DEFAULT '[]', ADD guest_definition_id uuid;
ALTER TABLE public.teams ADD FOREIGN KEY(guest_definition_id,tournament_id) REFERENCES public.tournament_definitions(id,tournament_id);
CREATE FUNCTION tournament_builder_private.valid_guests(players jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(players)<>'array' THEN false ELSE
 jsonb_array_length(players) BETWEEN 1 AND 2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(players) g WHERE jsonb_typeof(g)<>'object' OR jsonb_typeof(g->'id') IS DISTINCT FROM 'string' OR (g->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(g->'name') IS DISTINCT FROM 'string' OR length(btrim(g->>'name')) NOT BETWEEN 1 AND 120 OR (SELECT count(*) FROM jsonb_object_keys(g))<>2)
 AND (SELECT count(DISTINCT g->>'id') FROM jsonb_array_elements(players) g)=jsonb_array_length(players) END
$$;
REVOKE ALL ON FUNCTION tournament_builder_private.valid_guests(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tournament_builder_private.valid_guests(jsonb) TO anon,authenticated,service_role;
ALTER TABLE public.teams ADD CONSTRAINT tb_guest_roster_shape CHECK ((guest_definition_id IS NULL AND guest_players='[]') OR (guest_definition_id IS NOT NULL AND tournament_builder_private.valid_guests(guest_players)));
DO $patch$
DECLARE source text; old text; new text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 old:=$old$'publishTournament','requestEntry'$old$; new:=$new$'publishTournament','addGuestEntry','requestEntry'$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$old$p_command IN ('requestEntry','acceptPartner','approveEntry','rejectEntry')$old$; new:=$new$p_command IN ('addGuestEntry','requestEntry','acceptPartner','approveEntry','rejectEntry')$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$old$ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason']$old$; new:=$new$ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id']$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$old$'eligibility_version',0,'entry_state','pending','id',gen_random_uuid()$old$; new:=$new$'eligibility_version',0,'entry_state','pending','guest_players','[]'::jsonb,'id',gen_random_uuid()$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$old$public.teams(id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason$old$; new:=$new$public.teams(id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason,guest_players,guest_definition_id) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason,guest_players,guest_definition_id$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$old$withdrawal_reason=excluded.withdrawal_reason;$old$; new:=$new$withdrawal_reason=excluded.withdrawal_reason,guest_players=excluded.guest_players,guest_definition_id=excluded.guest_definition_id;$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$old$IF EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND a.membership_status='active' AND b.membership_status='active') THEN RAISE EXCEPTION 'PLAYER_BUSY'; END IF;$old$; new:=$new$IF EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND a.membership_status='active' AND b.membership_status='active') OR EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND (m.team_a_id IN (match_row.team_a_id,match_row.team_b_id) OR m.team_b_id IN (match_row.team_a_id,match_row.team_b_id))) THEN RAISE EXCEPTION 'PLAYER_BUSY'; END IF;$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'GUEST_FUNCTION_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 IF (length(source)-length(replace(source,$anchor$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);$anchor$,'')))/length($anchor$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);$anchor$)<>1 THEN RAISE EXCEPTION 'GUEST_GUARD_ANCHOR_MISSING'; END IF;
 source:=replace(source,$anchor$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);$anchor$,$replacement$ IF p_command='addGuestEntry' THEN
  IF p_request->>'definition_id' IS DISTINCT FROM event_row.definition_id::text THEN RAISE EXCEPTION 'STALE_PREVIEW'; END IF;
  SELECT definition INTO definition_row FROM public.tournament_definitions WHERE id=event_row.definition_id;
  IF (definition_row#>>'{registration,closes_at}')::timestamptz<=now() THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
  IF (SELECT count(*) FROM public.teams WHERE tournament_id=p_tournament_id AND entry_state='approved') >= (definition_row#>>'{registration,max_entries}')::integer THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;
  IF jsonb_typeof(p_request->'player_names') IS DISTINCT FROM 'array' OR jsonb_array_length(coalesce(p_effects->'team_members','[]'))<>0 OR jsonb_array_length(coalesce(p_effects->'tournament_players','[]'))<>0 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF jsonb_array_length(coalesce(p_effects->'teams','[]'))<>1 OR jsonb_typeof(p_request->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_request->>'reason')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  row_data:=p_effects->'teams'->0;
  IF row_data->>'guest_definition_id' IS DISTINCT FROM event_row.definition_id::text OR row_data->>'entry_state' IS DISTINCT FROM 'approved' OR EXISTS(SELECT 1 FROM public.teams WHERE id=(row_data->>'id')::uuid) OR NOT coalesce(tournament_builder_private.valid_guests(row_data->'guest_players'),false) OR jsonb_array_length(row_data->'guest_players')<>(CASE WHEN definition_row#>>'{registration,entry_type}'='singles' THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 END IF;
 PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);$replacement$);
 IF (length(source)-length(replace(source,$team$  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id']);$team$,'')))/length($team$  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id']);$team$)<>1 THEN RAISE EXCEPTION 'GUEST_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,$team$  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id']);$team$,$team$  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id']);
  IF (row_data ? 'guest_players' OR row_data ? 'guest_definition_id') AND p_command<>'addGuestEntry' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
$team$);
 IF (length(source)-length(replace(source,$member$  INSERT INTO public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status)$member$,'')))/length($member$  INSERT INTO public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status)$member$)<>1 THEN RAISE EXCEPTION 'GUEST_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,$member$  INSERT INTO public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status)$member$,$member$  IF EXISTS(SELECT 1 FROM public.teams WHERE id=(merged->>'team_id')::uuid AND guest_definition_id IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  INSERT INTO public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status)$member$);
 EXECUTE source;
END $patch$;
COMMIT;
