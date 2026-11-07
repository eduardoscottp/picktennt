BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_get_snapshot(uuid,text,uuid,uuid)'::regprocedure) INTO source;
 anchor:=$old$data:=jsonb_set(data,'{team_members}',$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'MATCH_PLAYER_NAMES_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$data:=jsonb_set(data,'{matches}',coalesce((SELECT jsonb_agg(item.value||jsonb_build_object(
  'player_a1_name',CASE WHEN item.value->>'player_a1_id' IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',a1.first_name,a1.last_name)),''),a1.username,'Player') END,
  'player_a2_name',CASE WHEN item.value->>'player_a2_id' IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',a2.first_name,a2.last_name)),''),a2.username,'Player') END,
  'player_b1_name',CASE WHEN item.value->>'player_b1_id' IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',b1.first_name,b1.last_name)),''),b1.username,'Player') END,
  'player_b2_name',CASE WHEN item.value->>'player_b2_id' IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',b2.first_name,b2.last_name)),''),b2.username,'Player') END
 ) ORDER BY item.ordinality) FROM jsonb_array_elements(data->'matches') WITH ORDINALITY AS item(value,ordinality)
 LEFT JOIN public.profiles a1 ON a1.id=(item.value->>'player_a1_id')::uuid LEFT JOIN public.profiles a2 ON a2.id=(item.value->>'player_a2_id')::uuid
 LEFT JOIN public.profiles b1 ON b1.id=(item.value->>'player_b1_id')::uuid LEFT JOIN public.profiles b2 ON b2.id=(item.value->>'player_b2_id')::uuid),'[]'::jsonb));
  data:=jsonb_set(data,'{team_members}',$new$);
 EXECUTE source;
END $migration$;
COMMIT;
