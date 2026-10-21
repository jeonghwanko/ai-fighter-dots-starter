// Google sign-in for Dot. Creates this user's own Supabase session file; nothing is shared with the browser.
// Usage: npm run login | npm run login -- --link | npm run login -- --replace | npm run logout
// --link adds Google to the existing account in the session file (beta accounts made before Google sign-in).
// --replace allows a login to overwrite a session file that belongs to a different user.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { apiRequest, validProjectUrl, withSessionLock, writeSessionFile } from '../api/client.mjs';

export const DEFAULT_LOGIN_PORT = 47821;
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
export const defaultSessionPath = () => process.env.AI_FIGHTER_CLIENT_CONFIG || path.join(homedir(), '.ai-fighter', 'client.json');

/** Decoded JWT payload, or null. Used only to read `role`, `sub` and `exp`; the server verifies every token. */
export function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
}
/** A publishable key (`sb_publishable_…`) or the legacy anon JWT. Never a secret or service_role key. */
export const isPublishableKey = key => typeof key === 'string'
  && (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key) || (key.split('.').length === 3 && jwtPayload(key)?.role === 'anon'));

/** Project URL and publishable key: flags, then environment, then the existing session file. All are public values. */
export async function projectSettings({ argv = [], env = process.env, sessionPath = defaultSessionPath() } = {}) {
  const flag = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  let saved = {};
  try { saved = JSON.parse(await readFile(sessionPath, 'utf8')); } catch { /* first login */ }
  const url = flag('--url') ?? env.AI_FIGHTER_SUPABASE_URL ?? saved.url;
  const publishableKey = flag('--key') ?? env.AI_FIGHTER_PUBLISHABLE_KEY ?? saved.publishableKey;
  if (!validProjectUrl(url)) throw new Error('project-url-required');
  // Never accept a secret key here: the file is readable by every MCP process on this account.
  if (!isPublishableKey(publishableKey)) throw new Error('publishable-key-required');
  const portText = flag('--port') ?? env.AI_FIGHTER_LOGIN_PORT;
  const port = portText === undefined ? DEFAULT_LOGIN_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid-login-port');
  return { url, publishableKey, port };
}

function memoryStorage() {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); }, removeItem: key => { items.delete(key); } };
}

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px/1.6 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px"><h1 style="font-size:22px">${title}</h1><p>${body}</p></body>`;

/**
 * Wait for one OAuth redirect to http://127.0.0.1:<port>/callback/<state>. Resolves with the authorization code.
 * Requests without this run's random state get 404 and do not end the wait, so another local page cannot cancel it.
 */
export function waitForCallback({ port, state, timeoutMs = LOGIN_TIMEOUT_MS, onListening }) {
  if (!/^[a-f0-9]{32}$/.test(state ?? '')) return Promise.reject(new Error('login-callback-failed'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      server.close(); server.closeAllConnections?.();
      if (error) reject(error); else resolve(code);
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (request.method !== 'GET' || url.pathname !== `/callback/${state}`) { response.writeHead(404).end(); return; }
      const code = url.searchParams.get('code'), problem = url.searchParams.get('error_code') ?? url.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      if (code && /^[A-Za-z0-9._~-]{8,512}$/.test(code)) {
        response.end(page('AI Fighter 로그인 완료', '터미널로 돌아가세요. 이 창은 닫아도 됩니다.'));
        finish(null, code);
      } else {
        response.end(page('AI Fighter 로그인 실패', '터미널의 안내를 확인하세요.'));
        finish(new Error(problem === 'identity_already_exists' ? 'identity-already-linked' : problem ? 'oauth-denied' : 'oauth-callback-invalid'));
      }
    });
    const timer = setTimeout(() => finish(new Error('login-timeout')), timeoutMs);
    server.once('error', error => finish(new Error(error.code === 'EADDRINUSE' ? 'login-port-busy' : 'login-callback-failed')));
    server.listen(port, '127.0.0.1', () => onListening?.());
  });
}

function openBrowser(url) {
  // Arguments, never a shell string: the URL contains '&'.
  const [command, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the URL is printed too */ }
}

async function readSession(sessionPath) {
  try { return JSON.parse(await readFile(sessionPath, 'utf8')); } catch { return null; }
}

/** Load the existing session into `auth` for --link. A refresh it causes is saved at once: the old refresh token is spent. */
async function adoptExistingSession(auth, sessionPath, url, publishableKey) {
  if (!await readSession(sessionPath)) throw new Error('link-session-required');
  return withSessionLock(sessionPath, async () => {
    const saved = await readSession(sessionPath);
    if (!saved || saved.url !== url || typeof saved.accessToken !== 'string' || typeof saved.refreshToken !== 'string') throw new Error('link-session-required');
    const { data, error } = await auth.auth.setSession({ access_token: saved.accessToken, refresh_token: saved.refreshToken });
    if (error || !data?.session || !data.user?.id) throw new Error('client-sign-in-required');
    if (data.session.refresh_token !== saved.refreshToken)
      await writeSessionFile(sessionPath, { url, publishableKey, accessToken: data.session.access_token, refreshToken: data.session.refresh_token });
    return data.user.id;
  });
}

export async function login({ argv = process.argv.slice(2), log = console.error, open = openBrowser, createAuthClient = createClient, request = apiRequest } = {}) {
  const sessionPath = defaultSessionPath(), link = argv.includes('--link'), replace = argv.includes('--replace');
  const { url, publishableKey, port } = await projectSettings({ argv, sessionPath });
  // The user already in the session file. An operator-issued beta session may be its only copy.
  const previousUser = jwtPayload((await readSession(sessionPath))?.accessToken)?.sub ?? null;
  const state = randomBytes(16).toString('hex'), redirectTo = `http://127.0.0.1:${port}/callback/${state}`;
  const auth = createAuthClient(url, publishableKey, { auth: { flowType: 'pkce', storage: memoryStorage(), persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  const linkedUser = link ? await adoptExistingSession(auth, sessionPath, url, publishableKey) : null;
  const options = { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } };
  const { data, error } = link ? await auth.auth.linkIdentity({ provider: 'google', options })
    : await auth.auth.signInWithOAuth({ provider: 'google', options });
  if (error && /manual.?linking/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) throw new Error('manual-linking-disabled');
  if (error || !data?.url) throw new Error('oauth-start-failed');
  const code = await waitForCallback({ port, state, onListening: () => {
    log('브라우저에서 Google 계정을 선택하세요. 홈페이지에서 쓸 계정과 같은 계정이어야 합니다.');
    log(`브라우저가 열리지 않으면 이 주소를 여세요:\n${data.url}`);
    open(data.url);
  } });
  const exchanged = await auth.auth.exchangeCodeForSession(code);
  const session = exchanged.data?.session;
  if (exchanged.error || !session?.access_token || !session.refresh_token || !session.user?.id) throw new Error('oauth-exchange-failed');
  // Linking must keep the same user, or the fighters it owns would no longer be this session's.
  if (link && session.user.id !== linkedUser) throw new Error('link-user-mismatch');
  if (!link && !replace && previousUser && previousUser !== session.user.id) throw new Error('session-user-differs');
  await mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  await withSessionLock(sessionPath, () => writeSessionFile(sessionPath, { url, publishableKey, accessToken: session.access_token, refreshToken: session.refresh_token }));
  log(link ? `기존 계정에 Google을 연결했습니다: ${session.user.id}. 이제 홈페이지와 Dot 모두 Google로 로그인합니다.`
    : `로그인했습니다: ${session.user.email ?? session.user.id}`);
  log(`세션 파일: ${sessionPath}`);
  try {
    const result = await request(url, session.access_token, 'me');
    log(result.account?.invited ? '로그인이 확인되었습니다. 사전 승인 없이 선수를 제출할 수 있습니다.'
      : '이 계정은 현재 이용이 제한되어 있습니다. 홈페이지에서 계정 상태를 확인하세요.');
  } catch (problem) {
    log(problem.message === 'route-not-found' ? '서버가 계정 상태 조회를 지원하지 않습니다. 제출할 때 다시 확인합니다.'
      : '계정 상태를 확인하지 못했습니다. 제출할 때 다시 확인합니다.');
  }
  log('Dot 앱이 이미 실행 중이었다면 앱을 다시 시작하세요.');
  return { sessionPath, userId: session.user.id };
}

/**
 * End this session on the server, then delete the file. A running MCP process still holds the refresh token in
 * memory; revoking the session on the server is what stops it from refreshing and writing the file back.
 */
export async function logout({ log = console.error, createAuthClient = createClient } = {}) {
  const sessionPath = defaultSessionPath();
  if (!await readSession(sessionPath)) { log('로그인된 세션이 없습니다.'); return; }
  const revoked = await withSessionLock(sessionPath, async () => {
    const saved = await readSession(sessionPath);
    let ended = false;
    if (saved && validProjectUrl(saved.url) && isPublishableKey(saved.publishableKey) && typeof saved.accessToken === 'string') {
      try {
        const auth = createAuthClient(saved.url, saved.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        let token = saved.accessToken;
        if ((jwtPayload(token)?.exp ?? 0) * 1000 <= Date.now() + 5000 && typeof saved.refreshToken === 'string') {
          const refreshed = await auth.auth.refreshSession({ refresh_token: saved.refreshToken });
          token = refreshed.data?.session?.access_token ?? null;
        }
        if (token) ended = !(await auth.auth.admin.signOut(token, 'local'))?.error;
      } catch { /* reported below */ }
    }
    await rm(sessionPath, { force: true });
    return ended;
  });
  log(`${sessionPath}를 지웠습니다.`);
  log(revoked ? '서버의 세션도 끝냈습니다. 실행 중인 Dot 앱을 다시 시작하세요.'
    : '서버의 세션을 끝내지 못했습니다. 이미 끝났거나 연결할 수 없습니다. 실행 중인 Dot 앱을 닫아야 세션 파일이 다시 생기지 않습니다.');
}

const messages = {
  'project-url-required': 'Supabase 프로젝트 주소가 필요합니다. AI_FIGHTER_SUPABASE_URL 또는 --url 로 지정하세요.',
  'publishable-key-required': '공개(publishable 또는 anon) 키가 필요합니다. AI_FIGHTER_PUBLISHABLE_KEY 또는 --key 로 지정하세요. 비밀 키와 service_role 키는 받지 않습니다.',
  'invalid-login-port': '--port 는 1024~65535 사이여야 합니다.',
  'login-port-busy': '로그인 콜백 포트가 이미 쓰이고 있습니다. 다른 로그인 창을 닫거나 --port 로 바꾸세요. 바꾼 포트는 Supabase 리다이렉트 허용 목록에도 있어야 합니다.',
  'login-callback-failed': '로그인 콜백 서버를 열지 못했습니다. 다시 실행하세요.',
  'login-timeout': '5분 안에 로그인이 끝나지 않았습니다. 다시 실행하세요.',
  'oauth-denied': 'Google 로그인이 취소되었거나 거부되었습니다. 테스트 모드에서는 등록된 테스트 사용자만 로그인할 수 있습니다.',
  'oauth-start-failed': 'Google 로그인을 시작하지 못했습니다. 프로젝트 주소와 공개 키를 확인하세요.',
  'oauth-exchange-failed': '로그인 코드를 세션으로 바꾸지 못했습니다. 다시 실행하세요.',
  'session-refresh-busy': '다른 프로세스가 세션 파일을 쓰고 있습니다. 잠시 후 다시 실행하세요.',
  'session-user-differs': '세션 파일에 다른 사용자의 세션이 있어 바꾸지 않았습니다. 기존 베타 계정이면 --link 로 Google을 연결하세요. 정말 바꾸려면 --replace 를 붙이세요.',
  'link-session-required': '--link 는 기존 계정의 세션 파일이 필요합니다. AI_FIGHTER_CLIENT_CONFIG 로 그 파일을 지정하세요.',
  'client-sign-in-required': '기존 세션이 끝났습니다. 운영자에게 새 세션 파일을 받은 뒤 --link 를 다시 실행하세요.',
  'manual-linking-disabled': 'Supabase Auth에서 수동 계정 연결(manual linking)이 꺼져 있습니다. 운영자가 켠 뒤 다시 실행하세요.',
  'identity-already-linked': '이 Google 계정은 이미 다른 사용자에 연결되어 있습니다. 그 Google 계정으로 먼저 로그인해 생긴 사용자를 운영자가 정리해야 합니다.',
  'link-user-mismatch': '연결 결과가 기존 사용자와 다릅니다. 세션 파일을 바꾸지 않았습니다.',
};

/** True when this file is the entry script, also when it is run through a symlink or junction. */
function isEntry() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isEntry()) {
  const run = process.argv[2] === 'logout' ? logout() : login({ argv: process.argv.slice(2) });
  run.catch(error => { console.error(messages[error.message] ?? `로그인 실패: ${error.message}`); process.exitCode = 1; });
}
