BEGIN;
DO $migration$
DECLARE source text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid)'::regprocedure) INTO source;
 anchor:=$old$ PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids','admin_change']);$old$;
 IF (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'COMPLETE_ROSTER_GUARD_SOURCE_MISMATCH'; END IF;
 source:=replace(source,anchor,$new$ IF (p_command IN ('startMatch','submitScore','confirmScore') OR (p_command IN ('attestScore','adjudicateDispute') AND coalesce(p_request->>'outcome_kind','played')='played')) AND EXISTS (
  SELECT 1 FROM public.matches m JOIN public.teams t ON t.id IN (m.team_a_id,m.team_b_id) AND t.tournament_id=p_tournament_id
  CROSS JOIN LATERAL (SELECT count(*) AS total,count(DISTINCT nullif(roster.id,'')) AS distinct_total FROM (
   SELECT tm.user_id::text AS id FROM public.team_members tm WHERE tm.team_id=t.id AND tm.tournament_id=p_tournament_id AND tm.membership_status='active'
   UNION ALL SELECT guest->>'id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.guest_players)='array' THEN t.guest_players ELSE '[]'::jsonb END) guest
  ) roster) players
  WHERE m.id=(p_request->>'match_id')::uuid AND m.tournament_id=p_tournament_id AND
   NOT coalesce((m.status IN ('score_entered','disputed') AND m.outcome_kind='played'
    AND (p_command='confirmScore' OR (p_command IN ('attestScore','adjudicateDispute') AND m.score_a::text=p_request->>'score_a' AND m.score_b::text=p_request->>'score_b'))
    AND m.player_a1_id IS NOT NULL AND m.player_b1_id IS NOT NULL
    AND CASE WHEN event_row.type='singles' THEN m.player_a2_id IS NULL AND m.player_b2_id IS NULL
             WHEN event_row.type='doubles' THEN m.player_a2_id IS NOT NULL AND m.player_b2_id IS NOT NULL AND m.player_a1_id<>m.player_a2_id AND m.player_b1_id<>m.player_b2_id ELSE false END), false) AND
   (players.total <> CASE WHEN event_row.type='singles' THEN 1 WHEN event_row.type='doubles' THEN 2 ELSE -1 END OR
    players.distinct_total <> CASE WHEN event_row.type='singles' THEN 1 WHEN event_row.type='doubles' THEN 2 ELSE -1 END)
 ) THEN RAISE EXCEPTION 'INCOMPLETE_ROSTER'; END IF;
$new$||anchor);
 EXECUTE source;
END $migration$;
COMMIT;
