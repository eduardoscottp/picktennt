-- Organizer requested no elapsed-rest blocking for modular games. No event data changes.
BEGIN;
DO $remove_rest$
DECLARE
 source text;
 old_guard text := $guard$IF NOT rest_override AND EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND rest_minutes>0 AND m.started_at IS NOT NULL AND m.ended_at>now()-make_interval(mins=>rest_minutes) AND a.membership_status='active' AND b.membership_status='active') THEN RAISE EXCEPTION 'REST_REQUIRED'; END IF;$guard$;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 IF (length(source)-length(replace(source,old_guard,'')))/length(old_guard) <> 1 THEN
  RAISE EXCEPTION 'REST_GUARD_SOURCE_MISMATCH';
 END IF;
 EXECUTE replace(source,old_guard,'-- Elapsed rest does not block match starts.');
END $remove_rest$;
COMMIT;
