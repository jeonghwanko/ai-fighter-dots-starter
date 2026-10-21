import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, readBody, sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

test('public spec announces open registration while anonymous writes fail', async () => {
  const handle = createHandler({ db: {} });
  const spec = await (await handle(new Request('https://test/ai-fighter/spec'))).json();
  assert.equal(spec.data.registration.available, true);
  assert.equal(spec.data.registration.mode, 'open');
  assert.equal(spec.data.registration.approvalRequired, false);
  const result = await handle(new Request('https://test/ai-fighter/submissions', { method: 'POST', body: '{}' }));
  assert.equal(result.status, 401);
});
test('creator JWT cannot enter the worker approval path', async () => {
  const handle = createHandler({ db: {} });
  const response = await handle(new Request('https://test/ai-fighter/worker/finish', { method: 'POST', headers: { authorization: 'Bearer not-a-worker-token-long-enough' }, body: '{}' }));
  assert.equal(response.status, 403);
});
test('body limit is enforced even with a missing or lying Content-Length', async () => {
  await assert.rejects(readBody(new Request('https://test', { method: 'POST', body: '123456' }), 5), /body-limit/);
  await assert.rejects(readBody(new Request('https://test', { method: 'POST', headers: { 'content-length': '1' }, body: '123456' }), 5), /body-limit/);
});
test('server validates JSON before writing a submission', async () => {
  const owner = crypto.randomUUID(), calls = [];
  const handle = createHandler({ db: { auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    rpc: async (name, args) => { calls.push(name); return { data: name === 'af_authorize' ? true : { id: crypto.randomUUID(), manifest_sha: args.p_sha, status: 'uploading' } }; } } });
  const send = text => handle(new Request('https://test/ai-fighter/submissions', { method: 'POST', headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID() }, body: text }));
  assert.equal((await send('{"schemaVersion":1,"schemaVersion":2}')).status, 422);
  assert.deepEqual(calls, ['af_authorize']);
  assert.equal((await send(JSON.stringify(example))).status, 200);
  assert.deepEqual(calls, ['af_authorize', 'af_authorize', 'af_create_submission']);
  assert.equal((await sha256(new TextEncoder().encode('abc'))).length, 64);
});
test('text that Postgres jsonb cannot store is rejected with 422 before any write', async () => {
  const owner = crypto.randomUUID(), calls = [];
  const handle = createHandler({ db: { auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    rpc: async name => { calls.push(name); return { data: true }; } } });
  for (const escape of ['\\u0000', '\\ud800']) {
    const text = JSON.stringify(example).replace(`"${example.profile.name}"`, `"Sparring${escape}Bot"`);
    const response = await handle(new Request('https://test/ai-fighter/submissions', { method: 'POST',
      headers: { authorization: 'Bearer signed-user-token-for-test', 'idempotency-key': crypto.randomUUID() }, body: text }));
    assert.equal(response.status, 422);
    assert.deepEqual((await response.json()).errors.map(e => [e.code, e.path]), [['UNSUPPORTED_TEXT', '/profile/name']]);
  }
  assert.ok(!calls.includes('af_create_submission'));
});
test('rejected and expired submissions are final: nothing is pending', async () => {
  const owner = crypto.randomUUID(), id = crypto.randomUUID();
  let row;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row }) };
  const handle = createHandler({ db: { auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    rpc: async () => ({ data: true }), from: () => query } });
  const read = async () => (await handle(new Request(`https://test/ai-fighter/submissions/${id}`, { headers: { authorization: 'Bearer signed-user-token-for-test' } }))).json();
  row = { id, owner_id: owner, status: 'rejected', manifest_sha: 'a'.repeat(64), validation: { code: 'worker-attempt-limit' } };
  assert.deepEqual((await read()).pending, []);
  row = { id, owner_id: owner, status: 'uploading', manifest_sha: 'a'.repeat(64), expires_at: new Date(Date.now() - 1000).toISOString() };
  const expired = await read();
  assert.deepEqual([expired.stage, expired.code, expired.pending], ['uploading', 'upload-expired', []]);
  row.expires_at = new Date(Date.now() + 60000).toISOString();
  const open = await read();
  assert.equal(open.code, undefined); assert.deepEqual(open.pending, ['server-validation', 'registration']);
});
test('a verifiable JWT is checked locally; the Auth server is not called', async () => {
  const owner = crypto.randomUUID(), calls = [];
  const auth = { getClaims: async token => { calls.push('getClaims'); return token === 'signed-user-token-for-test'
      ? { data: { claims: { sub: owner, is_anonymous: false } } } : { data: null, error: new Error('invalid') }; },
    getUser: async () => { calls.push('getUser'); return { data: { user: { id: owner } } }; } };
  const handle = createHandler({ db: { auth, rpc: async name => { calls.push(name); return { data: name === 'af_authorize' ? true : null }; },
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) }; return q; } } });
  const read = token => handle(new Request(`https://test/ai-fighter/fighters/${crypto.randomUUID()}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal((await read('signed-user-token-for-test')).status, 404);
  assert.deepEqual(calls, ['getClaims', 'af_authorize']);
  assert.equal((await read('forged-token-long-enough-1')).status, 401);
  const anonymous = { getClaims: async () => ({ data: { claims: { sub: owner, is_anonymous: true } } }) };
  assert.equal((await createHandler({ db: { auth: anonymous } })(new Request('https://test/ai-fighter/submissions', {
    method: 'POST', headers: { authorization: 'Bearer signed-user-token-for-test' }, body: '{}' }))).status, 401);
});
