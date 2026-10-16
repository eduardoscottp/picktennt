-- Picktennt 1.1 — Play Sessions
-- Session registration is intentionally separate from tournament rounds and match history.

CREATE TABLE play_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title               TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  starts_at           TIMESTAMPTZ NOT NULL,
  duration_minutes    INTEGER NOT NULL CHECK (duration_minutes BETWEEN 30 AND 720),
  timezone            TEXT NOT NULL CHECK (char_length(trim(timezone)) BETWEEN 1 AND 80),
  court_count         INTEGER NOT NULL CHECK (court_count BETWEEN 1 AND 20),
  location_name       TEXT NOT NULL CHECK (char_length(trim(location_name)) BETWEEN 1 AND 160),
  location_address    TEXT NOT NULL CHECK (char_length(trim(location_address)) BETWEEN 1 AND 300),
  max_players         INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 128),
  format              TEXT NOT NULL CHECK (format IN ('random_player', 'by_partner')),
  description         TEXT,
  join_code           TEXT NOT NULL UNIQUE DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  registration_closed BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT play_sessions_partner_capacity CHECK (format <> 'by_partner' OR max_players % 2 = 0)
);

CREATE TABLE play_session_pairs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  pair_number INTEGER NOT NULL CHECK (pair_number >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, pair_number),
  UNIQUE (session_id, id)
);

CREATE TABLE play_session_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state          TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'left', 'removed')),
  rejoin_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  pair_id        UUID,
  seat_number    INTEGER CHECK (seat_number IN (1, 2)),
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at     TIMESTAMPTZ,
  removed_by     UUID REFERENCES profiles(id),
  UNIQUE (session_id, user_id),
  UNIQUE (pair_id, seat_number),
  CONSTRAINT play_session_member_pair_fk
    FOREIGN KEY (session_id, pair_id) REFERENCES play_session_pairs(session_id, id) ON DELETE RESTRICT,
  CONSTRAINT play_session_member_seat_shape CHECK (
    (pair_id IS NULL AND seat_number IS NULL) OR
    (pair_id IS NOT NULL AND seat_number IS NOT NULL)
  )
);

CREATE INDEX idx_play_sessions_creator_start ON play_sessions(created_by, starts_at);
CREATE INDEX idx_play_sessions_join_code ON play_sessions(join_code);
CREATE INDEX idx_play_session_members_user ON play_session_members(user_id, state);
CREATE INDEX idx_play_session_members_session ON play_session_members(session_id, state);
CREATE INDEX idx_play_session_pairs_session ON play_session_pairs(session_id, pair_number);

ALTER TABLE play_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_session_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE play_session_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_play_session_related(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM play_sessions s
    WHERE s.id = p_session_id AND (
      s.created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM play_session_members m
        WHERE m.session_id = p_session_id AND m.user_id = auth.uid()
      )
    )
  );
$$;

CREATE POLICY "play_sessions_read_related" ON play_sessions FOR SELECT USING (
  is_play_session_related(id)
);

CREATE POLICY "play_session_pairs_read_related" ON play_session_pairs FOR SELECT USING (
  is_play_session_related(session_id)
);

CREATE POLICY "play_session_members_read_related" ON play_session_members FOR SELECT USING (
  user_id = auth.uid() OR is_play_session_related(session_id)
);

CREATE OR REPLACE FUNCTION play_session_assert_open(p_session play_sessions)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_session.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
  IF p_session.registration_closed THEN RAISE EXCEPTION 'REGISTRATION_CLOSED'; END IF;
  IF now() >= p_session.starts_at THEN RAISE EXCEPTION 'SESSION_STARTED'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_create(
  p_title TEXT,
  p_starts_at TIMESTAMPTZ,
  p_duration_minutes INTEGER,
  p_timezone TEXT,
  p_court_count INTEGER,
  p_location_name TEXT,
  p_location_address TEXT,
  p_max_players INTEGER,
  p_format TEXT,
  p_description TEXT DEFAULT NULL,
  p_creator_is_playing BOOLEAN DEFAULT TRUE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_session play_sessions;
  v_first_pair UUID;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_starts_at <= now() THEN RAISE EXCEPTION 'START_MUST_BE_FUTURE'; END IF;
  IF p_format NOT IN ('random_player', 'by_partner') THEN RAISE EXCEPTION 'INVALID_FORMAT'; END IF;
  IF p_format = 'by_partner' AND p_max_players % 2 <> 0 THEN RAISE EXCEPTION 'PARTNER_CAPACITY_MUST_BE_EVEN'; END IF;

  INSERT INTO play_sessions (
    created_by, title, starts_at, duration_minutes, timezone, court_count,
    location_name, location_address, max_players, format, description
  ) VALUES (
    v_owner, trim(p_title), p_starts_at, p_duration_minutes, trim(p_timezone), p_court_count,
    trim(p_location_name), trim(p_location_address), p_max_players, p_format, nullif(trim(p_description), '')
  ) RETURNING * INTO v_session;

  IF p_format = 'by_partner' THEN
    INSERT INTO play_session_pairs(session_id, pair_number)
    SELECT v_session.id, n FROM generate_series(1, p_max_players / 2) n;
    SELECT id INTO v_first_pair FROM play_session_pairs
      WHERE session_id = v_session.id ORDER BY pair_number LIMIT 1;
  END IF;

  IF p_creator_is_playing THEN
    INSERT INTO play_session_members(session_id, user_id, pair_id, seat_number)
    VALUES (v_session.id, v_owner, v_first_pair, CASE WHEN v_first_pair IS NULL THEN NULL ELSE 1 END);
  END IF;

  RETURN v_session.id;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_join(
  p_session_id UUID,
  p_pair_id UUID DEFAULT NULL,
  p_seat_number INTEGER DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_session play_sessions;
  v_member play_session_members;
  v_member_id UUID;
  v_active_count INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  SELECT * INTO v_session FROM play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  PERFORM play_session_assert_open(v_session);

  SELECT * INTO v_member FROM play_session_members
    WHERE session_id = p_session_id AND user_id = v_user FOR UPDATE;
  IF FOUND AND v_member.state = 'active' THEN RETURN v_member.id; END IF;
  IF FOUND AND NOT v_member.rejoin_allowed THEN RAISE EXCEPTION 'REJOIN_BLOCKED'; END IF;

  SELECT count(*) INTO v_active_count FROM play_session_members
    WHERE session_id = p_session_id AND state = 'active';
  IF v_active_count >= v_session.max_players THEN RAISE EXCEPTION 'SESSION_FULL'; END IF;

  IF v_session.format = 'by_partner' THEN
    IF p_pair_id IS NULL OR p_seat_number IS NULL OR p_seat_number NOT IN (1, 2) THEN
      RAISE EXCEPTION 'PARTNER_SEAT_REQUIRED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM play_session_pairs WHERE id = p_pair_id AND session_id = p_session_id) THEN
      RAISE EXCEPTION 'INVALID_PARTNER_SEAT';
    END IF;
    IF EXISTS (SELECT 1 FROM play_session_members WHERE pair_id = p_pair_id AND seat_number = p_seat_number AND state = 'active') THEN
      RAISE EXCEPTION 'PARTNER_SEAT_TAKEN';
    END IF;
  ELSE
    p_pair_id := NULL;
    p_seat_number := NULL;
  END IF;

  INSERT INTO play_session_members(session_id, user_id, state, rejoin_allowed, pair_id, seat_number)
  VALUES (p_session_id, v_user, 'active', TRUE, p_pair_id, p_seat_number)
  ON CONFLICT (session_id, user_id) DO UPDATE SET
    state = 'active', rejoin_allowed = TRUE, pair_id = excluded.pair_id,
    seat_number = excluded.seat_number, removed_at = NULL, removed_by = NULL,
    joined_at = now(), updated_at = now()
  RETURNING id INTO v_member_id;
  RETURN v_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_update(
  p_session_id UUID,
  p_title TEXT,
  p_starts_at TIMESTAMPTZ,
  p_duration_minutes INTEGER,
  p_timezone TEXT,
  p_court_count INTEGER,
  p_location_name TEXT,
  p_location_address TEXT,
  p_max_players INTEGER,
  p_description TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session play_sessions;
  v_active_count INTEGER;
  v_highest_pair INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  SELECT * INTO v_session FROM play_sessions
    WHERE id = p_session_id AND created_by = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_session.cancelled_at IS NOT NULL OR now() >= v_session.starts_at THEN
    RAISE EXCEPTION 'SESSION_NOT_EDITABLE';
  END IF;
  IF p_starts_at <= now() THEN RAISE EXCEPTION 'START_MUST_BE_FUTURE'; END IF;
  IF v_session.format = 'by_partner' AND p_max_players % 2 <> 0 THEN
    RAISE EXCEPTION 'PARTNER_CAPACITY_MUST_BE_EVEN';
  END IF;
  SELECT count(*) INTO v_active_count FROM play_session_members
    WHERE session_id = p_session_id AND state = 'active';
  IF p_max_players < v_active_count THEN RAISE EXCEPTION 'CAPACITY_BELOW_ACTIVE_PLAYERS'; END IF;

  IF v_session.format = 'by_partner' THEN
    SELECT coalesce(max(p.pair_number), 0) INTO v_highest_pair
    FROM play_session_members m JOIN play_session_pairs p ON p.id = m.pair_id
    WHERE m.session_id = p_session_id AND m.state = 'active';
    IF p_max_players / 2 < v_highest_pair THEN RAISE EXCEPTION 'CAPACITY_REMOVES_OCCUPIED_PAIR'; END IF;

    DELETE FROM play_session_pairs
    WHERE session_id = p_session_id AND pair_number > p_max_players / 2;
    INSERT INTO play_session_pairs(session_id, pair_number)
    SELECT p_session_id, n FROM generate_series(1, p_max_players / 2) n
    ON CONFLICT (session_id, pair_number) DO NOTHING;
  END IF;

  UPDATE play_sessions SET
    title = trim(p_title), starts_at = p_starts_at, duration_minutes = p_duration_minutes,
    timezone = trim(p_timezone), court_count = p_court_count,
    location_name = trim(p_location_name), location_address = trim(p_location_address),
    max_players = p_max_players, description = nullif(trim(p_description), ''), updated_at = now()
  WHERE id = p_session_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_switch_seat(p_session_id UUID, p_pair_id UUID, p_seat_number INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_session play_sessions;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  SELECT * INTO v_session FROM play_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  PERFORM play_session_assert_open(v_session);
  IF v_session.format <> 'by_partner' THEN RAISE EXCEPTION 'NOT_PARTNER_FORMAT'; END IF;
  IF p_seat_number IS NULL OR p_seat_number NOT IN (1, 2) OR NOT EXISTS (
    SELECT 1 FROM play_session_pairs WHERE id = p_pair_id AND session_id = p_session_id
  ) THEN RAISE EXCEPTION 'INVALID_PARTNER_SEAT'; END IF;
  IF EXISTS (
    SELECT 1 FROM play_session_members
    WHERE pair_id = p_pair_id AND seat_number = p_seat_number AND state = 'active' AND user_id <> v_user
  ) THEN RAISE EXCEPTION 'PARTNER_SEAT_TAKEN'; END IF;

  UPDATE play_session_members SET pair_id = p_pair_id, seat_number = p_seat_number, updated_at = now()
  WHERE session_id = p_session_id AND user_id = v_user AND state = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_AN_ACTIVE_MEMBER'; END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_leave(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE play_session_members SET state = 'left', pair_id = NULL, seat_number = NULL, updated_at = now()
  WHERE session_id = p_session_id AND user_id = auth.uid() AND state = 'active';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_remove_member(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM play_sessions WHERE id = p_session_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_SESSION_ADMIN';
  END IF;
  UPDATE play_session_members SET
    state = 'removed', rejoin_allowed = FALSE, pair_id = NULL, seat_number = NULL,
    removed_at = now(), removed_by = auth.uid(), updated_at = now()
  WHERE session_id = p_session_id AND user_id = p_user_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_allow_rejoin(p_session_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM play_sessions WHERE id = p_session_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_SESSION_ADMIN';
  END IF;
  UPDATE play_session_members SET
    state = 'left', rejoin_allowed = TRUE, removed_at = NULL, removed_by = NULL, updated_at = now()
  WHERE session_id = p_session_id AND user_id = p_user_id AND state = 'removed';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_set_closed(p_session_id UUID, p_closed BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE play_sessions SET registration_closed = p_closed, updated_at = now()
  WHERE id = p_session_id AND created_by = auth.uid() AND cancelled_at IS NULL AND starts_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_EDITABLE'; END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_cancel(p_session_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE play_sessions SET cancelled_at = coalesce(cancelled_at, now()), registration_closed = TRUE, updated_at = now()
  WHERE id = p_session_id AND created_by = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_SESSION_ADMIN'; END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION play_session_public_invitation(p_code TEXT)
RETURNS TABLE (
  id UUID, title TEXT, starts_at TIMESTAMPTZ, duration_minutes INTEGER, timezone TEXT,
  court_count INTEGER, location_name TEXT, location_address TEXT, max_players INTEGER,
  format TEXT, description TEXT, join_code TEXT, registration_closed BOOLEAN,
  cancelled_at TIMESTAMPTZ, organizer_name TEXT, active_players BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.title, s.starts_at, s.duration_minutes, s.timezone, s.court_count,
         s.location_name, s.location_address, s.max_players, s.format, s.description,
         s.join_code, s.registration_closed, s.cancelled_at,
         trim(concat_ws(' ', p.first_name, p.last_name)) AS organizer_name,
         (SELECT count(*) FROM play_session_members m WHERE m.session_id = s.id AND m.state = 'active')
  FROM play_sessions s JOIN profiles p ON p.id = s.created_by
  WHERE s.join_code = upper(trim(p_code))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION play_session_invitation_detail(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session play_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_session FROM play_sessions WHERE join_code = upper(trim(p_code));
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  RETURN jsonb_build_object(
    'session', to_jsonb(v_session),
    'pairs', coalesce((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.pair_number)
      FROM play_session_pairs p WHERE p.session_id = v_session.id
    ), '[]'::jsonb),
    'members', coalesce((
      SELECT jsonb_agg(
        to_jsonb(m) || jsonb_build_object('profile', jsonb_build_object(
          'id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name, 'avatar_url', pr.avatar_url
        )) ORDER BY m.joined_at
      )
      FROM play_session_members m JOIN profiles pr ON pr.id = m.user_id
      WHERE m.session_id = v_session.id AND m.state = 'active'
    ), '[]'::jsonb)
  );
END;
$$;

CREATE TRIGGER play_sessions_updated_at BEFORE UPDATE ON play_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT ON play_sessions, play_session_pairs, play_session_members TO authenticated;

REVOKE EXECUTE ON FUNCTION play_session_create(TEXT, TIMESTAMPTZ, INTEGER, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_join(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_update(UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_switch_seat(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_leave(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_remove_member(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_allow_rejoin(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_set_closed(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_cancel(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_public_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION play_session_invitation_detail(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION play_session_create(TEXT, TIMESTAMPTZ, INTEGER, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_join(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_update(UUID, TEXT, TIMESTAMPTZ, INTEGER, TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_switch_seat(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_leave(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_remove_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_allow_rejoin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_set_closed(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_cancel(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION play_session_public_invitation(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION play_session_invitation_detail(TEXT) TO authenticated;
