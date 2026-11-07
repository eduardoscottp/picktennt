BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 anchor := $old$ ELSIF command IN ('startMatch','submitScore','confirmScore','disputeScore') AND EXISTS($old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN
  RAISE EXCEPTION 'SCORE_VALIDATION_AUTH_SOURCE_MISMATCH';
 END IF;
 source := replace(source, anchor, $new$ ELSIF command='confirmScore' AND client='web' AND EXISTS(
  SELECT 1 FROM public.tournament_players tp JOIN public.matches m ON m.tournament_id=tp.tournament_id
  WHERE tp.tournament_id=event AND tp.user_id=actor AND tp.status='approved' AND m.id=(request->>'match_id')::uuid
 ) THEN RETURN;
 ELSIF command IN ('startMatch','submitScore','disputeScore') AND EXISTS($new$);
 EXECUTE source;
END $migration$;
COMMIT;
