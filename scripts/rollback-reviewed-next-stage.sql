-- Local rollback candidate for migrations 202611130001/002/003/004/005/006. Do not run in production without a fresh review.
-- This restores pre-feature command authorization and validation; it does not delete tournament data.
BEGIN;
DO $rollback$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ELSE IF p_effects ? 'event' OR (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) m WHERE m ? 'stage_id') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) m WHERE m ? 'stage_id' AND (m->>'status' NOT IN ('validated','walkover') OR m->>'outcome_kind' IS NULL))) OR EXISTS(SELECT 1 FROM public.tournament_stages rs CROSS JOIN LATERAL jsonb_array_elements(coalesce(rs.output->'finalizedNodes',(SELECT d.definition->'nodes' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id))) n CROSS JOIN LATERAL jsonb_array_elements(tournament_builder_private.graph_node_inputs(n)) i WHERE rs.tournament_id=p_tournament_id AND rs.definition_id=event_row.definition_id AND rs.module_id='entries' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(rs.output->'finalizedNodes',(SELECT d.definition->'nodes' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id))) up WHERE up->>'module'='cross_play@1') OR (i->>'kind' IN ('winner','loser') AND EXISTS(SELECT 1 FROM public.tournament_stages s JOIN public.matches m ON m.stage_id=s.id AND m.tournament_id=p_tournament_id AND m.is_current AND m.voided_at IS NULL AND m.outcome_kind='no_contest' WHERE s.tournament_id=p_tournament_id AND s.definition_id=event_row.definition_id AND s.node_id=i->>'node_id')))) THEN
     PERFORM tournament_builder_private.validate_graph_general_no_auto(p_actor_id,p_tournament_id,p_request,p_effects);
    ELSE PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF; END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ROLLBACK_GENERAL_CROSS_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$ELSE PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$new$);
 anchor:=$old$PERFORM tournament_builder_private.validate_graph_general_no_auto(p_actor_id,p_tournament_id,p_request,p_effects);$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ROLLBACK_GENERAL_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$PERFORM tournament_builder_private.validate_graph_seed_pool(p_tournament_id,p_request,p_effects);$new$);
 anchor:=$old$IF EXISTS(SELECT 1 FROM public.tournament_stages rs CROSS JOIN LATERAL jsonb_array_elements(coalesce(rs.output->'finalizedNodes',(SELECT d.definition->'nodes' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id))) n WHERE rs.tournament_id=p_tournament_id AND rs.definition_id=event_row.definition_id AND rs.module_id='entries' AND n->>'module' IN ('round_robin@2','cross_play@1') AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN n->>'module'='cross_play@1' THEN (n->'side_a')||(n->'side_b') ELSE n->'inputs' END) i WHERE i->>'kind'<>'seed')) THEN
    PERFORM tournament_builder_private.validate_graph_seed_pool(p_tournament_id,p_request,p_effects);
   ELSE PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ROLLBACK_POOL_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects);$new$);
 anchor:=$old$IF p_command='generateNextStage' THEN
  IF (SELECT d.definition->>'schema_version' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id)='2.0' THEN PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects);
  ELSE PERFORM tournament_builder_private.validate_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 END IF;
 $old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ROLLBACK_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,'');
 anchor:=$old$'createDraft','updateDraft','generateNextStage','appendTerminalMatch','replayTerminalMatch'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ROLLBACK_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$'createDraft','updateDraft','appendTerminalMatch','replayTerminalMatch'$new$);
 EXECUTE source;
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ARRAY['generateNextStage','appendTerminalMatch','replayTerminalMatch'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'ROLLBACK_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$new$ARRAY['appendTerminalMatch','replayTerminalMatch'$new$);
END $rollback$;
DROP FUNCTION tournament_builder_private.validate_graph_partial_auto_group(uuid,uuid,jsonb,jsonb,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,integer,bigint,jsonb,boolean);
DROP FUNCTION tournament_builder_private.validate_graph_auto_match(uuid,uuid,jsonb,jsonb,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,integer,bigint);
DROP FUNCTION tournament_builder_private.graph_effective_bindings(uuid,uuid,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.graph_resolve_auto_group_bindings(uuid,uuid,jsonb,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_general_no_auto(uuid,uuid,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_initial_node(uuid,uuid,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.graph_node_inputs(jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_seed_pool(uuid,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_next_stage(uuid,uuid,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_next_stage(uuid,uuid,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_empty_group(uuid,jsonb,jsonb,uuid,jsonb,jsonb,jsonb,jsonb,bigint);
DROP FUNCTION tournament_builder_private.graph_resolve_bindings(uuid,uuid,jsonb,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_routes(uuid,uuid,jsonb,jsonb,jsonb);
DROP FUNCTION tournament_builder_private.validate_graph_scheduled_fixtures(jsonb,jsonb,uuid,jsonb,jsonb,jsonb,bigint,integer);
DROP FUNCTION tournament_builder_private.graph_fixture_ports(jsonb,jsonb);
DROP FUNCTION tournament_builder_private.graph_seed(jsonb,integer);
COMMIT;
