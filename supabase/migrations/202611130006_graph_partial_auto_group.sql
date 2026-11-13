-- Independent audit primitive for a partially played-by-walkover group.
-- This helper is not connected to generateNextStage until integrated and tested.
BEGIN;
-- All sources in this first cut are already resolved in the locked snapshot.
-- The caller must independently prove the source schedules complete.
CREATE OR REPLACE FUNCTION tournament_builder_private.graph_resolve_auto_group_bindings(event_id uuid, definition_id uuid, nodes jsonb, roster jsonb, node jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE src jsonb; upstream jsonb; source_stage public.tournament_stages%ROWTYPE; source_match public.matches%ROWTYPE; resolved text; result jsonb:='{}'::jsonb;
BEGIN
 FOR src IN SELECT value FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) LOOP
  resolved:=NULL;
  IF src->>'kind'='seed' THEN resolved:=tournament_builder_private.graph_seed(roster,(src->>'seed')::integer);
  ELSIF src->>'kind' IN ('rank','winner','loser') THEN
   SELECT value INTO upstream FROM jsonb_array_elements(nodes) WHERE value->>'id'=src->>'node_id';
   IF upstream IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(upstream)) i WHERE i->>'kind'<>'seed') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
   SELECT * INTO source_stage FROM public.tournament_stages s WHERE s.tournament_id=event_id AND s.definition_id=graph_resolve_auto_group_bindings.definition_id AND s.node_id=src->>'node_id';
   IF NOT FOUND OR source_stage.state NOT IN ('completed','blocked') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF src->>'kind'='rank' AND upstream->>'module' IN ('round_robin@2','cross_play@1') THEN
    SELECT row_value->>'entryId' INTO resolved FROM jsonb_array_elements(source_stage.output->'rows') WITH ORDINALITY r(row_value,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=row_value->>'entryId' AND t.entry_state='approved' ORDER BY ord OFFSET greatest((src->>'rank')::integer-1,0) LIMIT 1;
    IF resolved IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(source_stage.output->'ties','[]')) g WHERE g @> jsonb_build_array(resolved) AND (SELECT count(*) FROM jsonb_array_elements_text(g) member JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=member AND t.entry_state='approved')>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   ELSIF src->>'kind' IN ('winner','loser') AND upstream->>'module'='match@1' THEN
    SELECT * INTO source_match FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL;
    IF source_match.id IS NULL OR (source_match.outcome_kind='no_contest' AND (source_match.status IS DISTINCT FROM 'validated' OR source_match.winner_team_id IS NOT NULL)) OR (source_match.outcome_kind IS DISTINCT FROM 'no_contest' AND (source_match.winner_team_id IS NULL OR (source_match.winner_team_id IS DISTINCT FROM source_match.team_a_id AND source_match.winner_team_id IS DISTINCT FROM source_match.team_b_id))) OR (SELECT count(*) FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    resolved:=CASE WHEN source_match.outcome_kind='no_contest' THEN NULL WHEN src->>'kind'='winner' THEN source_match.winner_team_id::text WHEN source_match.winner_team_id=source_match.team_a_id THEN source_match.team_b_id::text ELSE source_match.team_a_id::text END;
   ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  IF resolved IS NOT NULL AND (NOT (roster->'entryIds' @> jsonb_build_array(resolved)) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=resolved AND entry_state IN ('approved','withdrawn'))) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  result:=result||jsonb_build_object(src::text,resolved);
 END LOOP;
 RETURN result;
END $$;
-- Distinguish a resolved empty port from a port waiting on a later block.
-- Outputs from deferred stages are provisional until every stage patch has
-- independently passed this transaction's validation.
CREATE OR REPLACE FUNCTION tournament_builder_private.graph_effective_bindings(event_id uuid, definition_id uuid, nodes jsonb, roster jsonb, node jsonb, stages jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE src jsonb; upstream jsonb; source_stage public.tournament_stages%ROWTYPE; source_patch jsonb; single_binding jsonb; result jsonb:='{}'; knowns jsonb:='{}'; resolved text; known boolean;
BEGIN
 FOR src IN SELECT value FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(node)) LOOP
  resolved:=NULL; known:=true;
  IF src->>'kind'='seed' THEN resolved:=tournament_builder_private.graph_seed(roster,(src->>'seed')::integer);
  ELSE
   SELECT value INTO upstream FROM jsonb_array_elements(nodes) WHERE value->>'id'=src->>'node_id';
   IF upstream IS NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tournament_builder_private.graph_node_inputs(upstream)) i WHERE i->>'kind'<>'seed') THEN
    single_binding:=tournament_builder_private.graph_resolve_auto_group_bindings(event_id,definition_id,nodes,roster,jsonb_build_object('module','match@1','inputs',jsonb_build_array(src)));
    resolved:=single_binding->>src::text;
   ELSE
    SELECT * INTO source_stage FROM public.tournament_stages s WHERE s.tournament_id=event_id AND s.definition_id=graph_effective_bindings.definition_id AND s.node_id=src->>'node_id';
    SELECT value INTO source_patch FROM jsonb_array_elements(stages) WHERE value->>'id'=source_stage.id::text;
    IF source_patch IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
    IF source_patch->>'state' NOT IN ('completed','blocked') THEN known:=false;
    ELSIF src->>'kind'='rank' AND upstream->>'module' IN ('round_robin@2','cross_play@1') THEN
     SELECT row_value->>'entryId' INTO resolved FROM jsonb_array_elements(source_patch#>'{output,rows}') WITH ORDINALITY r(row_value,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=row_value->>'entryId' AND t.entry_state='approved' ORDER BY ord OFFSET greatest((src->>'rank')::integer-1,0) LIMIT 1;
     IF resolved IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(source_patch#>'{output,ties}','[]')) g WHERE g @> jsonb_build_array(resolved) AND (SELECT count(*) FROM jsonb_array_elements_text(g) member JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=member AND t.entry_state='approved')>1) THEN known:=false; resolved:=NULL; END IF;
    ELSIF src->>'kind' IN ('winner','loser') AND upstream->>'module'='match@1' AND source_patch->>'state'='completed' THEN
     resolved:=nullif(source_patch#>>(CASE WHEN src->>'kind'='winner' THEN '{output,winnerEntryId}' ELSE '{output,loserEntryId}' END)::text[],'');
    ELSE RAISE EXCEPTION 'INVALID_STATE'; END IF;
   END IF;
  END IF;
  IF resolved IS NOT NULL AND (NOT (roster->'entryIds' @> jsonb_build_array(resolved)) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=resolved AND entry_state IN ('approved','withdrawn'))) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  result:=result||jsonb_build_object(src::text,resolved); knowns:=knowns||jsonb_build_object(src::text,known);
 END LOOP;
 RETURN jsonb_build_object('values',result,'known',knowns);
END $$;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_auto_match(event_id uuid, actor_id uuid, node jsonb, roster jsonb, stage_id uuid, stage_patch jsonb, matches jsonb, bindings jsonb, knowns jsonb, rounds jsonb, roster_revision bigint, court_count integer, revision bigint)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE st public.tournament_stages%ROWTYPE; a jsonb; b jsonb; id_a text; id_b text; known_a boolean; known_b boolean; eligible_a boolean; eligible_b boolean; outcome text; winner text; loser text; expected_state text; ids jsonb:='[]'; expected_output jsonb; patch jsonb; rr jsonb;
BEGIN
 IF node->>'module'<>'match@1' OR jsonb_array_length(node->'inputs')<>2 THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT * INTO st FROM public.tournament_stages WHERE id=stage_id AND tournament_id=event_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND matches.stage_id=st.id AND is_current AND voided_at IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 a:=node->'inputs'->0; b:=node->'inputs'->1;
 IF NOT (bindings ? a::text) OR NOT (bindings ? b::text) OR NOT (knowns ? a::text) OR NOT (knowns ? b::text) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 id_a:=bindings->>a::text; id_b:=bindings->>b::text; known_a:=(knowns->>a::text)::boolean; known_b:=(knowns->>b::text)::boolean;
 IF id_a IS NOT NULL AND id_a=id_b THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 eligible_a:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=id_a AND entry_state='approved');
 eligible_b:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=id_b AND entry_state='approved');
 outcome:=CASE WHEN known_a AND known_b AND NOT (eligible_a AND eligible_b) THEN CASE WHEN eligible_a OR eligible_b THEN 'walkover' ELSE 'no_contest' END ELSE NULL END;
 winner:=CASE WHEN outcome='walkover' THEN CASE WHEN eligible_a THEN id_a ELSE id_b END ELSE NULL END;
 loser:=CASE WHEN winner IS NULL THEN NULL WHEN winner=id_a THEN id_b ELSE id_a END;
 SELECT value INTO patch FROM jsonb_array_elements(matches) WHERE value->>'stage_id'=stage_id::text AND value->>'logical_key'=node->>'id'||':match';
 IF outcome IS NULL THEN
  PERFORM tournament_builder_private.validate_graph_scheduled_fixtures(node,roster,stage_id,matches,bindings,rounds,roster_revision,court_count);
 ELSE
  SELECT value INTO rr FROM jsonb_array_elements(rounds) WHERE value->>'id'=patch->>'round_id' AND value->>'stage_id'=stage_id::text;
  IF patch IS NULL OR rr IS NULL OR (SELECT count(*) FROM jsonb_array_elements(matches) x WHERE x->>'stage_id'=stage_id::text)<>1 OR patch->>'team_a_id' IS DISTINCT FROM id_a OR patch->>'team_b_id' IS DISTINCT FROM id_b OR patch->>'is_current' IS DISTINCT FROM 'true' OR patch->>'submit_to_dupr' IS DISTINCT FROM 'false' OR (patch->>'schedule_generation')::bigint IS DISTINCT FROM roster_revision OR (patch->>'court_number')::integer IS NULL OR (patch->>'court_number')::integer NOT BETWEEN 1 AND court_count OR rr->>'status' IS DISTINCT FROM 'pending' OR rr->>'is_current' IS DISTINCT FROM 'true' OR (rr->>'schedule_generation')::bigint IS DISTINCT FROM roster_revision OR (rr->>'logical_wave')::integer IS NULL OR (rr->>'logical_wave')::integer<1 OR patch->>'status' IS DISTINCT FROM (CASE WHEN outcome='walkover' THEN 'walkover' ELSE 'validated' END) OR patch->>'outcome_kind' IS DISTINCT FROM outcome OR patch->>'winner_team_id' IS DISTINCT FROM winner OR patch->>'validated_by' IS DISTINCT FROM actor_id::text OR (patch->>'revision')::bigint IS DISTINCT FROM revision OR (patch->>'result_revision')::bigint IS DISTINCT FROM revision OR patch->>'score_a' IS NOT NULL OR patch->>'score_b' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
 IF id_a IS NOT NULL THEN ids:=ids||jsonb_build_array(id_a); END IF; IF id_b IS NOT NULL THEN ids:=ids||jsonb_build_array(id_b); END IF;
 expected_state:=CASE WHEN outcome IS NOT NULL THEN 'completed' WHEN known_a AND known_b THEN 'ready' ELSE 'waiting' END;
 expected_output:=coalesce(st.output,'{}')||jsonb_build_object('state',expected_state,'entryIds',ids,'inputRevision',CASE WHEN outcome IS NULL THEN 0 ELSE revision END);
 IF outcome IS NOT NULL THEN expected_output:=expected_output||jsonb_build_object('winnerEntryId',winner,'loserEntryId',loser); END IF;
 IF stage_patch->>'id' IS DISTINCT FROM stage_id::text OR stage_patch->>'state' IS DISTINCT FROM expected_state OR stage_patch->'output' IS DISTINCT FROM expected_output OR stage_patch->>'blocked_code' IS NOT NULL OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM (CASE WHEN outcome IS NULL THEN 0 ELSE revision END) OR (stage_patch->>'output_revision')::bigint IS DISTINCT FROM revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;

CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_partial_auto_group(event_id uuid, actor_id uuid, node jsonb, roster jsonb, stage_id uuid, stage_patch jsonb, standings jsonb, matches jsonb, bindings jsonb, rounds jsonb, roster_revision bigint, court_count integer, revision bigint, ranking_order jsonb, allow_complete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,tournament_builder_private AS $$
DECLARE st public.tournament_stages%ROWTYPE; src jsonb; inputs jsonb; id_a text; id_b text; ids jsonb:='[]'; wins jsonb:='{}'; losses jsonb:='{}';
 fixture record; patch jsonb; rr jsonb; eligible_a boolean; eligible_b boolean; outcome text; winner text; pending integer:=0; automatic integer:=0;
 rows jsonb; ties jsonb; expected_output jsonb; expected_state text; first_key text; first_round text; row_item jsonb; standing jsonb; tie_key integer; row_rank integer; tie_text text; rank_by_wins boolean;
BEGIN
 IF node->>'module' NOT IN ('round_robin@2','cross_play@1') OR jsonb_typeof(ranking_order) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT * INTO st FROM public.tournament_stages WHERE id=stage_id AND tournament_id=event_id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND matches.stage_id=st.id AND is_current AND voided_at IS NULL) OR EXISTS(SELECT 1 FROM public.standings WHERE tournament_id=event_id AND standings.stage_id=st.id) OR coalesce(roster->'excludedByNode'->(node->>'id'),'[]'::jsonb)<>'[]'::jsonb OR coalesce(st.output->'rankingDraws','[]'::jsonb)<>'[]'::jsonb THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 inputs:=tournament_builder_private.graph_node_inputs(node);
 FOR src IN SELECT value FROM jsonb_array_elements(inputs) LOOP
  IF NOT (bindings ? src::text) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  id_a:=bindings->>src::text;
  IF id_a IS NULL THEN CONTINUE; END IF;
  IF ids @> jsonb_build_array(id_a) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=id_a AND entry_state IN ('approved','withdrawn')) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  ids:=ids||jsonb_build_array(id_a); wins:=wins||jsonb_build_object(id_a,0); losses:=losses||jsonb_build_object(id_a,0);
 END LOOP;
 FOR fixture IN SELECT * FROM tournament_builder_private.graph_fixture_ports(node,roster) LOOP
  id_a:=bindings->>fixture.port_a::text; id_b:=bindings->>fixture.port_b::text;
  SELECT value INTO patch FROM jsonb_array_elements(matches) WHERE value->>'stage_id'=stage_id::text AND value->>'logical_key'=fixture.logical_key;
  SELECT value INTO rr FROM jsonb_array_elements(rounds) WHERE value->>'id'=patch->>'round_id' AND value->>'stage_id'=stage_id::text;
  IF patch IS NULL OR (SELECT count(*) FROM jsonb_array_elements(matches) x WHERE x->>'stage_id'=stage_id::text AND x->>'logical_key'=fixture.logical_key)<>1 OR rr IS NULL OR patch->>'team_a_id' IS DISTINCT FROM id_a OR patch->>'team_b_id' IS DISTINCT FROM id_b OR patch->>'is_current' IS DISTINCT FROM 'true' OR patch->>'submit_to_dupr' IS DISTINCT FROM 'false' OR (patch->>'schedule_generation')::bigint IS DISTINCT FROM roster_revision OR (patch->>'court_number')::integer IS NULL OR (patch->>'court_number')::integer NOT BETWEEN 1 AND court_count OR rr->>'status' IS DISTINCT FROM 'pending' OR rr->>'is_current' IS DISTINCT FROM 'true' OR (rr->>'schedule_generation')::bigint IS DISTINCT FROM roster_revision OR (rr->>'logical_wave')::integer IS NULL OR (rr->>'logical_wave')::integer<1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  PERFORM tournament_builder_private.assert_keys(patch,ARRAY['id','round_id','stage_id','logical_key','court_number','team_a_id','team_b_id','schedule_generation','is_current','status','revision','result_revision','submit_to_dupr','outcome_kind','winner_team_id','score_a','score_b','validated_by']);
  eligible_a:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=id_a AND entry_state='approved');
  eligible_b:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=id_b AND entry_state='approved');
  IF eligible_a AND eligible_b THEN
   pending:=pending+1;
   IF patch->>'status' IS DISTINCT FROM 'scheduled' OR (patch->>'revision')::integer IS DISTINCT FROM 0 OR (patch->>'result_revision')::integer IS DISTINCT FROM 0 OR patch ?| ARRAY['outcome_kind','winner_team_id','score_a','score_b','validated_by'] THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSE
   automatic:=automatic+1; outcome:=CASE WHEN eligible_a OR eligible_b THEN 'walkover' ELSE 'no_contest' END;
   winner:=CASE WHEN eligible_a THEN id_a WHEN eligible_b THEN id_b ELSE NULL END;
   IF patch->>'status' IS DISTINCT FROM (CASE WHEN outcome='walkover' THEN 'walkover' ELSE 'validated' END) OR patch->>'outcome_kind' IS DISTINCT FROM outcome OR patch->>'winner_team_id' IS DISTINCT FROM winner OR patch->>'validated_by' IS DISTINCT FROM actor_id::text OR (patch->>'revision')::bigint IS DISTINCT FROM revision OR (patch->>'result_revision')::bigint IS DISTINCT FROM revision OR patch->>'score_a' IS NOT NULL OR patch->>'score_b' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF winner IS NOT NULL AND id_a IS NOT NULL AND id_b IS NOT NULL THEN wins:=jsonb_set(wins,ARRAY[winner],to_jsonb((wins->>winner)::integer+1)); losses:=jsonb_set(losses,ARRAY[CASE WHEN winner=id_a THEN id_b ELSE id_a END],to_jsonb((losses->>(CASE WHEN winner=id_a THEN id_b ELSE id_a END))::integer+1)); END IF;
  END IF;
 END LOOP;
 IF (pending=0 AND NOT allow_complete) OR automatic=0 OR (SELECT count(*) FROM jsonb_array_elements(matches) x WHERE x->>'stage_id'=stage_id::text)<>(SELECT count(*) FROM tournament_builder_private.graph_fixture_ports(node,roster)) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 rank_by_wins:=ranking_order @> '["wins_desc"]'::jsonb;
 SELECT coalesce(jsonb_agg(jsonb_build_object('entryId',x.value,'wins',(wins->>x.value)::integer,'losses',(losses->>x.value)::integer,'pointsFor',0,'pointsAgainst',0,'pointsForInLosses',0) ORDER BY CASE WHEN rank_by_wins THEN -(wins->>x.value)::integer ELSE 0 END,x.ord),'[]'::jsonb) INTO rows FROM jsonb_array_elements_text(ids) WITH ORDINALITY x(value,ord);
 SELECT coalesce(jsonb_agg(g.ids ORDER BY g.first_ord),'[]'::jsonb) INTO ties FROM (SELECT CASE WHEN rank_by_wins THEN (v->>'wins')::integer ELSE 0 END k,jsonb_agg(v->>'entryId' ORDER BY ord) ids,min(ord) first_ord FROM jsonb_array_elements(rows) WITH ORDINALITY x(v,ord) GROUP BY CASE WHEN rank_by_wins THEN (v->>'wins')::integer ELSE 0 END HAVING count(*)>1) g;
 expected_state:=CASE WHEN pending>0 THEN 'ready' WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(ties) g WHERE (SELECT count(*) FROM jsonb_array_elements_text(g) member JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=member AND t.entry_state='approved')>1) THEN 'blocked' ELSE 'completed' END;
 expected_output:=coalesce(st.output,'{}'::jsonb)||jsonb_build_object('state',expected_state,'entryIds',ids,'rows',rows,'ties',ties,'inputRevision',revision,'rankingDraws','[]'::jsonb);
 IF expected_state='blocked' THEN expected_output:=expected_output||jsonb_build_object('blockedCode','UNRESOLVED_TIE'); END IF;
 IF stage_patch->>'id' IS DISTINCT FROM stage_id::text OR stage_patch->>'state' IS DISTINCT FROM expected_state OR stage_patch->'output' IS DISTINCT FROM expected_output OR stage_patch->>'blocked_code' IS DISTINCT FROM (CASE WHEN expected_state='blocked' THEN 'UNRESOLVED_TIE' ELSE NULL END) OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM revision OR (stage_patch->>'output_revision')::bigint IS DISTINCT FROM revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 SELECT logical_key INTO first_key FROM tournament_builder_private.graph_fixture_ports(node,roster) LIMIT 1;
 SELECT value->>'round_id' INTO first_round FROM jsonb_array_elements(matches) WHERE value->>'stage_id'=stage_id::text AND value->>'logical_key'=first_key;
 IF first_round IS NULL OR (SELECT count(*) FROM jsonb_array_elements(standings) x WHERE x->>'stage_id'=stage_id::text)<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR standing IN SELECT value FROM jsonb_array_elements(standings) WHERE value->>'stage_id'=stage_id::text LOOP
  PERFORM tournament_builder_private.assert_keys(standing,ARRAY['id','stage_id','round_id','team_id','wins','losses','points_for','points_against','rank','input_revision','eligible','tie_group']);
  SELECT value INTO row_item FROM jsonb_array_elements(rows) WHERE value->>'entryId'=standing->>'team_id';
  IF row_item IS NULL OR (SELECT count(*) FROM jsonb_array_elements(standings) x WHERE x->>'stage_id'=stage_id::text AND x->>'team_id'=standing->>'team_id')<>1 OR EXISTS(SELECT 1 FROM public.standings WHERE id=(standing->>'id')::uuid) OR standing->>'round_id' IS DISTINCT FROM first_round OR (standing->>'wins')::integer IS DISTINCT FROM (row_item->>'wins')::integer OR (standing->>'losses')::integer IS DISTINCT FROM (row_item->>'losses')::integer OR (standing->>'points_for')::integer IS DISTINCT FROM 0 OR (standing->>'points_against')::integer IS DISTINCT FROM 0 OR (standing->>'input_revision')::bigint IS DISTINCT FROM revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  eligible_a:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=standing->>'team_id' AND entry_state='approved');
  row_rank:=NULL; tie_text:=NULL;
  IF eligible_a THEN
   tie_key:=CASE WHEN rank_by_wins THEN (row_item->>'wins')::integer ELSE 0 END;
   SELECT 1+count(*) INTO row_rank FROM jsonb_array_elements(rows) v JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=v->>'entryId' AND t.entry_state='approved' WHERE rank_by_wins AND (v->>'wins')::integer>tie_key;
   SELECT CASE WHEN count(*)>1 THEN string_agg(v->>'entryId',',' ORDER BY ord) ELSE NULL END INTO tie_text FROM jsonb_array_elements(rows) WITH ORDINALITY x(v,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=v->>'entryId' AND t.entry_state='approved' WHERE (CASE WHEN rank_by_wins THEN (v->>'wins')::integer ELSE 0 END)=tie_key;
  END IF;
  IF (standing->>'eligible')::boolean IS DISTINCT FROM eligible_a OR (standing->>'rank')::integer IS DISTINCT FROM row_rank OR standing->>'tie_group' IS DISTINCT FROM tie_text THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.graph_resolve_auto_group_bindings(uuid,uuid,jsonb,jsonb,jsonb), tournament_builder_private.graph_effective_bindings(uuid,uuid,jsonb,jsonb,jsonb,jsonb), tournament_builder_private.validate_graph_auto_match(uuid,uuid,jsonb,jsonb,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,integer,bigint), tournament_builder_private.validate_graph_partial_auto_group(uuid,uuid,jsonb,jsonb,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,integer,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text; cross_anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$PERFORM tournament_builder_private.validate_graph_seed_pool(p_tournament_id,p_request,p_effects);$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'GRAPH_GENERAL_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$PERFORM tournament_builder_private.validate_graph_general_no_auto(p_actor_id,p_tournament_id,p_request,p_effects);$new$);
 cross_anchor:=$old$ELSE PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,cross_anchor,'')))/length(cross_anchor)<>1 THEN RAISE EXCEPTION 'GRAPH_GENERAL_CROSS_SOURCE_MISMATCH'; END IF;
 source:=replace(source,cross_anchor,$new$ELSE IF p_effects ? 'event' OR (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) m WHERE m ? 'stage_id') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) m WHERE m ? 'stage_id' AND (m->>'status' NOT IN ('validated','walkover') OR m->>'outcome_kind' IS NULL))) OR EXISTS(SELECT 1 FROM public.tournament_stages rs CROSS JOIN LATERAL jsonb_array_elements(coalesce(rs.output->'finalizedNodes',(SELECT d.definition->'nodes' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id))) n CROSS JOIN LATERAL jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE rs.tournament_id=p_tournament_id AND rs.definition_id=event_row.definition_id AND rs.module_id='entries' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(rs.output->'finalizedNodes',(SELECT d.definition->'nodes' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id))) up WHERE up->>'module'='cross_play@1') OR (i->>'kind' IN ('winner','loser') AND EXISTS(SELECT 1 FROM public.tournament_stages s JOIN public.matches m ON m.stage_id=s.id AND m.tournament_id=p_tournament_id AND m.is_current AND m.voided_at IS NULL AND m.outcome_kind='no_contest' WHERE s.tournament_id=p_tournament_id AND s.definition_id=event_row.definition_id AND s.node_id=i->>'node_id')))) THEN
     PERFORM tournament_builder_private.validate_graph_general_no_auto(p_actor_id,p_tournament_id,p_request,p_effects);
    ELSE PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF; END IF;$new$);
 EXECUTE source;
END $migration$;
COMMIT;
