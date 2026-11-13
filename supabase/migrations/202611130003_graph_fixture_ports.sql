-- Reconstruct fixture input ports from the published graph, independently of effects.
-- This helper alone does not enable review for additional graph formats.
BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.graph_fixture_ports(node jsonb, roster jsonb)
RETURNS TABLE(logical_key text, port_a jsonb, port_b jsonb)
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,tournament_builder_private AS $$
DECLARE inputs jsonb[] := ARRAY[]::jsonb[]; ring jsonb[]; item jsonb;
 n integer; i integer; j integer; r integer; m integer; a integer; b integer; na integer; nb integer;
BEGIN
 IF node->>'module'='match@1' THEN
  RETURN QUERY SELECT node->>'id'||':match', node->'inputs'->0, node->'inputs'->1;
 ELSIF node->>'module'='cross_play@1' THEN
  na:=jsonb_array_length(node->'side_a'); nb:=jsonb_array_length(node->'side_b');
  IF na<1 OR nb<1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  FOR r IN 1..greatest(na,nb) LOOP
   m:=0;
   FOR a IN 0..na-1 LOOP
    FOR b IN 0..nb-1 LOOP
     IF (a+b)%greatest(na,nb)+1=r THEN
      m:=m+1; logical_key:=(node->>'id')||':r'||r||':m'||m;
      port_a:=node->'side_a'->a; port_b:=node->'side_b'->b; RETURN NEXT;
     END IF;
    END LOOP;
   END LOOP;
  END LOOP;
 ELSIF node->>'module'='round_robin@2' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(node->'inputs') LOOP
   IF item->>'kind'='seed' AND tournament_builder_private.graph_seed(roster,(item->>'seed')::integer) IS NULL THEN CONTINUE; END IF;
   inputs:=array_append(inputs,item);
  END LOOP;
  n:=cardinality(inputs);
  IF n<2 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  ring:=inputs;
  IF n%2=1 THEN ring:=array_append(ring,NULL::jsonb); n:=n+1; END IF;
  FOR r IN 1..n-1 LOOP
   m:=0;
   FOR i IN 1..n/2 LOOP
    j:=n+1-i;
    IF ring[i] IS NULL OR ring[j] IS NULL THEN CONTINUE; END IF;
    m:=m+1; logical_key:=(node->>'id')||':r'||r||':m'||m;
    port_a:=ring[i]; port_b:=ring[j]; RETURN NEXT;
   END LOOP;
   ring:=ARRAY[ring[1],ring[n]]||ring[2:n-1];
  END LOOP;
 ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.graph_fixture_ports(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Bindings must be derived by the calling validator from locked database state,
-- never from the submitted effects. This checks scheduled fixtures only.
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_scheduled_fixtures(node jsonb, roster jsonb, stage_id uuid, matches jsonb, bindings jsonb, rounds jsonb, roster_revision bigint, court_count integer)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,tournament_builder_private AS $$
DECLARE fixture record; patch jsonb; round_patch jsonb; expected_count integer:=0;
BEGIN
 FOR fixture IN SELECT * FROM tournament_builder_private.graph_fixture_ports(node,roster) LOOP
  expected_count:=expected_count+1;
  IF NOT (bindings ? fixture.port_a::text) OR NOT (bindings ? fixture.port_b::text) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT value INTO patch FROM jsonb_array_elements(matches) WHERE value->>'logical_key'=fixture.logical_key AND value->>'stage_id'=stage_id::text;
  SELECT value INTO round_patch FROM jsonb_array_elements(rounds) WHERE value->>'id'=patch->>'round_id' AND value->>'stage_id'=stage_id::text;
  IF patch IS NULL OR (SELECT count(*) FROM jsonb_array_elements(matches) x WHERE x->>'logical_key'=fixture.logical_key AND x->>'stage_id'=stage_id::text)<>1
    OR patch->>'team_a_id' IS DISTINCT FROM bindings->>fixture.port_a::text
    OR patch->>'team_b_id' IS DISTINCT FROM bindings->>fixture.port_b::text
    OR patch->>'status' IS DISTINCT FROM 'scheduled' OR patch->>'is_current' IS DISTINCT FROM 'true'
    OR (patch->>'revision')::integer IS DISTINCT FROM 0 OR (patch->>'result_revision')::integer IS DISTINCT FROM 0
    OR patch->>'submit_to_dupr' IS DISTINCT FROM 'false' OR (patch->>'schedule_generation')::bigint IS DISTINCT FROM roster_revision
    OR (patch->>'court_number')::integer NOT BETWEEN 1 AND court_count OR patch->>'court_number' IS NULL
    OR round_patch IS NULL OR (SELECT count(*) FROM jsonb_array_elements(rounds) x WHERE x->>'id'=patch->>'round_id')<>1
    OR round_patch->>'status' IS DISTINCT FROM 'pending' OR round_patch->>'is_current' IS DISTINCT FROM 'true'
    OR (round_patch->>'schedule_generation')::bigint IS DISTINCT FROM roster_revision OR (round_patch->>'logical_wave')::integer IS NULL OR (round_patch->>'logical_wave')::integer<1
    OR patch ?| ARRAY['outcome_kind','winner_team_id','score_a','score_b','validated_by'] THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(matches) x WHERE x->>'stage_id'=stage_id::text)<>expected_count
   OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(matches) x WHERE x->>'stage_id'=stage_id::text)<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(matches) a JOIN jsonb_array_elements(matches) b ON a->>'id'<b->>'id'
   JOIN tournament_builder_private.graph_fixture_ports(node,roster) ap ON ap.logical_key=a->>'logical_key'
   JOIN tournament_builder_private.graph_fixture_ports(node,roster) bp ON bp.logical_key=b->>'logical_key'
   JOIN jsonb_array_elements(rounds) ar ON ar->>'id'=a->>'round_id' JOIN jsonb_array_elements(rounds) br ON br->>'id'=b->>'round_id'
   WHERE a->>'stage_id'=stage_id::text AND b->>'stage_id'=stage_id::text AND ar->>'logical_wave'=br->>'logical_wave'
   AND (a->>'court_number'=b->>'court_number' OR a->>'team_a_id' IN (b->>'team_a_id',b->>'team_b_id') OR a->>'team_b_id' IN (b->>'team_a_id',b->>'team_b_id')
     OR ap.port_a IN (bp.port_a,bp.port_b) OR ap.port_b IN (bp.port_a,bp.port_b))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_graph_scheduled_fixtures(jsonb,jsonb,uuid,jsonb,jsonb,jsonb,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
-- Resolve immediate seed-based sources from locked persisted state. Deferred
-- sources remain unknown until played. The caller must independently validate
-- completeness of each source schedule and absence of pre-existing deferred fixtures.
CREATE OR REPLACE FUNCTION tournament_builder_private.graph_resolve_bindings(event_id uuid, definition_id uuid, nodes jsonb, roster jsonb, node jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE src jsonb; source_node jsonb; source_stage public.tournament_stages%ROWTYPE; source_match public.matches%ROWTYPE;
 resolved_value text; bindings jsonb:='{}'::jsonb; inputs jsonb; deferred boolean;
BEGIN
 FOR src IN SELECT p FROM (SELECT port_a p FROM tournament_builder_private.graph_fixture_ports(node,roster) UNION SELECT port_b FROM tournament_builder_private.graph_fixture_ports(node,roster)) ports LOOP
  resolved_value:=NULL;
  IF src->>'kind'='seed' THEN
   resolved_value:=tournament_builder_private.graph_seed(roster,(src->>'seed')::integer);
   IF resolved_value IS NULL THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  ELSIF src->>'kind' IN ('rank','winner','loser') THEN
   SELECT n INTO source_node FROM jsonb_array_elements(nodes) n WHERE n->>'id'=src->>'node_id';
   IF source_node IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   inputs:=CASE WHEN source_node->>'module'='cross_play@1' THEN coalesce(source_node->'side_a','[]')||coalesce(source_node->'side_b','[]') ELSE coalesce(source_node->'inputs','[]') END;
   deferred:=EXISTS(SELECT 1 FROM jsonb_array_elements(inputs) i WHERE i->>'kind'<>'seed');
   IF deferred THEN
    IF EXISTS(SELECT 1 FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id WHERE m.tournament_id=event_id AND s.definition_id=graph_resolve_bindings.definition_id AND s.node_id=source_node->>'id' AND m.is_current AND m.voided_at IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   ELSE
    SELECT * INTO source_stage FROM public.tournament_stages WHERE tournament_id=event_id AND tournament_stages.definition_id=graph_resolve_bindings.definition_id AND node_id=source_node->>'id';
    IF NOT FOUND OR source_stage.state NOT IN ('completed','blocked') OR EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=source_stage.id AND m.is_current AND m.voided_at IS NULL AND (m.status NOT IN ('validated','walkover') OR m.outcome_kind IS NULL)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF src->>'kind'='rank' AND source_node->>'module' IN ('round_robin@2','cross_play@1') THEN
     SELECT row_value->>'entryId' INTO resolved_value FROM jsonb_array_elements(source_stage.output->'rows') WITH ORDINALITY r(row_value,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=row_value->>'entryId' AND t.entry_state='approved' ORDER BY ord OFFSET greatest((src->>'rank')::integer-1,0) LIMIT 1;
     IF resolved_value IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(source_stage.output->'ties','[]')) g WHERE g @> jsonb_build_array(resolved_value) AND (SELECT count(*) FROM jsonb_array_elements_text(g) member JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=member AND t.entry_state='approved')>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    ELSIF src->>'kind' IN ('winner','loser') AND source_node->>'module'='match@1' THEN
     SELECT * INTO source_match FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL;
     IF source_match.id IS NULL OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL)<>1 OR source_match.winner_team_id IS NULL OR source_match.winner_team_id NOT IN (source_match.team_a_id,source_match.team_b_id) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     resolved_value:=CASE WHEN src->>'kind'='winner' THEN source_match.winner_team_id::text WHEN source_match.winner_team_id=source_match.team_a_id THEN source_match.team_b_id::text ELSE source_match.team_a_id::text END;
    ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
   END IF;
  ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  IF resolved_value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=resolved_value AND entry_state='approved') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  bindings:=bindings||jsonb_build_object(src::text,resolved_value);
 END LOOP;
 RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.graph_resolve_bindings(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Audit only an unplayed group with approved resolved entries and no manual draws
-- or exclusions. Bindings must come from graph_resolve_bindings in this transaction.
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_empty_group(event_id uuid, node jsonb, roster jsonb, stage_id uuid, stage_patch jsonb, standings jsonb, matches jsonb, bindings jsonb, revision bigint)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE stored public.tournament_stages%ROWTYPE; src jsonb; entry text; ids jsonb:='[]'; rows jsonb:='[]'; ties jsonb:='[]';
 sources jsonb; expected_state text:='ready'; expected_output jsonb; first_key text; first_round text; standing jsonb; tie_text text; n integer;
BEGIN
 IF node->>'module' NOT IN ('round_robin@2','cross_play@1') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT * INTO stored FROM public.tournament_stages WHERE id=stage_id AND tournament_id=event_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND matches.stage_id=stored.id AND is_current AND voided_at IS NULL)
   OR EXISTS(SELECT 1 FROM public.standings WHERE tournament_id=event_id AND standings.stage_id=stored.id)
   OR coalesce(roster->'excludedByNode'->(node->>'id'),'[]'::jsonb)<>'[]'::jsonb
   OR coalesce(stored.output->'rankingDraws','[]'::jsonb)<>'[]'::jsonb THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 sources:=CASE WHEN node->>'module'='cross_play@1' THEN (node->'side_a')||(node->'side_b') ELSE node->'inputs' END;
 FOR src IN SELECT value FROM jsonb_array_elements(sources) LOOP
  IF node->>'module'='round_robin@2' AND src->>'kind'='seed' AND tournament_builder_private.graph_seed(roster,(src->>'seed')::integer) IS NULL THEN CONTINUE; END IF;
  IF NOT (bindings ? src::text) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  entry:=bindings->>src::text;
  IF entry IS NULL THEN expected_state:='waiting'; CONTINUE; END IF;
  IF ids @> jsonb_build_array(entry) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=entry AND entry_state='approved') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ids:=ids||jsonb_build_array(entry);
  rows:=rows||jsonb_build_array(jsonb_build_object('entryId',entry,'wins',0,'losses',0,'pointsFor',0,'pointsAgainst',0,'pointsForInLosses',0));
 END LOOP;
 n:=jsonb_array_length(ids);
 IF n>1 THEN ties:=jsonb_build_array(ids); SELECT string_agg(value,',' ORDER BY ord) INTO tie_text FROM jsonb_array_elements_text(ids) WITH ORDINALITY x(value,ord); END IF;
 expected_output:=coalesce(stored.output,'{}'::jsonb)||jsonb_build_object('state',expected_state,'entryIds',ids,'rows',rows,'ties',ties,'inputRevision',0,'rankingDraws','[]'::jsonb);
 IF stage_patch->>'id' IS DISTINCT FROM stage_id::text OR stage_patch->>'state' IS DISTINCT FROM expected_state OR stage_patch->'output' IS DISTINCT FROM expected_output OR stage_patch->>'blocked_code' IS NOT NULL OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM 0 OR (stage_patch->>'output_revision')::bigint IS DISTINCT FROM revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT logical_key INTO first_key FROM tournament_builder_private.graph_fixture_ports(node,roster) LIMIT 1;
 SELECT value->>'round_id' INTO first_round FROM jsonb_array_elements(matches) WHERE value->>'stage_id'=stage_id::text AND value->>'logical_key'=first_key;
 IF first_round IS NULL OR (SELECT count(*) FROM jsonb_array_elements(standings) x WHERE x->>'stage_id'=stage_id::text)<>n THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR standing IN SELECT value FROM jsonb_array_elements(standings) WHERE value->>'stage_id'=stage_id::text LOOP
  PERFORM tournament_builder_private.assert_keys(standing,ARRAY['id','stage_id','round_id','team_id','wins','losses','points_for','points_against','rank','input_revision','eligible','tie_group']);
  IF NOT (ids @> jsonb_build_array(standing->>'team_id')) OR (SELECT count(*) FROM jsonb_array_elements(standings) x WHERE x->>'stage_id'=stage_id::text AND x->>'team_id'=standing->>'team_id')<>1
    OR EXISTS(SELECT 1 FROM public.standings WHERE id=(standing->>'id')::uuid) OR standing->>'round_id' IS DISTINCT FROM first_round
    OR (standing->>'wins')::integer IS DISTINCT FROM 0 OR (standing->>'losses')::integer IS DISTINCT FROM 0
    OR (standing->>'points_for')::integer IS DISTINCT FROM 0 OR (standing->>'points_against')::integer IS DISTINCT FROM 0
    OR (standing->>'rank')::integer IS DISTINCT FROM 1 OR (standing->>'input_revision')::integer IS DISTINCT FROM 0
    OR standing->>'eligible' IS DISTINCT FROM 'true' OR standing->>'tie_group' IS DISTINCT FROM tie_text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_graph_empty_group(uuid,jsonb,jsonb,uuid,jsonb,jsonb,jsonb,jsonb,bigint) FROM PUBLIC,anon,authenticated,service_role;
-- Rebuild each match's legacy routing from every published fixture port.
-- The calling validator must verify the fixture set, IDs and accepted outcomes.
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_routes(event_id uuid, definition_id uuid, nodes jsonb, roster jsonb, matches jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE node jsonb; target jsonb; port record; old_match public.matches%ROWTYPE; effect jsonb; target_effect jsonb; target_stage uuid;
 kind text; route_field text; side_field text; expected_id text; expected_side text; target_id text; target_count integer; old_id text; old_side text; actual_id text; actual_side text;
BEGIN
 FOR node IN SELECT value FROM jsonb_array_elements(nodes) WHERE value->>'module'='match@1' LOOP
  SELECT m.* INTO old_match FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id
   WHERE m.tournament_id=event_id AND s.definition_id=validate_graph_routes.definition_id AND s.node_id=node->>'id' AND m.logical_key=(node->>'id')||':match' AND m.is_current AND m.voided_at IS NULL;
  SELECT value INTO effect FROM jsonb_array_elements(matches) WHERE value->>'id'=old_match.id::text OR value->>'logical_key'=(node->>'id')||':match';
  IF old_match.id IS NULL AND effect IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  FOR kind IN SELECT unnest(ARRAY['winner','loser']) LOOP
   target_count:=0; expected_id:=NULL; expected_side:=NULL;
   FOR target IN SELECT value FROM jsonb_array_elements(nodes) WHERE value->>'module' IN ('match@1','round_robin@2','cross_play@1') LOOP
    FOR port IN SELECT * FROM tournament_builder_private.graph_fixture_ports(target,roster) LOOP
     IF NOT ((port.port_a->>'kind'=kind AND port.port_a->>'node_id'=node->>'id') OR (port.port_b->>'kind'=kind AND port.port_b->>'node_id'=node->>'id')) THEN CONTINUE; END IF;
     SELECT s.id INTO target_stage FROM public.tournament_stages s WHERE s.tournament_id=event_id AND s.definition_id=validate_graph_routes.definition_id AND s.node_id=target->>'id';
     SELECT value INTO target_effect FROM jsonb_array_elements(matches) WHERE value->>'logical_key'=port.logical_key AND value->>'stage_id'=target_stage::text;
     target_id:=target_effect->>'id';
     IF target_id IS NULL THEN SELECT m.id::text INTO target_id FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=target_stage AND m.logical_key=port.logical_key AND m.is_current AND m.voided_at IS NULL; END IF;
     IF target_id IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
     target_count:=target_count+1; expected_id:=target_id;
     expected_side:=CASE WHEN port.port_a->>'kind'=kind AND port.port_a->>'node_id'=node->>'id' THEN 'a' ELSE 'b' END;
    END LOOP;
   END LOOP;
   IF target_count>1 THEN expected_id:=NULL; expected_side:=NULL; END IF;
   route_field:=CASE WHEN kind='winner' THEN 'bracket_next_winner_match_id' ELSE 'bracket_next_loser_match_id' END;
   side_field:=CASE WHEN kind='winner' THEN 'bracket_winner_fills_side' ELSE 'bracket_loser_fills_side' END;
   old_id:=CASE WHEN kind='winner' THEN old_match.bracket_next_winner_match_id::text ELSE old_match.bracket_next_loser_match_id::text END;
   old_side:=CASE WHEN kind='winner' THEN old_match.bracket_winner_fills_side ELSE old_match.bracket_loser_fills_side END;
   actual_id:=CASE WHEN effect ? route_field THEN effect->>route_field ELSE old_id END;
   actual_side:=CASE WHEN effect ? side_field THEN effect->>side_field ELSE old_side END;
   IF actual_id IS DISTINCT FROM expected_id OR actual_side IS DISTINCT FROM expected_side THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_graph_routes(uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
