import { test } from 'node:test';
import assert from 'node:assert/strict';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { sha256 } from '../api/handler.mjs';
import { probeImage } from '../api/image-probe.mjs';
import { generation, png, webp } from './helpers/generation-database.mjs';

test('the probe reads a PNG, JPEG and WebP header and nothing else', () => {
  assert.deepEqual(probeImage(png(640, 480)), { type: 'image/png', ext: 'png', width: 640, height: 480 });
  assert.deepEqual(probeImage(webp(300, 200)), { type: 'image/webp', ext: 'webp', width: 300, height: 200 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 1, 0x2c, 2, 0x58, 3, 0, 0, 0]);
  assert.deepEqual(probeImage(jpeg), { type: 'image/jpeg', ext: 'jpg', width: 600, height: 300 });
  assert.equal(probeImage(new TextEncoder().encode('not a picture at all, just words here')), null);
});

test('a request past the account limit is refused until the operator raises that account', async () => {
  const { sql, owner, call, healthy } = await generation();
  try {
    await healthy();
    const profile = { name: 'Profile character', description: 'Introduction', portrait: '/art/character-profiles/test-v1.webp', color: '#ffeebb' };
    for (let i = 0; i < 3; i++) await sql.query('select public.af_register_character_profile($1,$2,$3,$4)', [owner, crypto.randomUUID(), profile, 'kkumssi']);
    const ask = () => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' }, undefined, { 'idempotency-key': crypto.randomUUID() });
    const check = () => call('POST', 'generations/check', { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko' });
    assert.equal((await ask()).body.code, 'fighter-quota');
    assert.equal((await check()).body.code, 'fighter-quota');
    await sql.query('update public.af_creators set fighter_limit = 4 where owner_id = $1', [owner]);
    // The check makes nothing.
    assert.deepEqual((await check()).body, { ok: true });
    assert.equal((await sql.query('select count(*)::int as n from public.af_generation_jobs')).rows[0].n, 0);
    const made = await ask();
    assert.equal(made.status, 200); assert.equal(made.body.job.status, 'queued');
    const definition = async fn => (await sql.query(`select pg_get_functiondef(oid) as d from pg_proc where proname = $1`, [fn])).rows[0].d;
    // A request's checks live in af_generation_check, which af_generation_create runs.
    for (const fn of ['af_create_submission', 'af_generation_check', 'af_generation_register'])
      assert.match(await definition(fn), /af_fighter_limit\(p_owner\) then raise exception 'fighter-quota'/);
    assert.match(await definition('af_generation_create'), /own := public\.af_generation_check\(p_owner, choice, p_host, p_host_consent\);/);
  } finally { await sql.close(); }
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
    await sql.query('update public.af_generation_hosts set daily_limit = 1 where official');
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
    // Previews ahead of the package (2026-10-28): the worker's drafts show while the motions are made, this round's only.
    const drafting0 = { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' };
    for (const name of ['draft-combo-0', 'draft-walk-0']) assert.equal((await work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(200, 200), drafting0)).status, 200);
    assert.deepEqual((await call('GET', `generations/${job.id}`)).body.job.drafts, []);
    await work('POST', 'progress', { jobId: held.id, leaseToken: held.leaseToken, event: { kind: 'drafts',
      clips: [{ clip: 'combo', name: 'draft-combo-0' }, { clip: 'walk', name: 'draft-walk-0' }, { clip: 'dance', name: 'draft-dance-0' }, { clip: 'run', name: 'motion-run-0' }] } });
    const drafting = (await call('GET', `generations/${job.id}`)).body.job;
    assert.deepEqual(drafting.drafts.map(d => d.clip), ['combo', 'walk']); assert.ok(drafting.drafts.every(d => typeof d.url === 'string'));
    // The run made from the walk carries its note (2026-10-29); a note the API does not know is refused.
    const preview = ['idle', 'walk', 'run'].map(clip => ({ clip, name: `motion-${clip.toLowerCase()}-0`, ...(clip === 'run' ? { note: 'run-from-walk' } : {}) }));
    assert.equal((await finish(held, 'ok', { preview: [{ clip: 'dance', name: 'x' }] })).body.code, 'invalid-result');
    assert.equal((await finish(held, 'ok', { preview: preview.map(p => ({ ...p, note: 'made-up' })) })).body.code, 'invalid-result');
    await finish(held, 'ok', { preview });
    read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'motion_ready'); assert.deepEqual(read.preview.map(p => p.clip), ['idle', 'walk', 'run']);
    assert.deepEqual(read.preview.map(p => p.note ?? null), [null, null, 'run-from-walk']);
    assert.deepEqual(read.drafts, []); // the package's previews replace them
    assert.equal((await call('POST', `generations/${job.id}/motions`, { revise: { clip: 'walk', note: '덜 통통 튀게'.repeat(25) } })).body.job.revisionsLeft.motions, 2);
    held = await step('motions'); assert.deepEqual(held.motionNote, { clip: 'walk', note: '덜 통통 튀게'.repeat(25) });
    assert.deepEqual((await call('GET', `generations/${job.id}`)).body.job.drafts, []); // round 0's drafts are not this round's
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
    // An upload past its window is refused by its own code, as on the creator's routes, not as a database fault (API 점검 2026-10-29).
    await sql.query("update public.af_submissions set expires_at = now() - interval '1 minute' where id = $1", [row.id]);
    const expired = await work('POST', `jobs/${held.id}/submission/submit`, {}, lease);
    assert.deepEqual([expired.status, expired.body.code], [409, 'upload-expired']);
    await sql.query("update public.af_submissions set expires_at = now() + interval '1 day' where id = $1", [row.id]);
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
    await sql.query("update public.af_generation_hosts set worker_seen_at = now() - interval '10 minutes' where official");
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


test('맡기기: the worker picks the look and the job goes on to the motions; with no pick, or a job not left to it, the creator is asked', async () => {
  const { sql, call, work, healthy } = await generation();
  try {
    await healthy();
    const ask = (body, token) => call('POST', 'generations', { description: '모자를 쓴 너구리 레슬러', language: 'ko', ...body }, token, { 'idempotency-key': crypto.randomUUID() });
    assert.equal((await ask({ delegate: 'yes' })).body.code, 'invalid-body');
    const job = (await ask({ delegate: true })).body.job;
    assert.equal(job.delegate, true);
    const finish = (c, result) => work('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome: 'ok', result });
    let held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.delegate, true);
    await finish(held, { brief: { profile: { name: '너구리' } } });
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'], choice: 'c' })).body.code, 'invalid-result');
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'], choice: 'b' })).body.status, 'motions');
    const read = (await call('GET', `generations/${job.id}`)).body.job;
    assert.equal(read.status, 'motions'); assert.equal(read.choice, 'b'); assert.equal(read.candidates.length, 2);
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.status, 'motions'); assert.equal(held.choice, 'b');
    // The pick found none: he is asked as before.
    await call('DELETE', `generations/${job.id}`);
    const asked = (await ask({ delegate: true })).body.job;
    held = (await work('POST', 'claim', {})).body.job; await finish(held, { brief: { profile: {} } });
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'] })).body.status, 'appearance_ready');
    assert.equal((await call('GET', `generations/${asked.id}`)).body.job.choice, null);
    // A job he did not leave to us takes no pick.
    await call('DELETE', `generations/${asked.id}`);
    const own = (await ask({})).body.job;
    assert.equal(own.delegate, false);
    held = (await work('POST', 'claim', {})).body.job; await finish(held, { brief: { profile: {} } });
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal((await finish(held, { candidates: ['look-a-0', 'look-b-0'], choice: 'a' })).body.code, 'invalid-result');
  } finally { await sql.close(); }
});
