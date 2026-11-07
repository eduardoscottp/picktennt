BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.validate_revision(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO source;
 anchor := $old$IF NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=event AND user_id=uid AND status='approved') AND (NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) OR NOT EXISTS(SELECT 1 FROM public.team_members existing_member JOIN public.teams existing_team ON existing_team.id=existing_member.team_id WHERE existing_member.tournament_id=event AND existing_member.user_id=uid AND existing_member.membership_status='active' AND existing_team.entry_state='approved')) THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION 'REVISION_ACCOUNT_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,anchor,'NULL;');
END $migration$;
COMMIT;
