BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$IF p_command='adminFillPosition' THEN PERFORM tournament_builder_private.validate_admin_fill_position(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ADMIN_PLAYER_MOVE_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='placeRegisteredPlayer' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP
   IF candidate->>'id' IS NULL OR candidate->>'user_id' IS DISTINCT FROM p_request->>'user_id' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF candidate->>'membership_status'='cancelled' THEN
    PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','user_id','membership_status']);
    IF NOT EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=(candidate->>'id')::uuid AND m.tournament_id=p_tournament_id AND m.user_id=(p_request->>'user_id')::uuid AND m.membership_status='active') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   ELSIF candidate->>'membership_status'='active' THEN
    IF (p_request ? 'position' AND candidate->>'player_slot' IS DISTINCT FROM p_request->>'position') OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=(candidate->>'id')::uuid AND (m.tournament_id<>p_tournament_id OR m.user_id<>(p_request->>'user_id')::uuid OR m.team_id<>(candidate->>'team_id')::uuid)) OR NOT (EXISTS(SELECT 1 FROM public.teams t WHERE t.id=(candidate->>'team_id')::uuid AND t.tournament_id=p_tournament_id AND t.registration_slot=(p_request->>'slot_index')::integer) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) t WHERE t->>'id'=candidate->>'team_id' AND (t->>'registration_slot')::integer=(p_request->>'slot_index')::integer AND t->>'entry_state'='approved' AND NOT EXISTS(SELECT 1 FROM public.teams existing WHERE existing.id=(candidate->>'team_id')::uuid))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   ELSE
    PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','user_id','player_slot']);
    IF NOT (candidate ? 'player_slot') OR (p_request ? 'position' AND candidate->>'player_slot' IS DISTINCT FROM p_request->>'position') OR NOT EXISTS(SELECT 1 FROM public.team_members m JOIN public.teams t ON t.id=m.team_id WHERE m.id=(candidate->>'id')::uuid AND m.tournament_id=p_tournament_id AND m.user_id=(p_request->>'user_id')::uuid AND m.membership_status='active' AND t.registration_slot=(p_request->>'slot_index')::integer) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   END IF;
   IF candidate->>'membership_status' IS DISTINCT FROM 'cancelled' THEN
    IF NOT coalesce((candidate->>'player_slot')::integer BETWEEN 1 AND CASE event_row.type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END,false) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
    IF EXISTS(
     WITH occupants AS (
      SELECT m.id,m.player_slot FROM public.team_members m WHERE m.tournament_id=p_tournament_id AND m.team_id=coalesce((candidate->>'team_id')::uuid,(SELECT own.team_id FROM public.team_members own WHERE own.id=(candidate->>'id')::uuid)) AND m.membership_status NOT IN ('cancelled','withdrawn')
     ), unpositioned AS (
      SELECT id,row_number() OVER (ORDER BY id) AS n FROM occupants WHERE player_slot IS NULL
     ), free_slots AS (
      SELECT value AS slot,row_number() OVER (ORDER BY value) AS n FROM generate_series(1,CASE event_row.type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END) value WHERE NOT EXISTS(SELECT 1 FROM occupants o WHERE o.player_slot=value)
     ), assigned AS (
      SELECT id,player_slot AS slot FROM occupants WHERE player_slot IS NOT NULL UNION ALL SELECT u.id,f.slot FROM unpositioned u JOIN free_slots f USING(n)
     ) SELECT 1 FROM assigned WHERE id<>(candidate->>'id')::uuid AND slot=(candidate->>'player_slot')::integer
    ) OR (SELECT count(*) FROM public.team_members m WHERE m.tournament_id=p_tournament_id AND m.team_id=coalesce((candidate->>'team_id')::uuid,(SELECT own.team_id FROM public.team_members own WHERE own.id=(candidate->>'id')::uuid)) AND m.membership_status NOT IN ('cancelled','withdrawn') AND m.id<>(candidate->>'id')::uuid)>=(CASE event_row.type WHEN 'singles' THEN 1 WHEN 'doubles' THEN 2 ELSE 0 END) THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;
   END IF;
  END LOOP;
 END IF;
 IF p_command='adminFillPosition' THEN PERFORM tournament_builder_private.validate_admin_fill_position(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 EXECUTE source;
END $migration$;
COMMIT;
