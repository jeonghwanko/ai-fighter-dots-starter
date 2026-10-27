import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { createHandler, sha256 } from '../api/handler.mjs';
import { probeImage } from '../api/image-probe.mjs';
import { migratedDatabase } from './helpers/fighter-database.mjs';

// Minimal headers the probe reads (the API never decodes a picture).
const png = (w, h) => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]); b.set(new TextEncoder().encode('IHDR'), 12);
  new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const webp = (w, h) => { const b = new Uint8Array(64); b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WEBPVP8X'), 8);
  b.set([(w - 1) & 255, (w - 1) >> 8 & 255, (w - 1) >> 16, (h - 1) & 255, (h - 1) >> 8 & 255, (h - 1) >> 16], 24); return b; };

// One database, a creator with a token, another creator, the generation worker's key and a validation worker's key; Storage in memory.
async function generation() {
  const sql = await migratedDatabase(), owner = crypto.randomUUID(), other = crypto.randomUUID();
  for (const user of [owner, other]) {
    await sql.query('insert into auth.users(id) values($1)', [user]);
    await sql.query('insert into public.af_creators(owner_id) values($1) on conflict do nothing', [user]);
  }
  const workerToken = `afw_${'a'.repeat(64)}`, validatorToken = `afw_${'b'.repeat(64)}`;
  await sql.query("insert into public.af_workers(token_hash,label,scope) values($1,'gen','generation'),($2,'val','validation')",
    [await sha256(new TextEncoder().encode(workerToken)), await sha256(new TextEncoder().encode(validatorToken))]);
  const rpc = async (name, args) => {
    try { return { data: (await sql.query(`select to_jsonb(public.${name}(${Object.keys(args).map((key, i) => `${key} => $${i + 1}`).join(',')})) as value`, Object.values(args))).rows[0].value }; }
    catch (error) { return { error: { message: error.message } }; }
  };
  const from = table => {
    const filters = [], values = []; let order = '', limit = '', gt = [];
    const run = async () => (await sql.query(`select to_jsonb(t) as value from public.${table} t${filters.length ? ' where ' + filters.join(' and ') : ''}${order}${limit}`, values)).rows.map(r => r.value);
    const q = { select: () => q, eq: (key, val) => { values.push(val); filters.push(`${key}=$${values.length}`); return q; },
      gt: (key, val) => { values.push(val); filters.push(`${key}>$${values.length}`); return q; },
      in: (key, vals) => { values.push(vals); filters.push(`${key}=any($${values.length})`); return q; },
      order: (key, o) => { order = ` order by ${key}${o?.ascending === false ? ' desc' : ''}`; return q; }, limit: n => { limit = ` limit ${n}`; return q; },
      maybeSingle: async () => ({ data: (await run())[0] ?? null }), then: (ok, no) => run().then(data => ({ data })).then(ok, no) };
    return q;
  };
  const objects = new Map();
  const storage = { from: bucket => ({
    upload: async (path, bytes, options) => { const key = `${bucket}/${path}`; if (objects.has(key) && !options?.upsert) return { error: { message: 'exists' } };
      objects.set(key, { bytes, type: options?.contentType }); return { data: { path } }; },
    remove: async paths => { for (const p of paths) objects.delete(`${bucket}/${p}`); return {}; },
    download: async path => objects.has(`${bucket}/${path}`) ? { data: new Blob([objects.get(`${bucket}/${path}`).bytes]) } : { error: { message: 'missing' } },
    createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?token=t` })) }) }) };
  const users = { 'owner-token-0123456789': owner, 'other-token-0123456789': other };
  const db = { rpc, from, storage, auth: { getUser: async token => ({ data: { user: users[token] ? { id: users[token] } : null } }) } };
  const handle = createHandler({ db });
  const call = async (method, path, body, token = 'owner-token-0123456789', headers = {}) => {
    const raw = body instanceof Uint8Array || typeof body === 'string';
    const response = await handle(new Request(`http://localhost/ai-fighter/${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': raw ? (headers['content-type'] ?? 'application/octet-stream') : 'application/json', ...headers },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) }));
    return { status: response.status, body: await response.json() };
  };
  const work = (method, path, body, headers = {}) => call(method, `generation-worker/${path}`, body, workerToken, headers);
  const healthy = async () => { await sql.query('update public.af_generation_settings set enabled = true');
    return work('POST', 'heartbeat', { health: { ok: true, codex: true, grok: true } }); };
  return { sql, owner, other, call, work, healthy, objects, validatorToken };
}

test('the probe reads a PNG, JPEG and WebP header and nothing else', () => {
  assert.deepEqual(probeImage(png(640, 480)), { type: 'image/png', ext: 'png', width: 640, height: 480 });
  assert.deepEqual(probeImage(webp(300, 200)), { type: 'image/webp', ext: 'webp', width: 300, height: 200 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 0x2c, 2, 0x58, 3, 0, 0, 0]);
  assert.deepEqual(probeImage(jpeg), { type: 'image/jpeg', ext: 'jpg', width: 600, height: 300 });
  assert.equal(probeImage(new TextEncoder().encode('not a picture at all, just words here')), null);
});

test('a request: off until the worker is healthy, pictures with rights, one hosted fighter per account, the same key the same job', async () => {
  const { sql, other, call, work, healthy } = await generation();
  try {
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.reason, 'disabled');
    const ask = (key, body) => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', ...body }, undefined, { 'idempotency-key': key });
    assert.equal((await ask(crypto.randomUUID())).body.code, 'generation-unavailable');
    assert.equal((await healthy()).body.capabilities.hosted, true);
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosted, true);
    // Pictures: a known kind within the sizes, kept privately; the rights confirmed with the request.
    assert.equal((await call('POST', 'generations/uploads', new TextEncoder().encode('plain words, no picture'))).status, 415);
    assert.equal((await call('POST', 'generations/uploads', png(32, 32))).body.code, 'image-size');
    const upload = (await call('POST', 'generations/uploads', png(512, 512))).body.upload;
    assert.equal(upload.width, 512);
    assert.equal((await ask(crypto.randomUUID(), { refs: [upload.id] })).body.code, 'rights-required');
    assert.equal((await call('POST', 'generations', { description: 'x', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() })).body.code, 'invalid-description');
    const key = crypto.randomUUID(), made = await ask(key, { refs: [upload.id], rightsConfirmed: true });
    assert.equal(made.status, 200); assert.equal(made.body.job.status, 'queued');
    assert.equal((await ask(key, { refs: [upload.id], rightsConfirmed: true })).body.job.id, made.body.job.id);
    assert.equal((await ask(crypto.randomUUID())).body.code, 'generation-quota');
    // Another creator's upload is not his to use; his job is not readable by another.
    const theirs = (await call('POST', 'generations/uploads', png(256, 256), 'other-token-0123456789')).body.upload;
    assert.equal((await call('GET', `generations/${made.body.job.id}`, undefined, 'other-token-0123456789')).status, 404);
    assert.equal((await call('POST', 'generations', { description: '다른 사람의 그림을 쓰는 선수 신청', language: 'ko', refs: [upload.id], rightsConfirmed: true },
      'other-token-0123456789', { 'idempotency-key': crypto.randomUUID() })).body.code, 'invalid-refs');
    assert.ok(theirs.id);
    // A rejected request frees the account again; the service's daily limit holds.
    const claim = (await work('POST', 'claim', {})).body.job;
    assert.equal((await work('POST', 'finish', { jobId: claim.id, leaseToken: claim.leaseToken, outcome: 'rejected', result: { code: 'real-person' } })).body.status, 'rejected');
    assert.equal((await call('GET', 'generations')).body.used, false);
    await sql.query('update public.af_generation_settings set daily_limit = 1');
    await sql.query("insert into public.af_generation_jobs(owner_id,idempotency_key,description,language) values($1,$2,'남이 이미 신청한 선수 하나','ko')", [other, crypto.randomUUID()]);
    assert.equal((await ask(crypto.randomUUID())).body.code, 'generation-capacity');
  } finally { await sql.close(); }
});

test('the worker carries a job through brief, two looks, a change, a pick, motions, a clip again and the registration under the creator', async () => {
  const { sql, owner, call, work, healthy, objects, validatorToken } = await generation();
  try {
    await healthy();
    const upload = (await call('POST', 'generations/uploads', png(800, 600))).body.upload;
    const job = (await call('POST', 'generations', { description: 'A blue armored cat boxer with a scarf', language: 'en', refs: [upload.id], rightsConfirmed: true },
      undefined, { 'idempotency-key': crypto.randomUUID() })).body.job;
    // Only the generation key works here, and only here.
    assert.equal((await call('POST', 'generation-worker/claim', {}, validatorToken)).status, 403);
    assert.equal((await call('POST', 'worker/claim', {}, `afw_${'a'.repeat(64)}`)).status, 403);
    const step = async status => { const c = (await work('POST', 'claim', {})).body.job; assert.equal(c.status, status); return c; };
    const finish = (c, outcome, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome, result });
    let held = await step('queued');
    assert.equal(held.refs.length, 1); assert.match(held.refs[0].url, /refs\//); assert.equal(held.description, 'A blue armored cat boxer with a scarf');
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await work('POST', 'progress', { jobId: held.id, leaseToken: crypto.randomUUID(), progress: 10 })).body.code, 'lease-lost');
    assert.equal((await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, progress: 40, event: { kind: 'brief', calls: { codex: 1 } } })).status, 200);
    await finish(held, 'ok', { brief: { profile: { name: 'Blue Cat', description: 'A boxer.', names: { en: 'Blue Cat' } }, prompt: 'internal' } });
    // Two looks, pictures uploaded under the lease.
    held = await step('appearance');
    for (const name of ['look-a-0', 'look-b-0'])
      assert.equal((await work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' })).status, 200);
    assert.equal((await work('PUT', `jobs/${held.id}/artifacts/look-c-0`, png(10, 10), { 'x-generation-lease': held.leaseToken })).status, 415);
    assert.equal((await finish(held, 'ok', { candidates: ['look-a-0'] })).body.code, 'invalid-result');
    await finish(held, 'ok', { candidates: ['look-a-0', 'look-b-0'] });
    let read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'appearance_ready'); assert.deepEqual(read.candidates.map(c => c.key), ['a', 'b']);
    assert.match(read.candidates[0].url, /jobs\/.*look-a-0\.webp/); assert.equal(read.profile.name, 'Blue Cat'); assert.equal(read.revisionsLeft.appearance, 2);
    // A change asked: a new pair; then a pick.
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { choose: 'c' })).body.code, 'invalid-answer');
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { revise: 'smaller ears' })).body.job.status, 'appearance');
    held = await step('appearance'); assert.equal(held.appearanceNote, 'smaller ears');
    await finish(held, 'ok', { candidates: ['look-a-1', 'look-b-1'] });
    assert.equal((await call('POST', `generations/${job.id}/appearance`, { choose: 'b' })).body.job.status, 'motions');
    held = await step('motions'); assert.equal(held.choice, 'b'); assert.equal(held.candidates[1].name, 'look-b-1');
    const preview = ['idle', 'walk', 'run'].map(clip => ({ clip, name: `motion-${clip.toLowerCase()}-0` }));
    assert.equal((await finish(held, 'ok', { preview: [{ clip: 'dance', name: 'x' }] })).body.code, 'invalid-result');
    await finish(held, 'ok', { preview });
    read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'motion_ready'); assert.deepEqual(read.preview.map(p => p.clip), ['idle', 'walk', 'run']);
    assert.equal((await call('POST', `generations/${job.id}/motions`, { revise: { clip: 'walk', note: '덜 통통 튀게'.repeat(25) } })).body.job.revisionsLeft.motions, 2);
    held = await step('motions'); assert.deepEqual(held.motionNote, { clip: 'walk', note: '덜 통통 튀게'.repeat(25) });
    await finish(held, 'ok', { preview });
    // Registered: his confirmed profile, the package submitted under his account by the worker.
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile: { name: '', description: 'x' } })).body.code, 'invalid-profile');
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile: { name: 'Blue', description: 'x', stats: { power: 5, toughness: 5, speed: 5 } } })).body.code, 'invalid-profile');
    const profile = { name: 'Blue Cat', description: 'A blue boxer.', lines: { win: 'Again!' }, stats: { power: 4, toughness: 3, speed: 2 } };
    assert.equal((await call('POST', `generations/${job.id}/register`, { profile })).body.job.status, 'submitting');
    held = await step('submitting'); assert.deepEqual(held.profile, profile);
    const lease = { 'x-generation-lease': held.leaseToken };
    const created = await work('POST', `jobs/${held.id}/submission`, JSON.stringify(example), { ...lease, 'content-type': 'application/json' });
    assert.equal(created.status, 200); assert.equal(created.body.stage, 'uploading');
    const row = (await sql.query('select owner_id, id from public.af_submissions where idempotency_key = $1', [held.id])).rows[0];
    assert.equal(row.owner_id, owner);
    for (const a of example.assets) await sql.query('insert into storage.objects values($1,$2,$3)', ['ai-fighter-beta', `${owner}/${row.id}/${a.id}.webp`, { size: a.bytes }]);
    assert.equal((await work('POST', `jobs/${held.id}/submission/submit`, {}, lease)).body.stage, 'queued');
    await finish(held, 'ok', { submissionId: row.id });
    read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'submitted'); assert.equal(read.submission.id, row.id);
    assert.ok([...objects.keys()].some(key => key.startsWith('af-generation/jobs/')));
    // The events keep no description or prompt.
    const events = (await sql.query('select data::text as d from public.af_generation_events where job_id = $1', [job.id])).rows.map(r => r.d).join(' ');
    assert.ok(!events.includes('scarf') && !events.includes('internal'));
  } finally { await sql.close(); }
});

test('cancel, leases that run out and creators who do not answer', async () => {
  const { sql, call, work, healthy } = await generation();
  try {
    await healthy();
    const ask = () => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    // Cancelled while the worker holds it: his lease no longer counts.
    let job = (await ask()).body.job, held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await call('DELETE', `generations/${job.id}`)).body.job.status, 'cancelled');
    assert.equal((await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { brief: {} } })).body.code, 'lease-lost');
    // A stage that lost its worker three times fails.
    job = (await ask()).body.job;
    for (let i = 0; i < 3; i += 1) {
      assert.ok((await work('POST', 'claim', {})).body.job);
      await sql.query("update public.af_generation_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [job.id]);
    }
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.error, 'stage-attempts');
    // A creator who leaves the looks unanswered for a week: expired, and his hosted fighter is free.
    await sql.query("delete from public.af_generation_jobs");
    job = (await ask()).body.job;
    held = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { brief: { profile: {} } } });
    held = (await work('POST', 'claim', {})).body.job;
    await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result: { candidates: ['a-0', 'b-0'] } });
    await sql.query("update public.af_generation_jobs set waiting_since = now() - interval '8 days' where id = $1", [job.id]);
    await work('POST', 'claim', {});
    assert.equal((await call('GET', `generations/${job.id}`)).body.job.status, 'expired');
    assert.equal((await call('GET', 'generations')).body.used, false);
  } finally { await sql.close(); }
});

test('retries count toward a stage\'s three leases and wait; progress is a heartbeat; a cancel before any work and a failed package free their slots', async () => {
  const { sql, owner, call, work, healthy } = await generation();
  try {
    await healthy();
    const ask = () => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    const first = (await ask()).body.job;
    for (let i = 0; i < 3; i += 1) {
      const held = (await work('POST', 'claim', {})).body.job;
      assert.ok(held, `lease ${i + 1}`);
      await work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'retry', result: { code: 'brief-exit-1' } });
      // A handed-back stage waits before it is claimed again.
      assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
      await sql.query("update public.af_generation_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [first.id]);
    }
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await call('GET', `generations/${first.id}`)).body.job.error, 'stage-attempts');
    // Progress keeps the worker on the books while a long stage runs.
    const second = (await ask()).body.job, held = (await work('POST', 'claim', {})).body.job;
    assert.match(held.createdAt, /^\d{4}-\d{2}-\d{2}/);
    await sql.query("update public.af_generation_settings set worker_seen_at = now() - interval '10 minutes'");
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosted, false);
    await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, progress: 50 });
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosted, true);
    // A cancel before the worker did anything is not a request toward the service's day.
    await sql.query("update public.af_generation_jobs set brief = null, status = 'cancelled', lease_token = null where id = $1", [second.id]);
    const today = (await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.today;
    assert.equal(today, 1);
    // A submitted package that failed its check frees the account's one hosted fighter.
    const third = (await ask()).body.job;
    assert.equal((await ask()).body.code, 'generation-quota');
    const text = JSON.stringify(example), bytes = example.assets.reduce((sum, a) => sum + a.bytes, 0);
    const sub = (await sql.query('select (public.af_create_submission($1, $2, $3, $4, $5, null)).id as id',
      [owner, third.id, text, await sha256(new TextEncoder().encode(text)), bytes])).rows[0];
    await sql.query("update public.af_generation_jobs set status = 'submitted', submission_id = $2 where id = $1", [third.id, sub.id]);
    await sql.query("update public.af_submissions set status = 'rejected' where id = $1", [sub.id]);
    assert.equal((await call('GET', 'generations')).body.used, false);
    await sql.query("update public.af_generation_jobs set created_at = now() - interval '2 days' where id = $1", [first.id]);  // his three a day
    assert.equal((await ask()).status, 200);
    assert.equal(owner.length, 36);
  } finally { await sql.close(); }
});

