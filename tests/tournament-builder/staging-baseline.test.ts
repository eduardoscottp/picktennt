import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const baseline=()=>readFileSync(resolve('scripts/tournament-builder/staging-baseline.sql'),'utf8');
async function managedShell(ref='abcdefghijklmnopqrst'){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 SET tournament_builder.staging_project_ref='${ref}';`);return db;
}

test('empty staging baseline reconstructs live core and applies only the two named modular migrations',async()=>{
 const db=await managedShell();try{
  await db.exec(baseline());
  assert.equal(Number((await db.query<{n:number}>("SELECT count(*) n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].n),10);
  assert.equal(Number((await db.query<{n:number}>("SELECT count(*) n FROM information_schema.columns WHERE table_schema='public'")).rows[0].n),103);
  assert.equal(Number((await db.query<{n:number}>("SELECT count(*) n FROM pg_policies WHERE schemaname='public'")).rows[0].n),28);
  assert.equal(Number((await db.query<{n:number}>("SELECT count(*) n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype<>'n'")).rows[0].n),65);
  assert.equal(Number((await db.query<{n:number}>("SELECT count(*) n FROM pg_indexes WHERE schemaname='public'")).rows[0].n),32);
  assert.equal(Number((await db.query<{n:number}>("SELECT count(*) n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")).rows[0].n),10);
  for(const name of ['202610280001_tournament_builder.sql','202610280002_tournament_connector_oauth.sql'])await db.exec(readFileSync(resolve('supabase/migrations',name),'utf8'));
  const actor='00000000-0000-4000-8000-000000000001',event='00000000-0000-4000-8000-000000000002',operation='00000000-0000-4000-8000-000000000003';
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'synthetic@example.invalid','{\"given_name\":\"Synthetic\",\"time_zone\":\"America/New_York\"}')",[actor]);
  assert.equal((await db.query<{time_zone:string}>('SELECT time_zone FROM profiles WHERE id=$1',[actor])).rows[0].time_zone,'America/New_York');
  await db.exec('SET ROLE service_role');
  const result=await db.query<{r:{revision:number}}>("SELECT tb_apply_command($1,'web',$2,$3,'createDraft',$4,NULL,'{}','{\"event\":{}}','{}',NULL) r",[actor,operation,'a'.repeat(64),event]);assert.equal(Number(result.rows[0].r.revision),1);
  const oauth=await db.query<{r:{client_id:string}}>("SELECT tb_oauth_store('register_client','{\"client_name\":\"Staging\",\"redirect_uris\":[\"https://client.example.invalid/cb\"],\"grant_types\":[\"authorization_code\"],\"response_types\":[\"code\"],\"token_endpoint_auth_method\":\"none\"}') r");assert.ok(oauth.rows[0].r.client_id);
 }finally{await db.close();}
});

test('baseline refuses production, a nonempty public schema, and an existing auth population without dropping anything',async()=>{
 for(const kind of ['production','unknown-table','auth-user'] as const){
  const db=await managedShell(kind==='production'?'qmiljmxnnryhuaudpuff':'abcdefghijklmnopqrst');try{
   if(kind==='unknown-table')await db.exec('CREATE TABLE public.keep_me(id integer); INSERT INTO public.keep_me VALUES(7);');
   if(kind==='auth-user')await db.exec("INSERT INTO auth.users(id,email) VALUES(gen_random_uuid(),'existing@example.invalid');");
   await assert.rejects(db.exec(baseline()),/STAGING_ONLY|EMPTY_PROJECT_REQUIRED/);
   await db.exec('ROLLBACK');
   assert.equal((await db.query<{r:string|null}>("SELECT to_regclass('public.tournaments')::text r")).rows[0].r,null);
   if(kind==='unknown-table')assert.equal((await db.query<{id:number}>('SELECT id FROM public.keep_me')).rows[0].id,7);
  }finally{await db.close();}
 }
});

test('package generator refuses production and bundles only the reviewed baseline and exact named migrations',async()=>{
 const {stagingPackage,selectedFiles}=await import('../../scripts/tournament-builder/setup-staging.mjs');
 assert.throws(()=>stagingPackage('qmiljmxnnryhuaudpuff'),/STAGING_ONLY/);
 assert.throws(()=>stagingPackage('bad-ref'),/STAGING_ONLY/);
 const plan=stagingPackage('abcdefghijklmnopqrst');assert.equal(plan.manifest.applies_remotely,false);
 assert.deepEqual(selectedFiles,['scripts/tournament-builder/staging-baseline.sql','supabase/migrations/202610280001_tournament_builder.sql','supabase/migrations/202610280002_tournament_connector_oauth.sql']);
 assert.equal((plan.sql.match(/^BEGIN;$/gm)??[]).length,1);assert.equal((plan.sql.match(/^COMMIT;$/gm)??[]).length,1);
 const db=await managedShell();try{await db.exec(plan.sql);assert.ok((await db.query<{r:string}>("SELECT to_regclass('public.tournament_operations')::text r")).rows[0].r);}finally{await db.close();}
});

test('hosted concurrency harness rejects production and mismatched target URLs before any request',async()=>{
 const {hostedTarget}=await import('../../scripts/tournament-builder/hosted-concurrency.mjs');
 assert.throws(()=>hostedTarget('qmiljmxnnryhuaudpuff','https://qmiljmxnnryhuaudpuff.supabase.co'),/STAGING_ONLY/);
 assert.throws(()=>hostedTarget('abcdefghijklmnopqrst','https://qmiljmxnnryhuaudpuff.supabase.co'),/STAGING_ONLY/);
 assert.throws(()=>hostedTarget('abcdefghijklmnopqrst','https://abcdefghijklmnopqrst.supabase.co.evil.invalid'),/STAGING_ONLY/);
 assert.equal(hostedTarget('abcdefghijklmnopqrst','https://abcdefghijklmnopqrst.supabase.co'),'https://abcdefghijklmnopqrst.supabase.co');
});


