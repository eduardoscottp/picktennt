BEGIN;
CREATE FUNCTION public.tb_search_tournaments(p_actor_id uuid, p_client_id text, p_grant_id uuid, p_query text, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE grant_row public.connection_grants%ROWTYPE; item record; matches jsonb := '[]'; next_page integer;
BEGIN
 IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id) THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 IF p_client_id IS NULL OR p_client_id='' OR p_client_id='web' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO grant_row FROM public.connection_grants WHERE id=p_grant_id FOR SHARE;
 IF NOT FOUND OR grant_row.status<>'active' OR grant_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'GRANT_REVOKED'; END IF;
 IF grant_row.user_id<>p_actor_id OR grant_row.client_id<>p_client_id OR NOT grant_row.permissions && ARRAY['draft:read','admin:manage','owner:manage']::text[] THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 1 AND 120 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 FOR item IN
  SELECT t.id,t.name,t.modular_state AS status,t.revision FROM public.tournaments t
  WHERE t.engine_version='modular_v1' AND strpos(lower(t.name),lower(btrim(p_query)))>0
   AND (t.created_by=p_actor_id OR (EXISTS(SELECT 1 FROM public.tournament_admins a WHERE a.tournament_id=t.id AND a.user_id=p_actor_id)
    AND grant_row.permissions && ARRAY['draft:read','admin:manage']::text[]))
  ORDER BY (lower(t.name)=lower(btrim(p_query))) DESC,lower(t.name),t.id LIMIT 21 OFFSET p_offset
 LOOP
  PERFORM tournament_builder_private.authorize(p_actor_id,p_client_id,item.id,'read','{}',p_grant_id);
  IF jsonb_array_length(matches)=20 THEN next_page:=p_offset+20; EXIT; END IF;
  matches:=matches||jsonb_build_array(to_jsonb(item));
 END LOOP;
 RETURN jsonb_build_object('tournaments',matches,'next_offset',next_page);
END $$;
REVOKE ALL ON FUNCTION public.tb_search_tournaments(uuid,text,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tb_search_tournaments(uuid,text,uuid,text,integer) TO service_role;
COMMIT;
