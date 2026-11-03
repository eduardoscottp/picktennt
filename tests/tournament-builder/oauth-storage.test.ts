import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { storageDatabase,role,command,owner,stranger } from './helpers/storage-db';
let db:PGlite;
const migration=resolve('supabase/migrations/202610280002_tournament_connector_oauth.sql');
const resource='https://app.picktennt.com/api/mcp';
const redirect='https://client.example.invalid/callback';
const challenge='x'.repeat(43);
const digest=()=>createHash('sha256').update(randomUUID()).digest('hex');
before(async()=>{ db=await storageDatabase(); if(existsSync(migration))await db.exec(readFileSync(migration,'utf8')); for(const name of ['202610280008_tournament_connector_administration.sql','202610280009_tournament_connector_owner_actions.sql'])await db.exec(readFileSync(`supabase/migrations/${name}`,'utf8')); });
after(async()=>{await db?.close();});
async function store(action:string,payload:Record<string,unknown>={}){
 return role(db,'service_role',owner,async()=>{
  const r=await db.query<{r:Record<string,unknown>}>('SELECT tb_oauth_store($1,$2::jsonb) r',[action,JSON.stringify(payload)]);return r.rows[0].r;
 });
}
async function client(){return store('register_client',{client_name:'Test connector',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'});}
async function authorized(permissions=['draft:read','draft:create','draft:update'],actor=owner){
 const c=await client(),id=randomUUID(),grant=randomUUID(),code=digest();
 await store('create_authorization',{id,client_id:c.client_id,redirect_uri:redirect,resource,scopes:permissions,state:'opaque-state',actor_id:actor,csrf_hash:'c'.repeat(64),code_challenge:challenge,expires_at:new Date(Date.now()+600_000).toISOString()});
 const approved=await store('approve_authorization',{request_id:id,actor_id:actor,csrf_hash:'c'.repeat(64),grant_id:grant,code_hash:code});
 assert.equal(approved.grant_id,grant);return {c,id,grant,code};
}
async function exchanged(permissions=['draft:read','draft:create','draft:update'],actor=owner){
 const a=await authorized(permissions,actor),access=digest(),refresh=digest(),family=randomUUID();
 const binding={code_hash:a.code,client_id:a.c.client_id,redirect_uri:redirect,resource,code_challenge:challenge,access_hash:access,refresh_hash:refresh,family_id:family};
 const r=await store('exchange_code',binding);assert.equal(r.user_id,actor);return {...a,access,refresh,family,binding};
}

test('opaque storage installs independently of Supabase token issuance',async()=>{
 const r=await db.query<{r:string|null}>("SELECT to_regclass('tournament_builder_private.oauth_tokens')::text r");assert.equal(r.rows[0].r,'tournament_builder_private.oauth_tokens');
});

test('DCR validates public-client methods, fixed redirects and grant types',async()=>{
 const c=await client();assert.equal(c.token_endpoint_auth_method,'none');assert.deepEqual(c.grant_types,['authorization_code','refresh_token']);
 assert.deepEqual(await store('get_client',{client_id:c.client_id}),c);
 for(const bad of [{redirect_uris:['https://evil.invalid/cb#fragment']},{redirect_uris:['http://remote.example.invalid/cb']},{token_endpoint_auth_method:'client_secret_post'},{grant_types:['client_credentials']},{response_types:['token']}]){
  const result=await store('register_client',{client_name:'Bad',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none',...bad});assert.equal(result.error,'invalid_client_metadata');
 }
});

test('code exchange atomically checks all bindings and consumes one code only once',async()=>{
 const a=await authorized(),access=digest(),refresh=digest(),family=randomUUID();
 const input={code_hash:a.code,client_id:a.c.client_id,redirect_uri:redirect,resource,code_challenge:challenge,access_hash:access,refresh_hash:refresh,family_id:family};
 for(const bad of [{code_challenge:'y'.repeat(43)},{redirect_uri:redirect+'/other'},{resource:resource+'/other'},{client_id:randomUUID()}]) assert.equal((await store('exchange_code',{...input,...bad})).error,'invalid_grant');
 assert.equal((await store('exchange_code',input)).user_id,owner);
 assert.equal((await store('exchange_code',{...input,access_hash:digest(),refresh_hash:digest(),family_id:randomUUID()})).error,'invalid_grant');
 assert.equal((await store('verify_token',{token_hash:access,resource})).grant_id,a.grant);
 assert.equal((await store('verify_token',{token_hash:access,resource:resource+'/other'})).error,'invalid_token');
 const columns=await db.query<{column_name:string}>("SELECT column_name FROM information_schema.columns WHERE table_schema='tournament_builder_private' AND table_name='oauth_tokens'");
 assert.ok(!columns.rows.some(r=>['token','access_token','refresh_token','secret'].includes(r.column_name)));
});

test('refresh reuse revokes its complete family and the revocation commits with an error response',async()=>{
 const x=await exchanged(),nextAccess=digest(),nextRefresh=digest();
 const r=await store('refresh_token',{refresh_hash:x.refresh,client_id:x.c.client_id,resource,access_hash:nextAccess,new_refresh_hash:nextRefresh});assert.equal(r.user_id,owner);
 assert.equal((await store('verify_token',{token_hash:nextAccess,resource})).user_id,owner);
 assert.equal((await store('refresh_token',{refresh_hash:x.refresh,client_id:x.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()})).error,'invalid_grant');
 for(const hash of [x.access,nextAccess])assert.equal((await store('verify_token',{token_hash:hash,resource})).error,'invalid_token');
 assert.equal((await store('refresh_token',{refresh_hash:nextRefresh,client_id:x.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()})).error,'invalid_grant');
});

test('admin and owner scope exchange and exact-set refresh do not elevate or narrow existing permissions',async()=>{
 for(const permissions of [['admin:manage'],['owner:manage'],['draft:create','draft:read','draft:update','operation:read','admin:manage'],['draft:create','draft:read','draft:update','operation:read','admin:manage','owner:manage']]){
  const x=await exchanged(permissions);
  assert.deepEqual((await store('verify_token',{token_hash:x.access,resource})).scopes,permissions);
  const payload={refresh_hash:x.refresh,client_id:x.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()};
  for(const requested_scopes of [[],['draft:read'],['admin:manage','draft:read','unrecognized'],null])assert.equal((await store('refresh_token',{...payload,requested_scopes})).error,'invalid_scope');
  const token=await db.query<{consumed_at:string|null}>('SELECT consumed_at FROM tournament_builder_private.oauth_tokens WHERE token_hash=$1',[x.refresh]);assert.equal(token.rows[0].consumed_at,null);
  const refreshed=await store('refresh_token',{...payload,requested_scopes:[...permissions].reverse()});assert.deepEqual(refreshed.scopes,permissions);
  assert.deepEqual((await store('verify_token',{token_hash:payload.access_hash,resource})).scopes,permissions);
 }
 const old=await exchanged(['draft:create','draft:read','draft:update','operation:read']);
 const payload={refresh_hash:old.refresh,client_id:old.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()};
 assert.equal((await store('refresh_token',{...payload,requested_scopes:['draft:create','draft:read','draft:update','operation:read','admin:manage']})).error,'invalid_scope');
 assert.deepEqual((await store('refresh_token',payload)).scopes,['draft:create','draft:read','draft:update','operation:read']);
});

test('replaying a consumed refresh with a different scope still revokes the entire family',async()=>{
 const x=await exchanged(['admin:manage']),access=digest(),refresh=digest();
 assert.equal((await store('refresh_token',{refresh_hash:x.refresh,client_id:x.c.client_id,resource,access_hash:access,new_refresh_hash:refresh})).user_id,owner);
 assert.equal((await store('refresh_token',{refresh_hash:x.refresh,client_id:x.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest(),requested_scopes:['draft:read']})).error,'invalid_grant');
 assert.equal((await store('verify_token',{token_hash:access,resource})).error,'invalid_token');
 assert.equal((await store('refresh_token',{refresh_hash:refresh,client_id:x.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()})).error,'invalid_grant');
});

test('admin grants require current event authority, actor/client binding and live permissions; owner website actions stay excluded',async()=>{
 const event=randomUUID();await command(db,{event});
 const x=await exchanged(['admin:manage']);
 const read=(actor:string,clientId:unknown,grant:string)=>role(db,'service_role',actor,()=>db.query('SELECT tb_get_snapshot($1,$2,$3,$4)',[actor,clientId,event,grant]));
 await read(owner,x.c.client_id,x.grant);
 await assert.rejects(read(stranger,x.c.client_id,x.grant),/FORBIDDEN/);
 await assert.rejects(read(owner,randomUUID(),x.grant),/FORBIDDEN/);
 const other=await exchanged(['admin:manage'],stranger);await assert.rejects(read(stranger,other.c.client_id,other.grant),/FORBIDDEN/);
 for(const ownerAction of ['publishTournament','reopenResults','cancelTournament'])await assert.rejects(command(db,{event,client:String(x.c.client_id),grant:x.grant,command:ownerAction,revision:1,effects:{}}),/FORBIDDEN/);
 await db.query("UPDATE connection_grants SET permissions='{}' WHERE id=$1",[x.grant]);await assert.rejects(read(owner,x.c.client_id,x.grant),/FORBIDDEN/);
 await db.query("UPDATE connection_grants SET permissions=ARRAY['admin:manage'] WHERE id=$1",[x.grant]);await read(owner,x.c.client_id,x.grant);
 await store('revoke_grant',{actor_id:owner,grant_id:x.grant});
 await assert.rejects(read(owner,x.c.client_id,x.grant),/GRANT_REVOKED/);
 assert.equal((await store('verify_token',{token_hash:x.access,resource})).error,'invalid_token');
});

test('owner actions require a fresh owner grant, current actual owner and explicit structural proof; migration is idempotent',async()=>{
 const event=randomUUID();await command(db,{event});
 const scope=await exchanged(['owner:manage']),admin=await exchanged(['admin:manage']),draft=await exchanged(['draft:read','draft:create','draft:update','operation:read']),nonowner=await exchanged(['owner:manage'],stranger);
 const proof={confirmed_owner_action:true,reviewed_action_hash:'a'.repeat(64)};
 const authorize=(actor:string,clientId:unknown,grant:string|null,action:string,request:unknown)=>db.query('SELECT tournament_builder_private.authorize($1,$2,$3,$4,$5::jsonb,$6)',[actor,clientId,event,action,JSON.stringify(request),grant]);
 for(const action of ['publishTournament','cancelTournament','reopenResults','addAdministrator','removeAdministrator']){
  await authorize(owner,scope.c.client_id,scope.grant,action,proof);
  await authorize(owner,'web',null,action,{});
  for(const request of [{},{...proof,confirmed_owner_action:false},{...proof,reviewed_action_hash:'short'}])await assert.rejects(authorize(owner,scope.c.client_id,scope.grant,action,request),/FORBIDDEN/);
  for(const old of [admin,draft])await assert.rejects(authorize(owner,old.c.client_id,old.grant,action,proof),/FORBIDDEN/);
  await assert.rejects(authorize(stranger,nonowner.c.client_id,nonowner.grant,action,proof),/FORBIDDEN/);
 }
 await assert.rejects(authorize(owner,scope.c.client_id,scope.grant,'addRegisteredEntry',proof),/FORBIDDEN/);
 await assert.rejects(authorize(owner,scope.c.client_id,scope.grant,'addGuestEntry',proof),/ACCOUNT_REQUIRED/);
 await role(db,'service_role',owner,()=>db.query('SELECT tb_get_snapshot($1,$2,$3,$4)',[owner,scope.c.client_id,event,scope.grant]));
 const permissionsBefore=await db.query<{id:string;permissions:string[]}>('SELECT id,permissions FROM connection_grants ORDER BY id');
 const migration=readFileSync('supabase/migrations/202610280009_tournament_connector_owner_actions.sql','utf8');
 await db.exec(migration);
 assert.deepEqual((await db.query('SELECT id,permissions FROM connection_grants ORDER BY id')).rows,permissionsBefore.rows);
 await authorize(owner,scope.c.client_id,scope.grant,'publishTournament',proof);
 await store('revoke_grant',{actor_id:owner,grant_id:scope.grant});
 await assert.rejects(authorize(owner,scope.c.client_id,scope.grant,'publishTournament',proof),/GRANT_REVOKED/);
 assert.equal((await store('verify_token',{token_hash:scope.access,resource})).error,'invalid_token');
});

test('owner revocation and permission reduction take effect on the next access lookup',async()=>{
 const x=await exchanged();
 await db.query("UPDATE connection_grants SET permissions=ARRAY['draft:read'] WHERE id=$1",[x.grant]);
 assert.deepEqual((await store('verify_token',{token_hash:x.access,resource})).scopes,['draft:read']);
 assert.equal((await store('revoke_grant',{actor_id:stranger,grant_id:x.grant})).error,'access_denied');
 assert.equal((await store('list_grants',{actor_id:owner})).grants instanceof Array,true);
 assert.equal((await store('revoke_grant',{actor_id:owner,grant_id:x.grant})).revoked,true);
 assert.equal((await store('verify_token',{token_hash:x.access,resource})).error,'invalid_token');
 assert.equal((await store('refresh_token',{refresh_hash:x.refresh,client_id:x.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()})).error,'invalid_grant');
});

test('request denial/expiry and malformed token digests do not issue credentials',async()=>{
 const c=await client(),id=randomUUID();
 await store('create_authorization',{id,client_id:c.client_id,redirect_uri:redirect,resource,scopes:['draft:read'],state:'deny-state',actor_id:owner,csrf_hash:'c'.repeat(64),code_challenge:challenge,expires_at:new Date(Date.now()+60_000).toISOString()});
 assert.equal((await store('deny_authorization',{request_id:id,actor_id:owner,csrf_hash:'c'.repeat(64)})).denied,true);
 assert.equal((await store('approve_authorization',{request_id:id,actor_id:owner,csrf_hash:'c'.repeat(64),grant_id:randomUUID(),code_hash:digest()})).error,'invalid_request');
 const x=await exchanged(); await db.query("UPDATE tournament_builder_private.oauth_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[x.access]);
 assert.equal((await store('verify_token',{token_hash:x.access,resource})).error,'invalid_token');
 assert.equal((await store('verify_token',{token_hash:'raw-token',resource})).error,'invalid_token');
});

test('RPC execution and storage are inaccessible to ordinary roles; even server role has no direct token writes',async()=>{
 for(const r of ['anon','authenticated'] as const) await assert.rejects(role(db,r,owner,()=>db.query("SELECT tb_oauth_store('list_grants',$1::jsonb)",[JSON.stringify({actor_id:owner})])),/permission denied/);
 await assert.rejects(role(db,'service_role',owner,()=>db.exec('SELECT * FROM tournament_builder_private.oauth_tokens')),/permission denied/);
 const grants=await db.query<{execute:boolean}>("SELECT has_function_privilege('anon','public.tb_oauth_store(text,jsonb)','EXECUTE') AS execute");assert.equal(grants.rows[0].execute,false);
});

test('persistent rate limits retain consumed counts and distinguish buckets',async()=>{
 const key=digest(); for(let i=0;i<10;i++)assert.equal((await store('rate_limit',{key_hash:key,bucket:'register'})).allowed,true);
 const denied=await store('rate_limit',{key_hash:key,bucket:'register'});assert.equal(denied.allowed,false);assert.ok(Number(denied.retry_after)>0);
 assert.equal((await store('rate_limit',{key_hash:key,bucket:'token'})).allowed,true);
});


test('pending consent binds the exact signed-in actor and original browser proof',async()=>{
 const c=await client(),id=randomUUID(),grant=randomUUID(),code=digest();
 await store('create_authorization',{id,client_id:c.client_id,redirect_uri:redirect,resource,scopes:['draft:read'],state:'bound-state',actor_id:owner,csrf_hash:'c'.repeat(64),code_challenge:challenge,expires_at:new Date(Date.now()+60_000).toISOString()});
 for(const bad of [{actor_id:stranger,csrf_hash:'c'.repeat(64)},{actor_id:owner,csrf_hash:'d'.repeat(64)}]) assert.equal((await store('approve_authorization',{request_id:id,grant_id:grant,code_hash:code,...bad})).error,'access_denied');
 const details=await store('get_authorization',{request_id:id});assert.equal(details.actor_id,owner);assert.equal('csrf_hash' in details,false);
 assert.equal((await store('approve_authorization',{request_id:id,actor_id:owner,csrf_hash:'c'.repeat(64),grant_id:grant,code_hash:code})).grant_id,grant);
});

test('RFC7009 revocation binds the client and refresh revocation ends the entire family',async()=>{
 const x=await exchanged();
 await store('revoke_token',{token_hash:x.refresh,client_id:randomUUID()});assert.equal((await store('verify_token',{token_hash:x.access,resource})).user_id,owner);
 await store('revoke_token',{token_hash:x.refresh,client_id:x.c.client_id});assert.equal((await store('verify_token',{token_hash:x.access,resource})).error,'invalid_token');
 const y=await exchanged();await store('revoke_token',{token_hash:y.access,client_id:y.c.client_id});assert.equal((await store('verify_token',{token_hash:y.access,resource})).error,'invalid_token');
 assert.equal((await store('refresh_token',{refresh_hash:y.refresh,client_id:y.c.client_id,resource,access_hash:digest(),new_refresh_hash:digest()})).user_id,owner);
});

test('authorization-code-only clients receive no refresh token; expired code cannot mint access',async()=>{
 const c=await store('register_client',{client_name:'No refresh',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'});
 const id=randomUUID(),code=digest();
 await store('create_authorization',{id,client_id:c.client_id,redirect_uri:redirect,resource,scopes:['draft:read'],state:'state',actor_id:owner,csrf_hash:'c'.repeat(64),code_challenge:challenge,expires_at:new Date(Date.now()+60_000).toISOString()});
 await store('approve_authorization',{request_id:id,actor_id:owner,csrf_hash:'c'.repeat(64),grant_id:randomUUID(),code_hash:code});
 const input={code_hash:code,client_id:c.client_id,redirect_uri:redirect,resource,code_challenge:challenge,access_hash:digest(),family_id:randomUUID()};
 assert.equal((await store('exchange_code',input)).refresh_allowed,false);
 const a=await authorized();await db.query("UPDATE tournament_builder_private.oauth_codes SET expires_at=now()-interval '1 second' WHERE code_hash=$1",[a.code]);
 assert.equal((await store('exchange_code',{...input,code_hash:a.code,client_id:a.c.client_id,access_hash:digest(),refresh_hash:digest(),family_id:randomUUID()})).error,'invalid_grant');
});
