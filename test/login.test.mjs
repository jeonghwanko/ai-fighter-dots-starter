import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { login, logout, projectSettings, waitForCallback } from '../scripts/login.mjs';

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co', KEY = 'sb_publishable_fixtureFixtureFixture01';
const jwt = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
let directory, previous;
before(async () => { directory = await mkdtemp(path.join(tmpdir(), 'fighter-login-')); previous = process.env.AI_FIGHTER_CLIENT_CONFIG; });
after(async () => {
  if (previous === undefined) delete process.env.AI_FIGHTER_CLIENT_CONFIG; else process.env.AI_FIGHTER_CLIENT_CONFIG = previous;
  await rm(directory, { recursive: true, force: true });
});
const freePort = () => new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const saved = async file => JSON.parse(await readFile(file, 'utf8'));

/** A fake Supabase auth client. `open` follows the real redirect URL the script asked for. */
function fakeLogin({ user = 'user-1', calls = {} } = {}) {
  const createAuthClient = (url, key, options) => {
    calls.client = { url, key, flowType: options.auth.flowType };
    return { auth: {
      signInWithOAuth: async args => { calls.oauth = args; return { data: { url: 'https://accounts.example/authorize?x=1&y=2' } }; },
      exchangeCodeForSession: async code => { calls.code = code;
        return { data: { session: { access_token: jwt({ sub: user, exp: 9999999999 }), refresh_token: `refresh-${user}`, user: { id: user, email: 'player@example.com' } } } }; },
    } };
  };
  const open = async address => {
    calls.opened = address;
    // A request without this run's state must neither succeed nor end the wait.
    const port = new URL(calls.oauth.options.redirectTo).port;
    calls.stray = (await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)).status;
    const response = await fetch(`${calls.oauth.options.redirectTo}?code=fixture-code-123`);
    calls.page = await response.text();
  };
  return { createAuthClient, open, request: async (url, token, route) => { calls.request = { url, route }; return { ok: true, account: { invited: false } }; } };
}

test('project settings accept only a Supabase project URL and a publishable or anon key', async () => {
  const sessionPath = path.join(directory, 'none.json');
  await assert.rejects(projectSettings({ argv: [], env: {}, sessionPath }), /project-url-required/);
  await assert.rejects(projectSettings({ argv: ['--url', 'https://evil.example'], env: { AI_FIGHTER_PUBLISHABLE_KEY: KEY }, sessionPath }), /project-url-required/);
  for (const key of ['sb_secret_fixtureFixtureFixture01', jwt({ role: 'service_role' }), 'a.b.c'])
    await assert.rejects(projectSettings({ argv: ['--url', URL_, '--key', key], env: {}, sessionPath }), /publishable-key-required/, key);
  assert.equal((await projectSettings({ argv: ['--url', URL_, '--key', jwt({ role: 'anon' })], env: {}, sessionPath })).port, 47821);
  await assert.rejects(projectSettings({ argv: ['--url', URL_, '--key', KEY, '--port', '80'], env: {}, sessionPath }), /invalid-login-port/);
  assert.deepEqual(await projectSettings({ argv: ['--url', URL_, '--key', KEY], env: {}, sessionPath }), { url: URL_, publishableKey: KEY, port: 47821 });
  // A later login reuses the public values from the existing session file.
  const existing = path.join(directory, 'saved.json');
  await writeFile(existing, JSON.stringify({ url: URL_, publishableKey: KEY, accessToken: 'a', refreshToken: 'r' }));
  assert.equal((await projectSettings({ argv: [], env: { AI_FIGHTER_LOGIN_PORT: '50001' }, sessionPath: existing })).port, 50001);
});

test('login runs PKCE through a state-bound loopback callback and writes only this user\'s session', async () => {
  const sessionPath = path.join(directory, 'nested', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const port = await freePort(), calls = {}, logs = [];
  const result = await login({ argv: ['--url', URL_, '--key', KEY, '--port', String(port)], log: line => logs.push(line), ...fakeLogin({ calls }) });
  assert.deepEqual(calls.client, { url: URL_, key: KEY, flowType: 'pkce' });
  assert.equal(calls.oauth.provider, 'google');
  assert.match(calls.oauth.options.redirectTo, new RegExp(`^http://127\\.0\\.0\\.1:${port}/callback/[a-f0-9]{32}$`));
  assert.equal(calls.oauth.options.skipBrowserRedirect, true);
  assert.equal(calls.oauth.options.queryParams.prompt, 'select_account');
  assert.equal(calls.opened, 'https://accounts.example/authorize?x=1&y=2');
  assert.equal(calls.stray, 404);
  assert.equal(calls.code, 'fixture-code-123');
  assert.match(calls.page, /로그인 완료/);
  assert.deepEqual(calls.request, { url: URL_, route: 'me' });
  const file = await saved(sessionPath);
  assert.deepEqual(Object.keys(file), ['url', 'publishableKey', 'accessToken', 'refreshToken']);
  assert.equal(file.refreshToken, 'refresh-user-1');
  assert.equal(result.userId, 'user-1');
  assert.ok(logs.some(line => line.includes('이용이 제한')));
  assert.ok(logs.every(line => !line.includes('초대를 요청')));
  assert.ok(logs.every(line => !line.includes('refresh-user-1') && !line.includes(file.accessToken)));

  // The same user may log in again; a different user would silently replace an operator-issued session.
  await login({ argv: ['--port', String(await freePort())], log: () => {}, ...fakeLogin() });
  await assert.rejects(login({ argv: ['--port', String(await freePort())], log: () => {}, ...fakeLogin({ user: 'user-2' }) }), /session-user-differs/);
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-1');
  await login({ argv: ['--replace', '--port', String(await freePort())], log: () => {}, ...fakeLogin({ user: 'user-2' }) });
  assert.equal((await saved(sessionPath)).refreshToken, 'refresh-user-2');
});

test('logout revokes the server session (refreshing an expired token first) and reports a failed revoke', async () => {
  const sessionPath = path.join(directory, 'logout', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const expired = { url: URL_, publishableKey: KEY, accessToken: jwt({ sub: 'u', exp: 1 }), refreshToken: 'old-refresh' };
  const calls = [], logs = [];
  const client = ({ signOutError = null } = {}) => () => ({ auth: {
    refreshSession: async ({ refresh_token }) => { calls.push(['refresh', refresh_token]); return { data: { session: { access_token: 'fresh.access.token' } } }; },
    admin: { signOut: async (token, scope) => { calls.push(['signOut', token, scope]); return { error: signOutError }; } },
  } });
  await writeFile(sessionPath, JSON.stringify(expired));
  await logout({ log: line => logs.push(line), createAuthClient: client() });
  assert.deepEqual(calls, [['refresh', 'old-refresh'], ['signOut', 'fresh.access.token', 'local']]);
  await assert.rejects(readFile(sessionPath, 'utf8'));
  assert.ok(logs.some(line => line.includes('서버의 세션도 끝냈습니다')));

  logs.length = 0;
  await writeFile(sessionPath, JSON.stringify({ ...expired, accessToken: jwt({ sub: 'u', exp: 9999999999 }) }));
  await logout({ log: line => logs.push(line), createAuthClient: client({ signOutError: { message: 'network' } }) });
  await assert.rejects(readFile(sessionPath, 'utf8'));
  assert.ok(logs.some(line => line.includes('끝내지 못했습니다')));
});

test('--link adds Google to the existing user, saves a refresh at once and never switches users', async () => {
  const sessionPath = path.join(directory, 'link', 'client.json');
  process.env.AI_FIGHTER_CLIENT_CONFIG = sessionPath;
  const argv = ['--link', '--url', URL_, '--key', KEY];
  await assert.rejects(login({ argv: [...argv, '--port', String(await freePort())], log: () => {} }), /link-session-required/);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const original = { url: URL_, publishableKey: KEY, accessToken: 'old.access.token', refreshToken: 'old-refresh' };
  const client = ({ exchangedUser = 'beta-user', linkError = null, seen = {} } = {}) => () => ({ auth: {
    setSession: async ({ refresh_token }) => { assert.equal(refresh_token, 'old-refresh');
      return { data: { session: { access_token: 'mid.access.token', refresh_token: 'mid-refresh' }, user: { id: 'beta-user' } } }; },
    linkIdentity: async args => { seen.args = args; return linkError ? { data: null, error: linkError } : { data: { url: 'https://accounts.example/link' } }; },
    signInWithOAuth: async () => { throw new Error('link mode must not start a new sign-in'); },
    exchangeCodeForSession: async () => ({ data: { session: { access_token: 'new.access.token', refresh_token: 'new-refresh', user: { id: exchangedUser } } } }),
  } });
  const run = async (options = {}, callback = 'code=fixture-code-123') => {
    const seen = {};
    return login({ argv: [...argv, '--port', String(await freePort())], log: () => {}, request: async () => ({ account: { invited: true } }),
      open: () => { fetch(`${seen.args.options.redirectTo}?${callback}`).catch(() => {}); }, createAuthClient: client({ ...options, seen }) });
  };

  await writeFile(sessionPath, JSON.stringify(original));
  assert.equal((await run()).userId, 'beta-user');
  assert.deepEqual(await saved(sessionPath), { url: URL_, publishableKey: KEY, accessToken: 'new.access.token', refreshToken: 'new-refresh' });

  // A different user after the callback: the refreshed session is kept, the foreign one is not written.
  await writeFile(sessionPath, JSON.stringify(original));
  await assert.rejects(run({ exchangedUser: 'someone-else' }), /link-user-mismatch/);
  assert.equal((await saved(sessionPath)).refreshToken, 'mid-refresh');

  await writeFile(sessionPath, JSON.stringify(original));
  await assert.rejects(run({ linkError: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' } }), /manual-linking-disabled/);
  await writeFile(sessionPath, JSON.stringify(original));
  await assert.rejects(run({}, 'error=server_error&error_code=identity_already_exists'), /identity-already-linked/);
});

test('the callback rejects a denied login, a bad code, a busy port, a timeout and a missing state', async () => {
  const port = await freePort(), state = 'a'.repeat(32), at = `http://127.0.0.1:${port}/callback/${state}`;
  await assert.rejects(waitForCallback({ port, state: 'short', timeoutMs: 5000 }), /login-callback-failed/);
  await assert.rejects(waitForCallback({ port, state, timeoutMs: 5000, onListening: () => { fetch(`${at}?error=access_denied`).catch(() => {}); } }), /oauth-denied/);
  await assert.rejects(waitForCallback({ port, state, timeoutMs: 5000, onListening: () => { fetch(`${at}?code=%3Cscript%3E`).catch(() => {}); } }), /oauth-callback-invalid/);
  const blocker = createServer().listen(port, '127.0.0.1');
  await new Promise(resolve => blocker.once('listening', resolve));
  try { await assert.rejects(waitForCallback({ port, state, timeoutMs: 5000 }), /login-port-busy/); }
  finally { await new Promise(resolve => blocker.close(resolve)); }
  await assert.rejects(waitForCallback({ port, state, timeoutMs: 50 }), /login-timeout/);
});
