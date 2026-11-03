-- Local-only until explicitly reviewed and deployed. Defaults preserve all legacy events.
BEGIN;
CREATE SCHEMA tournament_builder_private;
REVOKE ALL ON SCHEMA tournament_builder_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE tournament_builder_private.command_context(transaction_id bigint NOT NULL,event_id uuid NOT NULL,PRIMARY KEY(transaction_id,event_id));
REVOKE ALL ON tournament_builder_private.command_context FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.tournaments
 ADD engine_version text NOT NULL DEFAULT 'legacy' CHECK(engine_version IN ('legacy','modular_v1')),
 ADD modular_state text CHECK(modular_state IN ('draft','registration_open','registration_closed','ready','active','completed','cancelled')),
 ADD revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), ADD definition_id uuid,
 ADD roster_revision bigint NOT NULL DEFAULT 0, ADD timezone text, ADD registration_closed_at timestamptz,
 ADD result_version integer NOT NULL DEFAULT 0, ADD results_under_review boolean NOT NULL DEFAULT false,
 ADD completed_at timestamptz, ADD cancelled_at timestamptz;
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_status_check;
ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_status_check CHECK(status IN ('draft','registration','active','finals','completed','cancelled'));
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_name_key;
CREATE UNIQUE INDEX tournaments_legacy_name_key ON public.tournaments(name) WHERE engine_version='legacy';
ALTER TABLE public.teams ADD entry_state text NOT NULL DEFAULT 'legacy' CHECK(entry_state IN ('legacy','pending','approved','withdrawn','rejected','cancelled')),
 ADD eligibility_version integer NOT NULL DEFAULT 0, ADD withdrawn_at timestamptz, ADD withdrawal_reason text, ADD UNIQUE(id,tournament_id);
ALTER TABLE public.team_members ADD tournament_id uuid REFERENCES public.tournaments(id), ADD consented_definition_id uuid,
 ADD consented_at timestamptz, ADD membership_status text NOT NULL DEFAULT 'legacy' CHECK(membership_status IN ('legacy','pending','active','withdrawn','cancelled'));
ALTER TABLE public.team_members ADD FOREIGN KEY(team_id,tournament_id) REFERENCES public.teams(id,tournament_id);
CREATE UNIQUE INDEX tb_one_active_entry_per_player ON public.team_members(tournament_id,user_id) WHERE membership_status='active';
ALTER TABLE public.rounds ADD stage_id uuid, ADD schedule_generation integer NOT NULL DEFAULT 0,
 ADD logical_wave integer, ADD is_current boolean NOT NULL DEFAULT true, ADD UNIQUE(id,tournament_id);
ALTER TABLE public.matches ADD stage_id uuid, ADD logical_key text, ADD schedule_generation integer NOT NULL DEFAULT 0,
 ADD is_current boolean NOT NULL DEFAULT true, ADD revision bigint NOT NULL DEFAULT 0,
 ADD outcome_kind text CHECK(outcome_kind IN ('played','retirement','walkover','no_contest')),
 ADD winner_team_id uuid, ADD submitted_entry_id uuid, ADD result_revision bigint NOT NULL DEFAULT 0,
 ADD started_at timestamptz, ADD ended_at timestamptz, ADD voided_at timestamptz, ADD excluded_at timestamptz;
ALTER TABLE public.matches ADD FOREIGN KEY(round_id,tournament_id) REFERENCES public.rounds(id,tournament_id),
 ADD FOREIGN KEY(team_a_id,tournament_id) REFERENCES public.teams(id,tournament_id),
 ADD FOREIGN KEY(team_b_id,tournament_id) REFERENCES public.teams(id,tournament_id),
 ADD FOREIGN KEY(winner_team_id,tournament_id) REFERENCES public.teams(id,tournament_id),
 ADD FOREIGN KEY(submitted_entry_id,tournament_id) REFERENCES public.teams(id,tournament_id),
 ADD CHECK(winner_team_id IS NULL OR winner_team_id IN (team_a_id,team_b_id)),
 ADD CHECK(outcome_kind IS DISTINCT FROM 'no_contest' OR winner_team_id IS NULL);
ALTER TABLE public.standings ADD stage_id uuid, ADD input_revision bigint NOT NULL DEFAULT 0,
 ADD eligible boolean NOT NULL DEFAULT true, ADD tie_group text,
 ADD FOREIGN KEY(round_id,tournament_id) REFERENCES public.rounds(id,tournament_id),
 ADD FOREIGN KEY(team_id,tournament_id) REFERENCES public.teams(id,tournament_id);

CREATE TABLE public.tournament_definitions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 schema_version integer NOT NULL DEFAULT 1, revision bigint NOT NULL, definition jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('draft','published')), canonical_hash text,
 created_by uuid NOT NULL REFERENCES public.profiles(id), approved_by uuid REFERENCES public.profiles(id), approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,tournament_id));
ALTER TABLE public.tournaments ADD FOREIGN KEY(definition_id,id) REFERENCES public.tournament_definitions(id,tournament_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.team_members ADD FOREIGN KEY(consented_definition_id,tournament_id) REFERENCES public.tournament_definitions(id,tournament_id);
CREATE TABLE public.tournament_stages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL REFERENCES public.tournaments(id), definition_id uuid NOT NULL,
 node_id text NOT NULL, module_id text NOT NULL, module_version integer NOT NULL,
 state text NOT NULL DEFAULT 'pending', input_revision bigint NOT NULL DEFAULT 0, output_revision bigint NOT NULL DEFAULT 0,
 output jsonb NOT NULL DEFAULT '{}', blocked_code text, UNIQUE(id,tournament_id), UNIQUE(tournament_id,definition_id,node_id),
 FOREIGN KEY(definition_id,tournament_id) REFERENCES public.tournament_definitions(id,tournament_id));
ALTER TABLE public.rounds ADD FOREIGN KEY(stage_id,tournament_id) REFERENCES public.tournament_stages(id,tournament_id);
ALTER TABLE public.matches ADD FOREIGN KEY(stage_id,tournament_id) REFERENCES public.tournament_stages(id,tournament_id);
ALTER TABLE public.standings ADD FOREIGN KEY(stage_id,tournament_id) REFERENCES public.tournament_stages(id,tournament_id);
CREATE UNIQUE INDEX tb_current_fixture_identity ON public.matches(tournament_id,stage_id,schedule_generation,logical_key) WHERE is_current AND logical_key IS NOT NULL;
CREATE UNIQUE INDEX tb_one_live_match_per_court ON public.matches(tournament_id,court_number) WHERE stage_id IS NOT NULL AND status='in_progress' AND is_current AND voided_at IS NULL;
CREATE TABLE public.connection_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id), provider text NOT NULL,
 client_id text NOT NULL CHECK(client_id<>'web'), permissions text[] NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 CHECK(permissions <@ ARRAY['draft:create','draft:read','draft:update','operation:read']::text[]));
CREATE TABLE public.tournament_operations(
 operation_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES public.profiles(id), client_id text NOT NULL,
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id), command text NOT NULL, request_hash text NOT NULL,
 request jsonb NOT NULL, result jsonb NOT NULL, prior_revision bigint NOT NULL, revision bigint NOT NULL,
 before_facts jsonb NOT NULL, after_facts jsonb NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,client_id,operation_id));
CREATE INDEX tb_operation_event ON public.tournament_operations(tournament_id,created_at);
ALTER TABLE public.tournament_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_definitions,public.tournament_stages,public.tournament_operations,public.connection_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.connection_grants TO service_role;
REVOKE ALL ON public.tournament_definitions,public.tournament_stages,public.tournament_operations FROM service_role;

CREATE FUNCTION tournament_builder_private.assert_keys(value jsonb, allowed text[]) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'INVALID_EFFECTS'; END IF;
END $$;

CREATE FUNCTION tournament_builder_private.guard_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_event uuid; new_event uuid; target uuid; current_engine text;
BEGIN
 IF TG_TABLE_NAME='tournaments' THEN
  IF TG_OP<>'INSERT' AND OLD.engine_version='modular_v1' THEN old_event:=OLD.id; END IF;
  IF TG_OP<>'DELETE' AND NEW.engine_version='modular_v1' THEN new_event:=NEW.id; END IF;
  IF TG_OP='UPDATE' AND OLD.engine_version='modular_v1' AND NEW.engine_version<>'modular_v1' THEN RAISE EXCEPTION 'COMMAND_REQUIRED'; END IF;
 ELSIF TG_TABLE_NAME='team_members' THEN
  IF TG_OP<>'INSERT' THEN SELECT tournament_id INTO old_event FROM public.teams WHERE id=OLD.team_id; END IF;
  IF TG_OP<>'DELETE' THEN SELECT tournament_id INTO new_event FROM public.teams WHERE id=NEW.team_id; NEW.tournament_id:=new_event; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN old_event:=OLD.tournament_id; END IF;
  IF TG_OP<>'DELETE' THEN new_event:=NEW.tournament_id; END IF;
 END IF;
 FOREACH target IN ARRAY ARRAY[old_event,new_event] LOOP
  IF target IS NULL THEN CONTINUE; END IF;
  SELECT engine_version INTO current_engine FROM public.tournaments WHERE id=target;
  IF (current_engine='modular_v1' OR (TG_TABLE_NAME='tournaments' AND target=new_event)) AND NOT EXISTS(
   SELECT 1 FROM tournament_builder_private.command_context WHERE transaction_id=txid_current() AND event_id=target
  ) THEN RAISE EXCEPTION 'COMMAND_REQUIRED'; END IF;
 END LOOP;
 IF TG_TABLE_NAME IN ('tournament_operations','tournament_definitions') AND TG_OP<>'INSERT' THEN
  IF TG_TABLE_NAME='tournament_operations' THEN RAISE EXCEPTION 'IMMUTABLE_HISTORY'; END IF;
  IF OLD.status='published' THEN RAISE EXCEPTION 'PUBLISHED_DEFINITION'; END IF;
 END IF;
 IF TG_TABLE_NAME='team_members' AND TG_OP<>'DELETE' THEN
 IF NEW.membership_status='active' AND EXISTS(
  SELECT 1 FROM public.team_members m WHERE m.tournament_id=NEW.tournament_id AND m.user_id=NEW.user_id AND m.membership_status='active' AND m.id<>NEW.id
 ) THEN RAISE EXCEPTION 'DUPLICATE_ENTRY'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
-- Static table list: no public function can write arbitrary SQL or manufacture command context.
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.team_members FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_players FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_admins FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.rounds FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.matches FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.standings FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.mixed_pairings FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_definitions FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_stages FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();
CREATE TRIGGER tb_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_operations FOR EACH ROW EXECUTE FUNCTION tournament_builder_private.guard_write();

CREATE FUNCTION tournament_builder_private.guard_truncate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.tournaments WHERE engine_version='modular_v1') THEN RAISE EXCEPTION 'COMMAND_REQUIRED'; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.tournaments FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.teams FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.team_members FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.tournament_players FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.tournament_admins FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.rounds FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.matches FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.standings FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.mixed_pairings FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.tournament_definitions FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.tournament_stages FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();
CREATE TRIGGER tb_no_truncate BEFORE TRUNCATE ON public.tournament_operations FOR EACH STATEMENT EXECUTE FUNCTION tournament_builder_private.guard_truncate();

CREATE FUNCTION tournament_builder_private.authorize(actor uuid,client text,event uuid,command text,request jsonb,grant_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE permission text; event_row public.tournaments%ROWTYPE; admin boolean; grant_row public.connection_grants%ROWTYPE;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor) THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 IF client IS NULL OR client='' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO event_row FROM public.tournaments WHERE id=event;
 admin:=event_row.created_by=actor OR EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=event AND user_id=actor);
 IF client<>'web' THEN
  permission:=CASE command WHEN 'createDraft' THEN 'draft:create' WHEN 'updateDraft' THEN 'draft:update' WHEN 'read' THEN 'draft:read' ELSE NULL END;
  IF permission IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO grant_row FROM public.connection_grants WHERE id=grant_id FOR SHARE;
  IF NOT FOUND OR grant_row.status<>'active' OR grant_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'GRANT_REVOKED'; END IF;
  IF grant_row.user_id<>actor OR grant_row.client_id<>client OR NOT permission=ANY(grant_row.permissions) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
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

CREATE FUNCTION tournament_builder_private.snapshot(event uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
SELECT jsonb_build_object(
 'event',(SELECT to_jsonb(t) FROM public.tournaments t WHERE t.id=event),
 'definitions',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.revision) FROM public.tournament_definitions d WHERE d.tournament_id=event),'[]'),
 'teams',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.teams t WHERE t.tournament_id=event),'[]'),
 'team_members',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('display_name',coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),p.username,'Player')) ORDER BY m.id) FROM public.team_members m JOIN public.profiles p ON p.id=m.user_id WHERE m.tournament_id=event),'[]'),
 'tournament_players',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.tournament_players p WHERE p.tournament_id=event),'[]'),
 'stages',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.node_id) FROM public.tournament_stages s WHERE s.tournament_id=event),'[]'),
 'rounds',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.round_number) FROM public.rounds r WHERE r.tournament_id=event),'[]'),
 'matches',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.matches m WHERE m.tournament_id=event),'[]'),
 'standings',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.standings s WHERE s.tournament_id=event),'[]'))
$$;
CREATE FUNCTION public.tb_get_snapshot(p_actor_id uuid,p_client_id text,p_tournament_id uuid,p_grant_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE data jsonb; caller_role text; visible_teams uuid[];
BEGIN
 PERFORM tournament_builder_private.authorize(p_actor_id,p_client_id,p_tournament_id,'read','{}',p_grant_id);
 caller_role:=CASE WHEN EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament_id AND created_by=p_actor_id) THEN 'owner'
 WHEN EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN 'admin'
 WHEN EXISTS(SELECT 1 FROM public.team_members WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN 'player' ELSE 'viewer' END;
 data:=tournament_builder_private.snapshot(p_tournament_id);
 IF caller_role NOT IN ('owner','admin') THEN
  SELECT coalesce(array_agg(t.id),ARRAY[]::uuid[]) INTO visible_teams FROM public.teams t WHERE t.tournament_id=p_tournament_id AND
   (t.entry_state='approved' OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.team_id=t.id AND m.user_id=p_actor_id AND m.membership_status IN ('pending','active')));
  data:=data||jsonb_build_object(
   'definitions',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(data->'definitions') WHERE value->>'status'='published'),'[]'),
   'teams',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(data->'teams') WHERE (value->>'id')::uuid=ANY(visible_teams)),'[]'),
   'team_members',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(data->'team_members') WHERE (value->>'team_id')::uuid=ANY(visible_teams) AND (value->>'membership_status'='active' OR EXISTS(SELECT 1 FROM public.team_members own WHERE own.team_id=(value->>'team_id')::uuid AND own.user_id=p_actor_id AND own.membership_status IN ('active','pending')))),'[]'),
   'tournament_players',coalesce((SELECT jsonb_agg(value) FROM jsonb_array_elements(data->'tournament_players') WHERE value->>'status'='approved' OR (value->>'user_id')::uuid=p_actor_id),'[]'));
 END IF;
 RETURN data||jsonb_build_object('caller_role',caller_role);
END $$;
CREATE FUNCTION public.tb_get_operation(p_actor_id uuid,p_client_id text,p_operation_id uuid,p_grant_id uuid DEFAULT NULL,p_tournament_id uuid DEFAULT NULL,p_command text DEFAULT NULL,p_request jsonb DEFAULT '{}',p_request_hash text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.tournament_operations%ROWTYPE;
BEGIN
 SELECT * INTO op FROM public.tournament_operations WHERE actor_id=p_actor_id AND client_id=p_client_id AND operation_id=p_operation_id;
 IF NOT FOUND THEN
  IF p_tournament_id IS NULL OR p_command IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM tournament_builder_private.authorize(p_actor_id,p_client_id,p_tournament_id,p_command,p_request,p_grant_id);
  RETURN NULL;
 END IF;
 PERFORM tournament_builder_private.authorize(p_actor_id,p_client_id,op.tournament_id,op.command,op.request,p_grant_id);
 IF (p_request_hash IS NOT NULL AND op.request_hash<>p_request_hash) OR (p_command IS NOT NULL AND op.command<>p_command) OR (p_tournament_id IS NOT NULL AND op.tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 RETURN op.result;
END $$;

CREATE FUNCTION public.tb_apply_command(p_actor_id uuid,p_client_id text,p_operation_id uuid,p_request_hash text,p_command text,p_tournament_id uuid,p_expected_revision bigint,p_request jsonb,p_effects jsonb,p_result jsonb,p_grant_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event_row public.tournaments%ROWTYPE; op public.tournament_operations%ROWTYPE; row_data jsonb; merged jsonb;
 before_snapshot jsonb; after_snapshot jsonb; receipt jsonb; next_revision bigint; target_state text; match_row public.matches%ROWTYPE; definition_row jsonb; rest_minutes integer;
BEGIN
 IF p_command<>ALL(ARRAY['createDraft','updateDraft','publishTournament','requestEntry','acceptPartner','approveEntry','rejectEntry','cancelEntry','closeRegistration','reopenRegistration','lockRoster','startTournament','startMatch','submitScore','confirmScore','attestScore','adjudicateDispute','disputeScore','resolveTie','commitCorrection','withdrawEntry','reopenResults','cancelTournament','changeCourt']) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF p_operation_id IS NULL OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 -- Serialize the receipt scope even when this command creates a previously absent event.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_client_id||':'||p_operation_id::text,0));
 SELECT * INTO event_row FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 PERFORM tournament_builder_private.authorize(p_actor_id,p_client_id,p_tournament_id,p_command,p_request,p_grant_id);
 SELECT * INTO op FROM public.tournament_operations WHERE actor_id=p_actor_id AND client_id=p_client_id AND operation_id=p_operation_id;
 IF FOUND THEN
  IF op.request_hash<>p_request_hash OR op.command<>p_command OR op.tournament_id<>p_tournament_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN op.result;
 END IF;
 IF p_command='createDraft' THEN
  IF event_row.id IS NOT NULL OR p_expected_revision IS NOT NULL THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 ELSE
  IF p_expected_revision IS NULL OR p_expected_revision<>event_row.revision THEN RAISE EXCEPTION 'STALE_REVISION'; END IF;
 END IF;
 IF (p_command IN ('updateDraft','publishTournament') AND event_row.modular_state IS DISTINCT FROM 'draft') OR
 (p_command IN ('requestEntry','acceptPartner','approveEntry','rejectEntry') AND event_row.modular_state IS DISTINCT FROM 'registration_open') OR
 (p_command='closeRegistration' AND event_row.modular_state IS DISTINCT FROM 'registration_open') OR
 (p_command IN ('reopenRegistration','lockRoster') AND event_row.modular_state IS DISTINCT FROM 'registration_closed') OR
 (p_command='cancelEntry' AND event_row.modular_state NOT IN ('registration_open','registration_closed')) OR
 (p_command='startTournament' AND event_row.modular_state IS DISTINCT FROM 'ready') OR
 (p_command IN ('startMatch','submitScore','confirmScore','attestScore','adjudicateDispute','disputeScore','resolveTie','commitCorrection') AND event_row.modular_state IS DISTINCT FROM 'active') OR
 (p_command='withdrawEntry' AND event_row.modular_state NOT IN ('registration_open','registration_closed','ready','active')) OR
 (p_command='changeCourt' AND event_row.modular_state NOT IN ('ready','active')) OR
 (p_command='reopenResults' AND event_row.modular_state IS DISTINCT FROM 'completed') OR
 (p_command='cancelTournament' AND event_row.modular_state IN ('completed','cancelled')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 IF p_command='withdrawEntry' AND event_row.modular_state IN ('ready','active') AND event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_command='startMatch' THEN
  SELECT * INTO match_row FROM public.matches WHERE id=(p_request->>'match_id')::uuid AND tournament_id=p_tournament_id FOR UPDATE;
  IF NOT FOUND OR match_row.status<>'scheduled' OR NOT match_row.is_current OR match_row.voided_at IS NOT NULL OR match_row.stage_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=match_row.stage_id AND state IN ('ready','active')) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 END IF;
 PERFORM tournament_builder_private.assert_keys(p_effects,ARRAY['event','definition','teams','team_members','tournament_players','rounds','matches','standings','stages','replace_standings_stage_ids']);
 PERFORM tournament_builder_private.assert_keys(coalesce(p_effects->'event','{}'),ARRAY['name','court_count','max_players','type','rules_text','is_public','is_open','court_name','court_address','tournament_date','modular_state','roster_revision','timezone','registration_closed_at','result_version','results_under_review','completed_at','cancelled_at','status','definition_id']);
 next_revision:=coalesce(event_row.revision,0)+1;
 before_snapshot:=tournament_builder_private.snapshot(p_tournament_id);
 INSERT INTO tournament_builder_private.command_context VALUES(txid_current(),p_tournament_id);
 IF p_command='createDraft' THEN
  INSERT INTO public.tournaments(id,name,created_by,court_count,max_players,type,engine_version,modular_state,status,is_public,revision)
   VALUES(p_tournament_id,'draft-'||p_tournament_id,p_actor_id,1,16,'singles','modular_v1','draft','draft',false,0);
 END IF;
 IF p_effects ? 'definition' THEN
  row_data:=p_effects->'definition';
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','schema_version','definition','status','canonical_hash','approved_at']);
  IF EXISTS(SELECT 1 FROM public.tournament_definitions WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  INSERT INTO public.tournament_definitions(id,tournament_id,schema_version,revision,definition,status,canonical_hash,created_by,approved_by,approved_at)
  VALUES((row_data->>'id')::uuid,p_tournament_id,coalesce((row_data->>'schema_version')::integer,1),next_revision,row_data->'definition',coalesce(row_data->>'status','draft'),row_data->>'canonical_hash',p_actor_id,CASE WHEN row_data->>'status'='published' THEN p_actor_id END,(row_data->>'approved_at')::timestamptz)
  ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,definition=excluded.definition,status=excluded.status,canonical_hash=excluded.canonical_hash,approved_by=excluded.approved_by,approved_at=excluded.approved_at;
 END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'stages','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','definition_id','node_id','module_id','module_version','state','input_revision','output_revision','output','blocked_code']);
  IF EXISTS(SELECT 1 FROM public.tournament_stages WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.tournament_stages t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('id',gen_random_uuid(),'input_revision',0,'output','{}'::jsonb,'output_revision',0,'state','pending'))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.tournament_stages(id,tournament_id,definition_id,node_id,module_id,module_version,state,input_revision,output_revision,output,blocked_code) SELECT id,tournament_id,definition_id,node_id,module_id,module_version,state,input_revision,output_revision,output,blocked_code FROM jsonb_populate_record(NULL::public.tournament_stages,merged)
   ON CONFLICT(id) DO UPDATE SET definition_id=excluded.definition_id,node_id=excluded.node_id,module_id=excluded.module_id,module_version=excluded.module_version,state=excluded.state,input_revision=excluded.input_revision,output_revision=excluded.output_revision,output=excluded.output,blocked_code=excluded.blocked_code;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'teams','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','name','seed','entry_state','eligibility_version','withdrawn_at','withdrawal_reason']);
  IF EXISTS(SELECT 1 FROM public.teams WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.teams t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'eligibility_version',0,'entry_state','pending','id',gen_random_uuid()))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.teams(id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason) SELECT id,tournament_id,name,seed,created_at,entry_state,eligibility_version,withdrawn_at,withdrawal_reason FROM jsonb_populate_record(NULL::public.teams,merged)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,seed=excluded.seed,entry_state=excluded.entry_state,eligibility_version=excluded.eligibility_version,withdrawn_at=excluded.withdrawn_at,withdrawal_reason=excluded.withdrawal_reason;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'team_members','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','team_id','user_id','consented_definition_id','consented_at','membership_status']);
  IF EXISTS(SELECT 1 FROM public.team_members WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.team_members t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('id',gen_random_uuid(),'membership_status','active'))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  IF NOT EXISTS(SELECT 1 FROM public.teams WHERE id=(merged->>'team_id')::uuid AND tournament_id=p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  INSERT INTO public.team_members(id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status) SELECT id,team_id,user_id,tournament_id,consented_definition_id,consented_at,membership_status FROM jsonb_populate_record(NULL::public.team_members,merged)
   ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,user_id=excluded.user_id,consented_definition_id=excluded.consented_definition_id,consented_at=excluded.consented_at,membership_status=excluded.membership_status;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'tournament_players','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','user_id','status','joined_via','exit_reason','nullified_from_standings']);
  IF EXISTS(SELECT 1 FROM public.tournament_players WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.tournament_players t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'id',gen_random_uuid(),'nullified_from_standings',false,'status','pending'::text))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.tournament_players(id,tournament_id,user_id,status,joined_via,created_at,exit_reason,nullified_from_standings) SELECT id,tournament_id,user_id,status,joined_via,created_at,exit_reason,nullified_from_standings FROM jsonb_populate_record(NULL::public.tournament_players,merged)
   ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,status=excluded.status,joined_via=excluded.joined_via,exit_reason=excluded.exit_reason,nullified_from_standings=excluded.nullified_from_standings;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'rounds','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_number','round_type','status','stage_id','schedule_generation','logical_wave','is_current']);
  IF EXISTS(SELECT 1 FROM public.rounds WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.rounds t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'id',gen_random_uuid(),'is_current',true,'schedule_generation',0,'status','pending'::text))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.rounds(id,tournament_id,round_number,round_type,status,created_at,stage_id,schedule_generation,logical_wave,is_current) SELECT id,tournament_id,round_number,round_type,status,created_at,stage_id,schedule_generation,logical_wave,is_current FROM jsonb_populate_record(NULL::public.rounds,merged)
   ON CONFLICT(id) DO UPDATE SET round_number=excluded.round_number,round_type=excluded.round_type,status=excluded.status,stage_id=excluded.stage_id,schedule_generation=excluded.schedule_generation,logical_wave=excluded.logical_wave,is_current=excluded.is_current;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'matches','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_id','court_number','team_a_id','team_b_id','score_a','score_b','status','entered_by','validated_by','scheduled_at','stage_id','logical_key','schedule_generation','is_current','revision','outcome_kind','winner_team_id','submitted_entry_id','result_revision','started_at','ended_at','voided_at','excluded_at','submit_to_dupr','bracket_next_winner_match_id','bracket_next_loser_match_id','bracket_winner_fills_side','bracket_loser_fills_side']);
  IF EXISTS(SELECT 1 FROM public.matches WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.matches t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('created_at',now(),'id',gen_random_uuid(),'is_current',true,'result_revision',0,'revision',0,'schedule_generation',0,'status','scheduled'::text,'submit_to_dupr',true,'updated_at',now()))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  IF merged->>'status'='in_progress' AND coalesce((merged->>'is_current')::boolean,false) AND merged->>'voided_at' IS NULL AND EXISTS(
   SELECT 1 FROM public.matches WHERE tournament_id=p_tournament_id AND id<>(merged->>'id')::uuid AND status='in_progress' AND is_current AND voided_at IS NULL AND court_number=(merged->>'court_number')::integer
  ) THEN RAISE EXCEPTION 'COURT_BUSY'; END IF;
  INSERT INTO public.matches(id,tournament_id,round_id,court_number,team_a_id,team_b_id,player_a1_id,player_a2_id,player_b1_id,player_b2_id,score_a,score_b,status,entered_by,validated_by,scheduled_at,created_at,updated_at,bracket_next_winner_match_id,bracket_next_loser_match_id,bracket_winner_fills_side,bracket_loser_fills_side,submit_to_dupr,stage_id,logical_key,schedule_generation,is_current,revision,outcome_kind,winner_team_id,submitted_entry_id,result_revision,started_at,ended_at,voided_at,excluded_at) SELECT id,tournament_id,round_id,court_number,team_a_id,team_b_id,player_a1_id,player_a2_id,player_b1_id,player_b2_id,score_a,score_b,status,entered_by,validated_by,scheduled_at,created_at,updated_at,bracket_next_winner_match_id,bracket_next_loser_match_id,bracket_winner_fills_side,bracket_loser_fills_side,submit_to_dupr,stage_id,logical_key,schedule_generation,is_current,revision,outcome_kind,winner_team_id,submitted_entry_id,result_revision,started_at,ended_at,voided_at,excluded_at FROM jsonb_populate_record(NULL::public.matches,merged)
   ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,court_number=excluded.court_number,team_a_id=excluded.team_a_id,team_b_id=excluded.team_b_id,score_a=excluded.score_a,score_b=excluded.score_b,status=excluded.status,entered_by=excluded.entered_by,validated_by=excluded.validated_by,scheduled_at=excluded.scheduled_at,stage_id=excluded.stage_id,logical_key=excluded.logical_key,schedule_generation=excluded.schedule_generation,is_current=excluded.is_current,revision=excluded.revision,outcome_kind=excluded.outcome_kind,winner_team_id=excluded.winner_team_id,submitted_entry_id=excluded.submitted_entry_id,result_revision=excluded.result_revision,started_at=excluded.started_at,ended_at=excluded.ended_at,voided_at=excluded.voided_at,excluded_at=excluded.excluded_at,submit_to_dupr=excluded.submit_to_dupr,bracket_next_winner_match_id=excluded.bracket_next_winner_match_id,bracket_next_loser_match_id=excluded.bracket_next_loser_match_id,bracket_winner_fills_side=excluded.bracket_winner_fills_side,bracket_loser_fills_side=excluded.bracket_loser_fills_side;
 END LOOP;
 IF p_effects ? 'replace_standings_stage_ids' THEN
  DELETE FROM public.standings WHERE tournament_id=p_tournament_id AND stage_id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_effects->'replace_standings_stage_ids'));
 END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(coalesce(p_effects->'standings','[]')) LOOP
  PERFORM tournament_builder_private.assert_keys(row_data,ARRAY['id','round_id','team_id','player_id','wins','losses','points_for','points_against','rank','stage_id','input_revision','eligible','tie_group']);
  IF EXISTS(SELECT 1 FROM public.standings WHERE id=(row_data->>'id')::uuid AND tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
  merged:=coalesce((SELECT to_jsonb(t) FROM public.standings t WHERE id=(row_data->>'id')::uuid),jsonb_build_object('eligible',true,'id',gen_random_uuid(),'input_revision',0,'losses',0,'points_against',0,'points_for',0,'updated_at',now(),'wins',0))||row_data||jsonb_build_object('tournament_id',p_tournament_id);
  INSERT INTO public.standings(id,tournament_id,round_id,team_id,player_id,wins,losses,points_for,points_against,rank,updated_at,stage_id,input_revision,eligible,tie_group) SELECT id,tournament_id,round_id,team_id,player_id,wins,losses,points_for,points_against,rank,updated_at,stage_id,input_revision,eligible,tie_group FROM jsonb_populate_record(NULL::public.standings,merged)
   ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,team_id=excluded.team_id,player_id=excluded.player_id,wins=excluded.wins,losses=excluded.losses,points_for=excluded.points_for,points_against=excluded.points_against,rank=excluded.rank,stage_id=excluded.stage_id,input_revision=excluded.input_revision,eligible=excluded.eligible,tie_group=excluded.tie_group;
 END LOOP;
 -- Composite constraints also protect downstream bracket references, which predate modular events.
 IF EXISTS(SELECT 1 FROM public.matches m JOIN public.matches dependency ON dependency.id IN (m.bracket_next_winner_match_id,m.bracket_next_loser_match_id) WHERE m.tournament_id=p_tournament_id AND dependency.tournament_id<>p_tournament_id) THEN RAISE EXCEPTION 'CROSS_EVENT'; END IF;
 IF p_command='withdrawEntry' AND event_row.modular_state IN ('ready','active') AND event_row.created_by<>p_actor_id AND NOT EXISTS(SELECT 1 FROM public.tournament_admins WHERE tournament_id=p_tournament_id AND user_id=p_actor_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_command='startMatch' THEN
  SELECT * INTO match_row FROM public.matches WHERE id=(p_request->>'match_id')::uuid AND tournament_id=p_tournament_id;
  IF NOT FOUND OR NOT match_row.is_current OR match_row.voided_at IS NOT NULL OR match_row.status<>'in_progress' OR match_row.team_a_id IS NULL OR match_row.team_b_id IS NULL OR match_row.court_number IS NULL OR match_row.court_number<1 OR match_row.court_number>(SELECT court_count FROM public.tournaments WHERE id=p_tournament_id) THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
  IF EXISTS(SELECT 1 FROM public.matches m WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND m.court_number=match_row.court_number) THEN RAISE EXCEPTION 'COURT_BUSY'; END IF;
  IF EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND m.is_current AND m.voided_at IS NULL AND m.status='in_progress' AND a.membership_status='active' AND b.membership_status='active') THEN RAISE EXCEPTION 'PLAYER_BUSY'; END IF;
  SELECT d.definition INTO definition_row FROM public.tournament_definitions d JOIN public.tournaments t ON t.definition_id=d.id WHERE t.id=p_tournament_id;
  rest_minutes:=coalesce((definition_row#>>'{scheduling,minimum_rest_minutes}')::integer,0);
  IF EXISTS(SELECT 1 FROM public.matches m JOIN public.team_members a ON a.team_id IN (m.team_a_id,m.team_b_id) JOIN public.team_members b ON b.user_id=a.user_id AND b.team_id IN (match_row.team_a_id,match_row.team_b_id) WHERE m.tournament_id=p_tournament_id AND m.id<>match_row.id AND rest_minutes>0 AND m.started_at IS NOT NULL AND m.ended_at>now()-make_interval(mins=>rest_minutes) AND a.membership_status='active' AND b.membership_status='active') THEN RAISE EXCEPTION 'REST_REQUIRED'; END IF;
 END IF;
 merged:=to_jsonb((SELECT t FROM public.tournaments t WHERE t.id=p_tournament_id))||coalesce(p_effects->'event','{}');
 target_state:=merged->>'modular_state';
 IF (p_command='createDraft' AND target_state<>'draft') OR (p_command='updateDraft' AND target_state<>'draft') OR
 (p_command='publishTournament' AND target_state<>'registration_open') OR (p_command='closeRegistration' AND target_state<>'registration_closed') OR
 (p_command='reopenRegistration' AND target_state<>'registration_open') OR (p_command='lockRoster' AND target_state<>'ready') OR
 (p_command IN ('startTournament','reopenResults') AND target_state<>'active') OR (p_command='cancelTournament' AND target_state<>'cancelled') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
 UPDATE public.tournaments SET name=merged->>'name',court_count=(merged->>'court_count')::integer,max_players=(merged->>'max_players')::integer,type=merged->>'type',rules_text=merged->>'rules_text',is_public=(merged->>'is_public')::boolean,is_open=(merged->>'is_open')::boolean,court_name=merged->>'court_name',court_address=merged->>'court_address',tournament_date=(merged->>'tournament_date')::date,modular_state=target_state,revision=next_revision,definition_id=(merged->>'definition_id')::uuid,roster_revision=(merged->>'roster_revision')::bigint,timezone=merged->>'timezone',registration_closed_at=(merged->>'registration_closed_at')::timestamptz,result_version=(merged->>'result_version')::integer,results_under_review=(merged->>'results_under_review')::boolean,completed_at=(merged->>'completed_at')::timestamptz,cancelled_at=(merged->>'cancelled_at')::timestamptz,
 status=CASE target_state WHEN 'draft' THEN 'draft' WHEN 'registration_open' THEN 'registration' WHEN 'registration_closed' THEN 'registration' WHEN 'ready' THEN 'registration' WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE CASE WHEN merged->>'status'='finals' THEN 'finals' ELSE 'active' END END
 WHERE id=p_tournament_id;
 after_snapshot:=tournament_builder_private.snapshot(p_tournament_id);
 receipt:=jsonb_build_object('operation_id',p_operation_id,'tournament_id',p_tournament_id,'revision',next_revision,'status',target_state,'data',p_result);
 INSERT INTO public.tournament_operations(operation_id,actor_id,client_id,tournament_id,command,request_hash,request,result,prior_revision,revision,before_facts,after_facts,reason)
 VALUES(p_operation_id,p_actor_id,p_client_id,p_tournament_id,p_command,p_request_hash,p_request,receipt,coalesce(event_row.revision,0),next_revision,before_snapshot,after_snapshot,p_request->>'reason');
 DELETE FROM tournament_builder_private.command_context WHERE transaction_id=txid_current() AND event_id=p_tournament_id;
 RETURN receipt;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tournament_builder_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid),public.tb_get_snapshot(uuid,text,uuid,uuid),public.tb_get_operation(uuid,text,uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tb_apply_command(uuid,text,uuid,text,text,uuid,bigint,jsonb,jsonb,jsonb,uuid),public.tb_get_snapshot(uuid,text,uuid,uuid),public.tb_get_operation(uuid,text,uuid,uuid,uuid,text,jsonb,text) TO service_role;
COMMIT;








