import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { sha256, VALIDATOR_VERSION } from '../api/handler.mjs';

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
    grant usage on schema storage to service_role; grant select on storage.objects to service_role;`);
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(name => name.endsWith('.sql') && !name.includes('dispatch')).sort()) await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  return db;
}

test('Postgres enforces invite, immutability, queue, leases, unique registration and RLS', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), key = crypto.randomUUID();
    await db.query('insert into auth.users values($1),($2)', [owner, other]);
    await db.query('insert into public.af_creators(owner_id) values($1),($2)', [owner, other]);
    const text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text)), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const create = (who, k, t = text, hash = sha) => db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value', [who, k, t, hash, bytes]).then(r => r.rows[0].value);
    const row = await create(owner, key);
    await assert.rejects(db.query('update public.af_submissions set manifest_text=manifest_text||$1 where id=$2', [' ',row.id]), /immutable-submission/);
    assert.equal((await create(owner, key)).id, row.id);
    await assert.rejects(create(owner, key, text + ' ', 'f'.repeat(64)), /idempotency-conflict/);
    await assert.rejects(create(owner, crypto.randomUUID()), /open-submission-exists/);
    await assert.rejects(db.query('select public.af_submit($1,$2)', [other, row.id]), /not-found/);
    await assert.rejects(db.query('select public.af_submit($1,$2)', [owner, row.id]), /assets-incomplete/);
    for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, row.id]);
    const claim = (await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id])).rows[0].value;
    assert.equal(claim.status, 'validating');
    assert.equal((await db.query('select public.af_claim($1) is null as empty', [row.id])).rows[0].empty, true);
    const result = { validatorVersion: VALIDATOR_VERSION, stage: 'bytes-hashes-and-full-decode', errors: [] };
    const finish = lease => db.query('select to_jsonb(public.af_finish($1,$2,$3,true,$4)) as value', [row.id, lease, sha, result]).then(r => r.rows[0].value);
    await assert.rejects(finish(crypto.randomUUID()), /stale-validation/);
    const registered = await finish(claim.lease_token);
    assert.equal(registered.status, 'registered');
    assert.equal((await finish(claim.lease_token)).fighter_id, registered.fighter_id);
    assert.equal((await db.query('select count(*)::int as n from public.af_fighters')).rows[0].n, 1);
    assert.equal((await create(owner, key)).fighter_id, registered.fighter_id);
    await assert.rejects(create(owner, crypto.randomUUID()), /fighter-quota/);
    // An operator must bind the runtime admission to the exact manifest and record its authority and validation.
    await assert.rejects(db.query('update public.af_fighters set runtime_approved=true'), /af_fighters_runtime_admission/);
    await assert.rejects(db.query("update public.af_fighters set runtime_approved=true,review_state='approved',runtime_scope='arena-player-v1',runtime_manifest_sha=$1,review_evidence=$2",
      ['f'.repeat(64), { authorization: 'test', validation: 'test' }]), /af_fighters_runtime_admission/);
    await db.query("update public.af_fighters set runtime_approved=true,review_state='approved',runtime_scope='arena-player-v1',runtime_manifest_sha=manifest_sha,review_evidence=$1",
      [{ authorization: 'test operator', validation: 'test arena consumer' }]);
    await assert.rejects(db.query('update public.af_fighters set duel_approved=true'), /af_fighters_duel_admission/);
    await assert.rejects(db.query('update public.af_fighters set duel_approved=true,duel_manifest_sha=manifest_sha'), /af_fighters_duel_admission/);
    await db.query("update public.af_fighters set duel_approved=true,duel_manifest_sha=manifest_sha,review_evidence=review_evidence || $1::jsonb",
      [{ duelValidation: 'symmetric engine and package validation' }]);
    await assert.rejects(db.query('update public.af_fighters set duel_manifest_sha=$1', ['f'.repeat(64)]), /af_fighters_duel_admission/);
    // Real roles and RLS: a normal caller cannot perform privileged transitions or read another owner.
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select id from public.af_submissions')).rows.length, 0);
    await assert.rejects(db.query('select public.af_claim(null)'), /permission denied/);
    await assert.rejects(db.query('update public.af_fighters set runtime_approved=true'), /permission denied/);
    await assert.rejects(db.query('update public.af_fighters set duel_approved=true'), /permission denied/);
    await db.exec('reset role');
    const retry = await create(other, crypto.randomUUID());
    await db.query("update public.af_submissions set status='validating',lease_token=gen_random_uuid(),lease_until=now()-interval '1 second',attempts=1 where id=$1", [retry.id]);
    const reclaimed = (await db.query('select to_jsonb(public.af_claim($1)) as value', [retry.id])).rows[0].value;
    assert.equal(reclaimed.attempts, 2);
    await db.query("update public.af_submissions set lease_until=now()-interval '1 second',attempts=3 where id=$1", [retry.id]);
    await db.query('select public.af_claim($1)', [retry.id]);
    assert.equal((await db.query('select status from public.af_submissions where id=$1', [retry.id])).rows[0].status, 'rejected');
    await db.exec('update public.af_settings set max_reserved_bytes=1');
    await assert.rejects(create(other, crypto.randomUUID()), /storage-budget-full/);
  } finally { await db.close(); }
});

test('an expired upload closes instead of blocking the creator; integers written as 5258.0 are accepted', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID();
    await db.query('insert into auth.users values($1)', [owner]);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    const bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const create = async text => db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value',
      [owner, crypto.randomUUID(), text, await sha256(new TextEncoder().encode(text)), bytes]).then(r => r.rows[0].value);
    const abandoned = await create(JSON.stringify(example));
    await assert.rejects(create(JSON.stringify(example)), /open-submission-exists/);
    await db.query("update public.af_submissions set expires_at=now()-interval '1 second' where id=$1", [abandoned.id]);
    // The validator accepts 5258.0 as an integer; the byte sums must accept it too.
    const first = example.assets[0], floatText = JSON.stringify(example).replace(`"bytes":${first.bytes},`, `"bytes":${first.bytes}.0,`);
    assert.notEqual(floatText, JSON.stringify(example));
    const fresh = await create(floatText);
    assert.equal(fresh.status, 'uploading');
    const closed = (await db.query('select status,validation from public.af_submissions where id=$1', [abandoned.id])).rows[0];
    assert.deepEqual(closed, { status: 'rejected', validation: { code: 'upload-expired' } });
    for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${fresh.id}/${a.id}.webp`, { size: a.bytes }]);
    assert.equal((await db.query('select (public.af_submit($1,$2)).status', [owner, fresh.id])).rows[0].status, 'queued');
  } finally { await db.close(); }
});

test('a new validator version finishes only after the operator allows it', async () => {
  const db = await migratedDatabase();
  try {
    const owner = crypto.randomUUID(), text = JSON.stringify(example), sha = await sha256(new TextEncoder().encode(text));
    await db.query('insert into auth.users values($1)', [owner]);
    await db.query('insert into public.af_creators(owner_id) values($1)', [owner]);
    const row = (await db.query('select to_jsonb(public.af_create_submission($1,$2,$3,$4,$5)) as value',
      [owner, crypto.randomUUID(), text, sha, example.assets.reduce((sum, a) => sum + a.bytes, 0)])).rows[0].value;
    for (const a of example.assets) await db.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    await db.query('select public.af_submit($1,$2)', [owner, row.id]);
    const claim = (await db.query('select to_jsonb(public.af_claim($1)) as value', [row.id])).rows[0].value;
    const finish = version => db.query('select (public.af_finish($1,$2,$3,true,$4)).status', [row.id, claim.lease_token, sha,
      { validatorVersion: version, stage: 'bytes-hashes-and-full-decode', errors: [] }]).then(r => r.rows[0].status);
    await assert.rejects(finish('ai-fighter-validator-0.3.0'), /validator-version/);
    await db.query("update public.af_settings set validator_versions=array_append(validator_versions,'ai-fighter-validator-0.3.0')");
    assert.equal(await finish('ai-fighter-validator-0.3.0'), 'registered');
    assert.deepEqual((await db.query('select validator_versions from public.af_settings')).rows[0].validator_versions,
      [VALIDATOR_VERSION, 'ai-fighter-validator-0.3.0']);
  } finally { await db.close(); }
});
