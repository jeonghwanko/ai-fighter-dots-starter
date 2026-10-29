import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { accountItem, checkKit, checkLogin, checkReadiness, creationProgress, elicitAccount, KIT_BRANCH } from '../mcp/creation-readiness.mjs';
import { pendingLoginPath, pendingDeviceLoginPath } from '../scripts/login.mjs';
import { createServer } from '../mcp/server.mjs';

const installed = { source: true, environment: true };
const workingTools = { inspect: async () => ({ ffmpeg: { status: 'ok' }, ffprobe: { status: 'ok' }, img2webp: { status: 'ok' }, rife: { status: 'ok' } }) };
const jwt = payload => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const publicProbe = supported => async (_url, { spec = false } = {}) => spec
  ? { status: 'reachable', deviceLogin: supported ? 'available' : 'unsupported' }
  : { status: 'reachable' };

/** A scripted git: answers by the first arguments and records every call. */
function fakeGit({ branch = KIT_BRANCH, dirty = '', vendorDirty = '', fetch = 0, counts = '0\t3', merge = 0, changed = '' } = {}) {
  const calls = [];
  const git = async (args, { cwd } = {}) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { code: 0, stdout: branch };
    if (args[0] === 'rev-parse') return { code: 0, stdout: 'before-sha' };
    if (args[0] === 'status') return { code: 0, stdout: path.basename(cwd ?? '') === 'sprite-gen' ? vendorDirty : dirty };
    if (args[0] === 'fetch') return { code: fetch, stdout: '' };
    if (args[0] === 'rev-list') return { code: 0, stdout: counts };
    if (args[0] === 'merge') return { code: merge, stdout: '' };
    if (args[0] === 'diff') return { code: 0, stdout: changed };
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}
const engineState = motion => async () => ({ version: '3.4.0', motion });

test('before a character starts, a behind checkout fast-forwards and names slow installs', async () => {
  const { git, calls } = fakeGit({ changed: 'mcp/server.mjs\npackage-lock.json\ndocs/START-HERE.md' });
  const result = await checkKit({ progress: { inProgress: false }, installed, git, inspectEngine: engineState(true) });
  assert.equal(result.status, 'updated');
  assert.ok(calls.includes(`merge --ff-only origin/${KIT_BRANCH}`));
  assert.deepEqual(result.nextCommands, ['npm ci --ignore-scripts', 'npm run sprite:status']);
  assert.equal(result.restartRequired, true);
  // A moved sprite-gen pin needs the full setup.
  const pinned = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: 'vendor/sprite-gen' }).git,
    inspectEngine: engineState(true) });
  assert.deepEqual(pinned.nextCommands, ['npm run sprite:setup', 'npm run sprite:status']);
  // The forked validator (server/), spawned tools and startup JSON (deploy/) change what this process works with too.
  for (const file of ['server/ai-fighter-package.mjs', 'deploy/creation-context-source.json', 'tools/ai-fighter/gait.mjs'])
    assert.equal((await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: file }).git, inspectEngine: engineState(true) })).restartRequired, true, file);
  assert.equal((await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ changed: 'docs/START-HERE.md' }).git,
    inspectEngine: engineState(true) })).restartRequired, false, 'a docs-only update needs no restart');
});

test('a character in progress, unknown progress, local edits, a wrong branch or divergence never update', async () => {
  for (const progress of [{ inProgress: true }, { inProgress: null }]) {
    const { git, calls } = fakeGit();
    const result = await checkKit({ progress, installed, git, inspectEngine: engineState(true) });
    assert.equal(result.status, 'deferred');
    assert.ok(!calls.some(call => call.startsWith('merge')));
  }
  const cases = [[{ dirty: ' M AGENTS.md' }, 'local-changes'], [{ branch: 'main' }, 'wrong-branch'], [{ counts: '1\t2' }, 'diverged-from-published-branch']];
  for (const [options, reason] of cases) {
    const { git, calls } = fakeGit(options);
    const result = await checkKit({ progress: { inProgress: false }, installed, git, inspectEngine: engineState(true) });
    assert.deepEqual([result.status, result.reason], ['blocked', reason]);
    assert.ok(!calls.some(call => call.startsWith('merge')));
  }
});

test('an up-to-date checkout on the pre-fork pin is sent to setup, engine edits block; a fresh workspace gets install commands', async () => {
  const old = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(false) });
  assert.deepEqual([old.status, old.reason, old.nextCommands], ['action-required', 'motion-engine-missing', ['npm run sprite:setup', 'npm run sprite:status']]);
  const edited = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ counts: '0\t0', vendorDirty: ' M sprite_gen/cli.py' }).git,
    inspectEngine: engineState(true) });
  assert.deepEqual([edited.status, edited.reason], ['blocked', 'vendor-local-changes']);
  const fresh = await checkKit({ progress: { inProgress: false }, installed: { source: false, environment: false }, git: fakeGit({ counts: '0\t0' }).git,
    inspectEngine: async () => assert.fail('nothing installed to inspect') });
  assert.deepEqual([fresh.status, fresh.reason], ['action-required', 'sprite-gen-not-installed']);
  assert.deepEqual(fresh.nextCommands, ['npm ci --ignore-scripts', 'npm run sprite:setup', 'npm run sprite:status']);
  const offline = await checkKit({ progress: { inProgress: false }, installed, git: fakeGit({ fetch: 1 }).git, inspectEngine: engineState(true) });
  assert.deepEqual([offline.status, offline.reason], ['ready', 'remote-unreachable-current-unknown']);
  // A packaged plugin runtime is not a git checkout: report the engine, never touch git further.
  const calls = [];
  const packaged = await checkKit({ progress: { inProgress: false }, installed, inspectEngine: engineState(true),
    git: async args => { calls.push(args[0]); return { code: 128, stdout: '' }; } });
  assert.deepEqual([packaged.status, packaged.reason, calls], ['ready', 'not-a-git-checkout', ['rev-parse']]);
});

test('Dots readiness verifies the immutable workspace pin without fetching or treating detached HEAD as a branch error', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dots-pinned-readiness-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'runtime'), workspaceRoot = path.join(dir, 'workspace');
  await mkdir(root); await mkdir(path.join(workspaceRoot, 'output'), { recursive: true });
  const marker = path.join(root, '.dots-runtime.json'), bindingFile = path.join(workspaceRoot, 'output/dots-workspace.json');
  await writeFile(marker, JSON.stringify({ schemaVersion: 1, host: 'dots' }));
  const binding = { schemaVersion: 1, runtime: root, provider: 'grok', version: '0.5.5', commit: 'a'.repeat(40) };
  await writeFile(bindingFile, JSON.stringify(binding));
  const report = { blockers: [], kit: { version: binding.version, distribution: 'source', commit: binding.commit } };
  const options = { root, workspaceRoot, installed, progress: { inProgress: false },
    git: () => assert.fail('pinned readiness never fetches, merges or switches a branch'), inspectEngine: engineState(true),
    inspectPinnedRuntime: async args => { assert.equal(args.runtime, root); assert.equal(args.workspace, workspaceRoot);
      assert.equal(args.provider, 'none'); assert.equal(args.checkAuth, undefined); return report; } };
  const ready = await checkKit(options);
  assert.deepEqual([ready.status, ready.commit, ready.nextCommands, ready.remoteChecked], ['ready', binding.commit, [], false]);
  assert.equal((await checkKit({ ...options, progress: { inProgress: true } })).status, 'ready');
  assert.equal((await checkKit({ ...options, workspaceRoot: undefined })).reason, 'dots-workspace-binding-required');
  for (const change of [{ runtime: dir }, { provider: 'codex' }, { commit: 'not-a-pin' }]) {
    await writeFile(bindingFile, JSON.stringify({ ...binding, ...change }));
    assert.equal((await checkKit({ ...options, inspectPinnedRuntime: () => assert.fail('invalid binding must stop before inspection') })).reason,
      'dots-workspace-binding-invalid');
  }
  await writeFile(bindingFile, JSON.stringify(binding));
  assert.equal((await checkKit({ ...options, inspectPinnedRuntime: async () => ({ ...report, kit: { ...report.kit, commit: 'b'.repeat(40) } }) })).reason,
    'dots-runtime-binding-mismatch');
  for (const reason of ['source-local-changes', 'vendor-pin-mismatch', 'vendor-local-changes', 'source-metadata-unavailable']) {
    const blocked = await checkKit({ ...options, inspectPinnedRuntime: async () => ({ ...report, blockers: [reason] }) });
    assert.deepEqual([blocked.status, blocked.reason, blocked.nextCommands], ['blocked', reason, []]);
  }
  const manifestSha256 = 'c'.repeat(64);
  await writeFile(bindingFile, JSON.stringify({ ...binding, commit: null, manifestSha256 }));
  assert.equal((await checkKit({ ...options, inspectPinnedRuntime: async args => {
    assert.equal(args.manifestSha256, manifestSha256);
    return { blockers: [], kit: { version: binding.version, distribution: 'bundle', manifestSha256 } };
  } })).status, 'ready');
  await writeFile(marker, JSON.stringify({ schemaVersion: 99, host: 'dots' }));
  assert.equal((await checkKit(options)).reason, 'dots-runtime-marker-invalid');
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
  assert.deepEqual(open.options.map(o => o.id), ['gpt', 'grok', 'both', 'stop']);
  assert.match(open.verification, /creation:delivery는 기록의 누락·모순만 검사하며 표시를 증명하지 않는다/);
  const gpt = accountItem('gpt');
  assert.equal(gpt.status, 'chosen-unverified');
  assert.match(gpt.nextCommands[0], /--image-provider codex$/);
  assert.ok(!gpt.nextCommands.join(' ').includes('--confirmed-access'));
  assert.equal(accountItem('both').motionMethod, 'grok-video');
  assert.equal(accountItem('stop').status, 'stopped');
  assert.deepEqual(await elicitAccount({ getClientCapabilities: () => ({}) }), { method: 'unsupported', choice: null });
  const answering = content => ({ getClientCapabilities: () => ({ elicitation: { form: {} } }), elicitInput: async () => content });
  assert.deepEqual(await elicitAccount(answering({ action: 'accept', content: { account: 'grok' } })), { method: 'elicited', choice: 'grok' });
  assert.deepEqual(await elicitAccount(answering({ action: 'accept', content: { account: 'openai-api' } })), { method: 'accept', choice: null });
  assert.deepEqual(await elicitAccount(answering({ action: 'decline' })), { method: 'decline', choice: null });
  assert.deepEqual(await elicitAccount({ getClientCapabilities: () => ({ elicitation: {} }), elicitInput: async () => { throw new Error('no form'); } }),
    { method: 'unsupported', choice: null });
});

test('login offers device connection only when the server advertises it; otherwise another device is blocked', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-readiness-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  const probed = [];
  const probe = answer => async (url, options) => { probed.push(url); return publicProbe(answer)(url, options); };
  const none = await checkLogin({ remoteActive: false, sessionPath, probe: probe(false) });
  assert.equal(none.status, 'blocked'); assert.equal(none.accountStatus, 'sign-in-required');
  assert.match(none.routes.sameDevice.command, /^npm run login -- --url https:\/\/[a-z0-9]+\.supabase\.co --key sb_publishable_/);
  assert.deepEqual([none.routes.otherDevice.status, none.routes.otherDevice.secureRoute, none.routes.otherDevice.reason],
    ['blocked-no-secure-route', null, 'server-without-device-login']);
  assert.match(probed[0], /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/ai-fighter\/spec$/);
  // No paste or finish command is offered anywhere, and nothing calls a pasted callback safe.
  assert.ok(!/--paste|--finish/.test(JSON.stringify(none)));
  assert.match(none.note, /대화에 붙여 넣도록 요청하지 않고/);
  for (const [options, reason] of [[{ probe: async () => ({ status: 'unverified', reason: 'invalid-api-response' }) }, 'invalid-api-response'],
    [{ checkServer: false, probe: async () => assert.fail('no network requested') }, 'server-not-checked']])
    assert.equal((await checkLogin({ remoteActive: false, sessionPath, ...options })).routes.otherDevice.reason, reason);
  const device = await checkLogin({ remoteActive: false, sessionPath, probe: probe(true) });
  assert.deepEqual([device.routes.otherDevice.status, device.routes.otherDevice.secureRoute], ['available', 'device-connection']);
  assert.match(device.routes.otherDevice.start, /^npm run login -- --device --url https:\/\/[a-z0-9]+\.supabase\.co --key /);
  assert.equal(device.routes.otherDevice.wait, 'npm run login -- --device-wait');
  assert.deepEqual([device.action.label, device.action.status], ['ODDBOUT 연결', 'available']);
  assert.ok(!/--paste|--finish/.test(JSON.stringify(device)));
  // A leftover manual exchange file does not turn into a chat route.
  await writeFile(pendingLoginPath(sessionPath), JSON.stringify({ version: 1, createdAt: new Date().toISOString() }));
  assert.equal((await checkLogin({ remoteActive: false, sessionPath, probe: probe(false) })).status, 'blocked');
  await writeFile(sessionPath, JSON.stringify({ accessToken: jwt({ sub: 'user-9' }), refreshToken: 'refresh-secret' }));
  const restart = await checkLogin({ remoteActive: false, sessionPath, probe: probe(true) });
  assert.deepEqual([restart.status, restart.accountMatch], ['restart-required', 'unknown']);
  assert.equal(restart.userId, undefined);
  assert.ok(!JSON.stringify(restart).includes('refresh-secret'));
  assert.equal((await checkLogin({ remoteActive: true, sessionPath, probe: probe(true) })).status, 'session-present-unverified');
});

test('saved sessions need GET /me; network denial, expired authentication and service denial have different owners', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-connection-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  await writeFile(sessionPath, JSON.stringify({ accessToken: jwt({ sub: 'unverified-user' }), refreshToken: 'secret' }));
  const options = { sessionPath, remoteActive: true, probe: publicProbe(true) };
  const connected = await checkLogin({ ...options, request: async route => {
    assert.equal(route, 'me'); return { ok: true, account: { invited: true, canSubmit: true } }; } });
  assert.equal(connected.status, 'connected'); assert.equal(connected.canSubmit, true);
  assert.equal(connected.accountMatch, 'unknown');
  assert.ok(!/secret|unverified-user/.test(JSON.stringify(connected)));
  for (const [reason, status, actor] of [['network-connect-forbidden', 'blocked', 'environment-preparer'],
    ['authentication-required', 'sign-in-required', 'user'], ['api-http-403', 'blocked', 'service-operator']]) {
    const result = await checkLogin({ ...options, request: async () => { throw new Error(reason); } });
    assert.deepEqual([result.status, result.nextAction.actor], [status, actor]);
    assert.equal(result.action.actor, actor);
    assert.equal(result.canSubmit, null);
  }
  const offline = await checkLogin({ ...options, checkServer: false, request: async () => assert.fail('offline must not query') });
  assert.equal(offline.status, 'session-present-unverified');
});

test('pending approval resumes without a new request; a blocked VM never tells the creator to sign in again', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-pending-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  await writeFile(pendingDeviceLoginPath(sessionPath), JSON.stringify({ version: 1, deviceCode: 'secret-device-code', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  const waiting = await checkLogin({ sessionPath, probe: publicProbe(true) });
  assert.equal(waiting.action.status, 'awaiting-approval');
  assert.equal(waiting.action.command, undefined); assert.equal(waiting.action.resumeCommand, 'npm run login -- --device-wait');
  assert.ok(!JSON.stringify(waiting).includes('secret-device-code'));
  const blocked = await checkLogin({ sessionPath, probe: async () => ({ status: 'blocked', reason: 'network-connect-forbidden',
    nextAction: { actor: 'environment-preparer', code: 'prepare-workspace-network' } }) });
  assert.equal(blocked.action.status, 'blocked'); assert.equal(blocked.action.command, undefined);
  assert.equal(blocked.nextAction.actor, 'environment-preparer');
  assert.equal(blocked.infrastructure.networkSettingsManagedByKit, false);
  const recovered = await checkLogin({ sessionPath, probe: publicProbe(true) });
  assert.equal(recovered.action.status, 'awaiting-approval');
});

test('ODDBOUT and kit success never verify generation or parent display, and existing work survives recovery', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-ready-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  await writeFile(sessionPath, JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }));
  const state = { items: { idle: { versions: { v1: {} } } } }, work = [{ status: 'unknown' }];
  const result = await checkReadiness({ store: { list: async () => [{ sessionId: 'existing' }], read: async () => state },
    jobs: { list: async () => work }, account: 'gpt', remoteActive: true,
    kit: { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true) },
    tools: workingTools,
    login: { sessionPath, probe: publicProbe(true), request: async () => ({ ok: true, account: { invited: true, canSubmit: true } }) } });
  assert.equal(result.readyForRegistration, true); assert.equal(result.kitAndAccountReady, true);
  assert.equal(result.readyForGeneration, false); assert.equal(result.items.generation.status, 'unverified');
  assert.equal(result.items.delivery.parentDisplay, 'unverified');
  assert.equal(result.items.infrastructure.targets.library.status, 'unverified');
  assert.deepEqual(result.resume.sessionIds, ['existing']); assert.equal(result.resume.automaticGeneration, false);
  assert.deepEqual(work, [{ status: 'unknown' }]); assert.ok(state.items.idle.versions.v1);
});

test('a missing required system tool keeps generation from being ready and names who installs it', async () => {
  const result = await checkReadiness({ account: 'gpt', remoteActive: false,
    kit: { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true), fetchRemote: false },
    tools: { inspect: async () => ({ ffmpeg: { status: 'missing', install: { actor: 'user', command: 'sudo apt install ffmpeg' } },
      ffprobe: { status: 'missing', install: { actor: 'user', command: 'sudo apt install ffmpeg' } },
      img2webp: { status: 'broken', install: { actor: 'agent', command: 'npm run sprite:setup' } }, rife: { status: 'ok' } }) },
    login: { checkServer: false } });
  assert.equal(result.kitAndAccountReady, false);
  assert.deepEqual([result.items.tools.status, result.items.tools.missing], ['action-required', ['ffmpeg', 'ffprobe', 'img2webp']]);
  assert.deepEqual(result.items.tools.nextCommands, ['npm run sprite:setup']);
  assert.deepEqual([result.items.tools.nextAction.actor, result.items.tools.nextAction.commands], ['user', ['sudo apt install ffmpeg']]);
  const connection = await checkReadiness({ purpose: 'connection', tools: { inspect: () => assert.fail('no tool probe') }, login: { checkServer: false } });
  assert.equal(connection.items.tools.status, 'not-required');
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
  assert.deepEqual(asked.requestedSchema.properties.account.oneOf.map(o => o.const), ['gpt', 'grok', 'both', 'stop']);
  assert.equal(result.data.elicitation, 'elicited');
  assert.equal(result.data.items.account.choice, 'gpt');
  // Without a workspace, progress is unknown: the kit is reported, never changed.
  assert.equal(result.data.progress.known, false);
  assert.ok(['ready', 'deferred', 'action-required', 'blocked'].includes(result.data.items.kit.status));
  const stated = (await client.callTool({ name: 'check_creation_readiness', arguments: { account: 'stop', checkRemote: false } })).structuredContent;
  assert.deepEqual([stated.data.elicitation, stated.data.items.account.status, stated.data.readyForGeneration], ['not-needed', 'stopped', false]);
});

test('cloud workspace readiness does not read or suggest a local registration account', async t => {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer({ registrationMode: 'cloud' }).connect(serverSide);
  const client = new Client({ name: 'cloud-readiness-test', version: '1' });
  await client.connect(clientSide); t.after(() => client.close());
  const result = (await client.callTool({ name: 'check_creation_readiness', arguments: { account: 'stop', checkRemote: false } })).structuredContent;
  assert.equal(result.ok, true);
  assert.equal(result.data.items.login.status, 'connector-verification-required');
  assert.equal(result.data.items.login.userId, null);
  assert.equal(result.data.items.login.routes, undefined);
  assert.equal(result.data.readyForRegistration, false);
  assert.deepEqual(result.data.items.login.nextTools, ['get_profile', 'check_creation_readiness']);
  assert.throws(() => createServer({ registrationMode: 'cloud', remote: { request: () => assert.fail('must not use CLI account') } }), /inconsistent-registration-route/);
});

test('a saved environment keeps the stated provider and reports its preconditions without certifying generation', async () => {
  const kit = { installed, git: fakeGit({ counts: '0\t0' }).git, inspectEngine: engineState(true) };
  const base = { account: 'gpt', kit, tools: workingTools, registrationMode: 'cloud' };
  const noEnvironment = await checkReadiness(base);
  assert.equal(noEnvironment.readyForGeneration, false);
  assert.equal(noEnvironment.items.environment.status, 'workspace-required');
  const environment = { read: async () => ({ account: 'gpt' }), inspect: async () => ({ status: 'preconditions-recorded', account: 'gpt', readyForGeneration: true }) };
  const saved = await checkReadiness({ ...base, account: undefined, environment,
    lowLevelServer: { getClientCapabilities: () => { assert.fail('must reuse the stated choice'); } } });
  assert.equal(saved.elicitation, 'saved-environment');
  assert.equal(saved.items.account.choice, 'gpt');
  assert.equal(saved.items.environment.status, 'preconditions-recorded');
  assert.equal(saved.items.environment.matchesChoice, true);
  assert.equal(saved.readyForGeneration, false);
  const other = await checkReadiness({ ...base, account: 'grok', environment });
  assert.equal(other.items.environment.matchesChoice, false);
});

test('connection and registration never ask generation questions or touch the engine', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-stage-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  await writeFile(sessionPath, JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }));
  for (const purpose of ['connection', 'registration']) {
    const result = await checkReadiness({ purpose, remoteActive: true,
      lowLevelServer: { getClientCapabilities: () => assert.fail('no generation prompt') },
      kit: { git: () => assert.fail('no git or install'), inspectEngine: () => assert.fail('no engine read') },
      login: { sessionPath, probe: publicProbe(true), request: async () => ({ ok: true, account: { canSubmit: true } }) } });
    assert.equal(result.purpose, purpose); assert.equal(result.readyForRegistration, true);
    assert.equal(result.elicitation, 'not-needed'); assert.equal(result.items.account.status, 'not-required');
    assert.equal(result.items.kit.status, 'not-required'); assert.equal(result.readyForGeneration, false);
  }
});

test('homepage failure does not redirect an already connected creator away from registration', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fighter-homepage-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionPath = path.join(dir, 'client.json');
  await writeFile(sessionPath, JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }));
  const result = await checkLogin({ sessionPath, remoteActive: true,
    probe: async (_url, { spec } = {}) => spec ? { status: 'reachable', deviceLogin: 'available' }
      : { status: 'blocked', reason: 'network-connect-forbidden' },
    request: async () => ({ ok: true, account: { canSubmit: true } }) });
  assert.equal(result.status, 'connected'); assert.equal(result.nextAction.actor, 'agent');
});
