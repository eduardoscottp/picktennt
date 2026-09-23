-- Session Games 1.1 (27). Apply after 011_play_sessions.sql.
BEGIN;
CREATE TABLE play_session_games (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES play_sessions(id),
  session_title text NOT NULL,
  organizer_id uuid NOT NULL REFERENCES profiles(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  participants jsonb NOT NULL CHECK(jsonb_typeof(participants) = 'array'),
  match_type text NOT NULL CHECK(match_type IN ('SINGLES','DOUBLES')),
  scoring_system text NOT NULL CHECK(scoring_system IN ('SIDE_OUT','RALLY')),
  target_score integer NOT NULL CHECK(target_score BETWEEN 1 AND 99),
  win_by_two boolean NOT NULL,
  court_number integer,
  scorer_id uuid REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'invited' CHECK(status IN ('unassigned','invited','ready','in_progress','pending','disputed','confirmed','unfinished','cancelled')),
  revision integer NOT NULL DEFAULT 1,
  assignment_revision integer NOT NULL DEFAULT 1,
  score_a integer,
  score_b integer,
  submitted_by uuid REFERENCES profiles(id),
  confirmed_by uuid REFERENCES profiles(id),
  source text CHECK(source IN ('manual','watch')),
  played_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX play_session_games_session ON play_session_games(session_id, created_at DESC);
CREATE INDEX play_session_games_participants ON play_session_games USING gin(participants);
CREATE TABLE play_session_game_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES profiles(id),
  game_id uuid NOT NULL REFERENCES play_session_games(id),
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE play_session_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_session_game_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_games_read ON play_session_games FOR SELECT TO authenticated USING (
  organizer_id = auth.uid() OR
  participants @> jsonb_build_array(jsonb_build_object('userId', auth.uid()::text)) OR
  EXISTS (SELECT 1 FROM play_session_members m WHERE m.session_id = play_session_games.session_id AND m.user_id = auth.uid() AND m.state = 'active')
);
CREATE POLICY session_game_audit_read ON play_session_game_operations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM play_session_games g WHERE g.id = game_id)
);
GRANT SELECT ON play_session_games, play_session_game_operations TO authenticated;

CREATE FUNCTION session_game_mutate(p_operation text, p_game_id uuid, p_revision integer, p_operation_id uuid, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid(); g play_session_games; s play_sessions;
  previous play_session_game_operations; request_body jsonb;
  ids uuid[]; lineup jsonb; participant boolean; organizer boolean;
  scorer uuid; actor_team integer; submitter_team integer; sa integer; sb integer;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to manage session games.'; END IF;
  IF p_operation_id IS NULL OR p_game_id IS NULL OR p_operation IS NULL OR p_data IS NULL THEN RAISE EXCEPTION 'Invalid game request.'; END IF;
  IF jsonb_typeof(p_data) <> 'object' OR
     p_data - ARRAY['sessionId','playerIds','matchType','scoringSystem','targetScore','winByTwo','courtNumber','scorerId','source','scoreA','scoreB','assignmentRevision','unfinished'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Unsupported game fields. Private health data must not be submitted.';
  END IF;
  -- Serialize both repeated operations and concurrent mutations of the same game.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  request_body := jsonb_build_object('operation',p_operation,'gameId',p_game_id,'revision',p_revision,'data',p_data);
  SELECT * INTO previous FROM play_session_game_operations WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF previous.actor_id <> actor OR previous.request <> request_body THEN RAISE EXCEPTION 'Operation ID already used.'; END IF;
    RETURN previous.result;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_game_id::text, 1));
  IF p_operation = 'create' THEN
    SELECT * INTO s FROM play_sessions WHERE id = (p_data->>'sessionId')::uuid FOR UPDATE;
    IF NOT FOUND OR s.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Session unavailable.'; END IF;
    SELECT array_agg(value::uuid ORDER BY ordinality) INTO ids FROM jsonb_array_elements_text(p_data->'playerIds') WITH ORDINALITY;
    IF coalesce(array_length(ids,1),0) <> (CASE WHEN p_data->>'matchType' = 'SINGLES' THEN 2 ELSE 4 END)
      OR (SELECT count(DISTINCT v) FROM unnest(ids) v) <> array_length(ids,1) THEN RAISE EXCEPTION 'Choose distinct players for both teams.'; END IF;
    IF s.created_by <> actor AND (NOT actor = ANY(ids) OR NOT EXISTS(SELECT 1 FROM play_session_members WHERE session_id=s.id AND user_id=actor AND state='active')) THEN RAISE EXCEPTION 'You must play in this game.'; END IF;
    IF (SELECT count(*) FROM play_session_members WHERE session_id=s.id AND user_id=ANY(ids) AND state='active') <> array_length(ids,1) THEN RAISE EXCEPTION 'The roster changed. Refresh and choose active players.'; END IF;
    IF (p_data->>'courtNumber')::integer IS NOT NULL AND (p_data->>'courtNumber')::integer NOT BETWEEN 1 AND s.court_count THEN RAISE EXCEPTION 'Choose a court in this session.'; END IF;
    scorer := (p_data->>'scorerId')::uuid;
    IF scorer IS NOT NULL AND NOT scorer=ANY(ids) THEN RAISE EXCEPTION 'The scorer must be a participant.'; END IF;
    SELECT jsonb_agg(jsonb_build_object('userId',p.id::text,'label',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),'Picktennt player'), 'team',CASE WHEN a.ordinality <= array_length(ids,1)/2 THEN 0 ELSE 1 END,'slot',a.ordinality-1) ORDER BY a.ordinality)
      INTO lineup FROM unnest(ids) WITH ORDINALITY a(id,ordinality) JOIN profiles p ON p.id=a.id;
    INSERT INTO play_session_games(id,session_id,session_title,organizer_id,created_by,participants,match_type,scoring_system,target_score,win_by_two,court_number,scorer_id,status)
      VALUES(p_game_id,s.id,s.title,s.created_by,actor,lineup,p_data->>'matchType',p_data->>'scoringSystem',(p_data->>'targetScore')::integer,(p_data->>'winByTwo')::boolean,(p_data->>'courtNumber')::integer,scorer,CASE WHEN scorer IS NULL THEN 'unassigned' ELSE 'invited' END) RETURNING * INTO g;
  ELSE
    SELECT * INTO g FROM play_session_games WHERE id=p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.'; END IF;
    participant := g.participants @> jsonb_build_array(jsonb_build_object('userId',actor::text));
    organizer := actor = g.organizer_id;
    IF NOT participant AND NOT organizer AND actor <> g.created_by THEN RAISE EXCEPTION 'You cannot change this game.'; END IF;
    IF p_revision IS DISTINCT FROM g.revision THEN RAISE EXCEPTION 'This game changed. Refresh before trying again.'; END IF;
    IF g.status = 'cancelled' THEN RAISE EXCEPTION 'Game cancelled.'; END IF;
    IF p_operation IN ('assign','accept','start') THEN
      SELECT * INTO s FROM play_sessions WHERE id=g.session_id FOR UPDATE;
      IF s.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Session cancelled.'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(g.participants) p WHERE NOT EXISTS(SELECT 1 FROM play_session_members m WHERE m.session_id=g.session_id AND m.user_id=(p->>'userId')::uuid AND m.state='active')) THEN RAISE EXCEPTION 'A selected player is no longer active. Cancel and create a new game.'; END IF;
    END IF;
    CASE p_operation
    WHEN 'assign' THEN
      IF NOT (organizer OR actor=g.created_by) OR g.status NOT IN ('unassigned','invited') THEN RAISE EXCEPTION 'Cannot reassign this game.'; END IF;
      scorer := (p_data->>'scorerId')::uuid;
      IF scorer IS NULL OR NOT g.participants @> jsonb_build_array(jsonb_build_object('userId',scorer::text)) THEN RAISE EXCEPTION 'Choose a participating scorer.'; END IF;
      g.scorer_id:=scorer; g.status:='invited'; g.assignment_revision:=g.assignment_revision+1;
    WHEN 'accept' THEN
      IF actor IS DISTINCT FROM g.scorer_id OR g.status<>'invited' THEN RAISE EXCEPTION 'This invitation is no longer available.'; END IF;
      g.status:='ready';
    WHEN 'decline' THEN
      IF actor IS DISTINCT FROM g.scorer_id OR g.status<>'invited' THEN RAISE EXCEPTION 'This invitation is no longer available.'; END IF;
      g.scorer_id:=NULL; g.status:='unassigned'; g.assignment_revision:=g.assignment_revision+1;
    WHEN 'start' THEN
      IF actor IS DISTINCT FROM g.scorer_id OR g.status<>'ready' THEN RAISE EXCEPTION 'Accept the invitation before preparing the Watch.'; END IF;
      -- A prepared game is locked against reassignment so it can safely start offline.
      g.status:='in_progress'; g.played_at:=now();
    WHEN 'submit' THEN
      IF NOT (participant OR organizer) THEN RAISE EXCEPTION 'Only participants or the organizer can submit.'; END IF;
      IF g.status='confirmed' AND NOT organizer THEN RAISE EXCEPTION 'Ask the organizer to correct a confirmed result.'; END IF;
      IF p_data->>'source'='watch' THEN
        IF actor IS DISTINCT FROM g.scorer_id OR g.status<>'in_progress' OR (p_data->>'assignmentRevision')::integer IS DISTINCT FROM g.assignment_revision THEN RAISE EXCEPTION 'This Watch assignment is no longer valid.'; END IF;
      ELSIF p_data->>'source'='manual' THEN
        IF g.status='in_progress' THEN RAISE EXCEPTION 'The Watch is scoring this game. Cancel it before replacing it.'; END IF;
      ELSE RAISE EXCEPTION 'Choose a result source.';
      END IF;
      sa:=(p_data->>'scoreA')::integer; sb:=(p_data->>'scoreB')::integer;
      IF sa IS NULL OR sb IS NULL OR least(sa,sb)<0 OR greatest(sa,sb)>10000 THEN RAISE EXCEPTION 'Enter valid nonnegative scores.'; END IF;
      IF p_data->>'source'='watch' AND coalesce((p_data->>'unfinished')::boolean,false) THEN
        g.status:='unfinished';
      ELSE
        IF sa=sb OR greatest(sa,sb)<g.target_score OR
          (g.win_by_two AND (abs(sa-sb)<2 OR (greatest(sa,sb)>g.target_score AND abs(sa-sb)<>2))) OR
          (NOT g.win_by_two AND greatest(sa,sb)<>g.target_score) THEN RAISE EXCEPTION 'The final score does not match the selected game rules.'; END IF;
        g.status:='pending';
      END IF;
      g.score_a:=sa; g.score_b:=sb; g.submitted_by:=actor; g.confirmed_by:=NULL; g.source:=p_data->>'source';
    WHEN 'confirm' THEN
      SELECT (p->>'team')::integer INTO actor_team FROM jsonb_array_elements(g.participants) p WHERE p->>'userId'=actor::text;
      SELECT (p->>'team')::integer INTO submitter_team FROM jsonb_array_elements(g.participants) p WHERE p->>'userId'=g.submitted_by::text;
      IF g.status NOT IN ('pending','disputed') OR NOT coalesce(organizer OR (g.status='pending' AND participant AND actor_team<>submitter_team),false) THEN RAISE EXCEPTION 'An opponent or the organizer must confirm this score.'; END IF;
      g.status:='confirmed'; g.confirmed_by:=actor;
    WHEN 'dispute' THEN
      IF NOT participant OR g.status<>'pending' THEN RAISE EXCEPTION 'Only participants can dispute a pending result.'; END IF;
      g.status:='disputed'; g.confirmed_by:=NULL;
    WHEN 'cancel' THEN
      IF NOT (organizer OR (actor=g.created_by AND g.status IN ('invited','unassigned','ready'))) THEN RAISE EXCEPTION 'Ask the organizer to cancel this game.'; END IF;
      g.status:='cancelled'; g.assignment_revision:=g.assignment_revision+1; g.confirmed_by:=NULL;
    ELSE RAISE EXCEPTION 'Unknown game operation.';
    END CASE;
    g.revision:=g.revision+1; g.updated_at:=now();
    UPDATE play_session_games SET scorer_id=g.scorer_id,status=g.status,revision=g.revision,assignment_revision=g.assignment_revision,score_a=g.score_a,score_b=g.score_b,submitted_by=g.submitted_by,confirmed_by=g.confirmed_by,source=g.source,played_at=g.played_at,updated_at=g.updated_at WHERE id=g.id;
  END IF;
  INSERT INTO play_session_game_operations(operation_id,actor_id,game_id,request,result) VALUES(p_operation_id,actor,g.id,request_body,to_jsonb(g));
  RETURN to_jsonb(g);
END;
$$;
REVOKE ALL ON FUNCTION session_game_mutate(text,uuid,integer,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_game_mutate(text,uuid,integer,uuid,jsonb) TO authenticated;
COMMIT;

-- Expose only the public roster fields. Direct profiles joins are intentionally
-- restricted by the production profile privacy policy.
CREATE FUNCTION play_session_detail(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s play_sessions;
BEGIN
  IF auth.uid() IS NULL OR NOT is_play_session_related(p_session_id) THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;
  SELECT * INTO s FROM play_sessions WHERE id=p_session_id;
  RETURN jsonb_build_object(
    'session',to_jsonb(s),
    'pairs',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.pair_number) FROM play_session_pairs p WHERE p.session_id=s.id),'[]'::jsonb),
    'members',coalesce((SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('profile',jsonb_build_object('id',p.id,'first_name',p.first_name,'last_name',p.last_name,'avatar_url',p.avatar_url)) ORDER BY m.joined_at) FROM play_session_members m JOIN profiles p ON p.id=m.user_id WHERE m.session_id=s.id),'[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION play_session_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION play_session_detail(uuid) TO authenticated;
