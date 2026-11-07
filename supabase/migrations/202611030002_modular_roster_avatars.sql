-- Add avatars only after the web snapshot's existing row-visibility filters.
-- Internal audit snapshots and MCP projections do not gain profile fields.
BEGIN;
DO $patch$
DECLARE source text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.tb_get_snapshot(uuid,text,uuid,uuid)'::regprocedure) INTO source;
 marker:=$old$ RETURN data||jsonb_build_object('caller_role',caller_role);$old$;
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'AVATAR_SNAPSHOT_SOURCE_MISMATCH'; END IF;
 source:=replace(source,marker,$new$ IF p_client_id='web' THEN
  data:=jsonb_set(data,'{team_members}',coalesce((SELECT jsonb_agg(item.value||jsonb_build_object('avatar_url',profile.avatar_url) ORDER BY item.ordinality) FROM jsonb_array_elements(data->'team_members') WITH ORDINALITY AS item(value,ordinality) JOIN public.profiles profile ON profile.id=(item.value->>'user_id')::uuid),'[]'::jsonb));
  data:=jsonb_set(data,'{tournament_players}',coalesce((SELECT jsonb_agg(item.value||jsonb_build_object('avatar_url',profile.avatar_url) ORDER BY item.ordinality) FROM jsonb_array_elements(data->'tournament_players') WITH ORDINALITY AS item(value,ordinality) JOIN public.profiles profile ON profile.id=(item.value->>'user_id')::uuid),'[]'::jsonb));
 END IF;
$new$||marker);
 EXECUTE source;
END $patch$;
COMMIT;
