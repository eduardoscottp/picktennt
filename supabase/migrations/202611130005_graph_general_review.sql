-- Independent validation primitives for reviewed, scheduled graph stages.
-- This migration does not enable additional graph shapes by itself.
BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.graph_node_inputs(node jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN node->>'module'='cross_play@1' THEN coalesce(node->'side_a','[]')||coalesce(node->'side_b','[]') ELSE coalesce(node->'inputs','[]') END
$$;

CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_initial_node(event_id uuid, definition_id uuid, node jsonb, roster jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE st public.tournament_stages%ROWTYPE; f record; m public.matches%ROWTYPE; a text; b text; total integer:=0;
BEGIN
 SELECT * INTO st FROM public.tournament_stages s WHERE s.tournament_id=event_id AND s.definition_id=validate_graph_initial_node.definition_id AND s.node_id=node->>'id';
 IF NOT FOUND OR st.state NOT IN ('completed','blocked') OR EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) i WHERE i->>'kind'<>'seed') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 FOR f IN SELECT * FROM tournament_builder_private.graph_fixture_ports(node,roster) LOOP
  total:=total+1;
  a:=tournament_builder_private.graph_seed(roster,(f.port_a->>'seed')::integer); b:=tournament_builder_private.graph_seed(roster,(f.port_b->>'seed')::integer);
  IF a IS NOT NULL AND a=b THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT * INTO m FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND logical_key=f.logical_key AND is_current AND voided_at IS NULL;
  IF m.id IS NULL OR m.team_a_id::text IS DISTINCT FROM a OR m.team_b_id::text IS DISTINCT FROM b OR m.status NOT IN ('validated','walkover') OR m.outcome_kind IS NULL OR (m.outcome_kind='no_contest' AND (m.status IS DISTINCT FROM 'validated' OR m.winner_team_id IS NOT NULL)) OR (m.outcome_kind<>'no_contest' AND (m.winner_team_id IS NULL OR (m.winner_team_id IS DISTINCT FROM m.team_a_id AND m.winner_team_id IS DISTINCT FROM m.team_b_id))) OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND logical_key=f.logical_key AND is_current AND voided_at IS NULL)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 END LOOP;
 IF total=0 OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL)<>total THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
END $$;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_general_no_auto(actor_id uuid, event_id uuid, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE ev public.tournaments%ROWTYPE; roster public.tournament_stages%ROWTYPE; st public.tournament_stages%ROWTYPE; source_stage public.tournament_stages%ROWTYPE;
 nodes jsonb; node jsonb; src jsonb; p jsonb; patch jsonb; rr jsonb; bindings jsonb; knowns jsonb; effective jsonb; ids jsonb; expected_state text; placement jsonb;
 fixture_count integer:=0; source_max integer; target_min integer; stored_standing public.standings%ROWTYPE; standing jsonb; has_auto boolean; all_known boolean; ranking_order jsonb;
 complete_all boolean; final_patch jsonb; bronze_patch jsonb; winner text; final_loser text; bronze_winner text; bronze_loser text; groups jsonb; ineligible jsonb; rest jsonb; seen text[]; seen_history text[]; frontier text[]; next_frontier text[]; eliminated text[]; eligible_eliminated text[]; rank_cursor integer; item text;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event_id;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['preview_hash']);
 IF coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT * INTO roster FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='entries';
 SELECT definition#>'{policies,ranking,order}' INTO ranking_order FROM public.tournament_definitions WHERE id=ev.definition_id AND tournament_id=event_id;
 nodes:=coalesce(roster.output->'finalizedNodes',(SELECT definition->'nodes' FROM public.tournament_definitions WHERE id=ev.definition_id AND tournament_id=event_id));
 IF ev.modular_state IS DISTINCT FROM 'active' OR ev.results_under_review OR roster.id IS NULL OR jsonb_typeof(roster.output->'entryIds') IS DISTINCT FROM 'array' OR roster.output->>'graphNextStageApproved'='true' OR jsonb_typeof(nodes) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND output ? 'manualMatchEntries') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n WHERE n->>'module' NOT IN ('registration@1','entries@1','round_robin@2','cross_play@1','match@1','placements@2')) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT value INTO placement FROM jsonb_array_elements(nodes) WHERE value->>'module'='placements@2';
 IF placement IS NULL OR (SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module'='placements@2')<>1 THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','stages','rounds','matches','standings']);
 IF jsonb_array_length(coalesce(effects->'stages','[]'))<>(SELECT count(*) FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(coalesce(effects->'matches','[]')) x)<>jsonb_array_length(coalesce(effects->'matches','[]')) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(coalesce(effects->'rounds','[]')) x)<>jsonb_array_length(coalesce(effects->'rounds','[]')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 -- All initially scheduled blocks must be complete, including independent ones.
 FOR node IN SELECT value FROM jsonb_array_elements(nodes) n WHERE n->>'module' IN ('round_robin@2','cross_play@1','match@1') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE i->>'kind'<>'seed') LOOP
  PERFORM tournament_builder_private.validate_graph_initial_node(event_id,ev.definition_id,node,roster.output);
 END LOOP;
 FOR node IN SELECT value FROM jsonb_array_elements(nodes) n WHERE n->>'module' IN ('round_robin@2','cross_play@1','match@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE i->>'kind'<>'seed') LOOP
  SELECT * INTO st FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=node->>'id';
  IF st.id IS NULL OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND stage_id=st.id AND is_current AND voided_at IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  effective:=tournament_builder_private.graph_effective_bindings(event_id,ev.definition_id,nodes,roster.output,node,effects->'stages'); bindings:=effective->'values'; knowns:=effective->'known';
  SELECT value INTO p FROM jsonb_array_elements(effects->'stages') WHERE value->>'id'=st.id::text;
  IF node->>'module'='match@1' THEN
   PERFORM tournament_builder_private.validate_graph_auto_match(event_id,actor_id,node,roster.output,st.id,p,effects->'matches',bindings,knowns,effects->'rounds',ev.roster_revision,ev.court_count,ev.revision+1);
  ELSE
   has_auto:=EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m->>'stage_id'=st.id::text AND m->>'outcome_kind' IS NOT NULL);
   all_known:=NOT EXISTS(SELECT 1 FROM jsonb_each_text(knowns) x WHERE x.value<>'true');
   IF has_auto THEN
    IF NOT all_known THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
    PERFORM tournament_builder_private.validate_graph_partial_auto_group(event_id,actor_id,node,roster.output,st.id,p,effects->'standings',effects->'matches',bindings,effects->'rounds',ev.roster_revision,ev.court_count,ev.revision+1,ranking_order,true);
   ELSE
    IF all_known AND EXISTS(SELECT 1 FROM tournament_builder_private.graph_fixture_ports(node,roster.output) f WHERE NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=bindings->>f.port_a::text AND entry_state='approved') OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=bindings->>f.port_b::text AND entry_state='approved')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
    PERFORM tournament_builder_private.validate_graph_scheduled_fixtures(node,roster.output,st.id,effects->'matches',bindings,effects->'rounds',ev.roster_revision,ev.court_count);
   END IF;
  END IF;
  fixture_count:=fixture_count+(SELECT count(*) FROM tournament_builder_private.graph_fixture_ports(node,roster.output));
  SELECT min((x->>'logical_wave')::integer) INTO target_min FROM jsonb_array_elements(effects->'rounds') x WHERE x->>'stage_id'=st.id::text;
  IF target_min IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  FOR src IN SELECT value FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) WHERE value->>'kind'<>'seed' LOOP
   SELECT * INTO source_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=src->>'node_id';
   IF source_stage.id IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   SELECT max((x->>'logical_wave')::integer) INTO source_max FROM jsonb_array_elements(effects->'rounds') x WHERE x->>'stage_id'=source_stage.id::text;
   IF source_max IS NULL THEN SELECT max(logical_wave) INTO source_max FROM public.rounds WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current; END IF;
   IF source_max IS NULL OR target_min<=source_max THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
 END LOOP;
 IF fixture_count=0 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(effects->'stages') LOOP
  PERFORM tournament_builder_private.assert_keys(p,ARRAY['id','state','input_revision','output_revision','output','blocked_code']);
  SELECT * INTO st FROM public.tournament_stages WHERE id=(p->>'id')::uuid AND tournament_id=event_id AND definition_id=ev.definition_id;
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'stages') x WHERE x->>'id'=p->>'id')<>1 OR (p->>'output_revision')::bigint IS DISTINCT FROM ev.revision+1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  SELECT value INTO node FROM jsonb_array_elements(nodes) WHERE value->>'id'=st.node_id;
  IF st.id=roster.id THEN
   IF p->>'state' IS DISTINCT FROM st.state OR p->>'blocked_code' IS DISTINCT FROM st.blocked_code OR (p->>'input_revision')::bigint IS DISTINCT FROM st.input_revision OR p#>>'{output,graphNextStageApproved}' IS DISTINCT FROM 'true' OR ((p->'output')-'graphNextStageApproved') IS DISTINCT FROM (st.output-'graphNextStageApproved') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF node->>'module' IN ('round_robin@2','cross_play@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) i WHERE i->>'kind'<>'seed') THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m->>'stage_id'=st.id::text AND m->>'outcome_kind' IS NOT NULL) THEN
    effective:=tournament_builder_private.graph_effective_bindings(event_id,ev.definition_id,nodes,roster.output,node,effects->'stages'); bindings:=effective->'values';
    PERFORM tournament_builder_private.validate_graph_empty_group(event_id,node,roster.output,st.id,p,effects->'standings',effects->'matches',bindings,ev.revision+1);
   END IF;
  ELSIF node->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) i WHERE i->>'kind'<>'seed') THEN
   NULL; -- independently validated with its resolved inputs above
  ELSIF st.module_id='placements' THEN
   NULL; -- validated after every playing block and its results have been checked
  ELSIF p->>'state' IS DISTINCT FROM st.state OR p->'output' IS DISTINCT FROM st.output OR p->>'blocked_code' IS DISTINCT FROM st.blocked_code OR (p->>'input_revision')::bigint IS DISTINCT FROM st.input_revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR standing IN SELECT value FROM jsonb_array_elements(coalesce(effects->'standings','[]')) x WHERE NOT EXISTS(SELECT 1 FROM public.tournament_stages s JOIN jsonb_array_elements(nodes) n ON n->>'id'=s.node_id WHERE s.id::text=x->>'stage_id' AND s.tournament_id=event_id AND s.definition_id=ev.definition_id AND n->>'module' IN ('round_robin@2','cross_play@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE i->>'kind'<>'seed')) LOOP
  SELECT * INTO stored_standing FROM public.standings WHERE id=(standing->>'id')::uuid AND tournament_id=event_id AND stage_id IN (SELECT id FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id);
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'standings') x WHERE x->>'id'=standing->>'id')<>1 OR standing IS DISTINCT FROM jsonb_build_object('id',stored_standing.id,'stage_id',stored_standing.stage_id,'round_id',stored_standing.round_id,'team_id',stored_standing.team_id,'wins',stored_standing.wins,'losses',stored_standing.losses,'points_for',stored_standing.points_for,'points_against',stored_standing.points_against,'rank',stored_standing.rank,'input_revision',stored_standing.input_revision,'eligible',stored_standing.eligible,'tie_group',stored_standing.tie_group) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(coalesce(effects->'standings','[]')) x WHERE NOT EXISTS(SELECT 1 FROM public.tournament_stages s JOIN jsonb_array_elements(nodes) n ON n->>'id'=s.node_id WHERE s.id::text=x->>'stage_id' AND s.tournament_id=event_id AND s.definition_id=ev.definition_id AND n->>'module' IN ('round_robin@2','cross_play@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE i->>'kind'<>'seed')))<>(SELECT count(*) FROM public.standings WHERE tournament_id=event_id AND stage_id IN (SELECT id FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 PERFORM tournament_builder_private.validate_graph_routes(event_id,ev.definition_id,nodes,roster.output,effects->'matches');
 IF (SELECT count(*) FROM jsonb_array_elements(effects->'matches') x WHERE x ? 'stage_id')<>fixture_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR patch IN SELECT value FROM jsonb_array_elements(effects->'matches') LOOP
  IF patch ? 'stage_id' THEN
   PERFORM tournament_builder_private.assert_keys(patch,ARRAY['id','round_id','stage_id','logical_key','court_number','team_a_id','team_b_id','schedule_generation','is_current','status','revision','result_revision','submit_to_dupr','bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side','outcome_kind','winner_team_id','score_a','score_b','validated_by']);
   IF EXISTS(SELECT 1 FROM public.matches WHERE id=(patch->>'id')::uuid) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSE
   PERFORM tournament_builder_private.assert_keys(patch,ARRAY['id','bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side']);
   IF NOT EXISTS(SELECT 1 FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id JOIN jsonb_array_elements(nodes) n ON n->>'id'=s.node_id WHERE m.id=(patch->>'id')::uuid AND m.tournament_id=event_id AND m.is_current AND m.voided_at IS NULL AND s.definition_id=ev.definition_id AND n->>'module'='match@1' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE i->>'kind'<>'seed')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
 END LOOP;
 FOR rr IN SELECT value FROM jsonb_array_elements(coalesce(effects->'rounds','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(rr,ARRAY['id','stage_id','logical_wave','round_number','round_type','status','schedule_generation','is_current']);
  SELECT * INTO st FROM public.tournament_stages WHERE id=(rr->>'stage_id')::uuid AND tournament_id=event_id AND definition_id=ev.definition_id;
  SELECT value INTO node FROM jsonb_array_elements(nodes) WHERE value->>'id'=st.node_id;
  IF st.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) i WHERE i->>'kind'<>'seed') OR EXISTS(SELECT 1 FROM public.rounds WHERE id=(rr->>'id')::uuid) OR (rr->>'round_number')::integer IS NULL OR (rr->>'round_number')::integer <= (SELECT coalesce(max(round_number),0) FROM public.rounds WHERE tournament_id=event_id) OR (rr->>'logical_wave')::integer IS NULL OR (rr->>'logical_wave')::integer<1 OR rr->>'status' IS DISTINCT FROM 'pending' OR rr->>'is_current' IS DISTINCT FROM 'true' OR (rr->>'schedule_generation')::bigint IS DISTINCT FROM ev.roster_revision OR rr->>'round_type' IS DISTINCT FROM (CASE WHEN node->>'module' IN ('round_robin@2','cross_play@1') THEN 'round_robin' WHEN node->>'id'=placement->>'final' THEN 'finals_gold' WHEN node->>'id'=placement->>'bronze' THEN 'finals_bronze' ELSE 'elimination' END) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m->>'round_id'=rr->>'id' AND m->>'stage_id'=rr->>'stage_id') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT r->>'round_number') FROM jsonb_array_elements(effects->'rounds') r)<>jsonb_array_length(effects->'rounds') OR (SELECT count(DISTINCT (r->>'stage_id',r->>'logical_wave')) FROM jsonb_array_elements(effects->'rounds') r)<>jsonb_array_length(effects->'rounds') OR EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') x JOIN jsonb_array_elements(effects->'matches') y ON x->>'id'<y->>'id' JOIN jsonb_array_elements(effects->'rounds') xr ON xr->>'id'=x->>'round_id' JOIN jsonb_array_elements(effects->'rounds') yr ON yr->>'id'=y->>'round_id' WHERE xr->>'logical_wave'=yr->>'logical_wave' AND (x->>'court_number'=y->>'court_number' OR x->>'team_a_id' IN (y->>'team_a_id',y->>'team_b_id') OR x->>'team_b_id' IN (y->>'team_a_id',y->>'team_b_id'))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') x JOIN jsonb_array_elements(effects->'matches') y ON x->>'id'<y->>'id' JOIN jsonb_array_elements(effects->'rounds') xr ON xr->>'id'=x->>'round_id' JOIN jsonb_array_elements(effects->'rounds') yr ON yr->>'id'=y->>'round_id' JOIN public.tournament_stages xs ON xs.id::text=x->>'stage_id' JOIN public.tournament_stages ys ON ys.id::text=y->>'stage_id' JOIN jsonb_array_elements(nodes) xn ON xn->>'id'=xs.node_id JOIN jsonb_array_elements(nodes) yn ON yn->>'id'=ys.node_id JOIN tournament_builder_private.graph_fixture_ports(xn,roster.output) xf ON xf.logical_key=x->>'logical_key' JOIN tournament_builder_private.graph_fixture_ports(yn,roster.output) yf ON yf.logical_key=y->>'logical_key' WHERE xr->>'logical_wave'=yr->>'logical_wave' AND (xf.port_a IN (yf.port_a,yf.port_b) OR xf.port_b IN (yf.port_a,yf.port_b))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT * INTO st FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='placements';
 SELECT value INTO p FROM jsonb_array_elements(effects->'stages') WHERE value->>'id'=st.id::text;
 IF st.id IS NULL OR p IS NULL OR (p->>'input_revision')::bigint IS DISTINCT FROM st.input_revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 complete_all:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m ? 'stage_id' AND (m->>'status' NOT IN ('validated','walkover') OR m->>'outcome_kind' IS NULL));
 IF complete_all THEN
  FOR node IN SELECT value FROM jsonb_array_elements(nodes) n WHERE n->>'module' IN ('round_robin@2','cross_play@1','match@1') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE i->>'kind'<>'seed') LOOP
   SELECT * INTO source_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=node->>'id';
   IF source_stage.id IS NULL OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL AND (status NOT IN ('validated','walkover') OR outcome_kind IS NULL)) OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL)<>(SELECT count(*) FROM tournament_builder_private.graph_fixture_ports(node,roster.output)) THEN complete_all:=false; EXIT; END IF;
   PERFORM tournament_builder_private.validate_graph_initial_node(event_id,ev.definition_id,node,roster.output);
  END LOOP;
 END IF;
 SELECT x INTO final_patch FROM public.tournament_stages s JOIN jsonb_array_elements(effects->'stages') x ON x->>'id'=s.id::text WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=placement->>'final';
 IF placement->>'bronze' IS NOT NULL THEN SELECT x INTO bronze_patch FROM public.tournament_stages s JOIN jsonb_array_elements(effects->'stages') x ON x->>'id'=s.id::text WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=placement->>'bronze'; END IF;
 IF final_patch IS NULL OR (placement->>'bronze' IS NOT NULL AND bronze_patch IS NULL) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF bronze_patch IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(final_patch#>'{output,entryIds}','[]')) x JOIN jsonb_array_elements_text(coalesce(bronze_patch#>'{output,entryIds}','[]')) y ON x=y) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF complete_all AND final_patch->>'state'='completed' AND (bronze_patch IS NULL OR bronze_patch->>'state'='completed') THEN
  IF (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(roster.output->'entryIds') v)<>jsonb_array_length(roster.output->'entryIds') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(roster.output->'entryIds') v LEFT JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=v WHERE t.id IS NULL OR t.entry_state NOT IN ('approved','withdrawn')) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  winner:=nullif(final_patch#>>'{output,winnerEntryId}',''); final_loser:=nullif(final_patch#>>'{output,loserEntryId}',''); bronze_winner:=nullif(bronze_patch#>>'{output,winnerEntryId}',''); bronze_loser:=nullif(bronze_patch#>>'{output,loserEntryId}','');
  IF winner IS NULL OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=winner AND entry_state='approved') THEN
   IF effects ? 'event' OR p->>'state' IS DISTINCT FROM 'blocked' OR p->'output' IS DISTINCT FROM '{"state":"blocked","blockedCode":"NO_ELIGIBLE_CHAMPION"}'::jsonb OR p->>'blocked_code' IS DISTINCT FROM 'NO_ELIGIBLE_CHAMPION' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSE
   IF NOT (effects ? 'event') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['modular_state','completed_at','result_version','results_under_review']);
   IF effects#>>'{event,modular_state}' IS DISTINCT FROM 'completed' OR effects#>>'{event,results_under_review}' IS DISTINCT FROM 'false' OR (effects#>>'{event,result_version}')::bigint IS DISTINCT FROM coalesce(ev.result_version,0)+1 OR effects#>>'{event,completed_at}' IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   PERFORM (effects#>>'{event,completed_at}')::timestamptz;
   groups:=jsonb_build_array(jsonb_build_object('rank',1,'entryIds',jsonb_build_array(winner))); seen:=ARRAY[winner];
   IF final_loser IS NOT NULL AND EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=final_loser AND entry_state='approved') THEN groups:=groups||jsonb_build_array(jsonb_build_object('rank',2,'entryIds',jsonb_build_array(final_loser))); seen:=array_append(seen,final_loser); END IF;
   IF bronze_winner IS NOT NULL AND EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=bronze_winner AND entry_state='approved') THEN groups:=groups||jsonb_build_array(jsonb_build_object('rank',3,'entryIds',jsonb_build_array(bronze_winner))); seen:=array_append(seen,bronze_winner); END IF;
   IF bronze_loser IS NOT NULL AND EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=bronze_loser AND entry_state='approved') THEN groups:=groups||jsonb_build_array(jsonb_build_object('rank',4,'entryIds',jsonb_build_array(bronze_loser))); seen:=array_append(seen,bronze_loser); END IF;
   seen_history:=array_remove(ARRAY[winner,final_loser,bronze_winner,bronze_loser],NULL); frontier:=ARRAY[placement->>'final']; rank_cursor:=CASE WHEN bronze_patch IS NULL THEN 3 ELSE 5 END; source_max:=0;
   WHILE cardinality(frontier)>0 LOOP
    source_max:=source_max+1; IF source_max>jsonb_array_length(nodes) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    SELECT coalesce(array_agg(i.value->>'node_id' ORDER BY f.ord,i.ord),'{}') INTO next_frontier FROM unnest(frontier) WITH ORDINALITY f(id,ord) JOIN jsonb_array_elements(nodes) n ON n->>'id'=f.id AND n->>'module'='match@1' CROSS JOIN LATERAL jsonb_array_elements(n->'inputs') WITH ORDINALITY i(value,ord) WHERE i.value->>'kind'='winner';
    SELECT coalesce(array_agg(q.loser ORDER BY q.first_ord),'{}') INTO eliminated FROM (SELECT nullif(x#>>'{output,loserEntryId}','') loser,min(f.ord) first_ord FROM unnest(next_frontier) WITH ORDINALITY f(id,ord) JOIN public.tournament_stages s ON s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=f.id JOIN jsonb_array_elements(effects->'stages') x ON x->>'id'=s.id::text WHERE nullif(x#>>'{output,loserEntryId}','') IS NOT NULL AND NOT (nullif(x#>>'{output,loserEntryId}','')=ANY(seen_history)) GROUP BY nullif(x#>>'{output,loserEntryId}','')) q;
    SELECT coalesce(array_agg(v ORDER BY ord),'{}') INTO eligible_eliminated FROM unnest(eliminated) WITH ORDINALITY e(v,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=e.v AND t.entry_state='approved';
    IF cardinality(eligible_eliminated)>0 THEN groups:=groups||jsonb_build_array(jsonb_build_object('rank',rank_cursor,'entryIds',to_jsonb(eligible_eliminated))); seen:=seen||eligible_eliminated; END IF;
    seen_history:=seen_history||eliminated; rank_cursor:=rank_cursor+cardinality(eliminated); frontier:=next_frontier;
   END LOOP;
   SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord),'[]') INTO rest FROM jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY e(value,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=e.value AND t.entry_state='approved' WHERE NOT (e.value=ANY(seen));
   IF jsonb_array_length(rest)>0 THEN groups:=groups||jsonb_build_array(jsonb_build_object('rank',greatest(rank_cursor,cardinality(seen)+1),'entryIds',rest)); END IF;
   SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord),'[]') INTO ineligible FROM jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY e(value,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=e.value WHERE t.entry_state<>'approved';
   IF p->>'state' IS DISTINCT FROM 'completed' OR p->>'blocked_code' IS NOT NULL OR p->'output' IS DISTINCT FROM jsonb_build_object('state','completed','championEntryId',winner,'groups',groups,'ineligibleEntryIds',ineligible,'unplacedEntryIds',ineligible) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
 ELSE
  IF effects ? 'event' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_state:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'stages') x JOIN public.tournament_stages s ON s.id::text=x->>'id' WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.module_id NOT IN ('entries','registration','placements') AND x->>'state'='ready') THEN 'ready' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'stages') x JOIN public.tournament_stages s ON s.id::text=x->>'id' WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND x->>'state'='blocked' AND x->>'blocked_code'='UNRESOLVED_TIE') THEN 'blocked' ELSE 'waiting' END;
  IF p->>'state' IS DISTINCT FROM expected_state OR p->'output' IS DISTINCT FROM jsonb_build_object('state',expected_state) OR p->>'blocked_code' IS DISTINCT FROM (CASE WHEN expected_state='blocked' THEN 'UNRESOLVED_TIE' ELSE NULL END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.graph_node_inputs(jsonb), tournament_builder_private.validate_graph_initial_node(uuid,uuid,jsonb,jsonb), tournament_builder_private.validate_graph_general_no_auto(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
