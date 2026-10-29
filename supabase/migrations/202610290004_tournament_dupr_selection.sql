-- Persist explicit website administrator selection through the audited command boundary.
BEGIN;
DO $selection$
DECLARE source text; anchor text;
BEGIN
  SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
  anchor := $a$ARRAY['createDraft','updateDraft'$a$;
  IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION 'DUPR_COMMAND_SOURCE_MISMATCH'; END IF;
  source := replace(source,anchor,$a$ARRAY['setDuprSubmission','createDraft','updateDraft'$a$);
  anchor := $a$ next_revision:=coalesce(event_row.revision,0)+1;$a$;
  IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION 'DUPR_VALIDATION_SOURCE_MISMATCH'; END IF;
  source := replace(source,anchor,$b$
 IF p_command='setDuprSubmission' THEN
  IF p_client_id IS DISTINCT FROM 'web' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF event_row.modular_state IS DISTINCT FROM 'completed' OR event_row.results_under_review THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  PERFORM tournament_builder_private.assert_keys(p_request,ARRAY['match_id','enabled']);
  IF jsonb_typeof(p_request->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  SELECT * INTO match_row FROM public.matches WHERE id=(p_request->>'match_id')::uuid AND tournament_id=p_tournament_id;
  IF NOT FOUND OR match_row.is_current IS DISTINCT FROM true OR match_row.voided_at IS NOT NULL OR match_row.excluded_at IS NOT NULL OR match_row.status IS DISTINCT FROM 'validated' OR match_row.outcome_kind IS DISTINCT FROM 'played' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF p_effects IS DISTINCT FROM jsonb_build_object('matches',jsonb_build_array(jsonb_build_object('id',match_row.id,'submit_to_dupr',(p_request->>'enabled')::boolean))) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
 END IF;
$b$||anchor);
  EXECUTE source;
END $selection$;
COMMIT;
