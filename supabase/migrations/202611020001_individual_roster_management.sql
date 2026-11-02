-- IDD-7: stable individual positions, safe removal and explicitly consented player MCP access.
BEGIN;
ALTER TABLE public.team_members ADD COLUMN player_slot integer CHECK(player_slot BETWEEN 1 AND 2);
-- Historical positions are projected in snapshot order until that participant next moves.
ALTER TABLE public.connection_grants DROP CONSTRAINT connection_grants_permissions_check;
ALTER TABLE public.connection_grants ADD CONSTRAINT connection_grants_permissions_check CHECK(permissions <@ ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage','owner:manage','player:manage']::text[]);
DO $patch$
DECLARE source text; old text; new text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 old:=$a$'joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer'$a$; new:=$b$'joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer','removeRegisteredPlayer'$b$;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status','admission_source']$a$; new:=$b$ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status','admission_source','player_slot']$b$;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$consented_at,membership_status,admission_source) SELECT id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status,admission_source$a$; new:=$b$consented_at,membership_status,admission_source,player_slot) SELECT id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status,admission_source,player_slot$b$;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$admission_source=excluded.admission_source;$a$; new:=$b$admission_source=excluded.admission_source,player_slot=excluded.player_slot;$b$;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids','admin_change']);$a$;
 new:=$b$ IF p_command IN ('joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer','removeRegisteredPlayer') THEN
  IF event_row.modular_state<>'registration_open' OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=p_tournament_id) THEN RAISE EXCEPTION 'STRUCTURE_LOCKED'; END IF;
  IF p_command='removeRegisteredPlayer' THEN
   PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','teams','team_members','tournament_players']);
   PERFORM tournament_builder_private.assert_keys(p_effects->'event',ARRAY['roster_revision']);
   IF NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id AND user_id=(p_request->>'user_id')::uuid AND status='approved') THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
   IF coalesce((p_request->>'release_only')::boolean,false) AND jsonb_array_length(coalesce(p_effects->'tournament_players','[]'))<>0 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) LOOP
    PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','entry_state']);
    IF candidate->>'entry_state' IS DISTINCT FROM 'cancelled' OR NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=(candidate->>'id')::uuid AND m.tournament_id=p_tournament_id AND m.user_id=(p_request->>'user_id')::uuid AND m.membership_status IN ('active','pending')) OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=(candidate->>'id')::uuid AND m.user_id<>(p_request->>'user_id')::uuid AND m.membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   END LOOP;
  END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP
   IF p_command='removeRegisteredPlayer' THEN PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','membership_status']); END IF;
   IF coalesce(candidate->>'user_id',(SELECT user_id::text FROM public.team_members WHERE id=(candidate->>'id')::uuid)) IS DISTINCT FROM (CASE WHEN p_command IN ('placeRegisteredPlayer','removeRegisteredPlayer') THEN p_request->>'user_id' ELSE p_actor_id::text END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF p_command='removeRegisteredPlayer' AND (candidate->>'membership_status' IS DISTINCT FROM 'cancelled' OR NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=(candidate->>'id')::uuid AND m.tournament_id=p_tournament_id AND m.user_id=(p_request->>'user_id')::uuid) OR candidate ? 'team_id' OR candidate ? 'player_slot' OR candidate ? 'consented_at') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'tournament_players','[]')) LOOP
   IF candidate->>'user_id' IS DISTINCT FROM (CASE WHEN p_command='removeRegisteredPlayer' THEN p_request->>'user_id' ELSE p_actor_id::text END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
 END IF;
$b$||old;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new); EXECUTE source;
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 old:=$a$'placeRegisteredPlayer','approveEntry'$a$; new:=$b$'placeRegisteredPlayer','removeRegisteredPlayer','approveEntry'$b$;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_ADMIN_AUTH_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 old:=$a$  IF permission IS NULL OR NOT permission=ANY(grant_row.permissions) THEN$a$;
 new:=$b$  IF command IN ('joinTournament','selectEntrySlot','cancelRegistration') OR command='read' AND event_row.modular_state<>'draft' AND 'player:manage'=ANY(grant_row.permissions) THEN permission:='player:manage'; END IF;
$b$||old;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_PLAYER_AUTH_SOURCE_MISMATCH'; END IF;
 source:=replace(source,old,new);
 source:=replace(source,$a$IF client<>'web' OR event_row.modular_state='draft' THEN$a$,$b$IF (client<>'web' AND NOT 'player:manage'=ANY(grant_row.permissions)) OR event_row.modular_state='draft' THEN$b$);
 source:=replace(source,$a$('requestEntry','acceptPartner','joinTournament','selectEntrySlot','cancelRegistration') AND client='web'$a$,$b$('requestEntry','acceptPartner') AND client='web' THEN RETURN;
 ELSIF command IN ('joinTournament','selectEntrySlot','cancelRegistration') AND (client='web' OR 'player:manage'=ANY(grant_row.permissions))$b$);
 EXECUTE source;
 IF to_regprocedure('public.tb_oauth_store(text,jsonb)') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.tb_oauth_store(text,jsonb)'::regprocedure) INTO source;
  old:=$a$ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage','owner:manage']::text[]$a$;
  IF position(old IN source)=0 THEN RAISE EXCEPTION 'IDD7_OAUTH_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(source,old,$b$ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage','owner:manage','player:manage']::text[]$b$);
 END IF;
END $patch$;
COMMIT;
