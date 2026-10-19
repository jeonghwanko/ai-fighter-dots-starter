import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, readBody, sha256 } from '../api/handler.mjs';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };

test('public spec announces beta registration while anonymous writes fail', async () => {
  const handle = createHandler({ db: {} });
  const spec = await (await handle(new Request('https://test/ai-fighter/spec'))).json();
  assert.equal(spec.data.registration.available, true);
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
