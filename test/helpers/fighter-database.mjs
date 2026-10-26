import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
// Hosted pg_net/Vault dispatch runs only on hosted Supabase and is unavailable in PGlite.
export const migrationNames = async () => (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && !name.includes('dispatch')).sort();
export const applyMigration = async (db, name) => db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
// A stand-in for the hosted Supabase platform, shared so a migration that starts relying on another
// platform role or function is added here once instead of drifting in each test's own copy.
export async function supabasePlatform() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create table auth.users(id uuid primary key,email text,encrypted_password text);
    create table auth.oauth_clients(id uuid primary key, deleted_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,oauth_client_id uuid,not_after timestamptz,scopes text);
    create table auth.oauth_consents(user_id uuid,client_id uuid,revoked_at timestamptz,scopes text);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated,service_role;
    create function auth.jwt() returns jsonb language sql as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;
    create schema cron; create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';`);
  return db;
}
export async function migratedDatabase() {
  const db = await supabasePlatform();
  for (const name of await migrationNames()) await applyMigration(db, name);
  return db;
}
