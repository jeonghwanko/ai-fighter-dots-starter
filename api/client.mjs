import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

export function validProjectUrl(url) {
  return typeof url === 'string' && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url);
}
/** 30 s plus one second per 64 KiB: a 4 MB asset still finishes on a ~0.5 Mbit/s link. */
export const transferTimeoutMs = bytes => 30000 + Math.ceil(Math.max(0, bytes || 0) / 65536) * 1000;
const bodyBytes = body => body == null ? 0 : typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength ?? 0;

export async function apiRequest(url, token, route, { method = 'GET', body, headers = {}, timeoutMs = transferTimeoutMs(bodyBytes(body)) } = {}) {
  let response;
  try { response = await fetch(`${url}/functions/v1/ai-fighter/${route}`, { method, body, headers: { authorization: `Bearer ${token}`, ...headers }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new Error('api-unreachable'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('invalid-api-response'); }
  if (!response.ok) { const error = new Error(result?.code ?? `api-http-${response.status}`); error.status = response.status; throw error; }
  if (!result || typeof result !== 'object') throw new Error('invalid-api-response');
  return result;
}

/** Expiry time in milliseconds from the JWT payload, or 0. Only decides when to refresh; the server verifies the token. */
function accessTokenExpiry(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp * 1000 || 0; }
  catch { return 0; }
}
const REFRESH_MARGIN_MS = 60000, LOCK_STALE_MS = 30000, LOCK_WAIT_MS = 15000;

/**
 * Several MCP processes may share one session file (desktop app, CLI, IDE). Supabase rotates the refresh
 * token on every refresh and ends the whole session when a token two rotations old is used. So a process
 * first adopts a newer session another process saved, and refreshes only under a lock file.
 */
export async function createRemoteClient(configPath, { createAuthClient = createClient } = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!validProjectUrl(config.url) || !config.publishableKey || !config.accessToken || !config.refreshToken) throw new Error('invalid-client-config');
  const auth = createAuthClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const fresh = () => accessTokenExpiry(config.accessToken) - Date.now() > REFRESH_MARGIN_MS;
  async function adoptSaved() {
    try {
      const saved = JSON.parse(await readFile(configPath, 'utf8'));
      if (saved.url === config.url && typeof saved.accessToken === 'string' && typeof saved.refreshToken === 'string'
        && accessTokenExpiry(saved.accessToken) > accessTokenExpiry(config.accessToken)) {
        config.accessToken = saved.accessToken; config.refreshToken = saved.refreshToken;
      }
    } catch { /* keep the session in memory */ }
  }
  async function withLock(task) {
    const lock = `${configPath}.lock`, started = Date.now();
    for (;;) {
      try { await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const modified = await stat(lock).then(info => info.mtimeMs, () => null);
        if (modified !== null && Date.now() - modified > LOCK_STALE_MS) { await rm(lock, { force: true }); continue; }
        if (Date.now() - started > LOCK_WAIT_MS) throw new Error('session-refresh-busy');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try { return await task(); } finally { await rm(lock, { force: true }); }
  }
  async function save() {
    // The old refresh token is now spent. Replace the file atomically: a partial write would lose the only valid session.
    const temporary = `${configPath}.${process.pid}.tmp`;
    try {
      await rm(temporary, { force: true });
      await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, configPath);
    } catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  let pendingAuth;
  async function token() {
    // A valid token needs no auth call.
    if (fresh()) return config.accessToken;
    pendingAuth ??= (async () => {
      await adoptSaved();
      if (fresh()) return config.accessToken;
      return withLock(async () => {
        await adoptSaved(); // Another process may have refreshed while this one waited.
        if (fresh()) return config.accessToken;
        const { data, error } = await auth.auth.refreshSession({ refresh_token: config.refreshToken });
        if (error || !data.session) throw new Error('client-sign-in-required');
        config.accessToken = data.session.access_token; config.refreshToken = data.session.refresh_token;
        await save();
        return config.accessToken;
      });
    })().finally(() => { pendingAuth = undefined; });
    return pendingAuth;
  }
  return { request: async (route, options) => apiRequest(config.url, await token(), route, options) };
}
