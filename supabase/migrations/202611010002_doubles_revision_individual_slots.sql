-- Pre-fixture revisions retain individual registration, including half-filled Doubles teams.
BEGIN;
DO $individual_revision$
DECLARE source text; old text; new text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.validate_revision(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
  ($a$ARRAY['id','name','seed','entry_state','eligibility_version','admin_definition_id','registered_by']$a$,
   $b$ARRAY['id','name','seed','entry_state','eligibility_version','admin_definition_id','registered_by','registration_slot']$b$),
  ($a$IF removed AND jsonb_array_length(members)<>0 OR NOT removed AND jsonb_array_length(members)<>member_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;$a$,
   $b$IF removed AND jsonb_array_length(members)<>0 OR NOT removed AND jsonb_array_length(members)<>member_count AND NOT (member_count=2 AND jsonb_array_length(members)=1 AND NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF NOT removed AND NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) THEN
   IF NOT coalesce((desired->>'registration_slot')::integer BETWEEN 1 AND (request#>>'{definition,registration,max_entries}')::integer,false) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF item ? 'registration_slot' AND item->'registration_slot' IS DISTINCT FROM to_jsonb(t)->'registration_slot' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;$b$),
  ($a$IF item->>'membership_status'='active' THEN$a$,
   $b$IF item->>'membership_status'='active' THEN
   IF NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) AND NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=event AND user_id=uid AND status='approved') THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;$b$),
  ($a$IF jsonb_array_length(effects->'stages') IS DISTINCT FROM jsonb_array_length(request#>'{definition,nodes}') THEN$a$,
   $b$IF NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) AND cardinality(ids)+(SELECT count(*) FROM public.tournament_players joined_player WHERE joined_player.tournament_id=event AND joined_player.status='approved' AND NOT joined_player.user_id=ANY(ids) AND NOT EXISTS(SELECT 1 FROM public.team_members placed_member WHERE placed_member.tournament_id=event AND placed_member.user_id=joined_player.user_id AND placed_member.membership_status IN ('active','pending')))>(request#>>'{definition,registration,max_entries}')::integer*member_count THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;
 IF jsonb_array_length(effects->'stages') IS DISTINCT FROM jsonb_array_length(request#>'{definition,nodes}') THEN$b$)
 ) patches(a,b) LOOP
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_REVISION_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 EXECUTE source;

 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 old:=$a$p_command NOT IN ('addRegisteredEntry','reviseTournament') THEN RAISE EXCEPTION 'INVALID_EFFECTS';$a$;
 new:=$b$p_command NOT IN ('addRegisteredEntry','reviseTournament','placeRegisteredPlayer') THEN RAISE EXCEPTION 'INVALID_EFFECTS';$b$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>2 THEN RAISE EXCEPTION 'INDIVIDUAL_PLACEMENT_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids','admin_change']);$a$;
 new:=$b$ IF p_command='placeRegisteredPlayer' THEN
  IF NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND user_id=(p_request->>'user_id')::uuid AND status='approved') THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) LOOP
   IF (candidate ? 'admin_definition_id' OR candidate ? 'registered_by') AND (candidate->>'admin_definition_id' IS DISTINCT FROM event_row.definition_id::text OR candidate->>'registered_by' IS DISTINCT FROM p_actor_id::text) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP
   IF candidate->>'user_id' IS DISTINCT FROM p_request->>'user_id' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF candidate->>'membership_status'='active' THEN
    IF candidate->>'admission_source' IS DISTINCT FROM 'administrator' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
    IF (candidate->>'consented_at' IS NOT NULL OR candidate->>'consented_definition_id' IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.team_members genuine WHERE genuine.tournament_id=p_tournament_id AND genuine.user_id=(candidate->>'user_id')::uuid AND genuine.consented_at=(candidate->>'consented_at')::timestamptz AND genuine.consented_definition_id=(candidate->>'consented_definition_id')::uuid) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   END IF;
  END LOOP;
 END IF;
$b$||old;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_PLACEMENT_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 FOR old,new IN SELECT * FROM (VALUES
  ($a$IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=profile_id) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;$a$,
   $b$IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=profile_id) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
   IF expected_count=2 AND NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND user_id=profile_id AND status='approved') THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;$b$),
  ($a$ARRAY['id','name','entry_state','admin_definition_id','registered_by']$a$,
   $b$ARRAY['id','name','entry_state','admin_definition_id','registered_by','registration_slot']$b$),
  ($a$registered_team:=(row_data->>'id')::uuid;$a$,
   $b$IF expected_count=2 AND (NOT coalesce((row_data->>'registration_slot')::integer BETWEEN 1 AND (definition_row#>>'{registration,max_entries}')::integer,false) OR EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=p_tournament_id AND registration_slot=(row_data->>'registration_slot')::integer)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  registered_team:=(row_data->>'id')::uuid;$b$)
 ) patches(a,b) LOOP
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_ENROLLMENT_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 EXECUTE source;
END $individual_revision$;
COMMIT;
