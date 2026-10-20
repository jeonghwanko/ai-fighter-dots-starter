import { Problem, bearerToken, jsonResponse, readBody, verifiedUserId } from './http.mjs';

const CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type' };
const reply = (body, status = 200) => jsonResponse(body, status, CORS);
const NOTE_LIMIT = 500;
const errorStatus = { 'already-invited': 409, 'request-declined': 409, 'rate-limit': 429, 'note-too-long': 422 };
const ROUTES = { me: 'GET', 'access-requests': 'POST', 'creator-handoffs': 'POST' };

/**
 * GET /me, POST /access-requests and POST /creator-handoffs. Any signed-in, non-anonymous user may call them:
 * these routes run before af_authorize, so a user without an invitation can see that and ask for one.
 * creatorLink(owner) mints a one-use sign-in token for the creator homepage; the browser redeems it with Supabase Auth.
 */
export function createAccountHandler({ db, creatorLink = null }) {
  async function call(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      if (errorStatus[error.message]) throw new Problem(errorStatus[error.message], error.message);
      throw new Problem(503, error.code === 'PGRST202' ? 'account-not-ready' : 'account-unavailable');
    }
    if (!data || typeof data !== 'object' || typeof data.invited !== 'boolean') throw new Problem(503, 'account-unavailable');
    return { invited: data.invited, expiresAt: data.invited ? data.expiresAt ?? null : null, request: data.request ?? null };
  }
  return async (request, parts) => {
    try {
      const route = parts.join('/');
      if (!Object.hasOwn(ROUTES, route)) return reply({ ok: false, code: 'not-found' }, 404);
      if (request.method === 'OPTIONS') return reply({ ok: true });
      if (request.method !== ROUTES[route]) return reply({ ok: false, code: 'method-not-allowed' }, 405);
      if (!bearerToken(request)) throw new Problem(401, 'authentication-required');
      const owner = await verifiedUserId(db, request);
      if (!owner) throw new Problem(401, 'authentication-required');
      if (route === 'me') return reply({ ok: true, account: await call('af_account', { p_owner: owner }) });
      if (route === 'creator-handoffs') {
        if (!creatorLink) throw new Problem(503, 'handoff-unavailable');
        // Only the verified token names the account; the request body is never read.
        const link = await creatorLink(owner);
        if (!link || typeof link.tokenHash !== 'string' || !/^[a-f0-9]{40,128}$/.test(link.tokenHash)) throw new Problem(503, 'handoff-unavailable');
        return reply({ ok: true, stage: 'creator-link', tokenHash: link.tokenHash, expiresAt: link.expiresAt });
      }
      let note = '';
      const bytes = await readBody(request, 4000);
      if (bytes.length) {
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new Problem(400, 'invalid-body'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Problem(400, 'invalid-body');
        if (body.note !== undefined) {
          if (typeof body.note !== 'string') throw new Problem(400, 'invalid-body');
          note = body.note.trim();
          if (note.includes('\0') || !note.isWellFormed()) throw new Problem(422, 'invalid-note');
          if (note.length > NOTE_LIMIT) throw new Problem(422, 'note-too-long');
        }
      }
      return reply({ ok: true, account: await call('af_request_access', { p_owner: owner, p_note: note }) });
    } catch (error) {
      if (error instanceof Problem) return reply({ ok: false, code: error.message }, error.status);
      return reply({ ok: false, code: 'account-unavailable' }, 503);
    }
  };
}
