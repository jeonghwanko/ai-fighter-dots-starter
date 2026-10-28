import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler, hostedNext, CLOUD_ISSUER, CLOUD_RESOURCE } from '../mcp/cloud.mjs';
import { generation, png, webp } from './helpers/generation-database.mjs';

const HOSTED = ['request_hosted_fighter', 'get_hosted_fighter', 'choose_hosted_look', 'revise_hosted_motion', 'register_hosted_fighter', 'cancel_hosted_fighter'];

// The cloud MCP over the hosted generation API on a real (PGlite) database: the agent carries the user's words and answers, the worker the rest.
async function connector(g, hosted) {
  const claims = { sub: g.owner, client_id: crypto.randomUUID(), session_id: crypto.randomUUID(), iss: CLOUD_ISSUER, aud: CLOUD_RESOURCE, role: 'af_mcp',
    af_mcp: 'registration-v1', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 600 };
  const downloads = [];
  const db = { ...g.db, auth: { getClaims: async () => ({ data: { claims } }) },
    rpc: (name, args) => name === 'af_mcp_session_active' ? { data: true } : g.db.rpc(name, args) };
  const handle = createCloudHandler({ db, hosted, fetcher: async url => { downloads.push(url); return new Response(png(512, 512)); } });
  const rpc = async (method, params) => (await (await handle(new Request(CLOUD_RESOURCE, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer signed-connector-token-for-test' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))).json()).result;
  return { downloads, tools: async () => (await rpc('tools/list', {})).tools,
    call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).structuredContent };
}

test('hosted generation tools list only when configured', async () => {
  const g = await generation();
  try {
    const off = (await (await connector(g, null)).tools()).map(t => t.name);
    for (const name of HOSTED) assert.ok(!off.includes(name), name);
    const on = await (await connector(g, {})).tools();
    for (const name of HOSTED) assert.ok(on.some(t => t.name === name), name);
    assert.deepEqual(on.find(t => t.name === 'request_hosted_fighter')._meta['openai/fileParams'], ['picture', 'secondPicture']);
    assert.equal(on.find(t => t.name === 'register_hosted_fighter').annotations.destructiveHint, true);
    assert.equal(on.find(t => t.name === 'get_hosted_fighter').annotations.readOnlyHint, true);
  } finally { await g.sql.close(); }
});

test('an agent asks ODDBOUT for a fighter, passes the picks and registers it in a handful of calls', async () => {
  const g = await generation();
  try {
    const { call, downloads } = await connector(g, { pollMs: 10 });
    const picture = { download_url: 'https://files.oaiusercontent.com/file-1', file_id: 'file-1' };
    const ask = { description: '빨간 글러브를 낀 고양이 복서, 귀가 크다', language: 'ko', idempotencyKey: crypto.randomUUID() };
    // Off: refused before any picture is kept.
    assert.deepEqual(await call('request_hosted_fighter', { ...ask, picture, rightsConfirmed: true }), { ok: false, code: 'generation-unavailable', reason: 'disabled' });
    assert.equal(downloads.length, 0);
    await g.healthy();
    assert.equal((await call('request_hosted_fighter', { ...ask, picture })).code, 'rights-required');
    const made = await call('request_hosted_fighter', { ...ask, picture, rightsConfirmed: true });
    assert.equal(made.job.status, 'queued'); assert.match(made.next, /get_hosted_fighter/);
    // The same key is the same job, and its picture is not uploaded again.
    assert.equal((await call('request_hosted_fighter', { ...ask, picture, rightsConfirmed: true })).job.id, made.job.id);
    assert.equal(downloads.length, 1);
    assert.equal((await g.sql.query('select count(*)::int as n from public.af_generation_uploads')).rows[0].n, 1);
    const jobId = made.job.id;
    const listed = await call('get_hosted_fighter', {});
    assert.equal(listed.capabilities.hosted, true); assert.equal(listed.used, true); assert.equal(listed.jobs[0].next, made.next);

    const claim = async status => { const held = (await g.work('POST', 'claim', {})).body.job; assert.equal(held.status, status); return held; };
    const finish = (held, result) => g.work('POST', 'finish', { jobId: held.id, leaseToken: held.leaseToken, outcome: 'ok', result });
    let held = await claim('queued');
    assert.equal(held.refs.length, 1);
    const draft = { name: '빨간 주먹', names: { ko: '빨간 주먹', en: 'Red Fist' }, description: '귀가 큰 고양이 복서.', concept: '성급하다',
      lines: { challenge: '덤벼!', win: '한 판 더!', lose: '다음엔…' }, stats: { power: 4, toughness: 3, speed: 2 } };
    await finish(held, { brief: { profile: draft } });
    held = await claim('appearance');
    for (const name of ['look-a-0', 'look-b-0'])
      await g.work('PUT', `jobs/${held.id}/artifacts/${name}`, webp(400, 600), { 'x-generation-lease': held.leaseToken, 'content-type': 'image/webp' });
    // waitSeconds holds the call while the worker paints; it returns the looks as soon as they are ready.
    const [waited] = await Promise.all([call('get_hosted_fighter', { jobId, waitSeconds: 5 }),
      new Promise(done => setTimeout(done, 50)).then(() => finish(held, { candidates: ['look-a-0', 'look-b-0'] }))]);
    assert.equal(waited.job.status, 'appearance_ready');
    assert.deepEqual(waited.job.candidates.map(c => c.key), ['a', 'b']); assert.match(waited.job.candidates[0].url, /look-a-0\.webp/);
    assert.match(waited.next, /choose_hosted_look/);
    assert.equal((await call('choose_hosted_look', { jobId, choose: 'a', revise: '귀를 줄여줘' })).code, 'invalid-answer');
    assert.equal((await call('choose_hosted_look', { jobId, choose: 'b' })).job.status, 'motions');

    held = await claim('motions');
    const preview = ['idle', 'walk', 'run'].map(clip => ({ clip, name: `motion-${clip}-0` }));
    await finish(held, { preview });
    const ready = await call('get_hosted_fighter', { jobId });
    assert.equal(ready.job.status, 'motion_ready'); assert.match(ready.next, /register_hosted_fighter/);
    assert.equal((await call('revise_hosted_motion', { jobId, clip: 'walk', note: '덜 통통 튀게' })).job.revisionsLeft.motions, 2);
    held = await claim('motions'); assert.deepEqual(held.motionNote, { clip: 'walk', note: '덜 통통 튀게' });
    await finish(held, { preview });

    // Registered with the worker's draft; the user's one change merges into its bout lines. The concept stays the brief's.
    const registered = await call('register_hosted_fighter', { jobId, profile: { lines: { win: '또 와!' } } });
    assert.equal(registered.job.status, 'submitting');
    held = await claim('submitting');
    assert.deepEqual(held.profile, { name: '빨간 주먹', names: { ko: '빨간 주먹', en: 'Red Fist' }, description: '귀가 큰 고양이 복서.',
      lines: { challenge: '덤벼!', win: '또 와!', lose: '다음엔…' }, stats: { power: 4, toughness: 3, speed: 2 } });
    assert.equal((await call('cancel_hosted_fighter', { jobId })).code, 'generation-state');
  } finally { await g.sql.close(); }
});

test('next names what the user is asked or how long ODDBOUT works', () => {
  assert.match(hostedNext({ status: 'motions' }), /15 to 30 minutes/);
  assert.match(hostedNext({ status: 'submitted', submission: { stage: 'registered', fighterId: 'f-1' } }), /Registered: fighter f-1/);
  assert.match(hostedNext({ status: 'submitted', submission: { stage: 'validating' } }), /waitSeconds/);
  assert.match(hostedNext({ status: 'rejected', error: 'real-person' }), /declined this request \(real-person\)/);
});
