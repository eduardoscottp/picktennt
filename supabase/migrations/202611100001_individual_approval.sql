BEGIN;

-- A pending request is a real hold, not an approved player.
CREATE UNIQUE INDEX tb_unique_live_player_position ON public.team_members(tournament_id,team_id,player_slot)
 WHERE player_slot IS NOT NULL AND membership_status IN ('active','pending');

CREATE FUNCTION tournament_builder_private.validate_individual_request(actor uuid, event uuid, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.tournaments%ROWTYPE; def jsonb; member jsonb; projection jsonb; team_patch jsonb; v_team_id uuid; existing public.teams%ROWTYPE; player public.tournament_players%ROWTYPE; size integer; slot integer; position integer;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 SELECT definition INTO def FROM public.tournament_definitions WHERE id=ev.definition_id AND tournament_id=event;
 IF def#>>'{registration,mode}' IS DISTINCT FROM 'approval' THEN RETURN; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['definition_id','consent','slot_index','position']);
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','teams','team_members','tournament_players']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['roster_revision']);
 IF request->'consent' IS DISTINCT FROM 'true'::jsonb OR request->>'definition_id' IS DISTINCT FROM ev.definition_id::text OR
    jsonb_typeof(request->'slot_index') IS DISTINCT FROM 'number' OR jsonb_typeof(request->'position') IS DISTINCT FROM 'number' OR
    jsonb_array_length(coalesce(effects->'teams','[]'))<>1 OR jsonb_array_length(coalesce(effects->'team_members','[]'))<>1 OR jsonb_array_length(coalesce(effects->'tournament_players','[]'))<>1 OR
    effects#>>'{event,roster_revision}' IS DISTINCT FROM (coalesce(ev.roster_revision,0)+1)::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 size:=CASE ev.type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END;
 slot:=(request->>'slot_index')::integer; position:=(request->>'position')::integer;
 IF slot NOT BETWEEN 1 AND (def#>>'{registration,max_entries}')::integer OR position NOT BETWEEN 1 AND size THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=event AND user_id=actor AND status IN ('approved','pending')) OR
    EXISTS(SELECT 1 FROM public.team_members WHERE tournament_id=event AND user_id=actor AND membership_status IN ('active','pending')) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
 IF (SELECT count(*) FROM public.tournament_players WHERE tournament_id=event AND status IN ('approved','pending')) >= (def#>>'{registration,max_entries}')::integer*size THEN RAISE EXCEPTION 'CAPACITY_FULL'; END IF;
 member:=effects->'team_members'->0; projection:=effects->'tournament_players'->0; team_patch:=effects->'teams'->0;
 PERFORM tournament_builder_private.assert_keys(member,ARRAY['id','team_id','user_id','membership_status','player_slot','consented_definition_id','consented_at']);
 PERFORM tournament_builder_private.assert_keys(projection,ARRAY['id','user_id','status','joined_via']);
 PERFORM tournament_builder_private.assert_keys(team_patch,ARRAY['id','name','entry_state','registration_slot']);
 v_team_id:=(member->>'team_id')::uuid;
 SELECT * INTO existing FROM public.teams WHERE tournament_id=event AND registration_slot=slot;
 SELECT * INTO player FROM public.tournament_players WHERE tournament_id=event AND user_id=actor;
 IF member->>'user_id' IS DISTINCT FROM actor::text OR member->>'membership_status' IS DISTINCT FROM 'pending' OR member->>'player_slot' IS DISTINCT FROM position::text OR member->>'consented_definition_id' IS DISTINCT FROM ev.definition_id::text OR member->>'consented_at' IS NULL OR (member->>'consented_at')::timestamptz < clock_timestamp()-interval '5 minutes' OR (member->>'consented_at')::timestamptz > clock_timestamp()+interval '1 minute' OR
    projection->>'user_id' IS DISTINCT FROM actor::text OR projection->>'status' IS DISTINCT FROM 'pending' OR projection->>'joined_via' IS DISTINCT FROM 'link' OR
    (player.id IS NOT NULL AND projection->>'id' IS DISTINCT FROM player.id::text) OR
    team_patch->>'id' IS DISTINCT FROM v_team_id::text OR team_patch->>'entry_state' IS DISTINCT FROM 'approved' OR team_patch->>'registration_slot' IS DISTINCT FROM slot::text OR
    (existing.id IS NOT NULL AND (v_team_id IS DISTINCT FROM existing.id OR existing.entry_state<>'approved' OR team_patch ? 'name')) OR
    (existing.id IS NULL AND (team_patch->>'name' IS DISTINCT FROM ('Team '||slot::text) OR EXISTS(SELECT 1 FROM public.teams WHERE id=v_team_id))) OR
    EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=(member->>'id')::uuid AND (m.tournament_id<>event OR m.team_id<>v_team_id OR m.user_id<>actor OR m.membership_status IN ('active','pending'))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF existing.id IS NOT NULL AND (EXISTS(
   WITH occupants AS (SELECT m.id,m.player_slot FROM public.team_members m WHERE m.tournament_id=event AND m.team_id=existing.id AND m.membership_status IN ('active','pending')),
   unpositioned AS (SELECT id,row_number() OVER (ORDER BY id) n FROM occupants WHERE player_slot IS NULL),
   available AS (SELECT value slot,row_number() OVER (ORDER BY value) n FROM generate_series(1,size) value WHERE NOT EXISTS(SELECT 1 FROM occupants o WHERE o.player_slot=value)),
   assigned AS (SELECT id,player_slot slot FROM occupants WHERE player_slot IS NOT NULL UNION ALL SELECT u.id,a.slot FROM unpositioned u JOIN available a USING(n))
   SELECT 1 FROM assigned WHERE assigned.slot=position
  ) OR (SELECT count(*) FROM public.team_members m WHERE m.team_id=existing.id AND m.membership_status IN ('active','pending'))>=size) THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;
END $$;

CREATE FUNCTION tournament_builder_private.validate_individual_decision(event uuid, command text, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.tournaments%ROWTYPE; definition jsonb; player public.tournament_players%ROWTYPE; held public.team_members%ROWTYPE; member jsonb; projection jsonb; target uuid; next_status text; member_status text;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 SELECT d.definition INTO definition FROM public.tournament_definitions d WHERE d.id=ev.definition_id AND d.tournament_id=event;
 IF ev.modular_state IS DISTINCT FROM 'registration_open' OR definition#>>'{registration,mode}' IS DISTINCT FROM 'approval' OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,CASE WHEN command='approveIndividual' THEN ARRAY['user_id'] ELSE ARRAY['user_id','reason'] END);
 IF command='rejectIndividual' AND (jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 target:=(request->>'user_id')::uuid;
 SELECT * INTO player FROM public.tournament_players WHERE tournament_id=event AND user_id=target AND status='pending';
 SELECT * INTO held FROM public.team_members WHERE tournament_id=event AND user_id=target AND membership_status='pending';
 IF player.id IS NULL OR held.id IS NULL OR held.player_slot IS NULL OR NOT EXISTS(SELECT 1 FROM public.teams t WHERE t.id=held.team_id AND t.tournament_id=event AND t.entry_state='approved' AND t.registration_slot IS NOT NULL) OR (command='approveIndividual' AND (held.consented_at IS NULL OR held.consented_definition_id IS DISTINCT FROM ev.definition_id)) OR (SELECT count(*) FROM public.team_members WHERE tournament_id=event AND user_id=target AND membership_status='pending')<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','team_members','tournament_players']);
 PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['roster_revision']);
 IF jsonb_array_length(coalesce(effects->'team_members','[]'))<>1 OR jsonb_array_length(coalesce(effects->'tournament_players','[]'))<>1 OR effects#>>'{event,roster_revision}' IS DISTINCT FROM (coalesce(ev.roster_revision,0)+1)::text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 member:=effects->'team_members'->0; projection:=effects->'tournament_players'->0;
 PERFORM tournament_builder_private.assert_keys(member,ARRAY['id','membership_status']);
 PERFORM tournament_builder_private.assert_keys(projection,ARRAY['id','user_id','status','joined_via']);
 next_status:=CASE WHEN command='approveIndividual' THEN 'approved' ELSE 'rejected' END;
 member_status:=CASE WHEN command='approveIndividual' THEN 'active' ELSE 'cancelled' END;
 IF member IS DISTINCT FROM jsonb_build_object('id',held.id::text,'membership_status',member_status) OR projection IS DISTINCT FROM jsonb_build_object('id',player.id::text,'user_id',target::text,'status',next_status,'joined_via',coalesce(player.joined_via,'link')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;

CREATE FUNCTION tournament_builder_private.validate_team_rename(event uuid, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.tournaments%ROWTYPE; team public.teams%ROWTYPE; patch jsonb;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event;
 IF ev.modular_state NOT IN ('registration_open','registration_closed','ready','active','completed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['team_id','name','reason']);
 IF jsonb_typeof(request->'name') IS DISTINCT FROM 'string' OR length(btrim(request->>'name')) NOT BETWEEN 1 AND 120 OR jsonb_typeof(request->'reason') IS DISTINCT FROM 'string' OR length(btrim(request->>'reason')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO team FROM public.teams WHERE id=(request->>'team_id')::uuid AND tournament_id=event AND entry_state='approved';
 IF team.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['teams']);
 IF jsonb_array_length(coalesce(effects->'teams','[]'))<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 patch:=effects->'teams'->0;
 IF patch IS DISTINCT FROM jsonb_build_object('id',team.id::text,'name',btrim(request->>'name')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;

DO $patch$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$a$'removeRegisteredPlayer','acceptPartner'$a$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_APPROVAL_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$b$'removeRegisteredPlayer','approveIndividual','rejectIndividual','renameTeam','acceptPartner'$b$);
 anchor:=$a$ IF p_command='adminFillPosition' THEN PERFORM tournament_builder_private.validate_admin_fill_position(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$a$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_APPROVAL_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$b$ IF p_command='selectEntrySlot' AND NOT EXISTS(SELECT 1 FROM public.tournament_players p WHERE p.tournament_id=p_tournament_id AND p.user_id=p_actor_id AND p.status='approved') THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;
 IF p_command='cancelEntry' AND EXISTS(SELECT 1 FROM public.teams t WHERE t.id=(p_request->>'entry_id')::uuid AND t.tournament_id=p_tournament_id AND t.registration_slot IS NOT NULL AND EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=t.id AND m.user_id=p_actor_id AND m.membership_status='pending')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF p_command='closeRegistration' AND EXISTS(SELECT 1 FROM public.team_members m JOIN public.tournament_players p ON p.tournament_id=m.tournament_id AND p.user_id=m.user_id AND p.status='pending' JOIN public.teams t ON t.id=m.team_id AND t.tournament_id=m.tournament_id AND t.entry_state='approved' AND t.registration_slot IS NOT NULL WHERE m.tournament_id=p_tournament_id AND m.membership_status='pending' AND m.player_slot IS NOT NULL) THEN RAISE EXCEPTION 'PENDING_APPROVALS'; END IF;
 IF p_command='lockRoster' AND EXISTS(SELECT 1 FROM public.teams t WHERE t.tournament_id=p_tournament_id AND t.entry_state='approved' AND ((SELECT count(*) FROM public.team_members m WHERE m.tournament_id=p_tournament_id AND m.team_id=t.id AND m.membership_status='active')<>CASE event_row.type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.tournament_id=p_tournament_id AND m.team_id=t.id AND m.membership_status='pending'))) THEN RAISE EXCEPTION 'INCOMPLETE_ROSTER'; END IF;
 IF p_command='joinTournament' THEN PERFORM tournament_builder_private.validate_individual_request(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 IF p_command IN ('approveIndividual','rejectIndividual') THEN PERFORM tournament_builder_private.validate_individual_decision(p_tournament_id,p_command,p_request,p_effects); END IF;
 IF p_command='renameTeam' THEN PERFORM tournament_builder_private.validate_team_rename(p_tournament_id,p_request,p_effects); END IF;
$b$||anchor);
 EXECUTE source;
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$a$'removeRegisteredPlayer','approveEntry'$a$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_APPROVAL_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$b$'removeRegisteredPlayer','approveIndividual','rejectIndividual','renameTeam','approveEntry'$b$);
 SELECT pg_get_functiondef('public.tb_get_snapshot(uuid,text,uuid,uuid)'::regprocedure) INTO source;
 anchor:=$a$ RETURN data||jsonb_build_object('caller_role',caller_role);$a$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_APPROVAL_SNAPSHOT_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$b$ IF caller_role NOT IN ('owner','admin') THEN
  data:=jsonb_set(data,'{team_members}',coalesce(data->'team_members','[]'::jsonb)||coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('display_name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),p.username,'Player'))) FROM public.team_members m JOIN public.profiles p ON p.id=m.user_id WHERE m.tournament_id=p_tournament_id AND m.user_id=p_actor_id AND m.team_id=ANY(visible_teams) AND m.membership_status IN ('cancelled','withdrawn') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(data->'team_members','[]')) v WHERE v->>'id'=m.id::text)),'[]'::jsonb));
  data:=jsonb_set(data,'{team_members}',coalesce((SELECT jsonb_agg(CASE WHEN v->>'membership_status'='pending' AND v->>'user_id' IS DISTINCT FROM p_actor_id::text AND EXISTS(SELECT 1 FROM public.tournament_players p JOIN public.teams t ON t.id=(v->>'team_id')::uuid AND t.tournament_id=p.tournament_id AND t.entry_state='approved' AND t.registration_slot IS NOT NULL WHERE p.tournament_id=p_tournament_id AND p.user_id=(v->>'user_id')::uuid AND p.status='pending') THEN jsonb_build_object('id','held-'||(v->>'id'),'team_id',v->>'team_id','membership_status','pending','player_slot',v->'player_slot','display_name','Pending approval') ELSE v END) FROM jsonb_array_elements(coalesce(data->'team_members','[]')) v),'[]'::jsonb));
  data:=jsonb_set(data,'{team_members}',coalesce(data->'team_members','[]'::jsonb)||coalesce((SELECT jsonb_agg(jsonb_build_object('id','held-'||m.id::text,'team_id',m.team_id,'membership_status','pending','player_slot',m.player_slot,'display_name','Pending approval')) FROM public.team_members m JOIN public.tournament_players p ON p.tournament_id=m.tournament_id AND p.user_id=m.user_id AND p.status='pending' JOIN public.teams t ON t.id=m.team_id AND t.tournament_id=m.tournament_id AND t.entry_state='approved' WHERE m.tournament_id=p_tournament_id AND m.membership_status='pending' AND m.player_slot IS NOT NULL AND t.registration_slot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(data->'team_members','[]')) v WHERE v->>'id' IN (m.id::text,'held-'||m.id::text))),'[]'::jsonb));
 END IF;
$b$||anchor);
 EXECUTE source;
END $patch$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_individual_request(uuid,uuid,jsonb,jsonb), tournament_builder_private.validate_individual_decision(uuid,text,jsonb,jsonb), tournament_builder_private.validate_team_rename(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
COMMIT;
