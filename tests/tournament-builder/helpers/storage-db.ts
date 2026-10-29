import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const owner = '00000000-0000-4000-8000-000000000001';
export const player = '00000000-0000-4000-8000-000000000002';
export const stranger = '00000000-0000-4000-8000-000000000003';
export const migration = resolve('supabase/migrations/202610280001_tournament_builder.sql');

export async function storageDatabase() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const initial = readFileSync(resolve('supabase/migrations/001_initial_schema.sql'), 'utf8');
  await db.exec(initial.split('-- ROW LEVEL SECURITY')[0].replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', ''));
  for (const name of ['006_bracket_columns.sql','008_tournament_date_and_court_info.sql','009_admin_is_playing.sql','010_player_exit_fields.sql']) {
    await db.exec(readFileSync(resolve('supabase/migrations', name), 'utf8'));
  }
  // Additions and helper/policy behavior verified in the 2026-10-28 live catalog.
  await db.exec(`ALTER TABLE profiles ADD username text, ADD time_zone text;
    ALTER TABLE tournaments ADD is_open boolean NOT NULL DEFAULT false;
    CREATE FUNCTION is_tournament_admin(t_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM tournament_admins WHERE tournament_id=t_id AND user_id=auth.uid()) $$;
    CREATE FUNCTION is_tournament_member(t_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM tournament_players WHERE tournament_id=t_id AND user_id=auth.uid() AND status='approved') $$;
    ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tournaments_read_public ON tournaments FOR SELECT USING(is_public OR is_tournament_admin(id) OR is_tournament_member(id));
    CREATE POLICY tournaments_insert_auth ON tournaments FOR INSERT WITH CHECK(auth.uid()=created_by);
    CREATE POLICY tournaments_update_admin ON tournaments FOR UPDATE USING(is_tournament_admin(id));
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_read_own ON profiles FOR SELECT TO authenticated USING(id=auth.uid());
    ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
    CREATE POLICY teams_manage_admin ON teams FOR ALL USING(is_tournament_admin(tournament_id));
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${owner}','owner@example.invalid','{"given_name":"Organizer"}'),
      ('${player}','player@example.invalid','{"given_name":"Player"}'),
      ('${stranger}','stranger@example.invalid','{"given_name":"Stranger"}');`);
  if (existsSync(migration)) await db.exec(readFileSync(migration, 'utf8'));
  const restOverride = resolve('supabase/migrations/202610280003_tournament_admin_rest_override.sql');
  if (existsSync(restOverride)) await db.exec(readFileSync(restOverride, 'utf8'));
  const noRest = resolve('supabase/migrations/202610280004_remove_tournament_rest_constraint.sql');
  if (existsSync(noRest)) await db.exec(readFileSync(noRest, 'utf8'));
  const guests = resolve('supabase/migrations/202610280005_tournament_guest_entries.sql');
  if (existsSync(guests)) await db.exec(readFileSync(guests, 'utf8'));
  const accounts = resolve('supabase/migrations/202610280006_require_picktennt_accounts.sql');
  if (existsSync(accounts)) await db.exec(readFileSync(accounts, 'utf8'));
  const registered = resolve('supabase/migrations/202610280007_tournament_registered_entries.sql');
  if (existsSync(registered)) await db.exec(readFileSync(registered, 'utf8'));
  const administration = resolve('supabase/migrations/202610280008_tournament_connector_administration.sql');
  if (existsSync(administration)) await db.exec(readFileSync(administration, 'utf8'));
  const ownerActions = resolve('supabase/migrations/202610280009_tournament_connector_owner_actions.sql');
  if (existsSync(ownerActions)) await db.exec(readFileSync(ownerActions, 'utf8'));
  const administrators = resolve('supabase/migrations/202610280010_tournament_administrator_management.sql');
  if (existsSync(administrators)) await db.exec(readFileSync(administrators, 'utf8'));
  const revisions = resolve('supabase/migrations/202610290001_tournament_revisions.sql');
  if (existsSync(revisions)) await db.exec(readFileSync(revisions, 'utf8'));
  return db;
}
export async function role<T>(db: PGlite, name: 'anon'|'authenticated'|'service_role', actor: string, fn: () => Promise<T>) {
  await db.exec(`SET ROLE ${name}; SET request.jwt.claim.sub='${actor}';`);
  try { return await fn(); } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub;'); }
}

export type Command = {
  actor?: string; client?: string; operation?: string; hash?: string; command?: string;
  event: string; revision?: number|null; request?: unknown; effects?: unknown; result?: unknown; grant?: string|null;
};
export async function command(db: PGlite, input: Command) {
  const args = [input.actor ?? owner,input.client ?? 'web',input.operation ?? crypto.randomUUID(),input.hash ?? 'a'.repeat(64),input.command ?? 'createDraft',input.event,input.revision ?? null,JSON.stringify(input.request ?? {}),JSON.stringify(input.effects ?? {event:{name:'Draft'}}),JSON.stringify(input.result ?? {}),input.grant ?? null];
  return role(db,'service_role',input.actor ?? owner,async () => {
    const result = await db.query<{receipt: Record<string,unknown>}>(`SELECT public.tb_apply_command($1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::uuid,$7::bigint,$8::jsonb,$9::jsonb,$10::jsonb,$11::uuid) AS receipt`,args);
    return result.rows[0].receipt;
  });
}
