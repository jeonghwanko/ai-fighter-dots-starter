import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectionHandler } from '../mcp/connect-oddbout.mjs';
import { checkConnection } from '../scripts/check-connection.mjs';
import { createServer } from '../mcp/server.mjs';
import { createLazyRemoteClient } from '../api/client.mjs';
import { startDeviceLogin, waitDeviceLogin, pendingDeviceLoginPath } from '../scripts/login.mjs';

const probe = async (_url, { spec } = {}) => spec ? { status: 'reachable', deviceLogin: 'available' } : { status: 'reachable' };
const deviceCode = `afd_${'a'.repeat(64)}`, tokenHash = 'b'.repeat(64), refreshToken = 'private-refresh-token';
const accessToken = `e30.${Buffer.from(JSON.stringify({ sub: 'user-one', exp: 9999999999 })).toString('base64url')}.signature`;

test('MCP connects, resumes, verifies and opens registration in one running process without generation setup', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-connect-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json'), calls = [];
  let approved = false;
  const post = async (_url, _key, route) => {
    calls.push(route);
    if (route === 'device-logins') return { deviceCode, userCode: 'BCDF-GHJK', interval: 5, expiresAt: new Date(Date.now() + 600000).toISOString() };
    return approved ? { status: 'approved', tokenHash } : { status: 'pending' };
  };
  const realFetch = globalThis.fetch; t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url, init) => {
    assert.ok(url.endsWith('/me')); assert.equal(init.headers.authorization, `Bearer ${accessToken}`);
    return Response.json({ ok: true, account: { canSubmit: true } });
  };
  const remote = createLazyRemoteClient(sessionPath);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ root: dir, remote, connectionOptions: { sessionPath, probe,
    start: options => startDeviceLogin({ ...options, post }),
    wait: options => waitDeviceLogin({ ...options, post, request: async () => ({ ok: true, account: { canSubmit: true } }),
      sleep: () => assert.fail('one poll, no blocking wait'), createAuthClient: () => ({ auth: { verifyOtp: async input => {
        assert.deepEqual(input, { type: 'email', token_hash: tokenHash });
        return { data: { session: { access_token: accessToken, refresh_token: refreshToken, user: { id: 'user-one' } } } };
      } } }) }) } });
  await server.connect(serverSide);
  const client = new Client({ name: 'device-connection-test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  client.setRequestHandler(ElicitRequestSchema, () => assert.fail('registration must not ask for a generation subscription'));
  await client.connect(clientSide); t.after(() => client.close());
  const invoke = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('submit_fighter_package')); assert.ok(names.includes('connect_oddbout'));
  const before = await invoke('check_creation_readiness', { purpose: 'registration' });
  assert.equal(before.data.readyForRegistration, false); assert.equal(before.data.items.kit.status, 'not-required');
  const first = await invoke('connect_oddbout', { action: 'start' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.verificationUrl, 'https://oddbout.com/creator.html#device=BCDF-GHJK');
  const repeated = await invoke('connect_oddbout', { action: 'start' });
  assert.deepEqual(repeated, first); assert.deepEqual(calls, ['device-logins']);
  const pending = await invoke('connect_oddbout', { action: 'wait' });
  assert.equal(pending.data.status, 'awaiting-approval'); assert.equal(pending.data.retryAfterSeconds, 5);
  assert.equal(JSON.parse(await readFile(pendingDeviceLoginPath(sessionPath))).deviceCode, deviceCode);
  approved = true;
  const connected = await invoke('connect_oddbout', { action: 'wait' });
  assert.equal(connected.data.status, 'connected'); assert.equal(connected.data.evidence, 'authenticated GET /me');
  const ready = await invoke('check_creation_readiness', { purpose: 'registration' });
  assert.equal(ready.data.readyForRegistration, true); assert.equal(ready.data.items.account.status, 'not-required');
  assert.equal((await invoke('connect_oddbout', { action: 'start' })).data.status, 'connected');
  assert.equal(calls.filter(route => route === 'device-logins').length, 1);
  const output = JSON.stringify([first, repeated, pending, connected, ready]);
  for (const secret of [deviceCode, tokenHash, refreshToken, accessToken]) assert.ok(!output.includes(secret));
});

test('blocked VM and unverified account never trigger login or disclose raw transport errors', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-connect-blocked-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const handle = connectionHandler({ sessionPath: path.join(dir, 'client.json'),
    probe: async () => ({ status: 'blocked', reason: 'network-connect-forbidden',
      nextAction: { actor: 'environment-preparer', code: 'prepare-workspace-network' } }),
    start: () => assert.fail('must not start'), wait: () => assert.fail('must not wait') });
  for (const action of ['start', 'wait']) {
    const result = await handle({ action });
    assert.equal(result.ok, false); assert.equal(result.data.nextAction.actor, 'environment-preparer');
  }
  const fail = connectionHandler({ sessionPath: path.join(dir, 'client.json'), probe,
    start: () => { throw new Error('unexpected secret-device-token'); } });
  const result = await fail({ action: 'start' });
  assert.equal(result.code, 'connection-failed'); assert.ok(!JSON.stringify(result).includes('secret-device-token'));
});

test('CLI diagnostics work before login and never enter generation setup', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-doctor-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await checkConnection({ sessionPath: path.join(dir, 'missing.json'), login: { probe } });
  assert.equal(result.purpose, 'connection'); assert.equal(result.items.kit.status, 'not-required');
  assert.equal(result.items.login.action.status, 'available'); assert.equal(result.readyForRegistration, false);
  assert.equal(result.elicitation, 'not-needed');
  await assert.rejects(checkConnection({ purpose: 'generation' }), /usage-creation-check/);
});
