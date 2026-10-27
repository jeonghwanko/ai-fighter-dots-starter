import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWorkerServer } from '../worker/server.mjs';

function headers(key, offset = 0) {
  const timestamp = String(Math.floor(Date.now() / 1000) + offset);
  return { 'x-ai-fighter-time': timestamp, authorization: `Bearer ${createHmac('sha256', key).update(timestamp).digest('hex')}` };
}

test('HTTP health does not claim; unauthorized requests cannot start work; authorized wake drains serially', async () => {
  let calls = 0, concurrent = 0, maxConcurrent = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = createWorkerServer({
    wakeToken: 'a'.repeat(64), log() {},
    commit: 'c'.repeat(40),
    async run() {
      calls++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (calls === 1) await gate;
      concurrent--;
      return { stage: calls === 1 ? 'registered' : 'idle' };
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await (await fetch(`${base}/health`)).json()).commit, 'c'.repeat(40));
    assert.equal((await fetch(`${base}/wake`, { method: 'POST' })).status, 401);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('a'.repeat(64), -181) })).status, 401);
    assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('b'.repeat(64)) })).status, 401);
    const wake = () => fetch(`${base}/wake`, { method: 'POST', headers: headers('a'.repeat(64)) });
    assert.equal((await wake()).status, 202);
    assert.equal((await wake()).status, 202);
    assert.equal(calls, 1);
    release();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(calls >= 2);
    assert.equal(maxConcurrent, 1);
  } finally { release(); await app.stop(); }
});

test('worker errors leave the service available for the next durable retry', async () => {
  let calls = 0;
  const app = createWorkerServer({
    wakeToken: 'b'.repeat(64), log() {},
    async run() { calls++; throw new Error('transient'); },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: headers('b'.repeat(64)) })).status, 202);
    }
    assert.equal(calls, 2);
  } finally { await app.stop(); }
});

test('health reports a rejected worker credential distinctly and stays up for the gateway', async () => {
  const logs = [];
  let failure = Object.assign(new Error('invalid-worker-token'), { status: 401 });
  const app = createWorkerServer({
    wakeToken: 'c'.repeat(64), log: line => logs.push(JSON.parse(line)),
    async run() { if (failure) throw failure; return { stage: 'idle' }; },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const health = async () => { const response = await fetch(`${base}/health`); return [response.status, (await response.json()).queue.status]; };
  const wake = async () => { await fetch(`${base}/wake`, { method: 'POST', headers: headers('c'.repeat(64)) }); await new Promise(resolve => setTimeout(resolve, 20)); };
  try {
    assert.deepEqual(await health(), [200, 'unknown']);
    await wake();
    assert.deepEqual(await health(), [200, 'credential-rejected']);
    assert.ok(logs.some(entry => entry.stage === 'worker-credential-rejected'));
    failure = new Error('fetch failed');
    await wake();
    assert.deepEqual(await health(), [200, 'api-unavailable']);
    failure = null;
    await wake();
    assert.deepEqual(await health(), [200, 'ok']);
  } finally { await app.stop(); }
});
