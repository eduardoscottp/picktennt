-- Enforce player registration limits under the same tournament row lock as mutations.
BEGIN;
DO $patch$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 marker := $old$ IF (p_command IN ('updateDraft','publishTournament')$old$;
 IF position(marker IN source)=0 THEN RAISE EXCEPTION 'REGISTRATION_GUARD_SOURCE_MISMATCH'; END IF;
 source := replace(source, marker, $new$ IF p_command IN ('joinTournament','selectEntrySlot','cancelRegistration','cancelEntry') OR
    (p_command='withdrawEntry' AND event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id)) THEN
  IF event_row.modular_state IS DISTINCT FROM 'registration_open' OR NOT EXISTS (
   SELECT 1 FROM public.tournament_definitions d WHERE d.id=event_row.definition_id AND (d.definition->'registration'->>'closes_at')::timestamptz > clock_timestamp()
  ) THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
 END IF;
$new$ || marker);
 EXECUTE source;
END $patch$;
COMMIT;
