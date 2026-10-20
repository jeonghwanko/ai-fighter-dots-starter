import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../api/handler.mjs';

test('admin authentication, private listing, atomic decisions, replay, stale reviews and capacity', async () => {
  const sql = new PGlite();
  try {
    await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      grant usage on schema auth to authenticated,service_role; grant select on auth.users to service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
      grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    // pg_net/Vault dispatch runs only on hosted Supabase; account/admin contracts do not depend on it.
    for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql') && !file.includes('dispatch')).sort()) await sql.exec(await readFile(new URL(name, dir), 'utf8'));
    const admin = crypto.randomUUID(), first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID();
    for (const [index,id] of [admin,first,second,third].entries()) await sql.query('insert into auth.users values($1,$2)', [id,`person${index}@example.com`]);
    await sql.query('insert into af_admins(owner_id) values($1)', [admin]);
    for (const id of [first,second,third]) await sql.query('insert into af_access_requests(owner_id,note) values($1,$2)', [id,'[Founding League]\nOriginal fighter']);
    // Neither a browser role nor a forged p_actor can use the service-only tables and functions.
    await sql.exec('set role authenticated');
    await assert.rejects(sql.query('select * from af_admins'), /permission denied/);
    await assert.rejects(sql.query('select * from af_access_reviews'), /permission denied/);
    await assert.rejects(sql.query('select af_admin_requests($1)', [admin]), /permission denied/);
    await sql.exec('reset role; set role service_role');
    const calls = [];
    const methods = {
      af_admin_account: ['p_actor'], af_admin_requests: ['p_actor','p_status','p_search','p_page'],
      af_admin_review: ['p_actor','p_owner','p_version','p_decision','p_reason'],
    };
    const tokens = { 'fixture-admin-token': admin, 'fixture-person-token': first };
    const handle = createHandler({ db: {
      auth: { getUser: async token => tokens[token] ? {data:{user:{id:tokens[token],user_metadata:{admin:true}}}} : {error:{message:'invalid'}} },
      rpc: async (name,args) => {
        calls.push({name,args}); const keys=methods[name];
        if (!keys) return {error:{message:'unexpected'}};
        try { return {data:(await sql.query(`select ${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) as result`,keys.map(key=>args[key]))).rows[0].result}; }
        catch (error) { return {error:{message:error.message}}; }
      },
    }});
    const call = (path, token = 'fixture-admin-token', body) => handle(new Request(`https://test/ai-fighter/admin/${path}`, {
      ...(body === undefined ? {} : {method:'POST',body:JSON.stringify(body)}),
      headers: token ? {authorization:`Bearer ${token}`} : {},
    }));
    assert.equal((await call('access-requests',null)).status,401);
    const denied = await call(`access-requests?actor=${admin}`,'fixture-person-token');
    assert.equal(denied.status,403); assert.equal((await denied.text()).includes('@example.com'),false);
    assert.equal((await call('me')).status,200);
    const listing = await call('access-requests');
    assert.equal(listing.headers.get('cache-control'),'no-store');
    const list = await listing.json(); assert.equal(list.total,3); assert.equal(list.counts.pending,3);
    assert.equal(list.applications.find(row=>row.ownerId===first).email,'person1@example.com');
    assert.equal((await (await call('access-requests?search=person2')).json()).total,1);
    assert.equal((await call('access-requests?status=garbage')).status,400);
    assert.equal((await call('access-requests?page=-1')).status,400);
    const application = list.applications.find(row=>row.ownerId===first);
    const body = {decision:'approved',version:application.updatedAt,reason:'Originality reviewed'};
    const review = () => call(`access-requests/${first}/review`,undefined,body);
    const reviewed = await review(); assert.equal(reviewed.status,200, JSON.stringify({body, response:await reviewed.json()}));
    assert.equal((await (await review()).json()).review.replayed,true);
    assert.equal((await sql.query('select count(*)::int as n from af_access_reviews')).rows[0].n,1);
    const account = (await sql.query('select af_account($1) as a',[first])).rows[0].a;
    assert.equal(account.invited,true); assert.equal(account.request.status,'approved');
    assert.ok(Date.parse(account.expiresAt)>Date.now()+29*86400000);
    assert.equal((await call(`access-requests/${first}/review`,undefined,{...body,decision:'declined'})).status,409);
    assert.equal((await call(`access-requests/${second}/review`,undefined,{decision:'approved',version:application.updatedAt,actor:admin})).status,400);
    const rejection = list.applications.find(row=>row.ownerId===second);
    assert.equal((await call(`access-requests/${second}/review`,undefined,{decision:'declined',version:rejection.updatedAt,reason:'Needs a fighter concept'})).status,200);
    assert.equal((await sql.query('select af_account($1) as a',[second])).rows[0].a.invited,false);
    await assert.rejects(sql.query('select af_request_access($1,$2)',[second,'retry']),/request-declined/);
    const stale = list.applications.find(row=>row.ownerId===third);
    await sql.query("update af_access_requests set updated_at=updated_at+interval '1 second' where owner_id=$1",[third]);
    assert.equal((await call(`access-requests/${third}/review`,undefined,{decision:'approved',version:stale.updatedAt})).status,409);
    await sql.exec('reset role');
    for (let i=0;i<19;i++) { const id=crypto.randomUUID(); await sql.query('insert into auth.users(id) values($1)',[id]); await sql.query('insert into af_creators(owner_id) values($1)',[id]); }
    await sql.exec('set role service_role');
    const latest = (await (await call('access-requests')).json()).applications.find(row=>row.ownerId===third);
    const capped = await call(`access-requests/${third}/review`,undefined,{decision:'approved',version:latest.updatedAt});
    assert.equal(capped.status,409); assert.equal((await capped.json()).code,'beta-capacity');
    assert.equal((await sql.query('select af_account($1) as a',[third])).rows[0].a.request.status,'pending');
    assert.equal((await sql.query('select count(*)::int as n from af_access_reviews')).rows[0].n,2);
    await sql.query('update af_admins set enabled=false where owner_id=$1',[admin]);
    assert.equal((await call('access-requests')).status,403);
    assert.equal(calls.find(c=>c.name==='af_admin_account').args.p_actor,first);
  } finally { await sql.close(); }
});
