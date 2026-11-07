BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 source := replace(source, chr(13)||chr(10), chr(10));
 anchor := $old$  IF p_command='removeRegisteredPlayer' THEN
   PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','teams','team_members','tournament_players']);$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION 'PRESERVE_TEAMS_SOURCE_MISMATCH'; END IF;
 source := replace(source,anchor,$new$  IF p_command IN ('selectEntrySlot','placeRegisteredPlayer','cancelRegistration','removeRegisteredPlayer') AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) entry WHERE entry->>'entry_state'='cancelled'
  ) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF p_command='removeRegisteredPlayer' THEN
   IF jsonb_array_length(coalesce(p_effects->'teams','[]')) <> 0 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','teams','team_members','tournament_players']);$new$);
 anchor := $old$ IF p_command IN ('joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer','removeRegisteredPlayer') THEN$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION 'PRESERVE_TEAMS_REVISION_SOURCE_MISMATCH'; END IF;
 source := replace(source,anchor,$new$ IF p_client_id='web' AND p_command='reviseTournament' AND EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=p_tournament_id) AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(coalesce(p_request->'entries','[]')) entry WHERE entry->>'remove'='true'
 ) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
 IF p_client_id='web' AND p_command='withdrawEntry' AND EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=p_tournament_id) AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) entry WHERE entry->>'entry_state'='cancelled'
 ) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
 IF p_command IN ('joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer','removeRegisteredPlayer') THEN$new$);
 EXECUTE source;
END $migration$;
COMMIT;
