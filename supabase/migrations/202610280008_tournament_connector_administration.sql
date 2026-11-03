-- Explicit re-consent for routine connector administration. No existing grant is modified.
BEGIN;
ALTER TABLE public.connection_grants DROP CONSTRAINT IF EXISTS connection_grants_permissions_check;
ALTER TABLE public.connection_grants ADD CONSTRAINT connection_grants_permissions_check CHECK(permissions <@ ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage']::text[]);
CREATE OR REPLACE FUNCTION tournament_builder_private.authorize(actor uuid,client text,event uuid,command text,request jsonb,grant_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE permission text; event_row public.tournaments%ROWTYPE; admin boolean; grant_row public.connection_grants%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor) THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 IF command='addGuestEntry' THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
 IF client IS NULL OR client='' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO event_row FROM public.tournaments WHERE id=event;
 admin:=event_row.created_by=actor OR EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=event AND user_id=actor);
 -- connector_admin_permissions_v1: existing grants never gain implicit authority.
 IF client<>'web' THEN
  SELECT * INTO grant_row FROM public.connection_grants WHERE id=grant_id FOR SHARE;
  IF NOT FOUND OR grant_row.status<>'active' OR grant_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'GRANT_REVOKED'; END IF;
  IF grant_row.user_id<>actor OR grant_row.client_id<>client THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  permission:=CASE command WHEN 'createDraft' THEN 'draft:create' WHEN 'updateDraft' THEN 'draft:update' WHEN 'read' THEN 'draft:read' ELSE NULL END;
  IF command='read' AND coalesce(admin,false) AND 'admin:manage'=ANY(grant_row.permissions) THEN permission:='admin:manage'; END IF;
  IF command=ANY(ARRAY['addRegisteredEntry','approveEntry','rejectEntry','closeRegistration','reopenRegistration','lockRoster','startTournament','startMatch','attestScore','adjudicateDispute','disputeScore','resolveTie','changeCourt','commitCorrection','withdrawEntry']) THEN
   IF NOT coalesce(admin,false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
   permission:='admin:manage';
  END IF;
  IF permission IS NULL OR NOT permission=ANY(grant_row.permissions) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 END IF;
 IF command='createDraft' THEN
  IF event_row.id IS NOT NULL AND NOT coalesce(admin,false) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN;
 END IF;
 IF event_row.id IS NULL OR event_row.engine_version<>'modular_v1' THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF command IN ('publishTournament','cancelTournament','reopenResults') THEN
  IF actor<>event_row.created_by OR client<>'web' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ELSIF coalesce(admin,false) THEN RETURN;
 ELSIF command='read' THEN
  IF client<>'web' OR event_row.modular_state='draft' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 ELSIF command IN ('requestEntry','acceptPartner') AND client='web' THEN RETURN;
 ELSIF command IN ('cancelEntry','withdrawEntry') AND EXISTS(SELECT 1 FROM public.team_members WHERE team_id=(request->>'entry_id')::uuid AND tournament_id=event AND user_id=actor) THEN RETURN;
 ELSIF command IN ('startMatch','submitScore','confirmScore','disputeScore') AND EXISTS(
  SELECT 1 FROM public.matches m JOIN public.team_members tm ON tm.team_id IN (m.team_a_id,m.team_b_id)
  WHERE m.id=(request->>'match_id')::uuid AND m.tournament_id=event AND tm.user_id=actor AND tm.membership_status='active'
 ) THEN RETURN;
 ELSE RAISE EXCEPTION 'FORBIDDEN'; END IF;
END $$;
DO $oauth_admin$
DECLARE source text; old text;
BEGIN
 IF to_regprocedure('public.tb_oauth_store(text,jsonb)') IS NOT NULL THEN
  SELECT pg_get_functiondef('public.tb_oauth_store(text,jsonb)'::regprocedure) INTO source;
  IF position('-- connector_admin_refresh_v1' IN source)=0 THEN
   old:=$scopes$ARRAY['draft:create','draft:read','draft:update','operation:read']::text[]$scopes$;
   IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'OAUTH_SCOPE_SOURCE_MISMATCH'; END IF;
   source:=replace(source,old,$scopes$ARRAY['draft:create','draft:read','draft:update','operation:read','admin:manage']::text[]$scopes$);
   old:=$anchor$  access_expiry:=least(now()+interval '1 hour',family.expires_at);$anchor$;
   IF (length(source)-length(replace(source,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'OAUTH_REFRESH_SOURCE_MISMATCH'; END IF;
   source:=replace(source,old,$replacement$  -- connector_admin_refresh_v1
  IF p_payload ? 'requested_scopes' THEN
   IF jsonb_typeof(p_payload->'requested_scopes') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('error','invalid_scope'); END IF;
   SELECT array_agg(value) INTO scopes FROM jsonb_array_elements_text(p_payload->'requested_scopes');
   IF NOT coalesce(scopes <@ g.permissions AND g.permissions <@ scopes,false) THEN RETURN jsonb_build_object('error','invalid_scope'); END IF;
  END IF;
  access_expiry:=least(now()+interval '1 hour',family.expires_at);$replacement$);
   EXECUTE source;
  END IF;
 END IF;
END $oauth_admin$;
COMMIT;
