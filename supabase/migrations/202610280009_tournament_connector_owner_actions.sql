-- Owner actions require a newly consented scope; existing grants are unchanged.
BEGIN;
ALTER TABLE public.connection_grants DROP CONSTRAINT IF EXISTS connection_grants_permissions_check;
ALTER TABLE public.connection_grants ADD CONSTRAINT connection_grants_permissions_check CHECK(permissions <@ ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage','owner:manage']::text[]);
DO $owner_actions$
DECLARE source text; old text;
BEGIN
 SELECT pg_get_functiondef('tournament_builder_private.authorize(uuid,text,uuid,text,jsonb,uuid)'::regprocedure) INTO source;
 IF position('-- connector_owner_permissions_v1' IN source)=0 THEN
  old:=$anchor$  IF command='read' AND coalesce(admin,false) AND 'admin:manage'=ANY(grant_row.permissions) THEN permission:='admin:manage'; END IF;$anchor$;
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'OWNER_READ_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,old||$replacement$
  -- connector_owner_permissions_v1
  IF command='read' AND actor=event_row.created_by AND 'owner:manage'=ANY(grant_row.permissions) THEN permission:='owner:manage'; END IF;
  IF command=ANY(ARRAY['publishTournament','cancelTournament','reopenResults','addAdministrator','removeAdministrator']) THEN
   IF actor IS DISTINCT FROM event_row.created_by THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   IF request->'confirmed_owner_action' IS DISTINCT FROM 'true'::jsonb OR coalesce(request->>'reviewed_action_hash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   permission:='owner:manage';
  END IF;$replacement$);
  old:=$anchor$ IF command IN ('publishTournament','cancelTournament','reopenResults') THEN
  IF actor<>event_row.created_by OR client<>'web' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$anchor$;
  IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'OWNER_ACTION_SOURCE_MISMATCH'; END IF;
  source:=replace(source,old,$replacement$ IF command IN ('publishTournament','cancelTournament','reopenResults','addAdministrator','removeAdministrator') THEN
  IF actor IS DISTINCT FROM event_row.created_by THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;$replacement$);
  EXECUTE source;
 END IF;
 IF to_regprocedure('public.tb_oauth_store(text,jsonb)') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.tb_oauth_store(text,jsonb)'::regprocedure) INTO source;
  IF position('/* connector_owner_scope_v1 */' IN source)=0 THEN
   old:=$anchor$ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage']::text[]$anchor$;
   IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'OWNER_OAUTH_SCOPE_SOURCE_MISMATCH'; END IF;
   source:=replace(source,old,$replacement$/* connector_owner_scope_v1 */ ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage','owner:manage']::text[]$replacement$);
   EXECUTE source;
  END IF;
 END IF;
END $owner_actions$;
COMMIT;
