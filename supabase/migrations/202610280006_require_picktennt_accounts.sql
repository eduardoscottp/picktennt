-- All new tournament players must have a real Picktennt profile. Preserve historical data.
BEGIN;
DO $disable_guests$
DECLARE source text; anchor text := $anchor$ IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor) THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;$anchor$;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'AUTHORIZE_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,anchor||E'\n IF command=''addGuestEntry'' THEN RAISE EXCEPTION ''ACCOUNT_REQUIRED''; END IF;');
END $disable_guests$;
COMMIT;
