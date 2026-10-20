import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { claimsFor } from './auth.mjs';
import { createHandler } from '../../api/handler.mjs';
export const project = 'https://abcdefghijklmnopqrst.supabase.co';
export const resource = `${project}/functions/v1/ai-fighter`;
export async function connectionDatabase({ beforeConnectionSQL } = {}) {
  const sql = new PGlite(), owner = crypto.randomUUID(), other = crypto.randomUUID();
  await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to service_role; grant select,insert on storage.objects to service_role;`);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) await sql.exec(await readFile(new URL(name, dir), 'utf8'));
  if (beforeConnectionSQL) await beforeConnectionSQL({ sql, owner, other });
  await sql.exec(await readFile(new URL('../../supabase/pending/agent-connections.sql', import.meta.url), 'utf8'));
  await sql.query('insert into auth.users values($1),($2)', [owner, other]);
  await sql.query('insert into af_creators(owner_id) values($1),($2)', [owner, other]);
  await sql.exec("update af_connection_clients set enabled=true; set role service_role;");
  const claims = new Map([['fixture-owner-token', claimsFor(owner, { iss: `${project}/auth/v1` })],
    ['fixture-other-token', claimsFor(other, { iss: `${project}/auth/v1` })]]);
  const objects = new Map();
  const db = {
    auth: { getClaims: async token => ({ data: { claims: claims.get(token) } }) },
    rpc: async (name, args) => {
      try {
        const entries = Object.entries(args);
        const call = `public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')})`;
        const rows = (await sql.query(`select to_jsonb(${call}) as value`, entries.map(([, v]) => v))).rows;
        return { data: name === 'af_owned_fighter_statistics' ? rows.map(r => r.value) : rows[0]?.value };
      } catch (error) { return { error }; }
    },
    from: table => {
      let columns = '*'; const conditions = [], values = [];
      const q = { select: value => { columns = value; return q; }, eq: (key, value) => {
        values.push(value); conditions.push(`${key}=$${values.length}`); return q;
      }, maybeSingle: async () => {
        const rows = (await sql.query(`select ${columns} from public.${table} where ${conditions.join(' and ') || 'true'}`, values)).rows;
        return { data: rows[0] ?? null };
      } };
      return q;
    },
    storage: { from: bucket => ({
      upload: async (key, bytes, options) => {
        if (options.upsert || objects.has(key)) return { error: new Error('immutable') };
        objects.set(key, new Blob([bytes]));
        await sql.query('insert into storage.objects values($1,$2,$3)', [bucket, key, { size: bytes.length }]);
        return { data: { path: key } };
      },
      download: async key => ({ data: objects.get(key) }),
    }) },
  };
  const handle = createHandler({ db, issuer: `${project}/auth/v1`, resource });
  const send = async (route, { token = 'fixture-owner-token', method = 'POST', body, headers = {} } = {}) => {
    const response = await handle(new Request(`${resource}/${route}`, { method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...headers },
      ...(['GET', 'OPTIONS'].includes(method) ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body ?? {}) }) }));
    return { status: response.status, data: await response.json(), response };
  };
  return { sql, owner, other, claims, db, handle, send, objects };
}
