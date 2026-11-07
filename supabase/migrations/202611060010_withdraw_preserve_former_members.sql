BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$IF p_command='adminFillPosition' THEN PERFORM tournament_builder_private.validate_admin_fill_position(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'WITHDRAW_FORMER_MEMBER_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='withdrawEntry' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP
   PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','membership_status']);
   IF NOT coalesce(candidate->>'membership_status' IN ('cancelled','withdrawn'),false) OR NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=(candidate->>'id')::uuid AND m.tournament_id=p_tournament_id AND m.team_id=(p_request->>'entry_id')::uuid AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'tournament_players','[]')) LOOP
   PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','status','exit_reason','nullified_from_standings']);
   IF candidate->>'status' IS DISTINCT FROM 'rejected' OR NOT EXISTS(SELECT 1 FROM public.tournament_players p JOIN public.team_members m ON m.tournament_id=p.tournament_id AND m.user_id=p.user_id WHERE p.id=(candidate->>'id')::uuid AND p.tournament_id=p_tournament_id AND m.team_id=(p_request->>'entry_id')::uuid AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
 END IF;
 IF p_command='adminFillPosition' THEN PERFORM tournament_builder_private.validate_admin_fill_position(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 EXECUTE source;
END $migration$;
COMMIT;
