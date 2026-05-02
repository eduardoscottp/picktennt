-- =============================================================
-- PICKTENNT — Dummy Data: Singles Tournament with 14 Players
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================

DO $$
DECLARE
  -- Real user IDs (looked up from profiles by email)
  eduardo_id  UUID;
  es_id       UUID;

  -- Tournament + round IDs
  tid UUID := gen_random_uuid();
  rid UUID := gen_random_uuid();

  -- 12 dummy player UUIDs
  d UUID[] := ARRAY[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
  ];

  -- Dummy player names
  fn TEXT[] := ARRAY['James','Maria','Chris','Ashley','Tyler','Samantha','Jordan','Emily','Marcus','Olivia','Derek','Jessica'];
  ln TEXT[] := ARRAY['Carter','Lopez','Williams','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas','Jackson'];

  -- All 14 player IDs (slot 1=eduardo, 2=es, 3-14=dummies)
  p UUID[];

  -- 14 team IDs (one per player for singles)
  t UUID[] := ARRAY[
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid()
  ];

  i       INT;
  pname   TEXT;
  ls      INT;     -- loser score (random 0–9)
  win_a   BOOLEAN; -- whether team A wins

BEGIN

  -- --------------------------------------------------------
  -- 1. Look up real users
  -- --------------------------------------------------------
  SELECT id INTO eduardo_id FROM profiles WHERE email = 'eduardodscott@gmail.com' LIMIT 1;
  SELECT id INTO es_id       FROM profiles WHERE email = 'es@idddeas.com'          LIMIT 1;

  IF eduardo_id IS NULL THEN
    RAISE EXCEPTION 'eduardodscott@gmail.com not found in profiles. Make sure this user has signed in at least once.';
  END IF;
  IF es_id IS NULL THEN
    RAISE EXCEPTION 'es@idddeas.com not found in profiles. Make sure this user has signed in at least once.';
  END IF;

  -- Build full 14-player array
  p := ARRAY[eduardo_id, es_id] || d;

  -- --------------------------------------------------------
  -- 2. Create 12 dummy users in auth.users
  -- --------------------------------------------------------
  FOR i IN 1..12 LOOP
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      d[i],
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(fn[i]) || '.' || lower(ln[i]) || '@picktennt.test',
      crypt('DummyPass123!', gen_salt('bf')),
      NOW(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('given_name', fn[i], 'family_name', ln[i]),
      NOW(),
      NOW()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- --------------------------------------------------------
  -- 3. Upsert profiles for dummy players
  --    (trigger may have already created them; force correct names)
  -- --------------------------------------------------------
  FOR i IN 1..12 LOOP
    INSERT INTO profiles (id, email, first_name, last_name)
    VALUES (
      d[i],
      lower(fn[i]) || '.' || lower(ln[i]) || '@picktennt.test',
      fn[i],
      ln[i]
    )
    ON CONFLICT (id) DO UPDATE
      SET first_name = EXCLUDED.first_name,
          last_name  = EXCLUDED.last_name;
  END LOOP;

  -- --------------------------------------------------------
  -- 4. Create the tournament
  --    The on_tournament_created trigger auto-adds eduardo as admin #1
  -- --------------------------------------------------------
  INSERT INTO tournaments (
    id, name, created_by,
    court_count, max_players, type,
    second_round_format, finals_format, finals_trigger,
    is_public, status
  ) VALUES (
    tid,
    'Summer Slam Singles 2026',
    eduardo_id,
    7, 14, 'singles',
    'none', 'top4', 'after_round_robin',
    true, 'active'
  );

  -- Add es as admin #2
  INSERT INTO tournament_admins (tournament_id, user_id, succession_order, granted_by)
  VALUES (tid, es_id, 2, eduardo_id)
  ON CONFLICT DO NOTHING;

  -- --------------------------------------------------------
  -- 5. Add all 14 players as approved
  -- --------------------------------------------------------
  FOR i IN 1..14 LOOP
    INSERT INTO tournament_players (tournament_id, user_id, status, joined_via)
    VALUES (tid, p[i], 'approved', 'invite')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- --------------------------------------------------------
  -- 6. Create one team per player (singles = 1 player per team)
  -- --------------------------------------------------------
  FOR i IN 1..14 LOOP
    SELECT first_name || ' ' || last_name INTO pname
    FROM profiles WHERE id = p[i];

    INSERT INTO teams (id, tournament_id, name, seed)
    VALUES (t[i], tid, pname, i);

    INSERT INTO team_members (team_id, user_id)
    VALUES (t[i], p[i]);
  END LOOP;

  -- --------------------------------------------------------
  -- 7. Create Round 1 (round robin, completed)
  -- --------------------------------------------------------
  INSERT INTO rounds (id, tournament_id, round_number, round_type, status)
  VALUES (rid, tid, 1, 'round_robin', 'completed');

  -- --------------------------------------------------------
  -- 8. Create 7 matches  (1v2, 3v4, 5v6, 7v8, 9v10, 11v12, 13v14)
  --    Winner always scores 11; loser gets a random 0–9
  -- --------------------------------------------------------
  FOR i IN 0..6 LOOP
    win_a := (random() > 0.5);
    ls    := floor(random() * 10)::INT;

    INSERT INTO matches (
      tournament_id, round_id, court_number,
      team_a_id,   team_b_id,
      score_a, score_b,
      status, entered_by, validated_by
    ) VALUES (
      tid, rid, i + 1,
      t[i * 2 + 1], t[i * 2 + 2],
      CASE WHEN win_a THEN 11 ELSE ls END,
      CASE WHEN win_a THEN ls ELSE 11 END,
      'validated',
      eduardo_id, es_id
    );
  END LOOP;

  -- --------------------------------------------------------
  -- 9. Compute and store standings from the validated matches
  -- --------------------------------------------------------
  INSERT INTO standings (
    tournament_id, round_id, team_id,
    wins, losses, points_for, points_against, rank
  )
  SELECT
    tid, rid,
    team_id,
    SUM(CASE WHEN score_for > score_against THEN 1 ELSE 0 END)::INT,
    SUM(CASE WHEN score_for < score_against THEN 1 ELSE 0 END)::INT,
    SUM(score_for)::INT,
    SUM(score_against)::INT,
    ROW_NUMBER() OVER (
      ORDER BY
        SUM(CASE WHEN score_for > score_against THEN 1 ELSE 0 END) DESC,
        SUM(score_against) ASC
    )::INT
  FROM (
    SELECT team_a_id AS team_id, score_a AS score_for, score_b AS score_against
    FROM matches WHERE round_id = rid
    UNION ALL
    SELECT team_b_id AS team_id, score_b AS score_for, score_a AS score_against
    FROM matches WHERE round_id = rid
  ) sub
  GROUP BY team_id
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '=== Done! ===';
  RAISE NOTICE 'Tournament: Summer Slam Singles 2026';
  RAISE NOTICE 'Tournament ID: %', tid;
  RAISE NOTICE 'Players: 14 (eduardo + es + 12 dummies)';
  RAISE NOTICE 'Round 1: 7 matches, all validated with scores';
  RAISE NOTICE 'Standings computed and stored.';
  RAISE NOTICE '';
  RAISE NOTICE 'View at: https://picktennt-bw9r.vercel.app/tournaments/%', tid;

END;
$$;
