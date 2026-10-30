// @ts-check
// Shared by every Edge route. No Node-only imports: this file runs on Deno and Node.
import { Problem, UUID } from './bytes.mjs';
export { UUID, Problem, sha256, readBody } from './bytes.mjs';
/**
 * Services the Edge entry hands the route factories; each is null where a deployment lacks it, and every use checks for that.
 * @typedef {{ enabled: boolean, allow: (request: Request, bucket: string, limit: number, windowSeconds: number) => Promise<boolean> }} Limiter
 * @typedef {{ enabled: boolean, review: (args: any) => Promise<any> }} Reviewer
 * @typedef {(owner: string) => Promise<{ tokenHash: string, expiresAt: string }>} CreatorLink
 * @typedef {{ preflight: () => Response, context: (request: Request, owner: string) => Promise<Response>, registered: (row: any) => Promise<void> }} Analytics
 * @typedef {(request: Request, parts: string[]) => Promise<Response>} Route  One route family of the Edge handler.
 */
const BASE_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/**
 * JSON response. `cors` opens a browser route: { methods, headers? }.
 * @param {any} body
 * @param {number} [status]
 * @param {{ methods: string, headers?: string }} [cors]
 */
export function jsonResponse(body, status = 200, cors) {
  const headers = { ...BASE_HEADERS };
  if (cors) Object.assign(headers, { 'access-control-allow-origin': '*', 'access-control-allow-methods': cors.methods },
    cors.headers ? { 'access-control-allow-headers': cors.headers } : {});
  return new Response(JSON.stringify(body), { status, headers });
}

/** @type {(request: Request) => string | null} */
export const bearerToken = request => request.headers.get('authorization')?.match(/^Bearer ([^\s]{16,4096})$/)?.[1] ?? null;

/**
 * The verified, non-anonymous user ID for the request, or null.
 * getClaims verifies an asymmetric JWT locally with the cached JWKS (no Auth round trip) and falls back
 * to the Auth server for symmetric keys. It does not see a sign-out before expiry; revoking the
 * af_creators account stops registration at once.
 * @param {any} db
 * @param {Request} request
 * @returns {Promise<string | null>}
 */
export async function verifiedUserId(db, request) { return (await verifiedUser(db, request))?.owner ?? null; }

/**
 * verifiedUserId with the sign-in session the token belongs to (its `session_id`, null when it names none): an action bound to a live
 * session (site deletion, 2026-10-30) asks the database whether that session still exists, which also catches a sign-out.
 * @param {any} db
 * @param {Request} request
 * @returns {Promise<{ owner: string, session: string | null } | null>}
 */
export async function verifiedUser(db, request) {
  const token = bearerToken(request);
  if (!token) return null;
  /** @type {(claims: any) => string | null} */
  const session = claims => UUID.test(claims?.session_id ?? '') ? claims.session_id.toLowerCase() : null;
  if (typeof db.auth.getClaims === 'function') {
    const { data, error } = await db.auth.getClaims(token);
    const claims = data?.claims;
    return !error && claims && !claims.client_id && claims.role !== 'af_mcp' && claims.is_anonymous !== true && UUID.test(claims.sub ?? '')
      ? { owner: claims.sub, session: session(claims) } : null;
  }
  const { data, error } = await db.auth.getUser(token);
  // Older clients lack getClaims. Decoding here only DENIES connector tokens, or reads the session of a token getUser verified as this user.
  let claims = null;
  if (token.split('.').length === 3) {
    try {
      claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      if (claims.client_id || claims.role === 'af_mcp') return null;
    } catch { return null; }
  }
  return !error && data?.user && !data.user.is_anonymous && UUID.test(data.user.id ?? '')
    ? { owner: data.user.id, session: claims?.sub === data.user.id ? session(claims) : null } : null;
}

/**
 * Postgres jsonb cannot store U+0000 or an unpaired surrogate. JSON.parse and the v1 schema accept both.
 * @param {unknown} value
 * @param {string} [at]
 * @returns {string | null}
 */
export function unstorableTextPath(value, at = '') {
  if (typeof value === 'string') return value.includes('\0') || !value.isWellFormed() ? at : null;
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) { const found = unstorableTextPath(item, `${at}/${key}`); if (found !== null) return found; }
  return null;
}

/**
 * A database function's refusal as the route answers it: the code `statuses` names — the error message itself, or with `contains` the
 * longest code the message contains — with its status. Anything else is what `otherwise(error)` names, else a 503 `unavailable` (a code,
 * or one picked from the error). One helper for every module's database calls: about ten copies disagreed (API 점검 2026-10-29).
 * @param {{ message?: string, code?: string } | null | undefined} error
 * @param {Readonly<Record<string, number>>} statuses
 * @param {{ contains?: boolean, unavailable?: string | ((error: any) => string), otherwise?: (error: any) => Problem | null }} [options]
 * @returns {Problem}
 */
export function rpcProblem(error, statuses, { contains = false, unavailable = 'database-unavailable', otherwise } = {}) {
  const message = error?.message ?? '';
  const code = contains ? Object.keys(statuses).sort((x, y) => y.length - x.length).find(known => message.includes(known))
    : Object.hasOwn(statuses, message) ? message : undefined;
  if (code) return new Problem(statuses[code], code);
  return otherwise?.(error) ?? new Problem(503, typeof unavailable === 'function' ? unavailable(error) : unavailable);
}

/**
 * One module's `db.rpc`: resolves to the function's data, or throws its refusal (rpcProblem).
 * @param {any} db
 * @param {Readonly<Record<string, number>>} statuses
 * @param {Parameters<typeof rpcProblem>[2]} [options]
 * @returns {(name: string, args: Record<string, unknown>) => Promise<any>}
 */
export const rpcCaller = (db, statuses, options) => async (name, args) => {
  const { data, error } = await db.rpc(name, args);
  if (error) throw rpcProblem(error, statuses, options);
  return data;
};
