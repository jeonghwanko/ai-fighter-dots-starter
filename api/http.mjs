// @ts-check
// Shared by every Edge route. No Node-only imports: this file runs on Deno and Node.
import { UUID } from './bytes.mjs';
export { UUID, Problem, sha256, readBody } from './bytes.mjs';
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

/** Postgres jsonb cannot store U+0000 or an unpaired surrogate. JSON.parse and the v1 schema accept both. */
export function unstorableTextPath(value, at = '') {
  if (typeof value === 'string') return value.includes('\0') || !value.isWellFormed() ? at : null;
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) { const found = unstorableTextPath(item, `${at}/${key}`); if (found !== null) return found; }
  return null;
}
