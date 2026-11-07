-- Admit the audited batch through the existing revision-locked command transaction.
BEGIN;
DO $migration$
DECLARE source text; old text; replacement text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 old := $a$'attestScore','adjudicateDispute'$a$;
 IF (length(source)-length(replace(source,old,'')))/length(old) <> 1 THEN RAISE EXCEPTION 'BULK_AUTH_SOURCE_MISMATCH'; END IF;
 source := replace(source,old,$b$'bulkAdjudicate','attestScore','adjudicateDispute'$b$);
 EXECUTE source;
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 IF (length(source)-length(replace(source,old,'')))/length(old) <> 2 THEN RAISE EXCEPTION 'BULK_COMMAND_SOURCE_MISMATCH'; END IF;
 source := replace(source,old,$b$'bulkAdjudicate','attestScore','adjudicateDispute'$b$);
 old := $anchor$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids','admin_change']);$anchor$;
 replacement := $guard$ IF p_command='bulkAdjudicate' THEN
  IF event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_request,ARRAY['entry_id','match_ids','mode','winner_score','loser_score','reason','regenerate_downstream','overwrite_existing','preview_hash']);
  PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','stages','rounds','matches','standings']);
  IF p_effects ? 'event' THEN
   PERFORM tournament_builder_private.assert_keys(p_effects->'event',ARRAY['modular_state','completed_at','result_version','results_under_review','status']);
   IF p_effects->'event' ? 'status' AND p_effects#>>'{event,status}' IS DISTINCT FROM 'finals' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END IF;
  IF jsonb_typeof(p_request->'match_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'match_ids') NOT BETWEEN 1 AND 64 OR
     jsonb_typeof(p_request->'overwrite_existing') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_request->'regenerate_downstream') IS DISTINCT FROM 'boolean' OR
     coalesce(p_request->>'reason','') !~ '[^[:space:]]' OR length(p_request->>'reason')>1000 OR coalesce(p_request->>'preview_hash','') !~ '^[a-f0-9]{64}$' OR
     coalesce(p_request->>'mode','') NOT IN ('score','walkover') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_request->'match_ids'))<>jsonb_array_length(p_request->'match_ids') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  SELECT d.definition INTO definition_row FROM public.tournament_definitions d WHERE d.id=event_row.definition_id AND d.tournament_id=p_tournament_id;
  IF coalesce(definition_row->>'schema_version','') NOT IN ('1.0','2.0') THEN RAISE EXCEPTION 'INVALID_DEFINITION'; END IF;
  IF p_request->>'mode'='score' THEN
   IF jsonb_typeof(p_request->'winner_score') IS DISTINCT FROM 'number' OR jsonb_typeof(p_request->'loser_score') IS DISTINCT FROM 'number' OR
      (p_request->>'winner_score') !~ '^[0-9]+$' OR (p_request->>'loser_score') !~ '^[0-9]+$' OR (p_request->>'winner_score')::numeric <= (p_request->>'loser_score')::numeric OR
      (p_request->>'winner_score')::numeric < (definition_row#>>'{policies,match,target}')::numeric OR
      (p_request->>'winner_score')::numeric-(p_request->>'loser_score')::numeric < (definition_row#>>'{policies,match,win_by}')::numeric OR
      ((p_request->>'winner_score')::numeric <> (definition_row#>>'{policies,match,target}')::numeric AND ((definition_row#>>'{policies,match,win_by}')::numeric <= 1 OR (p_request->>'winner_score')::numeric-(p_request->>'loser_score')::numeric <> (definition_row#>>'{policies,match,win_by}')::numeric)) THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
  ELSIF p_request ? 'winner_score' OR p_request ? 'loser_score' THEN RAISE EXCEPTION 'INVALID_SCORE'; END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_request->'match_ids') LOOP
   SELECT * INTO match_row FROM public.matches WHERE id=(candidate#>>'{}')::uuid AND tournament_id=p_tournament_id AND is_current AND voided_at IS NULL;
   IF NOT FOUND OR match_row.team_a_id IS NULL OR match_row.team_b_id IS NULL OR (p_request->>'entry_id')::uuid NOT IN (match_row.team_a_id,match_row.team_b_id) OR match_row.status NOT IN ('scheduled','in_progress','score_entered','disputed','validated','walkover') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF definition_row->>'schema_version'='1.0' AND NOT EXISTS(SELECT 1 FROM public.tournament_stages s WHERE s.id=match_row.stage_id AND s.tournament_id=p_tournament_id AND (s.module_id='round_robin' OR (s.module_id='elimination' AND jsonb_array_length(p_request->'match_ids')=1))) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF NOT (p_request->>'overwrite_existing')::boolean AND (match_row.status NOT IN ('scheduled','in_progress') OR match_row.outcome_kind IS NOT NULL OR match_row.score_a IS NOT NULL OR match_row.score_b IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF (SELECT count(*) FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) e WHERE e->>'id'=match_row.id::text)<>1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   SELECT value INTO candidate FROM jsonb_array_elements(p_effects->'matches') WHERE value->>'id'=match_row.id::text;
   PERFORM tournament_builder_private.assert_keys(candidate,ARRAY['id','status','outcome_kind','winner_team_id','score_a','score_b','submitted_entry_id','entered_by','validated_by','submit_to_dupr','ended_at','result_revision','revision','bracket_next_winner_match_id','bracket_next_loser_match_id','bracket_winner_fills_side','bracket_loser_fills_side']);
   IF candidate->>'validated_by' IS DISTINCT FROM p_actor_id::text OR candidate->>'submit_to_dupr' IS DISTINCT FROM 'false' OR
      candidate->>'winner_team_id' IS DISTINCT FROM (CASE WHEN match_row.team_a_id=(p_request->>'entry_id')::uuid THEN match_row.team_b_id ELSE match_row.team_a_id END)::text OR
      candidate->>'outcome_kind' IS DISTINCT FROM (CASE WHEN p_request->>'mode'='score' THEN 'administrative_score' ELSE 'walkover' END) OR
      candidate->>'status' IS DISTINCT FROM (CASE WHEN p_request->>'mode'='score' THEN 'validated' ELSE 'walkover' END) OR
      (candidate->>'result_revision')::bigint IS DISTINCT FROM event_row.revision+1 THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   IF p_request->>'mode'='score' THEN
    IF (candidate->>'score_a')::numeric IS DISTINCT FROM (CASE WHEN match_row.team_a_id=(p_request->>'entry_id')::uuid THEN (p_request->>'loser_score')::numeric ELSE (p_request->>'winner_score')::numeric END) OR
       (candidate->>'score_b')::numeric IS DISTINCT FROM (CASE WHEN match_row.team_b_id=(p_request->>'entry_id')::uuid THEN (p_request->>'loser_score')::numeric ELSE (p_request->>'winner_score')::numeric END) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
   ELSIF candidate->>'score_a' IS NOT NULL OR candidate->>'score_b' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  END LOOP;
  IF EXISTS(
   SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) e
   JOIN public.matches m ON m.id=(e->>'id')::uuid AND m.tournament_id=p_tournament_id
   WHERE NOT (p_request->'match_ids' ? m.id::text) AND m.status<>'scheduled'
    AND (e ?| ARRAY['team_a_id','team_b_id','status','outcome_kind','winner_team_id','score_a','score_b','is_current','voided_at'])
    AND NOT ((p_request->>'regenerate_downstream')::boolean AND e->>'is_current'='false' AND e->>'voided_at' IS NOT NULL)
  ) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF EXISTS(
   WITH RECURSIVE nodes AS (
    SELECT n FROM jsonb_array_elements(coalesce((SELECT output->'finalizedNodes' FROM public.tournament_stages WHERE tournament_id=p_tournament_id AND definition_id=event_row.definition_id AND module_id='entries' LIMIT 1),definition_row->'nodes')) n
   ), edges AS (
    SELECT input->>'node_id' AS source, n->>'id' AS destination FROM nodes
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(n->'inputs','[]')||coalesce(n->'side_a','[]')||coalesce(n->'side_b','[]')) input WHERE input ? 'node_id'
    UNION ALL SELECT n->>'from',n->>'id' FROM nodes WHERE n ? 'from'
   ), roots AS (
    SELECT DISTINCT s.node_id FROM public.matches m JOIN public.tournament_stages s ON s.id=m.stage_id
    WHERE m.tournament_id=p_tournament_id AND p_request->'match_ids' ? m.id::text
   ), downstream(node_id) AS (
    SELECT node_id FROM roots UNION SELECT edges.destination FROM edges JOIN downstream ON edges.source=downstream.node_id
   ), match_path(id) AS (
    SELECT m.id FROM public.matches m WHERE m.tournament_id=p_tournament_id AND p_request->'match_ids' ? m.id::text
    UNION SELECT next_id.id FROM match_path p JOIN public.matches m ON m.id=p.id AND m.tournament_id=p_tournament_id
     CROSS JOIN LATERAL (VALUES(m.bracket_next_winner_match_id),(m.bracket_next_loser_match_id)) next_id(id) WHERE next_id.id IS NOT NULL
   )
   SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) e
   LEFT JOIN public.matches m ON m.id=(e->>'id')::uuid AND m.tournament_id=p_tournament_id
   LEFT JOIN public.tournament_stages s ON s.id=coalesce((e->>'stage_id')::uuid,m.stage_id) AND s.tournament_id=p_tournament_id
   WHERE NOT (p_request->'match_ids' ? (e->>'id'))
    AND NOT (m.id IS NOT NULL AND (e - ARRAY['id','bracket_next_winner_match_id','bracket_next_loser_match_id','bracket_winner_fills_side','bracket_loser_fills_side'])='{}'::jsonb
     AND (e ? 'bracket_next_winner_match_id' OR e ? 'bracket_next_loser_match_id')
     AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(e) pointer
      WHERE pointer.key IN ('bracket_next_winner_match_id','bracket_next_loser_match_id') AND pointer.value IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) target JOIN public.tournament_stages target_stage ON target_stage.id=(target->>'stage_id')::uuid AND target_stage.tournament_id=p_tournament_id WHERE target->>'id'=pointer.value AND target_stage.node_id IN (SELECT node_id FROM downstream))))
    AND NOT (definition_row->>'schema_version'='1.0' AND s.module_id='elimination' AND (
     (m.id IS NOT NULL AND m.id IN (SELECT id FROM match_path)) OR
     (m.id IS NULL AND EXISTS(SELECT 1 FROM public.matches prior JOIN jsonb_array_elements(coalesce(p_effects->'matches','[]')) archived ON archived->>'id'=prior.id::text AND archived->>'is_current'='false' WHERE prior.tournament_id=p_tournament_id AND prior.stage_id=s.id AND prior.logical_key=e->>'logical_key' AND prior.id IN (SELECT id FROM match_path)))
    ))
    AND (s.id IS NULL OR s.node_id NOT IN (SELECT node_id FROM downstream) OR s.node_id IN (SELECT node_id FROM roots))
  ) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
  IF NOT (p_request->>'regenerate_downstream')::boolean AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) e WHERE e->>'is_current'='false' OR e->>'voided_at' IS NOT NULL) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
$guard$ || old;
 IF position(old IN source)=0 THEN RAISE EXCEPTION 'BULK_GUARD_SOURCE_MISMATCH'; END IF;
 source := replace(source,old,replacement);
 EXECUTE source;
END $migration$;
COMMIT;
