// Separate workspace setup, ODDBOUT connection, provider choice, generation access and parent delivery.
// It never generates, never switches providers, and never proves that a preview was displayed.
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSpritePatch, inspectSpritePatch } from '../scripts/sprite-patch.mjs';
import { checkTools } from '../scripts/sprite-tools.mjs';
import { defaultSessionPath } from '../scripts/login.mjs';
import { connectionAction } from '../api/connection-errors.mjs';
import { readProject, probeConnections, checkAccount, pendingConnection, infrastructureItem, unverifiedCreation } from './connection-readiness.mjs';

export const KIT_BRANCH = 'codex/creator-hosting';
const kitRoot = fileURLToPath(new URL('../', import.meta.url));

export const ACCOUNT_OPTIONS = [
  { id: 'gpt', label: '내 GPT(ChatGPT) 구독으로 진행', provider: 'codex' },
  { id: 'grok', label: '내 Grok 구독으로 진행', provider: 'grok' },
  { id: 'stop', label: '지금은 생성하지 않고 멈춤', provider: null },
];

/** git without a shell. Resolves { code, stdout } and never throws for a non-zero exit. */
export function runGit(args, { cwd = kitRoot, timeout = 30000 } = {}) {
  return new Promise(resolve => execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 1 << 20 },
    (error, stdout) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? '').trim() })));
}

/**
 * A character is in progress once any version or non-cancelled job exists. Updating then would change the
 * engine under recorded attempts and reviews (docs/EXECUTION-HOST.md). Without a workspace it is unknown.
 */
export async function creationProgress({ store, jobs, sessionId } = {}) {
  if (!store) return { known: false, inProgress: null, sessions: [] };
  const ids = sessionId ? [sessionId] : (await store.list()).map(s => s.sessionId);
  const active = [];
  for (const id of ids) {
    const state = await store.read(id);
    const versions = Object.values(state.items ?? {}).some(item => Object.keys(item.versions ?? {}).length);
    const work = (await jobs.list(id)).some(job => job.status !== 'cancelled');
    if (versions || work) active.push(id);
  }
  return { known: true, inProgress: active.length > 0, sessions: active };
}

/**
 * Bring the kit and its hash-bound sprite-gen motion patch current, but only before a character starts.
 * Fast-forward only, on the published branch, with no tracked local edits. Slow installs are returned as commands.
 */
export async function checkKit({ installed, ...options } = {}) {
  const spriteRoot = options.spriteRoot ?? path.join(options.root ?? kitRoot, 'vendor', 'sprite-gen');
  const present = installed ?? await installedSpriteGen(spriteRoot);
  const result = await checkKitCore({ ...options, spriteRoot, present });
  if (present.source && present.environment) return result;
  // First run in a fresh workspace: the agent installs; nothing here is a local-change problem.
  for (const command of ['npm ci --ignore-scripts', 'npm run sprite:setup', 'npm run sprite:status'])
    if (!result.nextCommands.includes(command)) result.nextCommands.push(command);
  return { ...result, status: result.status === 'blocked' ? 'blocked' : 'action-required', reason: result.reason ?? 'sprite-gen-not-installed' };
}

async function installedSpriteGen(spriteRoot) {
  const exists = file => access(file).then(() => true, () => false);
  return { source: await exists(path.join(spriteRoot, 'SKILL.md')),
    environment: await exists(path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')) };
}

async function checkKitCore({ progress, present, fetchRemote = true, git = runGit, root = kitRoot, spriteRoot,
  inspectPatch = inspectSpritePatch, ensurePatch = ensureSpritePatch }) {
  const result = { status: 'ready', branch: null, behind: null, ahead: null, remoteChecked: false, patch: null,
    changedFiles: [], nextCommands: [], restartRequired: false, reason: null };
  const readPatch = async () => !present.source ? { applied: false, error: 'sprite-gen-not-installed' }
    : inspectPatch(spriteRoot).then(s => ({ id: s.manifest.id, applied: s.applied }), e => ({ applied: false, error: e.message }));
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  result.branch = head.stdout;
  result.patch = await readPatch();
  // A packaged plugin runtime is not a checkout: its version comes with the package, so report only.
  if (head.code !== 0) return { ...result, status: result.patch.applied ? 'ready' : 'action-required', reason: 'not-a-git-checkout' };
  if (result.branch !== KIT_BRANCH) return { ...result, status: 'blocked', reason: 'wrong-branch' };
  // A patched submodule is always "dirty"; only tracked edits in this checkout or a moved gitlink count.
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty'], { cwd: root })).stdout;
  if (fetchRemote) result.remoteChecked = (await git(['fetch', '--quiet', 'origin', KIT_BRANCH], { cwd: root, timeout: 60000 })).code === 0;
  if (result.remoteChecked) {
    const counts = (await git(['rev-list', '--left-right', '--count', `HEAD...origin/${KIT_BRANCH}`], { cwd: root })).stdout.split(/\s+/).map(Number);
    [result.ahead, result.behind] = counts.length === 2 && counts.every(Number.isInteger) ? counts : [null, null];
  }
  if (progress.inProgress !== false) {
    // In progress, or unknown without a workspace: report only, change nothing.
    const reason = progress.inProgress === null ? 'progress-unknown-no-workspace' : 'character-in-progress';
    if (result.behind > 0) return { ...result, status: 'deferred', reason };
    return { ...result, status: result.patch.applied ? 'ready' : 'action-required', reason: result.patch.applied ? null : reason };
  }
  if (dirty) return { ...result, status: 'blocked', reason: 'local-changes' };
  if (result.ahead > 0) return { ...result, status: 'blocked', reason: 'diverged-from-published-branch' };
  if (result.behind > 0) {
    const before = (await git(['rev-parse', 'HEAD'], { cwd: root })).stdout;
    if ((await git(['merge', '--ff-only', `origin/${KIT_BRANCH}`], { cwd: root, timeout: 60000 })).code !== 0)
      return { ...result, status: 'blocked', reason: 'fast-forward-failed' };
    result.changedFiles = (await git(['diff', '--name-only', before, 'HEAD'], { cwd: root })).stdout.split('\n').filter(Boolean);
    const changed = file => result.changedFiles.includes(file);
    if (changed('package.json') || changed('package-lock.json')) result.nextCommands.push('npm ci --ignore-scripts');
    if (changed('vendor/sprite-gen') || !present.source) result.nextCommands.push('npm run sprite:setup');
    else result.patch = await ensurePatch(spriteRoot).then(s => ({ id: s.manifest.id, applied: s.applied }), e => ({ applied: false, error: e.message }));
    result.nextCommands.push('npm run sprite:status');
    // This MCP process still runs the code it started with.
    result.restartRequired = result.changedFiles.some(f => /^(mcp|api|contracts|scripts)\//.test(f) || /^package(-lock)?\.json$/.test(f));
    return { ...result, status: 'updated' };
  }
  if (!present.source) return result; // checkKit adds the install commands
  if (result.patch.error) return { ...result, status: 'blocked', reason: 'vendor-local-changes' };
  if (!result.patch.applied) {
    result.patch = await ensurePatch(spriteRoot).then(s => ({ id: s.manifest.id, applied: s.applied }), e => ({ applied: false, error: e.message }));
    return { ...result, status: result.patch.applied ? 'patched' : 'blocked', reason: result.patch.applied ? null : 'patch-apply-failed' };
  }
  return { ...result, reason: result.remoteChecked ? null : 'remote-unreachable-current-unknown' };
}

/**
 * Inspect saved/pending session presence, public routes and authenticated GET /me separately.
 * No new login request is started. The existing device login commands are offered only after public probes pass.
 */
export async function checkLogin({ remoteActive, request, sessionPath = defaultSessionPath(), root = kitRoot, probe, checkServer = true } = {}) {
  const read = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
  const saved = await read(sessionPath);
  const hasSession = Boolean(saved && typeof saved.accessToken === 'string' && saved.accessToken && typeof saved.refreshToken === 'string' && saved.refreshToken);
  const project = await readProject(root), flags = project ? ` ${project.flags}` : '';
  const connections = await probeConnections(project, { checkServer, probe });
  const account = await checkAccount({ hasSession, remoteActive, request, checkServer: checkServer && connections.api.status === 'reachable' });
  const pending = await pendingConnection(sessionPath);
  const available = connections.api.status === 'reachable' && connections.api.deviceLogin === 'available' && connections.homepage.status === 'reachable';
  const routeReason = connections.api.status !== 'reachable' ? connections.api.reason
    : connections.api.deviceLogin !== 'available' ? 'server-without-device-login'
    : connections.homepage.status !== 'reachable' ? connections.homepage.reason : null;
  const otherDevice = available
    ? { status: 'available', secureRoute: 'device-connection', start: `npm run login -- --device${flags}`, wait: 'npm run login -- --device-wait',
        when: '봇 VM처럼 사용자 브라우저가 다른 기기에 있을 때. start가 보여주는 링크와 공개 확인 코드를 사용자에게 전하고,'
          + ' 사용자가 홈페이지에서 본인 Google 로그인 후 코드가 같은지 확인해 승인하면 wait를 실행한다.' }
    : { status: 'blocked-no-secure-route', secureRoute: null,
        reason: routeReason, when: '연결 가능 여부를 확인하기 전에는 새 로그인이나 콜백 주소 전달을 시작하지 않는다.' };
  const routeAction = connections.api.nextAction ?? connections.homepage.nextAction
    ?? (routeReason === 'server-without-device-login' ? { actor: 'service-operator', code: 'device-login-deployment-required',
      message: '서비스 운영자가 기존 기기 로그인 API와 홈페이지 승인 화면의 배포를 확인해야 한다. 일반 제작 사용자에게 배포를 요구하지 않는다.' }
      : connectionAction(routeReason));
  const needsSignIn = account.status === 'sign-in-required';
  const action = { id: 'connect-oddbout', label: 'ODDBOUT 연결',
    status: account.status === 'connected' ? 'connected' : account.status === 'restart-required' ? 'restart-required'
      : !available ? 'blocked' : !needsSignIn ? 'check-required' : pending.status === 'pending' ? 'awaiting-approval'
      : pending.status === 'unknown' ? 'check-required' : 'available',
    actor: needsSignIn && available ? 'user' : routeAction.actor,
    steps: ['ODDBOUT 연결', '본인 Google 계정 로그인', '화면의 공개 확인 코드 확인 및 연결 승인'],
    ...(needsSignIn && available && ['none', 'expired'].includes(pending.status) ? { command: otherDevice.start } : {}),
    ...(needsSignIn && available && pending.status === 'pending' ? { resumeCommand: otherDevice.wait } : {}) };
  const nextAction = account.status === 'restart-required' ? { actor: 'agent', code: 'restart-mcp',
    message: '저장된 세션을 보존하고 MCP를 다시 시작해 계정 상태를 조회한다. 다시 로그인하거나 캐릭터를 재생성하지 않는다.' }
    : !available && account.status !== 'connected' ? routeAction : account.nextAction ?? { actor: needsSignIn ? 'user' : 'agent', code: action.status,
      message: needsSignIn ? '본인이 시작한 요청과 코드가 같은지 확인하고 연결을 승인한다. 기존 승인 대기는 새로 시작하지 않고 이어간다.'
        : '계정 상태를 확인한 뒤 기존 제작 기록에서 재개한다. 연결 확인은 생성·등록 실행 승인이 아니다.' };
  return { ...account, status: needsSignIn && !available ? 'blocked' : needsSignIn && pending.status === 'pending' ? 'pending-approval' : account.status,
    accountStatus: account.status, label: 'ODDBOUT 계정 연결', savedSessionPresent: hasSession, pendingConnection: pending.status,
    remoteToolsActive: Boolean(remoteActive), infrastructure: infrastructureItem(project, connections), action: { ...action, actor: nextAction.actor }, nextAction,
    routes: {
      sameDevice: connections.api.status === 'reachable'
        ? { status: 'available', command: `npm run login --${flags}`, when: '사용자 브라우저가 작업 공간과 같은 기기에 있을 때만 사용한다. VM 작업을 PC로 옮기지 않는다.' }
        : { status: 'blocked', reason: connections.api.reason },
      otherDevice,
    },
    note: '키트는 연결 행동·상태와 기존 CLI 명령을 제공한다. Dots 자체 버튼을 설치하지 않는다. 호스트가 버튼을 지원하지 않으면 같은 이름의 선택지와 공식 링크로 안내한다.'
      + ' 콜백 주소나 토큰을 대화에 붙여 넣도록 요청하지 않고, 안전하다고 안내하지 않는다.' };
}

/** The generation-account choice: options to show; the user's stated or elicited answer only. Never inferred. */
export function accountItem(choice) {
  const option = ACCOUNT_OPTIONS.find(o => o.id === choice);
  const verification = 'sprite-gen workflow는 사용자가 전달한 선택·접근 조건을 확인하며 구독·한도·실제 생성 성공을 보증하지 않는다.'
    + ' 결과 표시는 이 대화에 실제 이미지를 보여준 것으로만 확인한다. creation:delivery는 기록의 누락·모순만 검사하며 표시를 증명하지 않는다.';
  if (!option) return { status: 'choice-required', options: ACCOUNT_OPTIONS.map(({ id, label }) => ({ id, label })), verification };
  if (option.id === 'stop') return { status: 'stopped', choice: option.id, verification };
  return { status: 'chosen-unverified', choice: option.id, provider: option.provider, verification,
    nextCommands: [`npm run sprite -- workflow --kind image --confirmed-access ${option.provider}`,
      'npm run creation:delivery -- preflight output/<sessionId>-work/delivery-check.json <현재-대화-ID>'] };
}

/** Ask for the account through a host form when the client supports elicitation. Any failure means "ask in text". */
export async function elicitAccount(lowLevelServer) {
  if (!lowLevelServer?.getClientCapabilities?.()?.elicitation) return { method: 'unsupported', choice: null };
  try {
    const answer = await lowLevelServer.elicitInput({
      message: '이번 캐릭터 생성에 쓸 본인 구독을 골라 주세요. 다른 서비스나 유료 API로 자동 전환하지 않습니다.',
      requestedSchema: { type: 'object', required: ['account'], properties: { account: { type: 'string', title: '생성 계정',
        oneOf: ACCOUNT_OPTIONS.map(({ id, label }) => ({ const: id, title: label })) } } },
    }, { timeout: 5 * 60 * 1000 });
    return answer.action === 'accept' && ACCOUNT_OPTIONS.some(o => o.id === answer.content?.account)
      ? { method: 'elicited', choice: answer.content.account } : { method: answer.action ?? 'declined', choice: null };
  } catch { return { method: 'unsupported', choice: null }; }
}

export async function checkReadiness({ store, jobs, sessionId, account, purpose = 'generation', remoteActive, lowLevelServer, kit = {}, tools = {}, login = {} } = {}) {
  if (!['generation', 'connection', 'registration'].includes(purpose)) throw new Error('invalid-readiness-purpose');
  const needsGeneration = purpose === 'generation';
  const progress = await creationProgress({ store, jobs, sessionId });
  let choice = account ?? null, elicitation = 'not-needed';
  if (needsGeneration && !choice) ({ method: elicitation, choice } = await elicitAccount(lowLevelServer));
  const { infrastructure, ...connection } = await checkLogin({ remoteActive, ...login });
  const notRequired = { status: 'not-required', reason: 'no-generation-in-this-step', nextCommands: [] };
  const spriteRoot = kit.spriteRoot ?? path.join(kit.root ?? kitRoot, 'vendor', 'sprite-gen');
  const items = { kit: needsGeneration ? await checkKit({ progress, ...kit }) : notRequired,
    // ffmpeg, ffprobe and img2webp -exact are required; RIFE only warns (loops cut as filmed).
    tools: needsGeneration ? await checkTools({ spriteRoot, python: path.join(spriteRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), ...tools }) : notRequired,
    infrastructure, login: connection,
    account: needsGeneration ? accountItem(choice) : notRequired, ...unverifiedCreation(choice) };
  const ready = ['ready', 'updated', 'patched'].includes(items.kit.status) && !items.kit.restartRequired && items.kit.nextCommands.length === 0
    && items.tools.status === 'ready' && items.account.status === 'chosen-unverified';
  return { purpose, kitAndAccountReady: ready, readyForGeneration: false,
    readyForRegistration: items.login.status === 'connected' && items.login.canSubmit === true, progress, elicitation, items,
    resume: { preserveWorkspace: true, sessionIds: progress.sessions, automaticGeneration: false, automaticSubmission: false,
      nextAction: { actor: 'agent', code: 'resume-existing-work', message: '연결 복구 뒤 같은 작업 공간에서 check_creation_readiness를 다시 호출하고 get_creation_session·get_creation_job으로 기존 버전·선택·pending/unknown 결과를 회수한다. 새 폴더·재생성·재등록으로 우회하지 않는다.' } },
    meaning: 'kitAndAccountReady covers the kit, its required system tools (ffmpeg, ffprobe, img2webp with -exact) and provider choice only. Generation and parent display remain unverified by this tool; readyForGeneration stays false. Registration readiness means authenticated API access, not package approval or submission authorization.' };
}
