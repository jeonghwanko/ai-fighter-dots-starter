// Shared by every Edge route. No Node-only imports: this file runs on Deno and Node.
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BASE_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** JSON response. `cors` opens a browser route: { methods, headers? }. */
export function jsonResponse(body, status = 200, cors) {
  const headers = { ...BASE_HEADERS };
  if (cors) Object.assign(headers, { 'access-control-allow-origin': '*', 'access-control-allow-methods': cors.methods },
    cors.headers ? { 'access-control-allow-headers': cors.headers } : {});
  return new Response(JSON.stringify(body), { status, headers });
}

export const bearerToken = request => request.headers.get('authorization')?.match(/^Bearer ([^\s]{16,4096})$/)?.[1] ?? null;

/**
 * The verified, non-anonymous user ID for the request, or null.
 * getClaims verifies an asymmetric JWT locally with the cached JWKS (no Auth round trip) and falls back
 * to the Auth server for symmetric keys. It does not see a sign-out before expiry; revoking the
 * af_creators account stops registration at once.
 */
export async function verifiedUserId(db, request) {
  const token = bearerToken(request);
  if (!token) return null;
  if (typeof db.auth.getClaims === 'function') {
    const { data, error } = await db.auth.getClaims(token);
    const claims = data?.claims;
    return !error && claims && !claims.client_id && claims.role !== 'af_mcp' && claims.is_anonymous !== true && UUID.test(claims.sub ?? '') ? claims.sub : null;
  }
  const { data, error } = await db.auth.getUser(token);
  // Older clients lack getClaims. Only use decoding here to DENY connector tokens; getUser still verifies identity.
  if (token.split('.').length === 3) {
    try {
      const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      if (claims.client_id || claims.role === 'af_mcp') return null;
    } catch { return null; }
  }
  return !error && data?.user && !data.user.is_anonymous && UUID.test(data.user.id ?? '') ? data.user.id : null;
}

export class Problem extends Error { constructor(status, code, errors) { super(code); this.status = status; this.errors = errors; } }
export const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

/** Read at most `maximum` bytes, even when Content-Length is missing or false. */
export async function readBody(request, maximum) {
  if (Number(request.headers.get('content-length')) > maximum) throw new Problem(413, 'body-limit');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.length;
      if (count > maximum) { await reader.cancel(); throw new Problem(413, 'body-limit'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(count); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Postgres jsonb cannot store U+0000 or an unpaired surrogate. JSON.parse and the v1 schema accept both. */
export function unstorableTextPath(value, at = '') {
  if (typeof value === 'string') return value.includes('\0') || !value.isWellFormed() ? at : null;
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) { const found = unstorableTextPath(item, `${at}/${key}`); if (found !== null) return found; }
  return null;
}
