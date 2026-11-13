-- Validate reviewed graph stages without trusting client-supplied match effects.
BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.graph_seed(output jsonb, seed integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN output ? 'seedAssignments' THEN output->'seedAssignments'->>seed::text ELSE output->'entryIds'->>(seed-1) END
$$;

CREATE OR REPLACE FUNCTION tournament_builder_private.validate_graph_next_stage(actor_id uuid, event_id uuid, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.tournaments%ROWTYPE; roster public.tournament_stages%ROWTYPE; stored public.tournament_stages%ROWTYPE;
 definition jsonb; nodes jsonb; node jsonb; source jsonb; other jsonb; stage_patch jsonb; match_patch jsonb; round_patch jsonb;
 seed_a text; seed_b text; expected_a text; expected_b text; target_node text; source_id text; source_kind text;
 target_id text; target_side text; target_count integer; match_count integer; feeder_count integer; number_entries integer; expected_state text;
 standing jsonb; stored_standing public.standings%ROWTYPE; position integer; source_stage public.tournament_stages%ROWTYPE; feeder_match jsonb; feeder_round jsonb;
 initial_match public.matches%ROWTYPE; initial_node jsonb; expected_patch jsonb; feeder_stage jsonb;
 known_a boolean; known_b boolean; eligible_a boolean; eligible_b boolean; auto_outcome text; auto_winner text; auto_loser text; stage_expected jsonb; entry_ids jsonb;
 terminal boolean; champion text; ineligible jsonb; final_placements jsonb; approved_count integer; rest jsonb; final_node jsonb;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event_id;
 IF NOT FOUND OR ev.modular_state IS DISTINCT FROM 'active' OR ev.results_under_review THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['preview_hash']);
 IF coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT d.definition INTO definition FROM public.tournament_definitions d WHERE d.id=ev.definition_id AND d.tournament_id=event_id;
 IF definition->>'schema_version' IS DISTINCT FROM '2.0' THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT * INTO roster FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='entries';
 IF roster.id IS NULL OR jsonb_typeof(roster.output->'entryIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 nodes:=coalesce(roster.output->'finalizedNodes',definition->'nodes');
 IF jsonb_typeof(nodes) IS DISTINCT FROM 'array' OR (roster.output->>'graphNextStageApproved')='true' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_stages s WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.output ? 'manualMatchEntries') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 -- Initial groups are complete, contain each real pairing exactly once, and have no unresolved tie.
 FOR node IN SELECT value FROM jsonb_array_elements(nodes) WHERE value->>'module' NOT IN ('registration@1','entries@1','placements@2') LOOP
  target_node:=node->>'id';
  IF node->>'module'='round_robin@2' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(node->'inputs') s WHERE s->>'kind'<>'seed') THEN
   SELECT * INTO stored FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=target_node;
   IF NOT FOUND OR stored.state NOT IN ('completed','blocked') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   number_entries:=(SELECT count(*) FROM jsonb_array_elements(node->'inputs') i WHERE tournament_builder_private.graph_seed(roster.output,(i->>'seed')::integer) IS NOT NULL);
   IF number_entries<2 OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=stored.id AND m.is_current AND m.voided_at IS NULL)<>number_entries*(number_entries-1)/2 OR EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=stored.id AND m.is_current AND m.voided_at IS NULL AND (m.status NOT IN ('validated','walkover') OR m.outcome_kind IS NULL)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   FOR source IN SELECT value FROM jsonb_array_elements(node->'inputs') LOOP
    seed_a:=tournament_builder_private.graph_seed(roster.output,(source->>'seed')::integer);
    IF seed_a IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.teams t WHERE t.id::text=seed_a AND t.tournament_id=event_id AND t.entry_state IN ('approved','withdrawn')) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
    FOR other IN SELECT value FROM jsonb_array_elements(node->'inputs') WHERE (value->>'seed')::integer>(source->>'seed')::integer LOOP
     seed_b:=tournament_builder_private.graph_seed(roster.output,(other->>'seed')::integer);
     IF seed_b IS NULL THEN CONTINUE; END IF;
     IF seed_a=seed_b OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=stored.id AND m.is_current AND m.voided_at IS NULL AND ((m.team_a_id::text=seed_a AND m.team_b_id::text=seed_b) OR (m.team_a_id::text=seed_b AND m.team_b_id::text=seed_a)))<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    END LOOP;
   END LOOP;
  ELSIF node->>'module'='match@1' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(node->'inputs') s WHERE s->>'kind'<>'seed') THEN
   SELECT * INTO stored FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=target_node;
   SELECT * INTO initial_match FROM public.matches WHERE tournament_id=event_id AND stage_id=stored.id AND is_current AND voided_at IS NULL;
   seed_a:=tournament_builder_private.graph_seed(roster.output,((node->'inputs'->0)->>'seed')::integer);
   seed_b:=tournament_builder_private.graph_seed(roster.output,((node->'inputs'->1)->>'seed')::integer);
   IF stored.id IS NULL OR stored.state IS DISTINCT FROM 'completed' OR initial_match.id IS NULL OR initial_match.logical_key IS DISTINCT FROM target_node||':match' OR initial_match.status NOT IN ('validated','walkover') OR initial_match.outcome_kind IS NULL OR (initial_match.outcome_kind='no_contest' AND (initial_match.status IS DISTINCT FROM 'validated' OR initial_match.winner_team_id IS NOT NULL)) OR (initial_match.outcome_kind<>'no_contest' AND (initial_match.winner_team_id IS NULL OR (initial_match.winner_team_id IS DISTINCT FROM initial_match.team_a_id AND initial_match.winner_team_id IS DISTINCT FROM initial_match.team_b_id))) OR initial_match.team_a_id::text IS DISTINCT FROM seed_a OR initial_match.team_b_id::text IS DISTINCT FROM seed_b OR (seed_a IS NOT NULL AND seed_a=seed_b) OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=stored.id AND m.is_current AND m.voided_at IS NULL)<>1 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF (seed_a IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=seed_a AND entry_state IN ('approved','withdrawn'))) OR (seed_b IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=seed_b AND entry_state IN ('approved','withdrawn'))) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  ELSIF node->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(node->'inputs') s WHERE s->>'kind'<>'seed') THEN
   NULL;
  ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id AND s.tournament_id=event_id AND s.definition_id=ev.definition_id JOIN jsonb_array_elements(nodes) n ON n->>'id'=s.node_id WHERE m.tournament_id=event_id AND m.is_current AND m.voided_at IS NULL AND n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') p WHERE p->>'kind'<>'seed')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','stages','rounds','matches','standings']);
 match_count:=(SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') p WHERE p->>'kind'<>'seed'));
 feeder_count:=0;
 IF match_count=0 OR jsonb_array_length(coalesce(effects->'rounds','[]'))<>match_count OR (SELECT count(DISTINCT m->>'id') FROM jsonb_array_elements(effects->'matches') m)<>jsonb_array_length(coalesce(effects->'matches','[]')) OR (SELECT count(DISTINCT r->>'stage_id') FROM jsonb_array_elements(effects->'rounds') r)<>match_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF jsonb_array_length(coalesce(effects->'stages','[]'))<>(SELECT count(*) FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR stage_patch IN SELECT value FROM jsonb_array_elements(effects->'stages') LOOP
  PERFORM tournament_builder_private.assert_keys(stage_patch,ARRAY['id','state','input_revision','output_revision','output','blocked_code']);
  SELECT * INTO stored FROM public.tournament_stages WHERE id=(stage_patch->>'id')::uuid AND tournament_id=event_id AND definition_id=ev.definition_id;
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'stages') x WHERE x->>'id'=stage_patch->>'id')<>1 OR (stage_patch->>'output_revision')::bigint IS DISTINCT FROM ev.revision+1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF stored.id=roster.id THEN
   IF stage_patch#>>'{output,graphNextStageApproved}' IS DISTINCT FROM 'true' OR ((stage_patch->'output')-'graphNextStageApproved') IS DISTINCT FROM (stored.output-'graphNextStageApproved') OR stage_patch->>'state' IS DISTINCT FROM stored.state OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM stored.input_revision OR stage_patch->>'blocked_code' IS DISTINCT FROM stored.blocked_code THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF stored.module_id='placements' THEN NULL;
  ELSIF stored.module_id='match' AND EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n WHERE n->>'id'=stored.node_id AND n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') p WHERE p->>'kind'<>'seed')) THEN NULL;
  ELSIF stage_patch->'output' IS DISTINCT FROM stored.output OR stage_patch->>'state' IS DISTINCT FROM stored.state OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM stored.input_revision OR stage_patch->>'blocked_code' IS DISTINCT FROM stored.blocked_code THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'standings','[]'))<>(SELECT count(*) FROM public.standings WHERE tournament_id=event_id AND stage_id IN (SELECT id FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='round_robin')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR standing IN SELECT value FROM jsonb_array_elements(coalesce(effects->'standings','[]')) LOOP
  SELECT * INTO stored_standing FROM public.standings WHERE id=(standing->>'id')::uuid AND tournament_id=event_id;
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'standings') x WHERE x->>'id'=standing->>'id')<>1 OR standing IS DISTINCT FROM jsonb_build_object('id',stored_standing.id,'stage_id',stored_standing.stage_id,'round_id',stored_standing.round_id,'team_id',stored_standing.team_id,'wins',stored_standing.wins,'losses',stored_standing.losses,'points_for',stored_standing.points_for,'points_against',stored_standing.points_against,'rank',stored_standing.rank,'input_revision',stored_standing.input_revision,'eligible',stored_standing.eligible,'tie_group',stored_standing.tie_group) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 -- Each deferred match must match the published input ports and stored group ranks.
 FOR node IN SELECT value FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') p WHERE p->>'kind'<>'seed') LOOP
  target_node:=node->>'id';
  SELECT * INTO stored FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=target_node;
  IF NOT FOUND OR jsonb_array_length(node->'inputs')<>2 THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  SELECT value INTO match_patch FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=target_node||':match';
  IF match_patch IS NULL OR (SELECT count(*) FROM jsonb_array_elements(effects->'matches') x WHERE x->>'logical_key'=target_node||':match')<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  PERFORM tournament_builder_private.assert_keys(match_patch,ARRAY['id','round_id','stage_id','logical_key','court_number','team_a_id','team_b_id','schedule_generation','is_current','status','revision','result_revision','submit_to_dupr','bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side','outcome_kind','winner_team_id','score_a','score_b','validated_by']);
  SELECT value INTO round_patch FROM jsonb_array_elements(effects->'rounds') WHERE value->>'id'=match_patch->>'round_id';
  IF round_patch IS NULL OR match_patch->>'stage_id' IS DISTINCT FROM stored.id::text OR match_patch->>'is_current' IS DISTINCT FROM 'true' OR match_patch->>'submit_to_dupr' IS DISTINCT FROM 'false' OR (match_patch->>'schedule_generation')::bigint IS DISTINCT FROM ev.roster_revision OR (match_patch->>'court_number')::integer IS NULL OR (match_patch->>'court_number')::integer NOT BETWEEN 1 AND ev.court_count OR EXISTS(SELECT 1 FROM public.matches WHERE id=(match_patch->>'id')::uuid) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_a:=NULL; expected_b:=NULL; known_a:=false; known_b:=false;
  FOR position IN 0..1 LOOP
   source:=node->'inputs'->position; source_id:=source->>'node_id'; source_kind:=source->>'kind'; seed_a:=NULL;
   IF source_kind='seed' THEN seed_a:=tournament_builder_private.graph_seed(roster.output,(source->>'seed')::integer); IF position=0 THEN known_a:=true; ELSE known_b:=true; END IF;
   ELSIF source_kind='rank' THEN
    SELECT * INTO source_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=source_id AND module_id='round_robin';
    IF NOT FOUND OR source_stage.state NOT IN ('completed','blocked') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF (round_patch->>'logical_wave')::integer <= (SELECT coalesce(max(logical_wave),0) FROM public.rounds WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
    SELECT row_value->>'entryId' INTO seed_a FROM jsonb_array_elements(source_stage.output->'rows') WITH ORDINALITY r(row_value,ord) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=row_value->>'entryId' AND t.entry_state='approved' ORDER BY ord OFFSET greatest((source->>'rank')::integer-1,0) LIMIT 1;
    IF seed_a IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(source_stage.output->'ties','[]')) g WHERE g @> jsonb_build_array(seed_a) AND (SELECT count(*) FROM jsonb_array_elements_text(g) member JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=member AND t.entry_state='approved')>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
    IF position=0 THEN known_a:=true; ELSE known_b:=true; END IF;
   ELSIF source_kind IN ('winner','loser') THEN
    SELECT value INTO initial_node FROM jsonb_array_elements(nodes) n WHERE n->>'id'=source_id AND n->>'module'='match@1';
    IF initial_node IS NULL THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(initial_node->'inputs') p WHERE p->>'kind'<>'seed') THEN
     SELECT * INTO source_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=source_id;
     SELECT * INTO initial_match FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL;
     IF initial_match.id IS NULL OR (round_patch->>'logical_wave')::integer <= (SELECT coalesce(max(logical_wave),0) FROM public.rounds WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
     seed_a:=CASE WHEN initial_match.outcome_kind='no_contest' THEN NULL WHEN source_kind='winner' THEN initial_match.winner_team_id::text WHEN initial_match.winner_team_id=initial_match.team_a_id THEN initial_match.team_b_id::text ELSE initial_match.team_a_id::text END;
     IF position=0 THEN known_a:=true; ELSE known_b:=true; END IF;
    ELSE
     SELECT value INTO feeder_match FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=source_id||':match';
     SELECT value INTO feeder_round FROM jsonb_array_elements(effects->'rounds') WHERE value->>'id'=feeder_match->>'round_id';
     IF feeder_match IS NULL OR feeder_round IS NULL OR (round_patch->>'logical_wave')::integer <= (feeder_round->>'logical_wave')::integer THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
     SELECT x.value INTO feeder_stage FROM jsonb_array_elements(effects->'stages') x JOIN public.tournament_stages s ON s.id::text=x.value->>'id' WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=source_id;
     IF feeder_stage->>'state'='completed' THEN
      seed_a:=nullif(feeder_stage#>>(CASE WHEN source_kind='winner' THEN '{output,winnerEntryId}' ELSE '{output,loserEntryId}' END)::text[],'');
      IF position=0 THEN known_a:=true; ELSE known_b:=true; END IF;
     END IF;
    END IF;
   ELSE RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
   IF seed_a IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.teams t WHERE t.id::text=seed_a AND t.tournament_id=event_id AND t.entry_state IN ('approved','withdrawn')) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
   IF position=0 THEN expected_a:=seed_a; ELSE expected_b:=seed_a; END IF;
  END LOOP;
  IF match_patch->>'team_a_id' IS DISTINCT FROM expected_a OR match_patch->>'team_b_id' IS DISTINCT FROM expected_b OR (expected_a IS NOT NULL AND expected_a=expected_b) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  SELECT value INTO stage_patch FROM jsonb_array_elements(effects->'stages') WHERE value->>'id'=stored.id::text;
  eligible_a:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=expected_a AND entry_state='approved');
  eligible_b:=EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=expected_b AND entry_state='approved');
  auto_outcome:=CASE WHEN known_a AND known_b AND NOT (eligible_a AND eligible_b) THEN CASE WHEN eligible_a OR eligible_b THEN 'walkover' ELSE 'no_contest' END ELSE NULL END;
  auto_winner:=CASE WHEN auto_outcome='walkover' THEN CASE WHEN eligible_a THEN expected_a ELSE expected_b END ELSE NULL END;
  auto_loser:=CASE WHEN auto_winner IS NULL THEN NULL WHEN auto_winner=expected_a THEN expected_b ELSE expected_a END;
  IF auto_outcome IS NOT NULL THEN
   IF match_patch->>'status' IS DISTINCT FROM (CASE WHEN auto_outcome='walkover' THEN 'walkover' ELSE 'validated' END) OR match_patch->>'outcome_kind' IS DISTINCT FROM auto_outcome OR match_patch->>'winner_team_id' IS DISTINCT FROM auto_winner OR match_patch->>'validated_by' IS DISTINCT FROM actor_id::text OR (match_patch->>'revision')::bigint IS DISTINCT FROM ev.revision+1 OR (match_patch->>'result_revision')::bigint IS DISTINCT FROM ev.revision+1 OR match_patch->>'score_a' IS NOT NULL OR match_patch->>'score_b' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF match_patch->>'status' IS DISTINCT FROM 'scheduled' OR (match_patch->>'revision')::integer IS DISTINCT FROM 0 OR (match_patch->>'result_revision')::integer IS DISTINCT FROM 0 OR match_patch ?| ARRAY['outcome_kind','winner_team_id','score_a','score_b','validated_by'] THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_state:=CASE WHEN auto_outcome IS NOT NULL THEN 'completed' WHEN known_a AND known_b THEN 'ready' ELSE 'waiting' END;
  entry_ids:='[]'::jsonb; IF expected_a IS NOT NULL THEN entry_ids:=entry_ids||jsonb_build_array(expected_a); END IF; IF expected_b IS NOT NULL THEN entry_ids:=entry_ids||jsonb_build_array(expected_b); END IF;
  stage_expected:=stored.output||jsonb_build_object('state',expected_state,'entryIds',entry_ids,'inputRevision',CASE WHEN auto_outcome IS NULL THEN stored.input_revision ELSE ev.revision+1 END);
  IF auto_outcome IS NOT NULL THEN stage_expected:=stage_expected||jsonb_build_object('winnerEntryId',auto_winner,'loserEntryId',auto_loser); END IF;
  IF stage_patch->>'state' IS DISTINCT FROM expected_state OR stage_patch->'output' IS DISTINCT FROM stage_expected OR stage_patch->>'blocked_code' IS NOT NULL OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM (CASE WHEN auto_outcome IS NULL THEN stored.input_revision ELSE ev.revision+1 END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  FOR source_kind IN SELECT unnest(ARRAY['winner','loser']) LOOP
   SELECT count(*),min(m->>'id'),min(CASE WHEN (n->'inputs'->0)->>'node_id'=target_node AND (n->'inputs'->0)->>'kind'=source_kind THEN 'a' ELSE 'b' END)
    INTO target_count,target_id,target_side FROM jsonb_array_elements(nodes) n JOIN jsonb_array_elements(effects->'matches') m ON m->>'logical_key'=n->>'id'||':match'
    WHERE n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') s WHERE s->>'node_id'=target_node AND s->>'kind'=source_kind);
   IF target_count>1 THEN target_id:=NULL; target_side:=NULL; END IF;
   IF match_patch->>(CASE WHEN source_kind='winner' THEN 'bracket_next_winner_match_id' ELSE 'bracket_next_loser_match_id' END) IS DISTINCT FROM target_id OR match_patch->>(CASE WHEN source_kind='winner' THEN 'bracket_winner_fills_side' ELSE 'bracket_loser_fills_side' END) IS DISTINCT FROM target_side THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
 END LOOP;
 SELECT * INTO stored FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='placements';
 SELECT value INTO stage_patch FROM jsonb_array_elements(effects->'stages') WHERE value->>'id'=stored.id::text;
 terminal:=effects ? 'event';
 IF terminal THEN
  SELECT value INTO node FROM jsonb_array_elements(nodes) WHERE value->>'module'='placements@2';
  SELECT x#>>'{output,winnerEntryId}' INTO champion FROM jsonb_array_elements(effects->'stages') x JOIN public.tournament_stages s ON s.id::text=x->>'id' WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=node->>'final';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(roster.output->'entryIds') r LEFT JOIN public.teams t ON t.id::text=r AND t.tournament_id=event_id WHERE t.id IS NULL OR t.entry_state NOT IN ('approved','withdrawn')) OR (SELECT count(DISTINCT r) FROM jsonb_array_elements_text(roster.output->'entryIds') r)<>jsonb_array_length(roster.output->'entryIds') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  SELECT count(*),coalesce(jsonb_agg(r.team_id ORDER BY r.ordinal) FILTER (WHERE r.team_id<>champion),'[]'::jsonb) INTO approved_count,rest FROM jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY r(team_id,ordinal) JOIN public.teams t ON t.id::text=r.team_id AND t.tournament_id=event_id WHERE t.entry_state='approved';
  IF champion IS NULL OR approved_count NOT IN (1,2) OR NOT EXISTS(SELECT 1 FROM public.teams WHERE tournament_id=event_id AND id::text=champion AND entry_state='approved') OR EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n JOIN public.tournament_stages s ON s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=n->>'id' JOIN jsonb_array_elements(effects->'stages') x ON x->>'id'=s.id::text WHERE n->>'module' IN ('round_robin@2','match@1') AND x->>'state'<>'completed') THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
  IF approved_count=2 THEN
   SELECT value INTO final_node FROM jsonb_array_elements(nodes) WHERE value->>'id'=node->>'final' AND value->>'module'='match@1';
   IF node->>'bronze' IS NOT NULL OR (SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1')<>3 OR (SELECT count(*) FROM jsonb_array_elements(nodes) n WHERE n->>'module'='round_robin@2')<>0 OR jsonb_array_length(final_node->'inputs')<>2 OR (SELECT count(DISTINCT p->>'node_id') FROM jsonb_array_elements(final_node->'inputs') p WHERE p->>'kind'='winner' AND EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n WHERE n->>'id'=p->>'node_id' AND n->>'module'='match@1' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') i WHERE i->>'kind'<>'seed')))<>2 THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(final_node->'inputs') p JOIN public.tournament_stages s ON s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=p->>'node_id' JOIN public.matches m ON m.tournament_id=event_id AND m.stage_id=s.id AND m.is_current AND m.voided_at IS NULL WHERE (CASE WHEN m.winner_team_id=m.team_a_id THEN m.team_b_id ELSE m.team_a_id END)::text=rest->>0) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
  PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['modular_state','completed_at','result_version','results_under_review']);
  IF effects#>>'{event,modular_state}' IS DISTINCT FROM 'completed' OR effects#>>'{event,results_under_review}' IS DISTINCT FROM 'false' OR (effects#>>'{event,result_version}')::bigint IS DISTINCT FROM coalesce(ev.result_version,0)+1 OR effects#>>'{event,completed_at}' IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  PERFORM (effects#>>'{event,completed_at}')::timestamptz;
  SELECT coalesce(jsonb_agg(r.team_id ORDER BY r.ordinal),'[]'::jsonb) INTO ineligible FROM jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY r(team_id,ordinal) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=r.team_id WHERE t.entry_state='withdrawn';
  final_placements:=jsonb_build_object('state','completed','championEntryId',champion,'groups',jsonb_build_array(jsonb_build_object('rank',1,'entryIds',jsonb_build_array(champion))),'ineligibleEntryIds',ineligible,'unplacedEntryIds',ineligible);
  IF approved_count=2 THEN final_placements:=jsonb_set(final_placements,'{groups}',(final_placements->'groups')||jsonb_build_array(jsonb_build_object('rank',3,'entryIds',rest))); END IF;
  IF stage_patch->>'state' IS DISTINCT FROM 'completed' OR stage_patch->'output' IS DISTINCT FROM final_placements OR stage_patch->>'blocked_code' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 ELSE
  -- A caller may not hide a terminal graph by omitting its event update.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) n JOIN public.tournament_stages s ON s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.node_id=n->>'id' JOIN jsonb_array_elements(effects->'stages') x ON x->>'id'=s.id::text WHERE (n->>'module'='match@1' AND x->>'state'<>'completed') OR (n->>'module'='round_robin@2' AND x->>'state' NOT IN ('completed','blocked'))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_state:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'stages') x JOIN public.tournament_stages s ON s.id::text=x->>'id' WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND s.module_id NOT IN ('entries','registration','placements') AND x->>'state'='ready') THEN 'ready' WHEN EXISTS(SELECT 1 FROM public.tournament_stages s WHERE s.tournament_id=event_id AND s.definition_id=ev.definition_id AND jsonb_array_length(coalesce(s.output->'ties','[]'))>0) THEN 'blocked' ELSE 'waiting' END;
  IF stage_patch->>'state' IS DISTINCT FROM expected_state OR stage_patch->'output' IS DISTINCT FROM jsonb_build_object('state',expected_state) OR stage_patch->>'blocked_code' IS DISTINCT FROM (CASE WHEN expected_state='blocked' THEN 'UNRESOLVED_TIE' ELSE NULL END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
 IF stored.id IS NULL OR (stage_patch->>'input_revision')::bigint IS DISTINCT FROM stored.input_revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 -- Historic feeders may only gain the reviewed winner/loser links; scores and teams stay unchanged.
 FOR node IN SELECT value FROM jsonb_array_elements(nodes) n WHERE n->>'module'='match@1' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') p WHERE p->>'kind'<>'seed') LOOP
  target_node:=node->>'id';
  SELECT * INTO source_stage FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND node_id=target_node;
  SELECT * INTO initial_match FROM public.matches WHERE tournament_id=event_id AND stage_id=source_stage.id AND is_current AND voided_at IS NULL;
  expected_patch:=jsonb_build_object('id',initial_match.id);
  FOR source_kind IN SELECT unnest(ARRAY['winner','loser']) LOOP
   SELECT count(*),min(m->>'id'),min(CASE WHEN (n->'inputs'->0)->>'node_id'=target_node AND (n->'inputs'->0)->>'kind'=source_kind THEN 'a' ELSE 'b' END)
    INTO target_count,target_id,target_side FROM jsonb_array_elements(nodes) n JOIN jsonb_array_elements(effects->'matches') m ON m->>'logical_key'=n->>'id'||':match'
    WHERE n->>'module'='match@1' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n->'inputs') p WHERE p->>'node_id'=target_node AND p->>'kind'=source_kind);
   IF target_count>1 THEN target_id:=NULL; target_side:=NULL; END IF;
   IF target_count>0 AND ((CASE WHEN source_kind='winner' THEN initial_match.bracket_next_winner_match_id ELSE initial_match.bracket_next_loser_match_id END)::text IS DISTINCT FROM target_id OR (CASE WHEN source_kind='winner' THEN initial_match.bracket_winner_fills_side ELSE initial_match.bracket_loser_fills_side END) IS DISTINCT FROM target_side) THEN expected_patch:=expected_patch||CASE WHEN source_kind='winner' THEN jsonb_build_object('bracket_next_winner_match_id',target_id,'bracket_winner_fills_side',target_side) ELSE jsonb_build_object('bracket_next_loser_match_id',target_id,'bracket_loser_fills_side',target_side) END; END IF;
  END LOOP;
  IF expected_patch<>jsonb_build_object('id',initial_match.id) THEN
   feeder_count:=feeder_count+1;
   SELECT value INTO match_patch FROM jsonb_array_elements(effects->'matches') WHERE value->>'id'=initial_match.id::text;
   IF match_patch IS DISTINCT FROM expected_patch OR (SELECT count(*) FROM jsonb_array_elements(effects->'matches') x WHERE x->>'id'=initial_match.id::text)<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<>match_count+feeder_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR round_patch IN SELECT value FROM jsonb_array_elements(coalesce(effects->'rounds','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(round_patch,ARRAY['id','stage_id','logical_wave','round_number','round_type','status','schedule_generation','is_current']);
  IF round_patch->>'status' IS DISTINCT FROM 'pending' OR round_patch->>'is_current' IS DISTINCT FROM 'true' OR (round_patch->>'schedule_generation')::bigint IS DISTINCT FROM ev.roster_revision OR (round_patch->>'round_number')::integer IS NULL OR (round_patch->>'round_number')::integer<=(SELECT coalesce(max(round_number),0) FROM public.rounds WHERE tournament_id=event_id) OR (round_patch->>'logical_wave')::integer IS NULL OR (round_patch->>'logical_wave')::integer<1 OR (round_patch->>'logical_wave')::integer>(SELECT coalesce(max(logical_wave),0)+match_count FROM public.rounds WHERE tournament_id=event_id AND is_current) OR EXISTS(SELECT 1 FROM public.rounds WHERE id=(round_patch->>'id')::uuid) OR (SELECT count(*) FROM jsonb_array_elements(effects->'rounds') x WHERE x->>'id'=round_patch->>'id')<>1 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m->>'round_id'=round_patch->>'id' AND m->>'stage_id'=round_patch->>'stage_id') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  SELECT * INTO stored FROM public.tournament_stages WHERE id=(round_patch->>'stage_id')::uuid AND tournament_id=event_id AND definition_id=ev.definition_id;
  SELECT value INTO node FROM jsonb_array_elements(nodes) WHERE value->>'module'='placements@2';
  IF stored.id IS NULL OR round_patch->>'round_type' IS DISTINCT FROM (CASE WHEN node->>'final'=stored.node_id THEN 'finals_gold' WHEN node->>'bronze'=stored.node_id THEN 'finals_bronze' ELSE 'elimination' END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') a JOIN jsonb_array_elements(effects->'matches') b ON a->>'id'<b->>'id' JOIN jsonb_array_elements(effects->'rounds') ar ON ar->>'id'=a->>'round_id' JOIN jsonb_array_elements(effects->'rounds') br ON br->>'id'=b->>'round_id' WHERE ar->>'logical_wave'=br->>'logical_wave' AND (a->>'court_number'=b->>'court_number' OR a->>'team_a_id' IN (b->>'team_a_id',b->>'team_b_id') OR a->>'team_b_id' IN (b->>'team_a_id',b->>'team_b_id'))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') a JOIN jsonb_array_elements(effects->'matches') b ON a->>'id'<b->>'id' JOIN jsonb_array_elements(effects->'rounds') ar ON ar->>'id'=a->>'round_id' JOIN jsonb_array_elements(effects->'rounds') br ON br->>'id'=b->>'round_id' JOIN jsonb_array_elements(nodes) an ON a->>'logical_key'=an->>'id'||':match' JOIN jsonb_array_elements(nodes) bn ON b->>'logical_key'=bn->>'id'||':match' CROSS JOIN LATERAL jsonb_array_elements(an->'inputs') ap CROSS JOIN LATERAL jsonb_array_elements(bn->'inputs') bp WHERE ar->>'logical_wave'=br->>'logical_wave' AND ap=bp) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.graph_seed(jsonb,integer), tournament_builder_private.validate_graph_next_stage(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$IF p_command='generateNextStage' THEN PERFORM tournament_builder_private.validate_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'GRAPH_NEXT_STAGE_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='generateNextStage' THEN
  IF (SELECT d.definition->>'schema_version' FROM public.tournament_definitions d WHERE d.id=event_row.definition_id)='2.0' THEN PERFORM tournament_builder_private.validate_graph_next_stage(p_actor_id,p_tournament_id,p_request,p_effects);
  ELSE PERFORM tournament_builder_private.validate_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 END IF;$new$);
 EXECUTE source;
END $migration$;
COMMIT;
