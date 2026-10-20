import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

export function validProjectUrl(url) {
  return typeof url === 'string' && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url);
}
export async function apiRequest(url, token, route, { method = 'GET', body, headers = {} } = {}) {
  let response;
  try { response = await fetch(`${url}/functions/v1/ai-fighter/${route}`, { method, body, headers: { authorization: `Bearer ${token}`, ...headers }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
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
const REFRESH_MARGIN_MS = 60000;

export async function createRemoteClient(configPath, { createAuthClient = createClient } = {}) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!validProjectUrl(config.url) || !config.publishableKey || !config.accessToken || !config.refreshToken) throw new Error('invalid-client-config');
  const auth = createAuthClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let pendingAuth;
  async function token() {
    // A valid token needs no auth call. setSession() made one network request per API call.
    if (accessTokenExpiry(config.accessToken) - Date.now() > REFRESH_MARGIN_MS) return config.accessToken;
    if (!pendingAuth) pendingAuth = (async () => {
      const { data, error } = await auth.auth.refreshSession({ refresh_token: config.refreshToken });
      if (error || !data.session) throw new Error('client-sign-in-required');
      config.accessToken = data.session.access_token; config.refreshToken = data.session.refresh_token;
      // The old refresh token is now spent. Replace the file atomically: a partial write would lose the only valid session.
      const temporary = `${configPath}.${process.pid}.tmp`;
      try {
        await rm(temporary, { force: true });
        await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await rename(temporary, configPath);
      } catch (writeError) { await rm(temporary, { force: true }); throw writeError; }
      return config.accessToken;
    })().finally(() => { pendingAuth = undefined; });
    return pendingAuth;
  }
  return { request: async (route, options) => apiRequest(config.url, await token(), route, options) };
}
