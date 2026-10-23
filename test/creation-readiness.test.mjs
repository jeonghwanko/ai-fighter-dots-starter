import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { accountItem, checkKit, checkLogin, creationProgress, elicitAccount, KIT_BRANCH } from '../mcp/creation-readiness.mjs';
import { pendingLoginPath } from '../scripts/login.mjs';
import { createServer } from '../mcp/server.mjs';

const installed = { source: true, environment: true };
const jwt = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

/** A scripted git: answers by the first arguments and records every call. */
function fakeGit({ branch = KIT_BRANCH, dirty = '', fetch = 0, counts = '0\t3', merge = 0, changed = '' } = {}) {
  const calls = [];
  const git = async args => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { code: 0, stdout: branch };
    if (args[0] === 'rev-parse') return { code: 0, stdout: 'before-sha' };
    if (args[0] === 'status') return { code: 0, stdout: dirty };
    if (args[0] === 'fetch') return { code: fetch, stdout: '' };
    if (args[0] === 'rev-list') return { code: 0, stdout: counts };
    if (args[0] === 'merge') return { code: merge, stdout: '' };
    if (args[0] === 'diff') return { code: 0, stdout: changed };
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}
const patchState = applied => async () => ({ manifest: { id: 'ai-fighter-gpt-motion-v8-semantic-coverage' }, applied });

test('before a character starts, a behind checkout fast-forwards, applies the patch and names slow installs', async () => {
  const { git, calls } = fakeGit({ changed: 'mcp/server.mjs\npackage-lock.json\ndocs/START-HERE.md' });
  let ensured = 0;
  const result = await checkKit({ progress: { inProgress: false }, installed, git, inspectPatch: patchState(false),
    ensurePatch: async () => { ensured++; return { manifest: { id: 'v8' }, applied: true }; } });
  assert.equal(result.status, 'updated');
  assert.ok(calls.includes(`merge --ff-only origin/${KIT_BRANCH}`));
  assert.equal(ensured, 1);
  assert.deepEqual(result.nextCommands, ['npm ci --ignore-scripts', 'npm run sprite:status']);
  assert.equal(result.restartRequired, true);
  // A moved sprite-gen pin needs the full setup instead of an in-place patch.
  const pinned = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: 'vendor/sprite-gen' }).git,
    inspectPatch: patchState(true), ensurePatch: async () => assert.fail('setup owns a moved pin') });
  assert.deepEqual(pinned.nextCommands, ['npm run sprite:setup', 'npm run sprite:status']);
});

test('a character in progress, unknown progress, local edits, a wrong branch or divergence never update', async () => {
  const never = async () => assert.fail('must not patch');
  for (const progress of [{ inProgress: true }, { inProgress: null }]) {
    const { git, calls } = fakeGit();
    const result = await checkKit({ progress, installed, git, inspectPatch: patchState(true), ensurePatch: never });
    assert.equal(result.status, 'deferred');
    assert.ok(!calls.some(call => call.startsWith('merge')));
  }
  const cases = [[{ dirty: ' M AGENTS.md' }, 'local-changes'], [{ branch: 'main' }, 'wrong-branch'], [{ counts: '1\t2' }, 'diverged-from-published-branch']];
  for (const [options, reason] of cases) {
    const { git, calls } = fakeGit(options);
    const result = await checkKit({ progress: { inProgress: false }, installed, git, inspectPatch: patchState(true), ensurePatch: never });
    assert.deepEqual([result.status, result.reason], ['blocked', reason]);
    assert.ok(!calls.some(call => call.startsWith('merge')));
  }
});

test('an up-to-date checkout applies a missing patch; a fresh workspace gets install commands, not a local-change error', async () => {
  const patched = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ counts: '0\t0' }).git,
    inspectPatch: patchState(false), ensurePatch: patchState(true) });
  assert.equal(patched.status, 'patched');
  const fresh = await checkKit({ progress: { inProgress: false }, installed: { source: false, environment: false }, git: fakeGit({ counts: '0\t0' }).git,
    inspectPatch: async () => { throw new Error('SPRITE_PATCH_SOURCE_CHANGED'); }, ensurePatch: async () => assert.fail('nothing to patch yet') });
  assert.deepEqual([fresh.status, fresh.reason], ['action-required', 'sprite-gen-not-installed']);
  assert.deepEqual(fresh.nextCommands, ['npm ci --ignore-scripts', 'npm run sprite:setup', 'npm run sprite:status']);
  const offline = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ fetch: 1 }).git, inspectPatch: patchState(true) });
  assert.deepEqual([offline.status, offline.reason], ['ready', 'remote-unreachable-current-unknown']);
  // A packaged plugin runtime is not a git checkout: report the patch, never touch git further.
  const calls = [];
  const packaged = await checkKit({ progress: { inProgress: false }, installed, inspectPatch: patchState(true),
    git: async args => { calls.push(args[0]); return { code: 128, stdout: '' }; } });
  assert.deepEqual([packaged.status, packaged.reason, calls], ['ready', 'not-a-git-checkout', ['rev-parse']]);
});

test('progress counts recorded versions and non-cancelled jobs only', async () => {
  const states = { fresh: { items: {} }, made: { items: { idle: { versions: { v1: {} } } } }, cancelled: { items: {} } };
  const jobLists = { fresh: [], made: [], cancelled: [{ status: 'cancelled' }] };
  const store = { list: async () => Object.keys(states).map(sessionId => ({ sessionId })), read: async id => states[id] };
  const jobs = { list: async id => jobLists[id] };
  assert.deepEqual(await creationProgress({ store, jobs }), { known: true, inProgress: true, sessions: ['made'] });
  assert.equal((await creationProgress({ store, jobs, sessionId: 'fresh' })).inProgress, false);
  assert.equal((await creationProgress({ store, jobs, sessionId: 'cancelled' })).inProgress, false);
  assert.deepEqual(await creationProgress({}), { known: false, inProgress: null, sessions: [] });
});

test('the account item offers fixed options, never infers, and does not claim display proof', async () => {
  const open = accountItem(undefined);
  assert.equal(open.status, 'choice-required');
  assert.deepEqual(open.options.map(o => o.id), ['gpt', 'grok', 'stop']);
  assert.match(open.verification, /creation:delivery는 기록의 누락·모순만 검사하며 표시를 증명하지 않는다/);
  const gpt = accountItem('gpt');
  assert.equal(gpt.status, 'chosen-unverified');
  assert.match(gpt.nextCommands[0], /--confirmed-access codex$/);
  assert.equal(accountItem('stop').status, 'stopped');
  assert.deepEqual(await elicitAccount({ getClientCapabilities: () => ({}) }), { method: 'unsupported', choice: null });
  const answering = content => ({ getClientCapabilities: () => ({ elicitation: { form: {} } }), elicitInput: async () => content });
  assert.deepEqual(await elicitAccount(answering({ action: 'accept', content: { account: 'grok' } })), { method: 'elicited', choice: 'grok' });
  assert.deepEqual(await elicitAccount(answering({ action: 'accept', content: { account: 'openai-api' } })), { method: 'accept', choice: null });
  assert.deepEqual(await elicitAccount(answering({ action: 'decline' })), { method: 'decline', choice: null });
  assert.deepEqual(await elicitAccount({ getClientCapabilities: () => ({ elicitation: {} }), elicitInput: async () => { throw new Error('no form'); } }),
    { method: 'unsupported', choice: null });
});

test('login offers only the same-device route and reports another device as blocked; never returns tokens', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-readiness-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  const none = await checkLogin({ remoteActive: false, sessionPath });
  assert.equal(none.status, 'sign-in-required');
  assert.match(none.routes.sameDevice.command, /^npm run login -- --url https:\/\/[a-z0-9]+\.supabase\.co --key sb_publishable_/);
  assert.deepEqual([none.routes.otherDevice.status, none.routes.otherDevice.secureRoute], ['blocked-no-secure-route', null]);
  // No paste or finish command is offered anywhere, and nothing calls a pasted callback safe.
  assert.ok(!/--paste|--finish/.test(JSON.stringify(none)));
  assert.match(none.note, /대화에 붙여 넣도록 요청하지 않고/);
  // A leftover manual exchange file does not turn into a chat route.
  await writeFile(pendingLoginPath(sessionPath), JSON.stringify({ version: 1, createdAt: new Date().toISOString() }));
  assert.equal((await checkLogin({ remoteActive: false, sessionPath })).status, 'sign-in-required');
  await writeFile(sessionPath, JSON.stringify({ accessToken: jwt({ sub: 'user-9' }), refreshToken: 'refresh-secret' }));
  const restart = await checkLogin({ remoteActive: false, sessionPath });
  assert.deepEqual([restart.status, restart.userId], ['restart-required', 'user-9']);
  assert.ok(!JSON.stringify(restart).includes('refresh-secret'));
  assert.equal((await checkLogin({ remoteActive: true, sessionPath })).status, 'signed-in');
});

test('the MCP tool asks the account through a host form when the client supports elicitation', async t => {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({}).connect(serverSide);
  const client = new Client({ name: 'readiness-test', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  let asked;
  client.setRequestHandler(ElicitRequestSchema, request => { asked = request.params; return { action: 'accept', content: { account: 'gpt' } }; });
  await client.connect(clientSide); t.after(() => client.close());
  const result = (await client.callTool({ name: 'check_creation_readiness', arguments: { checkRemote: false } })).structuredContent;
  assert.equal(result.ok, true);
  assert.deepEqual(asked.requestedSchema.properties.account.oneOf.map(o => o.const), ['gpt', 'grok', 'stop']);
  assert.equal(result.data.elicitation, 'elicited');
  assert.equal(result.data.items.account.choice, 'gpt');
  // Without a workspace, progress is unknown: the kit is reported, never changed.
  assert.equal(result.data.progress.known, false);
  assert.ok(['ready', 'deferred', 'action-required', 'blocked'].includes(result.data.items.kit.status));
  const stated = (await client.callTool({ name: 'check_creation_readiness', arguments: { account: 'stop', checkRemote: false } })).structuredContent;
  assert.deepEqual([stated.data.elicitation, stated.data.items.account.status, stated.data.readyForGeneration], ['not-needed', 'stopped', false]);
});
