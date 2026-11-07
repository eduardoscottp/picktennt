-- A numeric administrative award counts for ranking but is not a played DUPR result.
BEGIN;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_outcome_kind_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_outcome_kind_check CHECK (outcome_kind IN ('played','administrative_score','retirement','walkover','no_contest'));
ALTER TABLE public.matches ADD CONSTRAINT matches_administrative_score_check CHECK (
  outcome_kind IS DISTINCT FROM 'administrative_score' OR
  (status IS NOT DISTINCT FROM 'validated' AND score_a IS NOT NULL AND score_b IS NOT NULL AND score_a >= 0 AND score_b >= 0 AND score_a <> score_b
   AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL
   AND winner_team_id IS NOT NULL AND winner_team_id = CASE WHEN score_a > score_b THEN team_a_id ELSE team_b_id END
   AND submit_to_dupr IS FALSE)
);
DO $migration$
DECLARE source text; anchor text := $anchor$ FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) LOOP$anchor$;
BEGIN
  SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
  IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION 'ADMINISTRATIVE_SCORE_SOURCE_MISMATCH'; END IF;
  source := replace(source, anchor, anchor || $guard$
  IF row_data->>'outcome_kind'='administrative_score' AND p_command<>'bulkAdjudicate' THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;$guard$);
  EXECUTE source;
END $migration$;
COMMIT;
