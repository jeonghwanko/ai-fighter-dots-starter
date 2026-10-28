import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation } from './helpers/generation-database.mjs';

// 커뮤니티 호스트 (2026-10-28): a creator applies to host, the operator approves him, his own worker key takes the requests that name him
// (or any host) after ODDBOUT's own worker wrote the brief; the job stays with him to the end.
test('a host applies, is approved, gets a key and takes the requests meant for him after the official brief', async () => {
  const { sql, owner, other, call, work, healthy } = await generation();
  const theirs = 'other-token-0123456789';
  try {
    await healthy();
    assert.equal((await call('GET', 'generations/capabilities', undefined, null)).body.capabilities.hosts, 0);
    // Applying: terms first; not approved, so no key yet.
    assert.equal((await call('POST', 'generations/host', { name: '고양이 공방', billing: 'api-key' }, theirs)).body.code, 'host-terms-required');
    const applied = (await call('POST', 'generations/host', { name: '고양이 공방', billing: 'api-key', termsAccepted: true }, theirs)).body.host;
    assert.equal(applied.approved, false);
    assert.equal((await call('POST', 'generations/host/keys', {}, theirs)).body.code, 'host-not-approved');
    assert.deepEqual((await call('GET', 'generations/hosts', undefined, null)).body.hosts.map(h => h.name), ['ODDBOUT']);
    await sql.query('update public.af_generation_hosts set approved = true where id = $1', [applied.id]);
    const issued = (await call('POST', 'generations/host/keys', {}, theirs)).body;
    assert.match(issued.key, /^afw_[a-f0-9]{64}$/); assert.equal(issued.host, applied.id);
    const host = (method, path, body, headers) => call(method, `generation-worker/${path}`, body, issued.key, headers);
    assert.equal((await host('POST', 'heartbeat', { health: { ok: true, codex: true, grok: true } })).body.capabilities.hosts, 1);
    const listed = (await call('GET', 'generations/hosts', undefined, null)).body.hosts;
    assert.deepEqual(listed.map(h => [h.name, h.official, h.online]), [['ODDBOUT', true, true], ['고양이 공방', false, true]]);
    const mine = (await call('GET', 'generations/host', undefined, theirs)).body.host;
    assert.equal(mine.online, true); assert.equal(mine.keys.length, 1); assert.equal(mine.billing, 'api-key');

    // A request that names him: consent first. The brief is ODDBOUT's; the looks on are his, and the job stays his.
    const ask = body => call('POST', 'generations', { description: '빨간 글러브를 낀 고양이 복서', language: 'ko', ...body }, undefined, { 'idempotency-key': crypto.randomUUID() });
    assert.equal((await ask({ host: applied.id })).body.code, 'host-consent-required');
    assert.equal((await ask({ host: 'somebody' })).body.code, 'invalid-host');
    const named = (await ask({ host: applied.id, hostConsent: true })).body.job;
    assert.deepEqual([named.host.choice, named.host.requested.name, named.host.assigned], ['host', '고양이 공방', null]);
    const finish = (via, c, result) => via('POST', 'finish', { jobId: c.id, leaseToken: c.leaseToken, outcome: 'ok', result });
    assert.equal((await host('POST', 'claim', {})).body.stage, 'idle');
    let held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.status, 'queued');
    await finish(work, held, { brief: { profile: { name: '빨간 주먹' } } });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    held = (await host('POST', 'claim', {})).body.job;
    assert.equal(held.status, 'appearance');
    assert.equal((await call('GET', `generations/${named.id}`)).body.job.host.assigned.name, '고양이 공방');
    await finish(host, held, { candidates: ['look-a-0', 'look-b-0'] });
    await call('POST', `generations/${named.id}/appearance`, { choose: 'a' });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await host('POST', 'claim', {})).body.job.status, 'motions');
    await call('DELETE', `generations/${named.id}`);

    // Any host: the official worker leaves it to an online host; with none on, it takes it itself.
    const open = (await ask({ host: 'any', hostConsent: true })).body.job;
    held = (await work('POST', 'claim', {})).body.job; await finish(work, held, { brief: { profile: {} } });
    assert.equal((await work('POST', 'claim', {})).body.stage, 'idle');
    assert.equal((await host('POST', 'claim', {})).body.job.id, open.id);
    await call('DELETE', `generations/${open.id}`);
    const fallback = (await ask({ host: 'any', hostConsent: true })).body.job;
    held = (await work('POST', 'claim', {})).body.job; await finish(work, held, { brief: { profile: {} } });
    await sql.query("update public.af_generation_hosts set worker_seen_at = now() - interval '10 minutes' where id = $1", [applied.id]);
    held = (await work('POST', 'claim', {})).body.job;
    assert.equal(held.id, fallback.id);
    assert.equal((await call('GET', `generations/${fallback.id}`)).body.job.host.assigned.official, true);
    await call('DELETE', `generations/${fallback.id}`);

    // His switches: a limit of none refuses requests that name him; a paused host is not listed and cannot be named.
    await sql.query("update public.af_generation_jobs set created_at = now() - interval '2 days' where owner_id = $1", [owner]);
    await host('POST', 'heartbeat', { health: { ok: true } });
    assert.equal((await call('PATCH', 'generations/host', { dailyLimit: 0 }, theirs)).body.host.dailyLimit, 0);
    assert.equal((await ask({ host: applied.id, hostConsent: true })).body.code, 'host-capacity');
    await call('PATCH', 'generations/host', { dailyLimit: 5, enabled: false }, theirs);
    assert.deepEqual((await call('GET', 'generations/hosts', undefined, null)).body.hosts.map(h => h.name), ['ODDBOUT']);
    assert.equal((await ask({ host: applied.id, hostConsent: true })).body.code, 'host-offline');
    // Nobody else's host to change; his keys switched off at once.
    assert.equal((await call('PATCH', 'generations/host', { enabled: true })).body.code, 'not-found');
    assert.equal((await call('DELETE', 'generations/host/keys', undefined, theirs)).body.revoked, 1);
    assert.equal((await host('POST', 'heartbeat', { health: { ok: true } })).status, 403);
    assert.ok(other);
  } finally { await sql.close(); }
});
