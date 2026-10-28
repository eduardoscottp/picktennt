-- Opaque, resource-bound connector credentials. Never issues or returns Supabase JWTs.
BEGIN;
ALTER TABLE public.connection_grants ADD resource text;
CREATE TABLE tournament_builder_private.oauth_clients(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_name text NOT NULL CHECK(length(client_name) BETWEEN 1 AND 120),
 redirect_uris text[] NOT NULL, grant_types text[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tournament_builder_private.oauth_authorizations(
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES tournament_builder_private.oauth_clients(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id), csrf_hash text NOT NULL CHECK(csrf_hash ~ '^[a-f0-9]{64}$'),
 redirect_uri text NOT NULL, resource text NOT NULL, scopes text[] NOT NULL, state text NOT NULL,
 code_challenge text NOT NULL CHECK(code_challenge ~ '^[A-Za-z0-9_-]{43}$'), expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')), grant_id uuid REFERENCES public.connection_grants(id),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tournament_builder_private.oauth_codes(
 code_hash text PRIMARY KEY CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 request_id uuid NOT NULL UNIQUE REFERENCES tournament_builder_private.oauth_authorizations(id),
 grant_id uuid NOT NULL REFERENCES public.connection_grants(id), expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE TABLE tournament_builder_private.oauth_families(
 id uuid PRIMARY KEY, grant_id uuid NOT NULL REFERENCES public.connection_grants(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days', revoked_at timestamptz);
CREATE TABLE tournament_builder_private.oauth_tokens(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'), kind text NOT NULL CHECK(kind IN ('access','refresh')),
 family_id uuid NOT NULL REFERENCES tournament_builder_private.oauth_families(id),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz, parent_hash text,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX tb_oauth_tokens_family ON tournament_builder_private.oauth_tokens(family_id);
CREATE TABLE tournament_builder_private.oauth_rate_limits(
 key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),bucket text NOT NULL CHECK(bucket IN ('register','token','authorize')),
 count bigint NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(key_hash,bucket));
REVOKE ALL ON ALL TABLES IN SCHEMA tournament_builder_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION tournament_builder_private.oauth_client_json(c tournament_builder_private.oauth_clients) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('client_id',c.id,'client_name',c.client_name,'redirect_uris',c.redirect_uris,'grant_types',c.grant_types,'response_types',ARRAY['code'],'token_endpoint_auth_method','none');
$$;
CREATE FUNCTION tournament_builder_private.oauth_request_json(r tournament_builder_private.oauth_authorizations) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('id',r.id,'client_id',r.client_id,'client_name',(SELECT client_name FROM tournament_builder_private.oauth_clients WHERE id=r.client_id),'actor_id',r.actor_id,'redirect_uri',r.redirect_uri,'resource',r.resource,'scopes',r.scopes,'state',r.state,'code_challenge',r.code_challenge,'expires_at',r.expires_at,'status',r.status);
$$;
CREATE FUNCTION tournament_builder_private.oauth_binding(g public.connection_grants,expiry timestamptz) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('user_id',g.user_id,'client_id',g.client_id,'grant_id',g.id,'resource',g.resource,'scopes',g.permissions,'expires_at',expiry);
$$;

CREATE FUNCTION public.tb_oauth_store(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c tournament_builder_private.oauth_clients%ROWTYPE; a tournament_builder_private.oauth_authorizations%ROWTYPE;
 code tournament_builder_private.oauth_codes%ROWTYPE; token tournament_builder_private.oauth_tokens%ROWTYPE;
 family tournament_builder_private.oauth_families%ROWTYPE; g public.connection_grants%ROWTYPE;
 redirects text[]; grants text[]; scopes text[]; response_types text[]; access_expiry timestamptz; refresh_allowed boolean;
 rate tournament_builder_private.oauth_rate_limits%ROWTYPE; rate_limit integer; window_seconds integer; actor uuid;
BEGIN
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 IF p_action='rate_limit' THEN
  IF p_payload->>'key_hash' IS NULL OR p_payload->>'key_hash' !~ '^[a-f0-9]{64}$' OR coalesce(p_payload->>'bucket','') NOT IN ('register','token','authorize') THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  rate_limit:=CASE p_payload->>'bucket' WHEN 'register' THEN 10 ELSE 60 END;
  window_seconds:=CASE p_payload->>'bucket' WHEN 'register' THEN 3600 ELSE 60 END;
  INSERT INTO tournament_builder_private.oauth_rate_limits(key_hash,bucket,count,expires_at)
   VALUES(p_payload->>'key_hash',p_payload->>'bucket',1,now()+make_interval(secs=>window_seconds))
  ON CONFLICT(key_hash,bucket) DO UPDATE SET count=CASE WHEN oauth_rate_limits.expires_at<=now() THEN 1 ELSE oauth_rate_limits.count+1 END,
   expires_at=CASE WHEN oauth_rate_limits.expires_at<=now() THEN now()+make_interval(secs=>window_seconds) ELSE oauth_rate_limits.expires_at END RETURNING * INTO rate;
  RETURN jsonb_build_object('allowed',rate.count<=rate_limit,'retry_after',CASE WHEN rate.count<=rate_limit THEN 0 ELSE greatest(1,ceil(extract(epoch FROM rate.expires_at-now())))::integer END);
 ELSIF p_action='register_client' THEN
  IF jsonb_typeof(p_payload->'redirect_uris') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'redirect_uris') NOT BETWEEN 1 AND 10 THEN RETURN jsonb_build_object('error','invalid_client_metadata'); END IF;
  SELECT array_agg(value) INTO redirects FROM jsonb_array_elements_text(p_payload->'redirect_uris');
  SELECT array_agg(value) INTO grants FROM jsonb_array_elements_text(coalesce(p_payload->'grant_types','["authorization_code"]'));
  SELECT array_agg(value) INTO response_types FROM jsonb_array_elements_text(coalesce(p_payload->'response_types','["code"]'));
  IF coalesce(length(trim(p_payload->>'client_name')),0) NOT BETWEEN 1 AND 120 OR coalesce(p_payload->>'token_endpoint_auth_method','none')<>'none'
   OR NOT coalesce(grants @> ARRAY['authorization_code'] AND grants <@ ARRAY['authorization_code','refresh_token'],false)
   OR response_types IS DISTINCT FROM ARRAY['code']::text[] OR EXISTS(SELECT 1 FROM unnest(redirects) u WHERE length(u)>2048 OR u ~ '[@#[:space:]]' OR (u !~ '^https://[^/?#:]+(:[0-9]+)?(/|\?|$)' AND u !~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/|\?|$)'))
  THEN RETURN jsonb_build_object('error','invalid_client_metadata'); END IF;
  INSERT INTO tournament_builder_private.oauth_clients(client_name,redirect_uris,grant_types) VALUES(trim(p_payload->>'client_name'),redirects,grants) RETURNING * INTO c;
  RETURN tournament_builder_private.oauth_client_json(c);
 ELSIF p_action='get_client' THEN
  SELECT * INTO c FROM tournament_builder_private.oauth_clients WHERE id=(p_payload->>'client_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_client'); END IF;
  RETURN tournament_builder_private.oauth_client_json(c);
 ELSIF p_action='create_authorization' THEN
  SELECT * INTO c FROM tournament_builder_private.oauth_clients WHERE id=(p_payload->>'client_id')::uuid;
  IF NOT FOUND OR NOT coalesce((p_payload->>'redirect_uri')=ANY(c.redirect_uris),false) THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  SELECT array_agg(value) INTO scopes FROM jsonb_array_elements_text(p_payload->'scopes');
  actor:=(p_payload->>'actor_id')::uuid;
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor) OR p_payload->>'csrf_hash' IS NULL OR p_payload->>'csrf_hash' !~ '^[a-f0-9]{64}$'
   OR NOT coalesce(scopes <@ ARRAY['draft:create','draft:read','draft:update','operation:read']::text[] AND cardinality(scopes)>0,false)
   OR p_payload->>'resource' IS NULL OR p_payload->>'resource' !~ '^https://[^[:space:]#]+$' OR coalesce(length(p_payload->>'state'),0) NOT BETWEEN 1 AND 2048
   OR p_payload->>'code_challenge' IS NULL OR p_payload->>'code_challenge' !~ '^[A-Za-z0-9_-]{43}$'
   OR p_payload->>'expires_at' IS NULL OR (p_payload->>'expires_at')::timestamptz<=now() OR (p_payload->>'expires_at')::timestamptz>now()+interval '10 minutes 5 seconds'
  THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  INSERT INTO tournament_builder_private.oauth_authorizations(id,client_id,actor_id,csrf_hash,redirect_uri,resource,scopes,state,code_challenge,expires_at)
   VALUES((p_payload->>'id')::uuid,c.id,actor,p_payload->>'csrf_hash',p_payload->>'redirect_uri',p_payload->>'resource',scopes,p_payload->>'state',p_payload->>'code_challenge',(p_payload->>'expires_at')::timestamptz) RETURNING * INTO a;
  RETURN tournament_builder_private.oauth_request_json(a);
 ELSIF p_action='get_authorization' THEN
  SELECT * INTO a FROM tournament_builder_private.oauth_authorizations WHERE id=coalesce(p_payload->>'request_id',p_payload->>'id')::uuid;
  IF NOT FOUND OR a.expires_at<=now() THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  RETURN tournament_builder_private.oauth_request_json(a);
 ELSIF p_action IN ('approve_authorization','deny_authorization') THEN
  SELECT * INTO a FROM tournament_builder_private.oauth_authorizations WHERE id=(p_payload->>'request_id')::uuid FOR UPDATE;
  IF NOT FOUND OR a.status<>'pending' OR a.expires_at<=now() THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  IF (p_payload->>'actor_id')::uuid IS DISTINCT FROM a.actor_id OR p_payload->>'csrf_hash' IS DISTINCT FROM a.csrf_hash THEN RETURN jsonb_build_object('error','access_denied'); END IF;
  IF p_action='deny_authorization' THEN
   UPDATE tournament_builder_private.oauth_authorizations SET status='denied' WHERE id=a.id;
   RETURN jsonb_build_object('redirect_uri',a.redirect_uri,'state',a.state,'denied',true);
  END IF;
  IF p_payload->>'code_hash' IS NULL OR p_payload->>'code_hash' !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  INSERT INTO public.connection_grants(id,user_id,provider,client_id,permissions,resource)
   VALUES((p_payload->>'grant_id')::uuid,a.actor_id,'opaque_oauth',a.client_id::text,a.scopes,a.resource) RETURNING * INTO g;
  INSERT INTO tournament_builder_private.oauth_codes(code_hash,request_id,grant_id,expires_at) VALUES(p_payload->>'code_hash',a.id,g.id,now()+interval '2 minutes');
  UPDATE tournament_builder_private.oauth_authorizations SET status='approved',grant_id=g.id WHERE id=a.id;
  RETURN jsonb_build_object('grant_id',g.id,'redirect_uri',a.redirect_uri,'state',a.state);
 ELSIF p_action='exchange_code' THEN
  SELECT * INTO code FROM tournament_builder_private.oauth_codes WHERE code_hash=p_payload->>'code_hash' FOR UPDATE;
  IF NOT FOUND OR code.consumed_at IS NOT NULL OR code.expires_at<=now() THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
  SELECT * INTO a FROM tournament_builder_private.oauth_authorizations WHERE id=code.request_id;
  SELECT * INTO c FROM tournament_builder_private.oauth_clients WHERE id=a.client_id;
  SELECT * INTO g FROM public.connection_grants WHERE id=code.grant_id FOR SHARE;
  IF g.status<>'active' OR g.revoked_at IS NOT NULL OR a.client_id::text IS DISTINCT FROM p_payload->>'client_id' OR a.redirect_uri IS DISTINCT FROM p_payload->>'redirect_uri' OR a.resource IS DISTINCT FROM p_payload->>'resource' OR a.code_challenge IS DISTINCT FROM p_payload->>'code_challenge' THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
  IF p_payload->>'access_hash' IS NULL OR p_payload->>'access_hash' !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  refresh_allowed:='refresh_token'=ANY(c.grant_types);
  IF refresh_allowed AND (p_payload->>'refresh_hash' IS NULL OR p_payload->>'refresh_hash' !~ '^[a-f0-9]{64}$') THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  INSERT INTO tournament_builder_private.oauth_families(id,grant_id) VALUES((p_payload->>'family_id')::uuid,g.id) RETURNING * INTO family;
  access_expiry:=now()+interval '1 hour';
  INSERT INTO tournament_builder_private.oauth_tokens(token_hash,kind,family_id,expires_at) VALUES(p_payload->>'access_hash','access',family.id,access_expiry);
  IF refresh_allowed THEN INSERT INTO tournament_builder_private.oauth_tokens(token_hash,kind,family_id,expires_at) VALUES(p_payload->>'refresh_hash','refresh',family.id,family.expires_at); END IF;
  UPDATE tournament_builder_private.oauth_codes SET consumed_at=now() WHERE code_hash=code.code_hash;
  RETURN tournament_builder_private.oauth_binding(g,access_expiry)||jsonb_build_object('expires_in',3600,'token_type','Bearer','refresh_allowed',refresh_allowed,'refresh_expires_at',family.expires_at);
 ELSIF p_action='refresh_token' THEN
  -- Lock family before token so concurrent rotations/reuse and family revocation share one order.
  SELECT f.* INTO family FROM tournament_builder_private.oauth_families f JOIN tournament_builder_private.oauth_tokens t ON t.family_id=f.id WHERE t.token_hash=p_payload->>'refresh_hash' AND t.kind='refresh' FOR UPDATE OF f;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
  SELECT * INTO token FROM tournament_builder_private.oauth_tokens WHERE token_hash=p_payload->>'refresh_hash' FOR UPDATE;
  SELECT * INTO g FROM public.connection_grants WHERE id=family.grant_id FOR SHARE;
  IF g.client_id IS DISTINCT FROM p_payload->>'client_id' OR g.resource IS DISTINCT FROM p_payload->>'resource' THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
  IF token.consumed_at IS NOT NULL THEN
   UPDATE tournament_builder_private.oauth_families SET revoked_at=coalesce(revoked_at,now()) WHERE id=family.id;
   RETURN jsonb_build_object('error','invalid_grant');
  END IF;
  IF token.revoked_at IS NOT NULL OR token.expires_at<=now() OR family.revoked_at IS NOT NULL OR family.expires_at<=now() OR g.status<>'active' OR g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error','invalid_grant'); END IF;
  IF p_payload->>'access_hash' IS NULL OR p_payload->>'access_hash' !~ '^[a-f0-9]{64}$' OR p_payload->>'new_refresh_hash' IS NULL OR p_payload->>'new_refresh_hash' !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  access_expiry:=least(now()+interval '1 hour',family.expires_at);
  INSERT INTO tournament_builder_private.oauth_tokens(token_hash,kind,family_id,expires_at,parent_hash) VALUES(p_payload->>'access_hash','access',family.id,access_expiry,token.token_hash),(p_payload->>'new_refresh_hash','refresh',family.id,family.expires_at,token.token_hash);
  UPDATE tournament_builder_private.oauth_tokens SET consumed_at=now() WHERE token_hash=token.token_hash;
  RETURN tournament_builder_private.oauth_binding(g,access_expiry)||jsonb_build_object('expires_in',greatest(0,floor(extract(epoch FROM access_expiry-now())))::integer,'token_type','Bearer','refresh_allowed',true,'refresh_expires_at',family.expires_at);
 ELSIF p_action='verify_token' THEN
  SELECT * INTO token FROM tournament_builder_private.oauth_tokens WHERE token_hash=p_payload->>'token_hash' AND kind='access';
  IF NOT FOUND OR token.expires_at<=now() OR token.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  SELECT * INTO family FROM tournament_builder_private.oauth_families WHERE id=token.family_id;
  SELECT * INTO g FROM public.connection_grants WHERE id=family.grant_id;
  IF family.revoked_at IS NOT NULL OR family.expires_at<=now() OR g.status<>'active' OR g.revoked_at IS NOT NULL OR g.resource IS DISTINCT FROM p_payload->>'resource' THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  RETURN tournament_builder_private.oauth_binding(g,token.expires_at);
 ELSIF p_action='revoke_token' THEN
  SELECT * INTO token FROM tournament_builder_private.oauth_tokens WHERE token_hash=p_payload->>'token_hash';
  IF NOT FOUND THEN RETURN jsonb_build_object('revoked',true); END IF;
  SELECT f.* INTO family FROM tournament_builder_private.oauth_families f JOIN public.connection_grants cg ON cg.id=f.grant_id WHERE f.id=token.family_id AND cg.client_id=p_payload->>'client_id' FOR UPDATE OF f;
  IF NOT FOUND THEN RETURN jsonb_build_object('revoked',true); END IF;
  IF token.kind='refresh' THEN UPDATE tournament_builder_private.oauth_families SET revoked_at=coalesce(revoked_at,now()) WHERE id=family.id;
  ELSE UPDATE tournament_builder_private.oauth_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE token_hash=token.token_hash; END IF;
  RETURN jsonb_build_object('revoked',true);
 ELSIF p_action='list_grants' THEN
  RETURN jsonb_build_object('grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',cg.id,'client_id',cg.client_id,'client_name',registered_client.client_name,'resource',cg.resource,'permissions',cg.permissions,'status',cg.status,'created_at',cg.created_at,'revoked_at',cg.revoked_at) ORDER BY cg.created_at DESC) FROM public.connection_grants cg JOIN tournament_builder_private.oauth_clients registered_client ON registered_client.id::text=cg.client_id WHERE cg.user_id=(p_payload->>'actor_id')::uuid AND cg.provider='opaque_oauth'),'[]'));
 ELSIF p_action='revoke_grant' THEN
  UPDATE public.connection_grants SET status='revoked',revoked_at=coalesce(revoked_at,now()) WHERE id=(p_payload->>'grant_id')::uuid AND user_id=(p_payload->>'actor_id')::uuid AND provider='opaque_oauth';
  IF NOT FOUND THEN RETURN jsonb_build_object('error','access_denied'); END IF;
  RETURN jsonb_build_object('revoked',true);
 END IF;
 RETURN jsonb_build_object('error','invalid_request');
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tournament_builder_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tb_oauth_store(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tb_oauth_store(text,jsonb) TO service_role;
COMMIT;

