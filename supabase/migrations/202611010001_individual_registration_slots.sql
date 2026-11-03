-- Individual registration reserves one visual team position at a time.
-- Existing partner-confirmed tournaments keep their historical roster flow.
BEGIN;

ALTER TABLE public.teams ADD COLUMN registration_slot integer;
ALTER TABLE public.teams ADD CONSTRAINT tb_registration_slot_range CHECK (registration_slot IS NULL OR registration_slot BETWEEN 1 AND 16);
CREATE UNIQUE INDEX tb_unique_registration_slot ON public.teams(tournament_id,registration_slot) WHERE registration_slot IS NOT NULL;

DO $individual_slots$
DECLARE source text; old text; new text; patch_number integer:=0;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.snapshot(uuid)'::regprocedure) INTO source;
 old:=$snapshot$'tournament_players',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tournament_players p WHERE p.tournament_id=event),'[]')$snapshot$;
 new:=$snapshot$'tournament_players',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('display_name',coalesce(nullif(trim(concat_ws(' ',profile.first_name,profile.last_name)),''),profile.username,'Player')) ORDER BY p.id) FROM public.tournament_players p JOIN public.profiles profile ON profile.id=p.user_id WHERE p.tournament_id=event),'[]')$snapshot$;
 IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_SLOT_SNAPSHOT_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(source,old,new);

 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
  ($a$'addGuestEntry','addRegisteredEntry','addAdministrator','removeAdministrator','reviseTournament','updateEventDetails','requestEntry'$a$,$b$'addGuestEntry','addRegisteredEntry','addAdministrator','removeAdministrator','reviseTournament','updateEventDetails','requestEntry','joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer'$b$),
  ($a$(p_command IN ('addRegisteredEntry','addGuestEntry','requestEntry','acceptPartner','approveEntry','rejectEntry')$a$,$b$(p_command IN ('addRegisteredEntry','addGuestEntry','requestEntry','acceptPartner','approveEntry','rejectEntry','joinTournament','selectEntrySlot','cancelRegistration','placeRegisteredPlayer')$b$),
  ($a$ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id','admin_definition_id','registered_by']$a$,$b$ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason','guest_players','guest_definition_id','admin_definition_id','registered_by','registration_slot']$b$),
  ($a$withdrawal_reason,guest_players,guest_definition_id,admin_definition_id,registered_by) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason,guest_players,guest_definition_id,admin_definition_id,registered_by$a$,$b$withdrawal_reason,guest_players,guest_definition_id,admin_definition_id,registered_by,registration_slot) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason,guest_players,guest_definition_id,admin_definition_id,registered_by,registration_slot$b$),
  ($a$guest_definition_id=excluded.guest_definition_id,admin_definition_id=excluded.admin_definition_id,registered_by=excluded.registered_by;$a$,$b$guest_definition_id=excluded.guest_definition_id,admin_definition_id=excluded.admin_definition_id,registered_by=excluded.registered_by,registration_slot=excluded.registration_slot;$b$)
 ) patches(a,b) LOOP
  patch_number:=patch_number+1;
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_SLOT_COMMAND_SOURCE_MISMATCH_%',patch_number; END IF;
  source:=replace(source,old,new);
 END LOOP;
 EXECUTE source;

 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 FOR old,new IN SELECT * FROM (VALUES
  ($a$ARRAY['reviseTournament','updateEventDetails','addRegisteredEntry','approveEntry'$a$,$b$ARRAY['reviseTournament','updateEventDetails','addRegisteredEntry','placeRegisteredPlayer','approveEntry'$b$),
  ($a$ELSIF command IN ('requestEntry','acceptPartner') AND client='web' THEN RETURN;$a$,$b$ELSIF command IN ('requestEntry','acceptPartner','joinTournament','selectEntrySlot','cancelRegistration') AND client='web' THEN RETURN;$b$)
 ) patches(a,b) LOOP
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'INDIVIDUAL_SLOT_AUTH_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,new);
 END LOOP;
 EXECUTE source;
END $individual_slots$;
COMMIT;
