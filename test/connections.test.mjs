import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import example from '../contracts/ai-fighter/v1/example.fighter.json' with { type: 'json' };
import { connectionDatabase, project, resource } from './support/connection-db.mjs';
import { claimsFor } from './support/auth.mjs';
import { verifiedUserId } from '../api/http.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
let f;
before(async () => { f = await connectionDatabase(); });
after(async () => { await f?.sql.close(); });
function pending(permissions = ['fighter:read']) {
  const token = `afg_${randomBytes(32).toString('hex')}`, code = randomBytes(16).toString('hex');
  return { token, code, headers: { 'x-af-client-id': 'ai-fighter-stdio', 'x-af-resource': resource },
    body: { requestId: crypto.randomUUID(), clientId: 'ai-fighter-stdio', tokenHash: digest(token), codeHash: digest(code), permissions } };
}
async function start(p = pending()) {
  const r = await f.send('connections/start', { token: null, body: p.body });
  assert.equal(r.status, 200, JSON.stringify(r.data)); p.id = r.data.connection.id; return p;
}
async function approve(p, permissions = p.body.permissions) {
  const r = await f.send('connections/approve', { body: { code: p.code, permissions, seconds: 900, expectedSubject: f.owner } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.connection;
}
const agent = (p, route, options = {}) => f.send(route, { token: p.token, headers: p.headers, ...options });

test('start is idempotent under concurrent retries and rejects owner/client/agent injection', async () => {
  const p = pending(), replies = await Promise.all(Array.from({ length: 4 }, () => f.send('connections/start', { token: null, body: p.body })));
  assert.ok(replies.every(r => r.status === 200));
  assert.equal(new Set(replies.map(r => r.data.connection.id)).size, 1);
  for (const name of ['ownerId', 'owner_id', 'agent_id', 'resource'])
    assert.equal((await f.send('connections/start', { body: { ...p.body, [name]: f.other } })).status, 400);
  assert.equal((await f.send('connections/start', { body: { ...p.body, permissions: ['fighter:submit'] } })).status, 409);
  assert.equal((await f.send('connections/start', { body: { ...pending().body, clientId: 'unknown' } })).status, 403);
  assert.equal((await f.send('connections/start', { body: { ...pending().body, permissions: ['admin'] } })).status, 400);
  const stored = (await f.sql.query('select * from af_connections where request_id=$1', [p.body.requestId])).rows[0];
  assert.equal(stored.owner_id, null); assert.equal(stored.token_hash, digest(p.token));
  assert.ok(!JSON.stringify(stored).includes(p.token)); assert.ok(!JSON.stringify(replies).includes(p.token));
});
test('pending tokens cannot access data; consent requires a verified owner session and narrows permissions', async () => {
  const p = await start(pending(['fighter:read', 'fighter:submit']));
  assert.equal((await agent(p, `fighters/${crypto.randomUUID()}`, { method: 'GET' })).data.code, 'connection-inactive');
  assert.equal((await f.send('connections/inspect', { token: p.token, body: { code: p.code } })).status, 401);
  assert.equal((await f.send('connections/inspect', { token: null, body: { code: p.code } })).status, 401);
  const g = await approve(p, ['fighter:read']);
  assert.deepEqual(g.permissions, ['fighter:read']);
  const replay = await approve(p, ['fighter:read']); assert.equal(replay.expiresAt, g.expiresAt);
  assert.equal((await f.send('connections/approve', { body: { code: p.code, permissions: p.body.permissions, seconds: 900, expectedSubject: f.owner } })).status, 403);
  assert.equal((await agent(p, 'submissions', { body: example, headers: { ...p.headers, 'idempotency-key': crypto.randomUUID() } })).data.code, 'connection-permission');
  assert.equal((await f.send('connections/inspect', { token: 'fixture-other-token', body: { code: p.code } })).status, 404);
  assert.equal((await f.send('connections/revoke', { token: 'fixture-other-token', body: { connectionId: p.id } })).status, 404);
});
test('client and resource binding are checked even for a valid approved bearer', async () => {
  const p = await start(); await approve(p);
  const route = `fighters/${crypto.randomUUID()}`;
  for (const headers of [{ ...p.headers, 'x-af-client-id': 'different-client' }, { ...p.headers, 'x-af-resource': 'https://elsewhere/api' }, {}])
    assert.equal((await agent(p, route, { method: 'GET', headers })).status, 403);
  await f.sql.query('update af_connections set resource=$1 where id=$2', ['https://elsewhere/api', p.id]);
  assert.equal((await agent(p, route, { method: 'GET' })).data.code, 'connection-resource');
});
test('deny and cancel are terminal; approved agents can cancel themselves but cannot approve', async () => {
  const p = await start();
  assert.equal((await f.send('connections/deny', { body: { code: p.code } })).data.connection.status, 'denied');
  assert.equal((await f.send('connections/deny', { body: { code: p.code } })).status, 200);
  assert.equal((await f.send('connections/approve', { body: { code: p.code, permissions: p.body.permissions, seconds: 900, expectedSubject: f.owner } })).status, 403);
  const c = await start(); assert.equal((await agent(c, 'connections/cancel')).data.connection.status, 'cancelled');
  assert.equal((await agent(c, 'connections/cancel')).status, 200);
  assert.equal((await f.send('connections/approve', { body: { code: c.code, permissions: c.body.permissions, seconds: 900, expectedSubject: f.owner } })).status, 403);
  const a = await start(); await approve(a); await agent(a, 'connections/cancel');
  assert.equal((await agent(a, `fighters/${crypto.randomUUID()}`, { method: 'GET' })).status, 403);
});
test('pending expiry, grant expiry, client disable and disconnect block subsequent access', async () => {
  const p = await start();
  await f.sql.query("update af_connections set pending_until=now()-interval '1 second' where id=$1", [p.id]);
  assert.equal((await f.send('connections/approve', { body: { code: p.code, permissions: p.body.permissions, seconds: 900, expectedSubject: f.owner } })).data.code, 'connection-expired');
  assert.equal((await agent(p, 'connections/status')).data.connection.status, 'expired');
  const a = await start(); await approve(a);
  const route = `fighters/${crypto.randomUUID()}/statistics`;
  assert.equal((await agent(a, route, { method: 'GET' })).status, 404);
  await f.sql.query("update af_connections set expires_at=now()-interval '1 second' where id=$1", [a.id]);
  assert.equal((await agent(a, route, { method: 'GET' })).data.code, 'connection-expired');
  const b = await start(); await approve(b);
  await f.sql.exec('update af_connection_clients set enabled=false');
  assert.equal((await agent(b, route, { method: 'GET' })).data.code, 'connection-client');
  await f.sql.exec('update af_connection_clients set enabled=true');
  assert.equal((await f.send('connections/revoke', { body: { connectionId: b.id } })).data.connection.status, 'revoked');
  assert.equal((await f.send('connections/revoke', { body: { connectionId: b.id } })).status, 200);
  assert.equal((await agent(b, route, { method: 'GET' })).data.code, 'connection-inactive');
});
test('JWT sub, audience, issuer, expiration, anonymous status, role and native OAuth client are validated', async () => {
  const base = claimsFor(f.owner, { iss: `${project}/auth/v1` });
  for (const change of [{ sub: f.other }, { sub: 'bad' }, { aud: 'other' }, { aud: ['authenticated', 'other'] },
    { iss: 'https://evil/auth/v1' }, { exp: 0 }, { exp: undefined }, { role: 'service_role' }, { is_anonymous: true }, { client_id: 'native-oauth-client' }]) {
    const token = `fixture-invalid-${crypto.randomUUID()}`;
    f.claims.set(token, { ...base, ...change });
    const r = await f.send('connections', { token, method: 'GET' });
    if (change.sub === f.other) { assert.equal(r.status, 200); assert.deepEqual(r.data.connection.items, []); }
    else assert.equal(r.status, 401, JSON.stringify(change));
  }
  // No decode-only/getUser fallback can accidentally lose OAuth client/audience claims.
  assert.equal(await verifiedUserId({ auth: { getUser: async () => ({ data: { user: { id: f.owner } } }) } },
    new Request('https://test', { headers: { authorization: 'Bearer fixture-owner-token' } }), `${project}/auth/v1`), null);
});
test('server-owned submission identity, idempotency, audit actor and existing Sparring Bot remain intact', async () => {
  const p = await start(pending(['fighter:read', 'fighter:submit'])); const grant = await approve(p);
  assert.equal((await agent(p, 'fighters', { method: 'GET' })).data.fighter, null);
  const key = crypto.randomUUID(), send = (id = key) => agent(p, `submissions?owner_id=${f.other}&agent_id=${f.other}`, {
    body: example, headers: { ...p.headers, 'idempotency-key': id },
  });
  const created = await send(); assert.equal(created.status, 200, JSON.stringify(created.data));
  const duplicate = await Promise.all([send(), send()]);
  assert.ok(duplicate.every(r => r.data.submissionId === created.data.submissionId));
  const submission = (await f.sql.query('select * from af_submissions where id=$1', [created.data.submissionId])).rows[0];
  assert.equal(submission.owner_id, f.owner);
  assert.equal((await f.send(`submissions/${submission.id}`, { token: 'fixture-other-token', method: 'GET' })).status, 404);
  await f.sql.query(`insert into af_fighters(submission_id,owner_id,manifest_sha,profile) values($1,$2,$3,$4)`,
    [submission.id, f.owner, submission.manifest_sha, { name: 'Sparring Bot' }]);
  const fighter = (await f.sql.query('select * from af_fighters where owner_id=$1', [f.owner])).rows[0];
  assert.equal((await agent(p, `fighters?owner_id=${f.other}`, { method: 'GET' })).data.fighter.id, fighter.id);
  assert.equal((await f.send('fighters', { token: 'fixture-other-token', method: 'GET' })).data.fighter, null);
  const second = await send(crypto.randomUUID()); assert.equal(second.data.code, 'fighter-quota'); assert.equal(second.status, 409);
  const foreignSubmission = crypto.randomUUID();
  await f.sql.query(`insert into af_submissions(id,owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes)
    values($1,$2,gen_random_uuid(),'{}','{}',$3,1)`, [foreignSubmission, f.other, 'a'.repeat(64)]);
  assert.equal((await agent(p, `submissions/${foreignSubmission}`, { method: 'GET' })).status, 404);
  assert.equal((await agent(p, `submissions/${foreignSubmission}/submit`)).status, 404);
  assert.equal((await agent(p, `submissions/${foreignSubmission}/assets/idle`, { method: 'PUT', body: 'data' })).status, 404);
  const events = (await f.sql.query("select * from af_connection_events where connection_id=$1 and action='fighter:submit'", [p.id])).rows;
  assert.ok(events.length >= 4);
  assert.ok(events.every(e => e.owner_id === f.owner && e.agent_id === grant.agentId && e.client_id === p.body.clientId));
  assert.notEqual(grant.agentId, f.owner);
  await f.send('connections/revoke', { body: { connectionId: p.id } });
  assert.equal((await send()).status, 403);
  assert.deepEqual((await f.sql.query('select * from af_fighters where id=$1', [fighter.id])).rows[0], fighter);
  await assert.rejects(f.sql.query(`insert into af_fighters(submission_id,owner_id,manifest_sha,profile) values($1,$2,$3,'{}')`,
    [foreignSubmission, f.owner, 'a'.repeat(64)]), /unique/);
});
test('authenticated/anon cannot call grant RPCs or read/write grants; native OAuth cannot use owner RLS', async () => {
  await f.sql.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await f.sql.exec(`set role ${role}`);
    for (const table of ['af_connections', 'af_connection_clients', 'af_connection_events'])
      await assert.rejects(f.sql.query(`select * from ${table}`), /permission denied/);
    await assert.rejects(f.sql.query("select af_connection_owner($1,'list')", [f.owner]), /permission denied/);
    await assert.rejects(f.sql.query("select af_connection_agent('x','x','x','fighter:read','x')"), /permission denied/);
    await assert.rejects(f.sql.query("update af_connections set status='approved'"), /permission denied/);
    await f.sql.exec('reset role');
  }
  await f.sql.exec(`set role authenticated; set request.jwt.claim.sub='${f.owner}'; set request.jwt.claims='{}'`);
  assert.equal((await f.sql.query('select * from af_fighters')).rows.length, 1);
  await f.sql.exec(`set request.jwt.claims='{"client_id":"oauth-client"}'`);
  assert.equal((await f.sql.query('select * from af_fighters')).rows.length, 0);
  assert.equal((await f.sql.query('select * from af_submissions')).rows.length, 0);
  await f.sql.exec("reset role; reset request.jwt.claims; set role service_role");
  const unsafe = await f.sql.query("select proname from pg_proc where proname like 'af_connection_%' and (prosecdef or not ('search_path=\"\"'=any(proconfig)))");
  assert.equal(unsafe.rows.length, 0);
});
test('failed grant lookup never falls back to user/owner access or leaks database errors', async () => {
  const original = f.db.rpc; f.db.rpc = async () => ({ error: { message: 'secret SQL detail' } });
  try {
    const p = pending();
    const r = await agent(p, `fighters/${crypto.randomUUID()}/statistics`, { method: 'GET' });
    assert.equal(r.status, 503); assert.equal(r.data.code, 'connection-unavailable');
    assert.ok(!JSON.stringify(r.data).includes('secret'));
  } finally { f.db.rpc = original; }
});
test('approval cannot exceed requested rights/lifetime and agent cannot manage another grant or become a worker', async () => {
  const p = await start();
  for (const body of [
    { code: p.code, permissions: ['fighter:submit'], seconds: 900, expectedSubject: f.owner },
    { code: p.code, permissions: ['fighter:read'], seconds: 3601, expectedSubject: f.owner },
    { code: p.code, permissions: [], seconds: 900, expectedSubject: f.owner },
    { code: p.code, permissions: ['fighter:read'], seconds: 0, expectedSubject: f.owner },
    { code: p.code, permissions: ['fighter:read'], seconds: 900, expectedSubject: f.owner, ownerId: f.other },
  ]) assert.ok([400, 403].includes((await f.send('connections/approve', { body })).status));
  await approve(p);
  assert.equal((await agent(p, 'worker/claim')).status, 403);
  assert.equal((await agent(p, 'connections/revoke', { body: { connectionId: p.id } })).status, 401);
  assert.equal((await agent(p, 'connections', { method: 'GET' })).status, 401);
  assert.equal((await f.send('connections/inspect', { body: { code: 'x'.repeat(5000) } })).status, 413);
});
test('simultaneous approve/cancel cannot resurrect a cancelled grant; anonymous admission is bounded', async () => {
  const p = await start();
  const results = await Promise.all([
    f.send('connections/approve', { body: { code: p.code, permissions: p.body.permissions, seconds: 900, expectedSubject: f.owner } }),
    agent(p, 'connections/cancel'),
  ]);
  assert.ok(results.every(r => [200, 403].includes(r.status)));
  assert.equal((await agent(p, 'connections/status')).data.connection.status, 'cancelled');
  assert.equal((await agent(p, `fighters/${crypto.randomUUID()}`, { method: 'GET' })).status, 403);
  await f.sql.exec("update af_connections set created_at=now()-interval '2 minutes'");
  const created = await Promise.all(Array.from({ length: 21 }, () => f.send('connections/start', { token: null, body: pending().body })));
  assert.equal(created.filter(r => r.status === 200).length, 20);
  assert.equal(created.filter(r => r.status === 429).length, 1);
});
