-- Commit the reviewed v1 knockout through the existing serialized command boundary.
BEGIN;
CREATE OR REPLACE FUNCTION tournament_builder_private.validate_next_stage(actor_id uuid, event_id uuid, request jsonb, effects jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.tournaments%ROWTYPE; roster public.tournament_stages%ROWTYPE; rr public.tournament_stages%ROWTYPE;
 ranking public.tournament_stages%ROWTYPE; qualifier public.tournament_stages%ROWTYPE; knockout public.tournament_stages%ROWTYPE;
 definition jsonb; node jsonb; stage_patch jsonb; stored public.tournament_stages%ROWTYPE; standing jsonb; stored_standing public.standings%ROWTYPE;
 match_patch jsonb; round_patch jsonb; final_id text; bronze_id text; semi1_id text; semi2_id text; seeds jsonb;
 expected_count integer; entry_count integer; bracket_size integer; bronze boolean; match_key text; expected_a text; expected_b text;
 stage_output jsonb; fixture_expected jsonb; fixture_patch jsonb; slot_a jsonb; slot_b jsonb; fixture_round integer;
 raw_a text; raw_b text; vacancy_count integer; auto_outcome text; auto_winner text; auto_loser text;
 vacants text[]; a1 text; b1 text; a2 text; b2 text; w1 text; w2 text; l1 text; l2 text; auto1 boolean; auto2 boolean;
 known_a boolean; known_b boolean; resolved_a text; resolved_b text; fixture_state text; required_outcome text;
 terminal boolean; ineligible jsonb; final_placements jsonb;
BEGIN
 SELECT * INTO ev FROM public.tournaments WHERE id=event_id;
 IF NOT FOUND OR ev.modular_state IS DISTINCT FROM 'active' OR ev.results_under_review THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(request,ARRAY['preview_hash']);
 IF coalesce(request->>'preview_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 SELECT d.definition INTO definition FROM public.tournament_definitions d WHERE d.id=ev.definition_id AND d.tournament_id=event_id;
 IF definition->>'schema_version' IS DISTINCT FROM '1.0' THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT * INTO roster FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='entries';
 SELECT * INTO rr FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='round_robin';
 SELECT * INTO ranking FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='standings';
 SELECT * INTO qualifier FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='qualify';
 SELECT * INTO knockout FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id AND module_id='elimination';
 IF roster.id IS NULL OR rr.id IS NULL OR ranking.id IS NULL OR qualifier.id IS NULL OR knockout.id IS NULL OR rr.state IS DISTINCT FROM 'completed' OR qualifier.state IS DISTINCT FROM 'completed' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT value INTO node FROM jsonb_array_elements(definition->'nodes') WHERE value->>'id'=qualifier.node_id AND value->>'module'='qualify@1';
 bracket_size:=(node#>>'{config,count}')::integer;
 IF bracket_size NOT IN (2,4) THEN RAISE EXCEPTION 'UNSUPPORTED_FORMAT'; END IF;
 SELECT coalesce((value#>>'{config,bronze}')::boolean,false) INTO bronze FROM jsonb_array_elements(definition->'nodes') WHERE value->>'id'=knockout.node_id AND value->>'module'='elimination@1';
 IF bronze IS NULL OR (bracket_size=2 AND bronze) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 seeds:=qualifier.output->'entryIds';
 IF jsonb_typeof(seeds) IS DISTINCT FROM 'array' OR jsonb_array_length(seeds)<>bracket_size OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(seeds))<>bracket_size THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF roster.output->'qualifierSlots' IS NOT NULL AND roster.output->'qualifierSlots'<>'null'::jsonb AND roster.output->'qualifierSlots' IS DISTINCT FROM seeds THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 SELECT coalesce(array_agg(s.team_id),'{}') INTO vacants FROM jsonb_array_elements_text(seeds) s(team_id) JOIN public.teams t ON t.id::text=s.team_id AND t.tournament_id=event_id WHERE t.entry_state='withdrawn';
 vacancy_count:=cardinality(vacants);
 IF vacancy_count>=bracket_size OR (vacancy_count>0 AND roster.output->'qualifierSlots' IS DISTINCT FROM seeds) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(seeds) WITH ORDINALITY s(team_id,rank) LEFT JOIN public.standings t ON t.tournament_id=event_id AND t.stage_id=ranking.id AND t.team_id::text=s.team_id WHERE t.id IS NULL OR (NOT s.team_id=ANY(vacants) AND (NOT t.eligible OR t.rank IS DISTINCT FROM s.rank::integer OR t.tie_group IS NOT NULL)) OR (s.team_id=ANY(vacants) AND t.eligible)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 a1:=CASE WHEN seeds->>0=ANY(vacants) THEN NULL ELSE seeds->>0 END;
 b1:=CASE WHEN (CASE bracket_size WHEN 2 THEN seeds->>1 ELSE seeds->>3 END)=ANY(vacants) THEN NULL ELSE CASE bracket_size WHEN 2 THEN seeds->>1 ELSE seeds->>3 END END;
 auto1:=a1 IS NULL OR b1 IS NULL; w1:=CASE WHEN auto1 THEN coalesce(a1,b1) ELSE NULL END;
 l1:=CASE WHEN auto1 AND w1 IS NOT NULL THEN CASE WHEN a1 IS NULL THEN seeds->>0 ELSE CASE bracket_size WHEN 2 THEN seeds->>1 ELSE seeds->>3 END END ELSE NULL END;
 IF bracket_size=4 THEN
  a2:=CASE WHEN seeds->>1=ANY(vacants) THEN NULL ELSE seeds->>1 END; b2:=CASE WHEN seeds->>2=ANY(vacants) THEN NULL ELSE seeds->>2 END;
  auto2:=a2 IS NULL OR b2 IS NULL; w2:=CASE WHEN auto2 THEN coalesce(a2,b2) ELSE NULL END;
  l2:=CASE WHEN auto2 AND w2 IS NOT NULL THEN CASE WHEN a2 IS NULL THEN seeds->>1 ELSE seeds->>2 END ELSE NULL END;
 ELSE auto2:=false; END IF;
 terminal:=CASE WHEN bracket_size=2 THEN auto1 ELSE auto1 AND auto2 AND (w1 IS NULL OR w2 IS NULL) END;
 IF jsonb_typeof(roster.output->'entryIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 entry_count:=jsonb_array_length(roster.output->'entryIds');
 IF entry_count<2 OR (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=rr.id AND m.is_current AND m.voided_at IS NULL)<>entry_count*(entry_count-1)/2 OR EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=rr.id AND m.is_current AND m.voided_at IS NULL AND (m.status NOT IN ('validated','walkover') OR m.outcome_kind IS NULL)) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY a(team_id,ordinal), jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY b(team_id,ordinal) WHERE a.ordinal<b.ordinal AND (SELECT count(*) FROM public.matches m WHERE m.tournament_id=event_id AND m.stage_id=rr.id AND m.is_current AND m.voided_at IS NULL AND ((m.team_a_id::text=a.team_id AND m.team_b_id::text=b.team_id) OR (m.team_a_id::text=b.team_id AND m.team_b_id::text=a.team_id)))<>1) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event_id AND stage_id=knockout.id AND is_current AND voided_at IS NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 PERFORM tournament_builder_private.assert_keys(effects,ARRAY['event','stages','rounds','matches','standings']);
 IF terminal THEN
  PERFORM tournament_builder_private.assert_keys(effects->'event',ARRAY['modular_state','completed_at','result_version','results_under_review']);
  IF effects#>>'{event,modular_state}' IS DISTINCT FROM 'completed' OR effects#>>'{event,results_under_review}' IS DISTINCT FROM 'false' OR (effects#>>'{event,result_version}')::bigint IS DISTINCT FROM coalesce(ev.result_version,0)+1 OR effects#>>'{event,completed_at}' IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  SELECT coalesce(jsonb_agg(x.team_id ORDER BY x.ordinal),'[]'::jsonb) INTO ineligible FROM jsonb_array_elements_text(roster.output->'entryIds') WITH ORDINALITY x(team_id,ordinal) JOIN public.teams t ON t.tournament_id=event_id AND t.id::text=x.team_id WHERE t.entry_state='withdrawn';
  final_placements:=jsonb_build_object('state','completed','championEntryId',coalesce(w1,w2),'groups',jsonb_build_array(jsonb_build_object('rank',1,'entryIds',jsonb_build_array(coalesce(w1,w2)))),'ineligibleEntryIds',ineligible,'unplacedEntryIds',ineligible);
 ELSE
  IF effects->'event' IS DISTINCT FROM '{"status":"finals"}'::jsonb THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
 expected_count:=bracket_size-1+bronze::integer;
 IF jsonb_array_length(coalesce(effects->'matches','[]'))<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF jsonb_array_length(coalesce(effects->'stages','[]'))<>(SELECT count(*) FROM public.tournament_stages WHERE tournament_id=event_id AND definition_id=ev.definition_id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR stage_patch IN SELECT value FROM jsonb_array_elements(effects->'stages') LOOP
  PERFORM tournament_builder_private.assert_keys(stage_patch,ARRAY['id','state','input_revision','output_revision','output','blocked_code']);
  SELECT * INTO stored FROM public.tournament_stages WHERE id=(stage_patch->>'id')::uuid AND tournament_id=event_id AND definition_id=ev.definition_id;
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'stages') x WHERE x->>'id'=stage_patch->>'id')<>1 OR (stage_patch->>'output_revision')::bigint<>ev.revision+1 OR (stage_patch->>'input_revision')::bigint<>stored.input_revision THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF stored.module_id='placements' AND terminal THEN
   IF stage_patch->>'state' IS DISTINCT FROM 'completed' OR stage_patch->'output' IS DISTINCT FROM final_placements OR stage_patch->>'blocked_code' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF stored.id<>knockout.id AND (stage_patch->>'state' IS DISTINCT FROM stored.state OR stage_patch->'output' IS DISTINCT FROM stored.output OR stage_patch->>'blocked_code' IS DISTINCT FROM stored.blocked_code) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF stored.id=knockout.id AND (stage_patch->>'state' IS DISTINCT FROM (CASE WHEN terminal THEN 'completed' ELSE 'ready' END) OR stage_patch->>'blocked_code' IS NOT NULL OR stage_patch#>>'{output,generationApproved}' IS DISTINCT FROM 'true' OR jsonb_array_length(coalesce(stage_patch#>'{output,fixtures}','[]'))<>expected_count OR ((stage_patch->'output')-'fixtures'-'generationApproved') IS DISTINCT FROM (stored.output-'fixtures'-'generationApproved')) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF stored.id=knockout.id THEN stage_output:=stage_patch->'output'; END IF;
 END LOOP;
 IF jsonb_array_length(coalesce(effects->'standings','[]'))<>(SELECT count(*) FROM public.standings WHERE tournament_id=event_id AND stage_id=ranking.id) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR standing IN SELECT value FROM jsonb_array_elements(coalesce(effects->'standings','[]')) LOOP
  SELECT * INTO stored_standing FROM public.standings WHERE id=(standing->>'id')::uuid AND tournament_id=event_id AND stage_id=ranking.id;
  IF NOT FOUND OR (SELECT count(*) FROM jsonb_array_elements(effects->'standings') x WHERE x->>'id'=standing->>'id')<>1 OR standing IS DISTINCT FROM jsonb_build_object('id',stored_standing.id,'stage_id',stored_standing.stage_id,'round_id',stored_standing.round_id,'team_id',stored_standing.team_id,'wins',stored_standing.wins,'losses',stored_standing.losses,'points_for',stored_standing.points_for,'points_against',stored_standing.points_against,'rank',stored_standing.rank,'input_revision',stored_standing.input_revision,'eligible',stored_standing.eligible,'tie_group',stored_standing.tie_group) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 SELECT value->>'id' INTO final_id FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=knockout.node_id||CASE bracket_size WHEN 2 THEN ':r1:m1' ELSE ':r2:m1' END;
 SELECT value->>'id' INTO bronze_id FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=knockout.node_id||':bronze';
 SELECT value->>'id' INTO semi1_id FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=knockout.node_id||':r1:m1';
 SELECT value->>'id' INTO semi2_id FROM jsonb_array_elements(effects->'matches') WHERE value->>'logical_key'=knockout.node_id||':r1:m2';
 IF final_id IS NULL OR (bracket_size=4 AND (semi1_id IS NULL OR semi2_id IS NULL)) OR (bronze AND bronze_id IS NULL) OR (NOT bronze AND bronze_id IS NOT NULL) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(effects->'matches') x)<>expected_count THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 FOR round_patch IN SELECT value FROM jsonb_array_elements(coalesce(effects->'rounds','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(round_patch,ARRAY['id','stage_id','logical_wave','round_number','round_type','status','schedule_generation','is_current']);
  IF round_patch->>'stage_id' IS DISTINCT FROM knockout.id::text OR round_patch->>'status' IS DISTINCT FROM 'pending' OR round_patch->>'is_current' IS DISTINCT FROM 'true' OR (round_patch->>'schedule_generation')::bigint IS DISTINCT FROM ev.roster_revision OR (round_patch->>'round_number')::integer IS NULL OR (round_patch->>'round_number')::integer<=(SELECT coalesce(max(round_number),0) FROM public.rounds WHERE tournament_id=event_id) OR (round_patch->>'logical_wave')::integer IS NULL OR (round_patch->>'logical_wave')::integer<=(SELECT coalesce(max(logical_wave),0) FROM public.rounds WHERE tournament_id=event_id AND stage_id=rr.id AND is_current) OR EXISTS(SELECT 1 FROM public.rounds WHERE id=(round_patch->>'id')::uuid) OR (SELECT count(*) FROM jsonb_array_elements(effects->'rounds') x WHERE x->>'id'=round_patch->>'id')<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF (round_patch->>'logical_wave')::integer>(SELECT coalesce(max(logical_wave),0)+expected_count FROM public.rounds WHERE tournament_id=event_id AND stage_id=rr.id AND is_current) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 FOR match_patch IN SELECT value FROM jsonb_array_elements(effects->'matches') LOOP
  PERFORM tournament_builder_private.assert_keys(match_patch,ARRAY['id','round_id','stage_id','logical_key','court_number','team_a_id','team_b_id','schedule_generation','is_current','status','revision','result_revision','submit_to_dupr','bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side','outcome_kind','winner_team_id','score_a','score_b','validated_by']);
  match_key:=match_patch->>'logical_key';
  SELECT value INTO round_patch FROM jsonb_array_elements(effects->'rounds') WHERE value->>'id'=match_patch->>'round_id';
  IF round_patch IS NULL OR match_patch->>'stage_id' IS DISTINCT FROM knockout.id::text OR match_patch->>'is_current' IS DISTINCT FROM 'true' OR match_patch->>'submit_to_dupr' IS DISTINCT FROM 'false' OR (match_patch->>'schedule_generation')::bigint IS DISTINCT FROM ev.roster_revision OR (match_patch->>'court_number')::integer IS NULL OR (match_patch->>'court_number')::integer NOT BETWEEN 1 AND ev.court_count OR EXISTS(SELECT 1 FROM public.matches WHERE id=(match_patch->>'id')::uuid) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  expected_a:=NULL; expected_b:=NULL; raw_a:=NULL; raw_b:=NULL; known_a:=false; known_b:=false; auto_outcome:=NULL; auto_winner:=NULL; auto_loser:=NULL;
  IF bracket_size=2 AND match_key=knockout.node_id||':r1:m1' THEN raw_a:=seeds->>0; raw_b:=seeds->>1; expected_a:=a1; expected_b:=b1; known_a:=true; known_b:=true;
  ELSIF bracket_size=4 AND match_key=knockout.node_id||':r1:m1' THEN raw_a:=seeds->>0; raw_b:=seeds->>3; expected_a:=a1; expected_b:=b1; known_a:=true; known_b:=true;
  ELSIF bracket_size=4 AND match_key=knockout.node_id||':r1:m2' THEN raw_a:=seeds->>1; raw_b:=seeds->>2; expected_a:=a2; expected_b:=b2; known_a:=true; known_b:=true;
  ELSIF bracket_size=4 AND match_key=knockout.node_id||':r2:m1' THEN known_a:=auto1; known_b:=auto2; raw_a:=w1; raw_b:=w2; expected_a:=w1; expected_b:=w2;
  ELSIF bracket_size=4 AND bronze AND match_key=knockout.node_id||':bronze' THEN known_a:=auto1; known_b:=auto2; raw_a:=l1; raw_b:=l2;
  ELSE RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF known_a AND known_b AND (expected_a IS NULL OR expected_b IS NULL) THEN
   auto_winner:=coalesce(expected_a,expected_b); auto_outcome:=CASE WHEN auto_winner IS NULL THEN 'no_contest' ELSE 'walkover' END;
   IF auto_winner IS NOT NULL THEN auto_loser:=CASE WHEN auto_winner=raw_a THEN raw_b ELSE raw_a END; END IF;
   IF match_patch->>'status' IS DISTINCT FROM (CASE WHEN auto_outcome='walkover' THEN 'walkover' ELSE 'validated' END) OR match_patch->>'outcome_kind' IS DISTINCT FROM auto_outcome OR match_patch->>'winner_team_id' IS DISTINCT FROM auto_winner OR match_patch->>'validated_by' IS DISTINCT FROM actor_id::text OR (match_patch->>'revision')::bigint IS DISTINCT FROM ev.revision+1 OR (match_patch->>'result_revision')::bigint IS DISTINCT FROM ev.revision+1 OR match_patch->>'score_a' IS NOT NULL OR match_patch->>'score_b' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF match_patch->>'status' IS DISTINCT FROM 'scheduled' OR (match_patch->>'revision')::integer IS DISTINCT FROM 0 OR (match_patch->>'result_revision')::integer IS DISTINCT FROM 0 OR match_patch ?| ARRAY['outcome_kind','winner_team_id','score_a','score_b','validated_by'] THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF match_patch->>'team_a_id' IS DISTINCT FROM expected_a OR match_patch->>'team_b_id' IS DISTINCT FROM expected_b OR round_patch->>'round_type' IS DISTINCT FROM (CASE WHEN match_patch->>'id'=final_id THEN 'finals_gold' WHEN match_patch->>'id'=bronze_id THEN 'finals_bronze' ELSE 'elimination' END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  fixture_round:=CASE WHEN bracket_size=4 AND match_patch->>'id' IN (final_id,bronze_id) THEN 2 ELSE 1 END;
  IF fixture_round=1 THEN
   slot_a:=jsonb_build_object('kind','entry','entryId',raw_a); slot_b:=jsonb_build_object('kind','entry','entryId',raw_b);
  ELSE
   slot_a:=jsonb_build_object('kind',CASE WHEN match_patch->>'id'=bronze_id THEN 'loser' ELSE 'winner' END,'fixtureId',knockout.node_id||':r1:m1');
   slot_b:=jsonb_build_object('kind',CASE WHEN match_patch->>'id'=bronze_id THEN 'loser' ELSE 'winner' END,'fixtureId',knockout.node_id||':r1:m2');
  END IF;
  fixture_expected:=jsonb_build_object('id',match_key,'stageId',knockout.node_id,'round',fixture_round,'wave',(round_patch->>'logical_wave')::integer,'court',(match_patch->>'court_number')::integer,'a',slot_a,'b',slot_b);
  IF match_patch->>'id'=bronze_id THEN fixture_expected:=fixture_expected||'{"bronze":true}'::jsonb; END IF;
  resolved_a:=CASE WHEN auto_outcome IS NOT NULL THEN raw_a ELSE expected_a END; resolved_b:=CASE WHEN auto_outcome IS NOT NULL THEN raw_b ELSE expected_b END;
  fixture_state:=CASE WHEN auto_outcome IS NOT NULL THEN 'completed' WHEN known_a AND known_b THEN 'ready' ELSE 'waiting' END;
  fixture_expected:=jsonb_build_object('fixture',fixture_expected,'state',fixture_state);
  IF known_a THEN fixture_expected:=fixture_expected||jsonb_build_object('entryA',resolved_a); END IF;
  IF known_b THEN fixture_expected:=fixture_expected||jsonb_build_object('entryB',resolved_b); END IF;
  IF known_a AND known_b AND (resolved_a IS NULL OR resolved_b IS NULL) THEN
   required_outcome:=CASE WHEN resolved_a IS NULL AND resolved_b IS NULL THEN 'no_contest' ELSE 'walkover' END;
   fixture_expected:=fixture_expected||jsonb_build_object('requiredOutcome',required_outcome);
  END IF;
  IF auto_outcome IS NOT NULL THEN fixture_expected:=fixture_expected||jsonb_build_object('result',jsonb_build_object('fixtureId',match_key,'accepted',true,'outcome',auto_outcome,'winnerEntryId',auto_winner,'scoreA',NULL,'scoreB',NULL),'winnerEntryId',auto_winner,'loserEntryId',auto_loser); END IF;
  SELECT value INTO fixture_patch FROM jsonb_array_elements(stage_output->'fixtures') WHERE value#>>'{fixture,id}'=match_key;
  IF fixture_patch IS DISTINCT FROM fixture_expected OR (SELECT count(*) FROM jsonb_array_elements(stage_output->'fixtures') x WHERE x#>>'{fixture,id}'=match_key)<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF bracket_size=4 AND match_patch->>'id' IN (semi1_id,semi2_id) THEN
   IF match_patch->>'bracket_next_winner_match_id' IS DISTINCT FROM final_id OR match_patch->>'bracket_winner_fills_side' IS DISTINCT FROM (CASE WHEN match_patch->>'id'=semi1_id THEN 'a' ELSE 'b' END) OR match_patch->>'bracket_next_loser_match_id' IS DISTINCT FROM bronze_id OR match_patch->>'bracket_loser_fills_side' IS DISTINCT FROM (CASE WHEN bronze THEN CASE WHEN match_patch->>'id'=semi1_id THEN 'a' ELSE 'b' END ELSE NULL END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  ELSIF match_patch ?| ARRAY['bracket_next_winner_match_id','bracket_winner_fills_side','bracket_next_loser_match_id','bracket_loser_fills_side'] THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'rounds') r WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') m WHERE m->>'round_id'=r->>'id')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') a JOIN jsonb_array_elements(effects->'matches') b ON a->>'id'<b->>'id' JOIN jsonb_array_elements(effects->'rounds') ar ON ar->>'id'=a->>'round_id' JOIN jsonb_array_elements(effects->'rounds') br ON br->>'id'=b->>'round_id' WHERE ar->>'logical_wave'=br->>'logical_wave' AND a->>'court_number'=b->>'court_number') THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 IF bracket_size=4 AND EXISTS(SELECT 1 FROM jsonb_array_elements(effects->'matches') target JOIN jsonb_array_elements(effects->'rounds') tr ON tr->>'id'=target->>'round_id' JOIN jsonb_array_elements(effects->'matches') feeder ON feeder->>'id' IN (semi1_id,semi2_id) JOIN jsonb_array_elements(effects->'rounds') fr ON fr->>'id'=feeder->>'round_id' WHERE target->>'id' IN (final_id,bronze_id) AND (tr->>'logical_wave')::integer<=(fr->>'logical_wave')::integer) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;
REVOKE ALL ON FUNCTION tournament_builder_private.validate_next_stage(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ARRAY['appendTerminalMatch','replayTerminalMatch'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'NEXT_STAGE_AUTH_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,$new$ARRAY['generateNextStage','appendTerminalMatch','replayTerminalMatch'$new$);
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$'createDraft','updateDraft','appendTerminalMatch','replayTerminalMatch'$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'NEXT_STAGE_COMMAND_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$'createDraft','updateDraft','generateNextStage','appendTerminalMatch','replayTerminalMatch'$new$);
 anchor:=$old$IF p_command='appendTerminalMatch' THEN PERFORM tournament_builder_private.validate_append_terminal_match(p_actor_id,p_tournament_id,p_request,p_effects); END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'NEXT_STAGE_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$IF p_command='generateNextStage' THEN PERFORM tournament_builder_private.validate_next_stage(p_actor_id,p_tournament_id,p_request,p_effects); END IF;
 $new$||anchor);
 EXECUTE source;
END $migration$;
COMMIT;
