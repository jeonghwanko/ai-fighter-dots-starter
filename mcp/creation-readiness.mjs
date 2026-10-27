// Creation readiness: kit/patch currency, the user's generation-account choice, and ODDBOUT sign-in.
// One tool reports all three with fixed options so a host can show them as choices (or an elicitation form).
// It never generates, never switches providers, and never proves that a preview was displayed.
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSpritePatch, inspectSpritePatch } from '../scripts/sprite-patch.mjs';
import { defaultSessionPath, jwtPayload } from '../scripts/login.mjs';
import { createEnvironmentStore } from './creation-environment.mjs';

export const KIT_BRANCH = 'codex/creator-hosting';
const kitRoot = fileURLToPath(new URL('../', import.meta.url));

export const ACCOUNT_OPTIONS = [
  { id: 'gpt', label: '내 GPT(ChatGPT) 구독으로 진행', provider: 'codex' },
  { id: 'grok', label: '내 Grok 구독으로 진행', provider: 'grok' },
  { id: 'both', label: 'GPT 원화 + Grok 동작으로 진행', provider: 'codex' },
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

/** Public project values (`--url`/`--key` flags) from the published site configuration, or null. */
async function projectFlags(root) {
  try {
    const site = JSON.parse(await readFile(path.join(root, 'deploy', 'creator-site.json'), 'utf8'));
    return { origin: new URL(site.apiBase).origin, flags: `--url ${new URL(site.apiBase).origin} --key ${site.publishableKey}` };
  } catch { return null; }
}

/** Whether the deployed API advertises device login in its public spec: true, false, or null when unreachable. */
export async function probeDeviceLogin(origin, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`${origin}/functions/v1/ai-fighter/spec`, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return (await response.json())?.data?.registration?.deviceLogin === 'v1';
  } catch { return null; }
}

/**
 * ODDBOUT sign-in state. Reads the session file only for presence, user id and expiry; never returns tokens.
 * Same-device browsers use the loopback login. Another device (a bot VM) gets the device-connection login only when
 * the deployed server advertises it; otherwise that route is a reported blocker. Callback addresses carry
 * authorization codes, so no route ever sends them through chat.
 */
export async function checkLogin({ remoteActive, sessionPath = defaultSessionPath(), root = kitRoot, probe = probeDeviceLogin, checkServer = true } = {}) {
  const read = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
  const saved = await read(sessionPath);
  const signedIn = Boolean(saved && typeof saved.accessToken === 'string' && typeof saved.refreshToken === 'string');
  if (signedIn) return { status: remoteActive ? 'signed-in' : 'restart-required', userId: jwtPayload(saved.accessToken)?.sub ?? null,
    remoteToolsActive: Boolean(remoteActive), note: remoteActive ? '세션 파일이 있다. 유효한 서버 세션이나 현재 대화와 같은 계정임은 등록 도구 응답으로만 확인된다.'
      : '세션 파일은 있지만 이 MCP 프로세스는 로그인 전에 시작됐다. 호스트를 다시 시작해야 등록 도구가 열린다.' };
  const project = await projectFlags(root), flags = project ? ` ${project.flags}` : '';
  const supported = checkServer && project ? await probe(project.origin) : null;
  const otherDevice = supported === true
    ? { status: 'available', secureRoute: 'device-connection', start: `npm run login -- --device${flags}`, wait: 'npm run login -- --device-wait',
        when: '봇 VM처럼 사용자 브라우저가 다른 기기에 있을 때. start가 보여주는 링크와 공개 확인 코드를 사용자에게 전하고,'
          + ' 사용자가 홈페이지에서 본인 Google 로그인 후 코드가 같은지 확인해 승인하면 wait를 실행한다.' }
    : { status: 'blocked-no-secure-route', secureRoute: null,
        reason: supported === false ? 'server-without-device-login' : checkServer ? 'server-support-unknown' : 'server-not-checked',
        when: '봇 VM처럼 사용자 브라우저가 다른 기기에 있을 때. 배포된 서버가 기기 연결 로그인을 알리지 않으면 이 경로는 막혀 있다.' };
  return { status: 'sign-in-required', userId: null, remoteToolsActive: Boolean(remoteActive),
    routes: {
      sameDevice: { status: 'available', command: `npm run login${flags ? ` --${flags}` : ''}`,
        when: '사용자 브라우저가 이 작업 공간과 같은 기기에서 실행될 때만. 로그인 콜백이 이 기기의 127.0.0.1로 돌아온다.' },
      otherDevice,
    },
    note: otherDevice.status === 'available'
      ? '기기 연결 링크와 확인 코드는 비밀이 아니다. 승인은 사용자가 홈페이지에서 직접 한다. 콜백 주소나 토큰은 대화로 옮기지 않는다.'
      : '다른 기기 브라우저라면 로그인을 시작하지 말고 인증 연결이 막혔다고 사용자에게 알린다. 콜백 주소에는 인증 코드·토큰이 들어갈 수 있으므로'
        + ' 대화에 붙여 넣도록 요청하지 않고, 안전하다고 안내하지 않는다.' };
}

/** The generation-account choice: options to show; the user's stated or elicited answer only. Never inferred. */
export function accountItem(choice) {
  const option = ACCOUNT_OPTIONS.find(o => o.id === choice);
  const verification = '로그인·구독·한도 확인은 sprite-gen workflow가 하고, 실제 생성 접근은 생성 결과로만 확인된다.'
    + ' 결과 표시는 이 대화에 실제 이미지를 보여준 것으로만 확인한다. creation:delivery는 기록의 누락·모순만 검사하며 표시를 증명하지 않는다.';
  if (!option) return { status: 'choice-required', options: ACCOUNT_OPTIONS.map(({ id, label }) => ({ id, label })), verification };
  if (option.id === 'stop') return { status: 'stopped', choice: option.id, verification };
  return { status: 'chosen-unverified', choice: option.id, provider: option.provider, verification,
    imageProvider: option.provider, motionMethod: choice === 'gpt' ? 'gpt-rows' : 'grok-video',
    // Choosing a provider is not a statement that its image/video entitlement was checked.
    nextCommands: [`npm run sprite -- workflow --kind image --image-provider ${option.provider}`,
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

export async function checkReadiness({ store, jobs, sessionId, account, remoteActive, lowLevelServer, kit = {}, login = {}, registrationMode = 'local', environment } = {}) {
  const progress = await creationProgress({ store, jobs, sessionId });
  const connection = environment ?? (store?.root ? createEnvironmentStore(store.root) : null);
  const saved = connection ? await connection.read() : null;
  let choice = account ?? saved?.account ?? null, elicitation = saved?.account && !account ? 'saved-environment' : 'not-needed';
  if (!choice) ({ method: elicitation, choice } = await elicitAccount(lowLevelServer));
  const items = { kit: await checkKit({ progress, ...kit }), account: accountItem(choice),
    login: registrationMode === 'cloud' ? { status: 'connector-verification-required', userId: null,
      route: 'oddbout-cloud', nextTools: ['get_profile', 'check_creation_readiness'],
      note: 'Use the connected ODDBOUT tools in this conversation. Verify its account and readiness there. Do not run workspace login or transfer credentials. This result does not verify that connection.' }
      : await checkLogin({ remoteActive, ...login }) };
  items.environment = connection ? await connection.inspect() : { status: 'workspace-required', readyForGeneration: false };
  const workflowReady = ['ready', 'updated', 'patched'].includes(items.kit.status) && !items.kit.restartRequired && items.kit.nextCommands.length === 0
    && items.account.status === 'chosen-unverified';
  const ready = workflowReady && items.environment.readyForGeneration && items.environment.account === choice;
  return { readyForWorkflow: workflowReady, readyForGeneration: Boolean(ready), readyForRegistration: items.login.status === 'signed-in', progress, elicitation, items,
    meaning: 'Readiness preconditions only. Generation access, preview display and motion quality still need actual results.' };
}
