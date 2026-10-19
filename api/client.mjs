import { readFile, writeFile } from 'node:fs/promises';
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
  if (!response.ok) { const error = new Error(result.code ?? `api-http-${response.status}`); error.status = response.status; throw error; }
  return result;
}
export async function createRemoteClient(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!validProjectUrl(config.url) || !config.publishableKey || !config.accessToken || !config.refreshToken) throw new Error('invalid-client-config');
  const auth = createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let pendingAuth;
  async function token() {
    if (!pendingAuth) pendingAuth = (async () => {
      const { data, error } = await auth.auth.setSession({ access_token: config.accessToken, refresh_token: config.refreshToken });
      if (error || !data.session) throw new Error('client-sign-in-required');
      if (data.session.access_token !== config.accessToken || data.session.refresh_token !== config.refreshToken) {
        config.accessToken = data.session.access_token; config.refreshToken = data.session.refresh_token;
        await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
      }
      return data.session.access_token;
    })().finally(() => { pendingAuth = undefined; });
    return pendingAuth;
  }
  return { request: async (route, options) => apiRequest(config.url, await token(), route, options) };
}
