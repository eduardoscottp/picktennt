-- Current owners manage existing administrator rows through audited commands only.
-- No ownership transfer, identity creation, roster changes or legacy behavior changes.
BEGIN;
DO $administrators$
DECLARE source text; old text; new text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.snapshot(uuid)'::regprocedure) INTO source;
 old:=$anchor$ 'teams',coalesce($anchor$;
 new:=$replacement$ 'admins',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('display_name',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.username,'Player')) ORDER BY a.succession_order) FROM public.tournament_admins a JOIN public.profiles p ON p.id=a.user_id WHERE a.tournament_id=event),'[]'),
 'teams',coalesce($replacement$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'ADMIN_SNAPSHOT_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,old,new);
 SELECT pg_get_functiondef('public.tb_get_snapshot(uuid,text,uuid,uuid)'::regprocedure) INTO source;
 old:=$anchor$ IF caller_role NOT IN ('owner','admin') THEN$anchor$;
 new:=old||E'\n  data:=data-''admins'';';
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'ADMIN_SNAPSHOT_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,old,new);
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
 ($a$'publishTournament','addGuestEntry','addRegisteredEntry','requestEntry'$a$,$b$'publishTournament','addGuestEntry','addRegisteredEntry','addAdministrator','removeAdministrator','requestEntry'$b$),
 ($a$candidate jsonb;$a$,$b$candidate jsonb; administrator_target uuid; administrator_row uuid;$b$),
 ($a$ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']$a$,$b$ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids','admin_change']$b$)
 ) patches(old_text,new_text) LOOP
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'ADMIN_COMMAND_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 old:=$anchor$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids','admin_change']);$anchor$;
 new:=$guard$ IF p_effects ? 'admin_change' AND p_command NOT IN ('addAdministrator','removeAdministrator') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF p_command IN ('addAdministrator','removeAdministrator') THEN
  IF event_row.created_by IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_request,ARRAY['user_id','reason','confirmed_owner_action','reviewed_action_hash']);
  IF p_request->'confirmed_owner_action' IS DISTINCT FROM 'true'::jsonb OR coalesce(p_request->>'reviewed_action_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CONFIRMATION_REQUIRED'; END IF;
  IF jsonb_typeof(p_request->'user_id') IS DISTINCT FROM 'string' OR (p_request->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(p_request->'reason') IS DISTINCT FROM 'string' OR length(p_request->>'reason') NOT BETWEEN 1 AND 1000 OR (p_request->>'reason') !~ '[^[:space:]]' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  administrator_target:=(p_request->>'user_id')::uuid;
  IF p_command='removeAdministrator' AND administrator_target=event_row.created_by THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=administrator_target) THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['admin_change']);
  row_data:=p_effects->'admin_change';
  IF row_data IS NULL OR jsonb_typeof(row_data)<>'object' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['action','id','user_id']);
  IF row_data->>'user_id' IS DISTINCT FROM administrator_target::text OR row_data->>'action' IS DISTINCT FROM (CASE WHEN p_command='addAdministrator' THEN 'add' ELSE 'remove' END) OR jsonb_typeof(row_data->'id') IS DISTINCT FROM 'string' OR (row_data->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  administrator_row:=(row_data->>'id')::uuid;
  IF p_command='addAdministrator' THEN
   IF administrator_target=event_row.created_by OR EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=administrator_target) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF EXISTS(SELECT 1 FROM public.tournament_admins WHERE id=administrator_row) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE id=administrator_row AND tournament_id=p_tournament_id AND user_id=administrator_target) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  END IF;
 END IF;
$guard$||old;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'ADMIN_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$anchor$ INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),p_tournament_id);$anchor$;
 new:=old||$mutation$
 IF p_command='addAdministrator' THEN
  INSERT INTO public.tournament_admins(id,tournament_id,user_id,succession_order,granted_by)
   SELECT administrator_row,p_tournament_id,administrator_target,coalesce(max(succession_order),0)+1,p_actor_id FROM public.tournament_admins WHERE tournament_id=p_tournament_id;
 ELSIF p_command='removeAdministrator' THEN
  DELETE FROM public.tournament_admins WHERE id=administrator_row AND tournament_id=p_tournament_id AND user_id=administrator_target AND user_id<>event_row.created_by;
 END IF;
$mutation$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'ADMIN_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 EXECUTE source;
END $administrators$;
COMMIT;
