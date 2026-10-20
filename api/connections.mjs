import { Problem, UUID, bearerToken, jsonResponse, readBody, sha256, verifiedUserId } from './http.mjs';

export const CONNECTION_PERMISSIONS = ['fighter:read', 'fighter:submit'];
const HEX = /^[a-f0-9]{64}$/;
const hashText = text => sha256(new TextEncoder().encode(text));
const CORS = { methods: 'GET, POST, OPTIONS', headers: 'Authorization, Content-Type, X-AF-Client-ID, X-AF-Resource' };
const reply = (body, status = 200) => jsonResponse(body, status, CORS);
const statuses = {
  'connection-not-found': 404, 'connection-expired': 403, 'connection-inactive': 403,
  'connection-conflict': 409, 'connection-client': 403, 'connection-resource': 403,
  'connection-permission': 403, 'connection-limit': 429, 'invalid-connection': 400,
};
async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Problem(statuses[error.message] ?? 503, statuses[error.message] ? error.message : 'connection-unavailable');
  if (!data || typeof data !== 'object') throw new Problem(503, 'connection-unavailable');
  return data;
}
async function body(request, allowed) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBody(request, 4096))); }
  catch (error) { if (error instanceof Problem) throw error; throw new Problem(400, 'invalid-connection'); }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !allowed.includes(k)))
    throw new Problem(400, 'invalid-connection');
  return value;
}
function permissions(value) {
  if (!Array.isArray(value) || !value.length || value.length > 2 || new Set(value).size !== value.length
    || value.some(p => !CONNECTION_PERMISSIONS.includes(p))) throw new Problem(400, 'invalid-connection');
  return [...value].sort();
}
export function connectionAction(method, parts) {
  if (method === 'GET' && ((parts.length === 1 && parts[0] === 'fighters')
    || (parts.length === 2 && ['fighters', 'submissions'].includes(parts[0]))
    || (parts.length === 3 && parts[0] === 'fighters' && parts[2] === 'statistics'))) return 'fighter:read';
  if ((method === 'POST' && parts.join('/') === 'submissions')
    || (method === 'POST' && parts.length === 3 && parts[0] === 'submissions' && parts[2] === 'submit')
    || (method === 'PUT' && parts.length === 4 && parts[0] === 'submissions' && parts[2] === 'assets')) return 'fighter:submit';
  return null;
}
export function createConnectionAccess({ db, issuer, resource }) {
  async function agent(request, action, target = '') {
    const token = bearerToken(request);
    if (!/^afg_[a-f0-9]{64}$/.test(token ?? '')) throw new Problem(401, 'authentication-required');
    if (!resource) throw new Problem(503, 'connection-not-configured');
    if (request.headers.get('x-af-resource') !== resource) throw new Problem(403, 'connection-resource');
    return rpc(db, 'af_connection_agent', { p_token_hash: await hashText(token),
      p_client: request.headers.get('x-af-client-id') ?? '', p_resource: resource, p_action: action, p_target: target });
  }
  async function owner(request) {
    const id = await verifiedUserId(db, request, issuer);
    if (!id) throw new Problem(401, 'authentication-required');
    return id;
  }
  return {
    async principal(request, parts) {
      if (bearerToken(request)?.startsWith('afg_')) {
        const action = connectionAction(request.method, parts);
        if (!action) throw new Problem(403, 'connection-permission');
        const grant = await agent(request, action, parts.join('/'));
        return { owner: grant.ownerId, agentId: grant.agentId, connectionId: grant.id };
      }
      return { owner: await owner(request), agentId: null, connectionId: null };
    },
    async handle(request, parts) {
      try {
        if (request.method === 'OPTIONS') return reply({ ok: true });
        if (!resource || !issuer) throw new Problem(503, 'connection-not-configured');
        const route = parts.slice(1).join('/');
        if (request.method === 'POST' && route === 'start') {
          const b = await body(request, ['requestId', 'clientId', 'tokenHash', 'codeHash', 'permissions']);
          if (!UUID.test(b.requestId ?? '') || !HEX.test(b.tokenHash ?? '') || !HEX.test(b.codeHash ?? '')
            || typeof b.clientId !== 'string' || b.clientId.length > 64) throw new Problem(400, 'invalid-connection');
          return reply({ ok: true, connection: await rpc(db, 'af_connection_start', {
            p_request: b.requestId, p_client: b.clientId, p_token_hash: b.tokenHash, p_code_hash: b.codeHash,
            p_resource: resource, p_permissions: permissions(b.permissions),
          }) });
        }
        if (request.method === 'POST' && ['status', 'cancel'].includes(route)) {
          await body(request, []);
          return reply({ ok: true, connection: await agent(request, route) });
        }
        const who = await owner(request);
        if (request.method === 'GET' && route === '') return reply({ ok: true,
          connection: await rpc(db, 'af_connection_owner', { p_owner: who, p_command: 'list' }) });
        if (request.method !== 'POST' || !['inspect', 'approve', 'deny', 'revoke'].includes(route)) throw new Problem(404, 'route-not-found');
        const b = await body(request, route === 'revoke' ? ['connectionId'] : route === 'approve' ? ['code', 'permissions', 'seconds', 'expectedSubject'] : ['code']);
        if (route === 'revoke' ? !UUID.test(b.connectionId ?? '') : !/^[a-f0-9]{32}$/.test(b.code ?? ''))
          throw new Problem(400, 'invalid-connection');
        const args = { p_owner: who, p_command: route, ...(route === 'revoke' ? { p_id: b.connectionId } : { p_code_hash: await hashText(b.code) }) };
        if (route === 'approve') {
          // This comparison binds consent to the account the human inspected. It
          // never assigns ownership from the body; `who` remains the verified JWT sub.
          if (!UUID.test(b.expectedSubject ?? '')) throw new Problem(400, 'invalid-connection');
          if (b.expectedSubject !== who) throw new Problem(403, 'connection-account-changed');
          args.p_permissions = permissions(b.permissions);
          if (!Number.isInteger(b.seconds) || b.seconds < 60 || b.seconds > 3600) throw new Problem(400, 'invalid-connection');
          args.p_seconds = b.seconds;
        }
        const connection = await rpc(db, 'af_connection_owner', args);
        return reply({ ok: true, connection: route === 'inspect' ? { ...connection, subject: who } : connection });
      } catch (error) { return reply({ ok: false, code: error instanceof Problem ? error.message : 'connection-unavailable' }, error instanceof Problem ? error.status : 503); }
    },
  };
}
