-- A replacement must already be registered even when fixtures exist.
BEGIN;
DO $patch$
DECLARE source text; old text; replacement text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.validate_revision(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO source;
 old:=$old$IF NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) AND NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=event AND user_id=uid AND status='approved') THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;$old$;
 replacement:=$new$IF NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=event AND user_id=uid AND status='approved') AND (NOT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id=event) OR NOT EXISTS(SELECT 1 FROM public.team_members existing_member JOIN public.teams existing_team ON existing_team.id=existing_member.team_id WHERE existing_member.tournament_id=event AND existing_member.user_id=uid AND existing_member.membership_status='active' AND existing_team.entry_state='approved')) THEN RAISE EXCEPTION 'NOT_REGISTERED'; END IF;$new$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'REVISION_REGISTERED_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,old,replacement);
END $patch$;
COMMIT;
