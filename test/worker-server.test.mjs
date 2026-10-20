import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerServer } from '../worker/server.mjs';

test('HTTP health does not claim; unauthorized requests cannot start work; authorized wake drains serially', async () => {
  let calls = 0, concurrent = 0, maxConcurrent = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = createWorkerServer({
    wakeToken: 'a'.repeat(64), log() {},
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
    assert.equal((await fetch(`${base}/wake`, { method: 'POST' })).status, 401);
    assert.equal(calls, 0);
    const wake = () => fetch(`${base}/wake`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}` } });
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
      assert.equal((await fetch(`${base}/wake`, { method: 'POST', headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status, 202);
    }
    assert.equal(calls, 2);
  } finally { await app.stop(); }
});
