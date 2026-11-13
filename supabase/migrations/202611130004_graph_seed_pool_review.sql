-- Validate reviewed groups fed by completed seed matches or initial groups,
-- followed by a final or a four-team bracket with final and bronze.
BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_seed_pool(event_id uuid, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE ev public.tournaments%ROWTYPE; roster public.tournament_stages%ROWTYPE; st public.tournament_stages%ROWTYPE;
 nodes jsonb; pool jsonb; pool_inputs jsonb; final_node jsonb; bronze_node jsonb; semi_nodes jsonb; semi jsonb; placements jsonb; feeder jsonb; src jsonb; route jsonb; p jsonb; patch jsonb; round_item jsonb; bindings jsonb;
 group_stage public.tournament_stages%ROWTYPE; final_stage public.tournament_stages%ROWTYPE; bronze_stage public.tournament_stages%ROWTYPE; old_match public.matches%ROWTYPE;
 group_match jsonb; final_match jsonb; bronze_match jsonb; group_round jsonb; final_round jsonb; bronze_round jsonb; semi_match jsonb; semi_round jsonb; seed_a text; seed_b text; side text; expected jsonb; feeder_patches integer:=0; fixture_count integer; target_count integer; target_id text; source_count integer; terminal_count integer; semi_count integer:=0; a jsonb; b jsonb; standing jsonb; stored_standing public.standings%ROWTYPE;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event_id;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['preview_hash']);
 IF coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO roster FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='entries';
 nodes:=coalesce(roster.output->'finalizedNodes',(SELECT definition->'nodes' FROM public.tournament_definitions WHERE id=ev.definition_id AND tournament_id=event_id));
 IF ev.modular_state IS DISTINCT FROM 'active' OR ev.results_under_review OR roster.id IS NULL OR roster.output->>'graphNextStageApproved'='true' OR EXISTS(SELECT 1 FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND output ? 'manualMatchEntries') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT value INTO pool FROM jsonb_array_elements(nodes) n WHERE n->>'module' IN ('round_robin@2','cross_play@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN n->>'module'='cross_play@1' THEN (n->'side_a')||(n->'side_b') ELSE n->'inputs' END) i WHERE i->>'kind'<>'seed');
 pool_inputs:=CASE WHEN pool->>'module'='cross_play@1' THEN (pool->'side_a')||(pool->'side_b') ELSE pool->'inputs' END;
 SELECT value INTO placements FROM jsonb_array_elements(nodes) WHERE value->>'module'='placements@2';
 SELECT value INTO final_node FROM jsonb_array_elements(nodes) WHERE value->>'module'='match@1' AND value->>'id'=placements->>'final';
 terminal_count:=CASE WHEN placements->>'bronze' IS NULL THEN 1 ELSE 2 END;
 IF terminal_count=2 THEN
  SELECT value INTO bronze_node FROM jsonb_array_elements(nodes) WHERE value->>'module'='match@1' AND value->>'id'=placements->>'bronze';
  IF bronze_node IS NULL OR bronze_node->>'id'=final_node->>'id' OR jsonb_array_length(pool_inputs)<4 OR jsonb_array_length(bronze_node->'inputs')<>2 OR (SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(final_node->'inputs') x WHERE x->>'kind'='winner')<>2 OR (SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(bronze_node->'inputs') x WHERE x->>'kind'='loser' AND EXISTS(SELECT 1 FROM jsonb_array_elements(final_node->'inputs') f WHERE f->>'node_id'=x->>'node_id'))<>2 THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  SELECT jsonb_agg(n) INTO semi_nodes FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(final_node->'inputs') f WHERE f->>'node_id'=n->>'id');
  IF jsonb_array_length(semi_nodes) IS DISTINCT FROM 2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(semi_nodes) s WHERE jsonb_array_length(s->'inputs')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'inputs') i WHERE i->>'kind'<>'rank' OR i->>'node_id'<>pool->>'id' OR (i->>'rank')::integer NOT BETWEEN 1 AND 4)) OR (SELECT count(DISTINCT i->>'rank') FROM jsonb_array_elements(semi_nodes) s CROSS JOIN LATERAL jsonb_array_elements(s->'inputs') i)<>4 THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  semi_count:=2;
 END IF;

 IF pool IS NULL OR placements IS NULL OR final_node IS NULL OR jsonb_array_length(pool_inputs)<2 OR jsonb_array_length(final_node->'inputs')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(pool_inputs) x WHERE x->>'kind' NOT IN ('seed','winner','loser','rank')) OR (SELECT count(DISTINCT x::text) FROM jsonb_array_elements(pool_inputs) x)<>jsonb_array_length(pool_inputs) OR (SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1')<>(SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(pool_inputs) x WHERE x->>'kind' IN ('winner','loser'))+terminal_count+semi_count OR (SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module' IN ('round_robin@2','cross_play@1'))<>(SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(pool_inputs) x WHERE x->>'kind'='rank')+1 OR jsonb_array_length(nodes)<>3+(SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1')+(SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module' IN ('round_robin@2','cross_play@1')) OR (semi_count=0 AND NOT (final_node->'inputs' @> jsonb_build_array(jsonb_build_object('kind','rank','node_id',pool->>'id','rank',1),jsonb_build_object('kind','rank','node_id',pool->>'id','rank',2)))) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT count(*) INTO fixture_count FROM tournament_builder_private.graph_fixture_ports(pool,roster.output);
 IF fixture_count<1 THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT * INTO group_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=pool->>'id';
 SELECT * INTO final_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=final_node->>'id';
 IF terminal_count=2 THEN SELECT * INTO bronze_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=bronze_node->>'id'; END IF;
 IF group_stage.id IS NULL OR final_stage.id IS NULL OR (terminal_count=2 AND bronze_stage.id IS NULL) OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND stage_id IN (group_stage.id,final_stage.id,bronze_stage.id) AND is_current AND voided_at IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['stages','rounds','matches','standings']);
 IF jsonb_array_length(coalesce(effects->'rounds','[]'))<2 OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(effects->'rounds') x)<>jsonb_array_length(effects->'rounds') OR (SELECT count(DISTINCT m->>'id') FROM jsonb_array_elements(effects->'matches') m)<>jsonb_array_length(effects->'matches') OR jsonb_array_length(effects->'stages')<>(SELECT count(*) FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT value INTO final_match FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=final_node->>'id'||':match';
 SELECT value INTO final_round FROM jsonb_array_elements(effects->'rounds') WHERE value->>'id'=final_match->>'round_id';
 IF final_match IS NULL OR final_round IS NULL OR (SELECT count(*) FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=final_stage.id::text)<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=group_stage.id::text AND (r->>'logical_wave')::integer >= (final_round->>'logical_wave')::integer) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF terminal_count=2 THEN
  SELECT value INTO bronze_match FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=bronze_node->>'id'||':match';
  SELECT value INTO bronze_round FROM jsonb_array_elements(effects->'rounds') WHERE value->>'id'=bronze_match->>'round_id';
  IF bronze_match IS NULL OR bronze_round IS NULL OR (SELECT count(*) FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=bronze_stage.id::text)<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=group_stage.id::text AND (r->>'logical_wave')::integer >= (bronze_round->>'logical_wave')::integer) OR ((bronze_round->>'logical_wave')::integer=(final_round->>'logical_wave')::integer AND bronze_match->>'court_number'=final_match->>'court_number') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
 FOR semi IN SELECT value FROM jsonb_array_elements(coalesce(semi_nodes,'[]')) LOOP
  SELECT * INTO st FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=semi->>'id';
  IF st.id IS NULL OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT value INTO semi_match FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=semi->>'id'||':match';
  SELECT value INTO semi_round FROM jsonb_array_elements(effects->'rounds') WHERE value->>'id'=semi_match->>'round_id';
  IF semi_match IS NULL OR semi_round IS NULL OR (SELECT count(*) FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=st.id::text)<>1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=group_stage.id::text AND (r->>'logical_wave')::integer >= (semi_round->>'logical_wave')::integer) OR (semi_round->>'logical_wave')::integer >= (final_round->>'logical_wave')::integer OR (semi_round->>'logical_wave')::integer >= (bronze_round->>'logical_wave')::integer THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  bindings:=tournament_builder_private.graph_resolve_bindings(event_id,ev.definition_id,nodes,roster.output,semi);
  PERFORM tournament_builder_private.validate_graph_scheduled_fixtures(semi,roster.output,st.id,effects->'matches',bindings,effects->'rounds',ev.roster_revision,ev.court_count);
  side:=CASE WHEN final_node->'inputs'->0->>'node_id'=semi->>'id' THEN 'a' ELSE 'b' END;
  IF semi_match->>'bracket_next_winner_match_id' IS DISTINCT FROM final_match->>'id' OR semi_match->>'bracket_winner_fills_side' IS DISTINCT FROM side THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  side:=CASE WHEN bronze_node->'inputs'->0->>'node_id'=semi->>'id' THEN 'a' ELSE 'b' END;
  IF semi_match->>'bracket_next_loser_match_id' IS DISTINCT FROM bronze_match->>'id' OR semi_match->>'bracket_loser_fills_side' IS DISTINCT FROM side THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 bindings:=tournament_builder_private.graph_resolve_bindings(event_id,ev.definition_id,nodes,roster.output,pool);
 PERFORM tournament_builder_private.validate_graph_scheduled_fixtures(pool,roster.output,group_stage.id,effects->'matches',bindings,effects->'rounds',ev.roster_revision,ev.court_count);
 bindings:=tournament_builder_private.graph_resolve_bindings(event_id,ev.definition_id,nodes,roster.output,final_node);
 PERFORM tournament_builder_private.validate_graph_scheduled_fixtures(final_node,roster.output,final_stage.id,effects->'matches',bindings,effects->'rounds',ev.roster_revision,ev.court_count);
 IF terminal_count=2 THEN
  bindings:=tournament_builder_private.graph_resolve_bindings(event_id,ev.definition_id,nodes,roster.output,bronze_node);
  PERFORM tournament_builder_private.validate_graph_scheduled_fixtures(bronze_node,roster.output,bronze_stage.id,effects->'matches',bindings,effects->'rounds',ev.roster_revision,ev.court_count);
 END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(effects->'stages') LOOP
  PERFORM tournament_builder_private.assert_keys(p,ARRAY['id','state','input_revision','output_revision','output','blocked_code']);
  SELECT * INTO st FROM public.tournament_stages WHERE id=(p->>'id')::uuid AND tournament_id=event_id AND definition_id=ev.definition_id;
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'stages') x WHERE x->>'id'=p->>'id')<>1 OR (p->>'output_revision')::bigint IS DISTINCT FROM ev.revision+1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF st.id=roster.id THEN
   IF p->>'state' IS DISTINCT FROM st.state OR p->>'blocked_code' IS DISTINCT FROM st.blocked_code OR (p->>'input_revision')::bigint IS DISTINCT FROM st.input_revision OR p#>>'{output,graphNextStageApproved}' IS DISTINCT FROM 'true' OR ((p->'output')-'graphNextStageApproved') IS DISTINCT FROM (st.output-'graphNextStageApproved') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF st.id=group_stage.id THEN
   bindings:=tournament_builder_private.graph_resolve_bindings(event_id,ev.definition_id,nodes,roster.output,pool);
   PERFORM tournament_builder_private.validate_graph_empty_group(event_id,pool,roster.output,st.id,p,effects->'standings',effects->'matches',bindings,ev.revision+1);
  ELSIF st.id IN (final_stage.id,bronze_stage.id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(semi_nodes,'[]')) sn WHERE sn->>'id'=st.node_id) THEN
   IF p->>'state' IS DISTINCT FROM 'waiting' OR p->'output' IS DISTINCT FROM (st.output||'{"state":"waiting","entryIds":[],"inputRevision":0}'::jsonb) OR (p->>'input_revision')::bigint IS DISTINCT FROM 0 OR p->>'blocked_code' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF st.module_id='placements' THEN
   IF p->>'state' IS DISTINCT FROM 'ready' OR p->'output' IS DISTINCT FROM '{"state":"ready"}'::jsonb OR (p->>'input_revision')::bigint IS DISTINCT FROM st.input_revision OR p->>'blocked_code' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF p->>'state' IS DISTINCT FROM st.state OR p->'output' IS DISTINCT FROM st.output OR p->>'blocked_code' IS DISTINCT FROM st.blocked_code OR (p->>'input_revision')::bigint IS DISTINCT FROM st.input_revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR standing IN SELECT value FROM jsonb_array_elements(coalesce(effects->'standings','[]')) x WHERE x->>'stage_id' IS DISTINCT FROM group_stage.id::text LOOP
  SELECT * INTO stored_standing FROM public.standings WHERE id=(standing->>'id')::uuid AND tournament_id=event_id AND stage_id IN (SELECT id FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id IN ('round_robin','cross_play') AND id<>group_stage.id);
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'standings') x WHERE x->>'id'=standing->>'id')<>1 OR standing IS DISTINCT FROM jsonb_build_object('id',stored_standing.id,'stage_id',stored_standing.stage_id,'round_id',stored_standing.round_id,'team_id',stored_standing.team_id,'wins',stored_standing.wins,'losses',stored_standing.losses,'points_for',stored_standing.points_for,'points_against',stored_standing.points_against,'rank',stored_standing.rank,'input_revision',stored_standing.input_revision,'eligible',stored_standing.eligible,'tie_group',stored_standing.tie_group) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'standings','[]')) x WHERE x->>'stage_id' IS DISTINCT FROM group_stage.id::text)<>(SELECT count(*) FROM public.standings WHERE tournament_id=event_id AND stage_id IN (SELECT id FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id IN ('round_robin','cross_play') AND id<>group_stage.id)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR src IN SELECT DISTINCT ON (value->>'node_id') value FROM jsonb_array_elements(pool_inputs) WHERE value->>'kind'<>'seed' ORDER BY value->>'node_id' LOOP
  IF src->>'kind'='rank' THEN
   SELECT value INTO feeder FROM jsonb_array_elements(nodes) WHERE value->>'id'=src->>'node_id' AND value->>'module' IN ('round_robin@2','cross_play@1');
   IF feeder IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN feeder->>'module'='cross_play@1' THEN (feeder->'side_a')||(feeder->'side_b') ELSE feeder->'inputs' END) i WHERE i->>'kind'<>'seed') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
   SELECT * INTO st FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=feeder->>'id';
   IF feeder->>'module'='cross_play@1' THEN
    IF jsonb_array_length(feeder->'side_a')<1 OR jsonb_array_length(feeder->'side_b')<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements((feeder->'side_a')||(feeder->'side_b')) i WHERE tournament_builder_private.graph_seed(roster.output,(i->>'seed')::integer) IS NULL) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
    source_count:=jsonb_array_length(feeder->'side_a')*jsonb_array_length(feeder->'side_b');
   ELSE
    source_count:=(SELECT count(*) FROM jsonb_array_elements(feeder->'inputs') i WHERE tournament_builder_private.graph_seed(roster.output,(i->>'seed')::integer) IS NOT NULL);
    IF source_count<2 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    source_count:=source_count*(source_count-1)/2;
   END IF;
   IF st.id IS NULL OR st.state NOT IN ('completed','blocked') OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL)<>source_count OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL AND (status NOT IN ('validated','walkover') OR outcome_kind IS NULL)) OR (SELECT min((r->>'logical_wave')::integer) FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=group_stage.id::text) <= (SELECT coalesce(max(logical_wave),2147483647) FROM public.rounds WHERE tournament_id=event_id AND stage_id=st.id AND is_current) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF feeder->>'module'='cross_play@1' THEN
    FOR a IN SELECT value FROM jsonb_array_elements(feeder->'side_a') LOOP
     seed_a:=tournament_builder_private.graph_seed(roster.output,(a->>'seed')::integer);
     FOR b IN SELECT value FROM jsonb_array_elements(feeder->'side_b') LOOP
      seed_b:=tournament_builder_private.graph_seed(roster.output,(b->>'seed')::integer);
      IF seed_a=seed_b OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=st.id AND m.is_current AND m.voided_at IS NULL AND ((m.team_a_id::text=seed_a AND m.team_b_id::text=seed_b) OR (m.team_a_id::text=seed_b AND m.team_b_id::text=seed_a)))<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
     END LOOP;
    END LOOP;
   ELSE
   FOR a IN SELECT value FROM jsonb_array_elements(feeder->'inputs') LOOP
    seed_a:=tournament_builder_private.graph_seed(roster.output,(a->>'seed')::integer); IF seed_a IS NULL THEN CONTINUE; END IF;
    FOR b IN SELECT value FROM jsonb_array_elements(feeder->'inputs') WHERE (value->>'seed')::integer>(a->>'seed')::integer LOOP
     seed_b:=tournament_builder_private.graph_seed(roster.output,(b->>'seed')::integer); IF seed_b IS NULL THEN CONTINUE; END IF;
     IF seed_a=seed_b OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=st.id AND m.is_current AND m.voided_at IS NULL AND ((m.team_a_id::text=seed_a AND m.team_b_id::text=seed_b) OR (m.team_a_id::text=seed_b AND m.team_b_id::text=seed_a)))<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END LOOP;
   END LOOP;
   END IF;
   CONTINUE;
  END IF;
  SELECT value INTO feeder FROM jsonb_array_elements(nodes) WHERE value->>'id'=src->>'node_id' AND value->>'module'='match@1';
  IF feeder IS NULL OR feeder->>'id'=final_node->>'id' OR jsonb_array_length(feeder->'inputs')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(feeder->'inputs') x WHERE x->>'kind'<>'seed') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  SELECT * INTO st FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=feeder->>'id';
  SELECT * INTO old_match FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL;
  seed_a:=tournament_builder_private.graph_seed(roster.output,(feeder->'inputs'->0->>'seed')::integer); seed_b:=tournament_builder_private.graph_seed(roster.output,(feeder->'inputs'->1->>'seed')::integer);
  IF st.state IS DISTINCT FROM 'completed' OR old_match.id IS NULL OR old_match.logical_key IS DISTINCT FROM feeder->>'id'||':match' OR old_match.team_a_id::text IS DISTINCT FROM seed_a OR old_match.team_b_id::text IS DISTINCT FROM seed_b OR old_match.status NOT IN ('validated','walkover') OR old_match.outcome_kind IS NULL OR old_match.winner_team_id NOT IN (old_match.team_a_id,old_match.team_b_id) OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL)<>1 OR (SELECT min((r->>'logical_wave')::integer) FROM jsonb_array_elements(effects->'rounds') r WHERE r->>'stage_id'=group_stage.id::text) <= (SELECT coalesce(max(logical_wave),2147483647) FROM public.rounds WHERE tournament_id=event_id AND stage_id=st.id AND is_current) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  expected:=jsonb_build_object('id',old_match.id);
  FOR route IN SELECT value FROM jsonb_array_elements(pool_inputs) WHERE value->>'node_id'=src->>'node_id' LOOP
   SELECT count(*),min(m->>'id'),min(CASE WHEN f.port_a=route THEN 'a' ELSE 'b' END) INTO target_count,target_id,side FROM tournament_builder_private.graph_fixture_ports(pool,roster.output) f JOIN jsonb_array_elements(effects->'matches') m ON m->>'logical_key'=f.logical_key WHERE f.port_a=route OR f.port_b=route;
   IF target_count=0 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF target_count>1 THEN target_id:=NULL; side:=NULL; END IF;
   IF (CASE WHEN route->>'kind'='winner' THEN old_match.bracket_next_winner_match_id ELSE old_match.bracket_next_loser_match_id END)::text IS DISTINCT FROM target_id OR (CASE WHEN route->>'kind'='winner' THEN old_match.bracket_winner_fills_side ELSE old_match.bracket_loser_fills_side END) IS DISTINCT FROM side THEN
    expected:=expected||CASE WHEN route->>'kind'='winner' THEN jsonb_build_object('bracket_next_winner_match_id',target_id,'bracket_winner_fills_side',side) ELSE jsonb_build_object('bracket_next_loser_match_id',target_id,'bracket_loser_fills_side',side) END;
   END IF;
  END LOOP;
  IF expected<>jsonb_build_object('id',old_match.id) THEN
   feeder_patches:=feeder_patches+1;
   SELECT value INTO patch FROM jsonb_array_elements(effects->'matches') WHERE value->>'id'=old_match.id::text;
   IF patch IS DISTINCT FROM expected THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
 END LOOP;
 IF jsonb_array_length(effects->'matches')<>fixture_count+terminal_count+semi_count+feeder_patches THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR patch IN SELECT value FROM jsonb_array_elements(effects->'matches') WHERE value ? 'logical_key' LOOP
  PERFORM tournament_builder_private.assert_keys(patch,ARRAY['id','round_id','stage_id','logical_key','court_number','team_a_id','team_b_id','schedule_generation','is_current','status','revision','result_revision','submit_to_dupr','bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side']);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(semi_nodes,'[]')) sn WHERE patch->>'logical_key'=sn->>'id'||':match') AND patch ?| ARRAY['bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side'] THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF EXISTS(SELECT 1 FROM public.matches WHERE id=(patch->>'id')::uuid) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR round_item IN SELECT value FROM jsonb_array_elements(effects->'rounds') LOOP
  PERFORM tournament_builder_private.assert_keys(round_item,ARRAY['id','stage_id','logical_wave','round_number','round_type','status','schedule_generation','is_current']);
  IF EXISTS(SELECT 1 FROM public.rounds WHERE id=(round_item->>'id')::uuid) OR (round_item->>'round_number')::integer IS NULL OR (round_item->>'round_number')::integer <= (SELECT coalesce(max(round_number),0) FROM public.rounds WHERE tournament_id=event_id) OR (round_item->>'round_number')::integer > (SELECT coalesce(max(round_number),0)+jsonb_array_length(effects->'rounds') FROM public.rounds WHERE tournament_id=event_id) OR (round_item->>'logical_wave')::integer > (SELECT coalesce(max(logical_wave),0)+fixture_count+terminal_count+semi_count FROM public.rounds WHERE tournament_id=event_id AND is_current) OR round_item->>'round_type' IS DISTINCT FROM (CASE WHEN round_item->>'stage_id'=group_stage.id::text THEN 'round_robin' WHEN round_item->>'stage_id'=final_stage.id::text THEN 'finals_gold' WHEN round_item->>'stage_id'=bronze_stage.id::text THEN 'finals_bronze' WHEN EXISTS(SELECT 1 FROM public.tournament_stages ss JOIN jsonb_array_elements(coalesce(semi_nodes,'[]')) sn ON sn->>'id'=ss.node_id WHERE ss.id::text=round_item->>'stage_id' AND ss.tournament_id=event_id AND ss.definition_id=ev.definition_id) THEN 'elimination' ELSE NULL END) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m->>'round_id'=round_item->>'id' AND m->>'stage_id'=round_item->>'stage_id') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') x JOIN jsonb_array_elements(effects->'matches') y ON x->>'id'<y->>'id' JOIN jsonb_array_elements(effects->'rounds') xr ON xr->>'id'=x->>'round_id' JOIN jsonb_array_elements(effects->'rounds') yr ON yr->>'id'=y->>'round_id' WHERE xr->>'logical_wave'=yr->>'logical_wave' AND x->>'court_number'=y->>'court_number') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF (SELECT count(DISTINCT r->>'round_number') FROM jsonb_array_elements(effects->'rounds') r)<>jsonb_array_length(effects->'rounds') OR (SELECT count(DISTINCT (r->>'stage_id',r->>'logical_wave')) FROM jsonb_array_elements(effects->'rounds') r)<>jsonb_array_length(effects->'rounds') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_graph_seed_pool(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects);$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'GRAPH_POOL_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF EXISTS(SELECT 1 FROM public.tournament_stages rs CROSS JOIN LATERAL jsonb_array_elements(coalesce(rs.output->'finalizedNodes',(SELECT d.definition->'nodes' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id))) n WHERE rs.tournament_id=p_tournament_id AND rs.definition_id=event_row.definition_id AND rs.module_id='entries' AND n->>'module' IN ('round_robin@2','cross_play@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN n->>'module'='cross_play@1' THEN (n->'side_a')||(n->'side_b') ELSE n->'inputs' END) i WHERE i->>'kind'<>'seed')) THEN
    PERFORM tournament_builder_private.validate_graph_seed_pool(p_tournament_id,p_request,p_effects);
   ELSE PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 EXECUTE source;
END $migration$;
COMMIT;
