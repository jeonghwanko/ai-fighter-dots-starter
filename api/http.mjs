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
 * af_creators invitation stops registration at once.
 */
export async function verifiedUserId(db, request, issuer) {
  const token = bearerToken(request);
  if (!token || !db.auth?.getClaims) return null;
  // supabase-js verifies the signature/expiry (and uses Auth for symmetric signing keys).
  // Only first-party sessions may act as an owner. Native OAuth tokens must never fall
  // through to the old owner-only policy, even with a valid signature and matching sub.
  const { data, error } = await db.auth.getClaims(token);
  const c = data?.claims;
  return !error && c && c.is_anonymous !== true && UUID.test(c.sub ?? '')
    && c.role === 'authenticated' && c.aud === 'authenticated' && c.client_id == null
    && Number.isFinite(c.exp) && c.exp * 1000 > Date.now()
    && typeof c.iss === 'string' && (!issuer || c.iss === issuer)
    ? c.sub : null;
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
